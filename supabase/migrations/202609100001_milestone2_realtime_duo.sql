create extension if not exists pgcrypto;

create table if not exists public.players (
  id text primary key,
  display_name text not null check (length(display_name) between 1 and 32),
  created_at timestamptz not null default now()
);

create table if not exists public.games (
  id uuid primary key default gen_random_uuid(),
  room_code text not null unique check (length(room_code) = 4),
  status text not null default 'waiting' check (status in ('waiting', 'active', 'ended')),
  host_player_id text not null references public.players(id),
  current_round_number integer not null default 0 check (current_round_number >= 0),
  created_at timestamptz not null default now(),
  ended_at timestamptz
);

create table if not exists public.game_players (
  game_id uuid not null references public.games(id) on delete cascade,
  player_id text not null references public.players(id) on delete cascade,
  slot integer not null check (slot in (1, 2)),
  ready boolean not null default false,
  wants_next_round boolean not null default false,
  joined_at timestamptz not null default now(),
  primary key (game_id, player_id),
  unique (game_id, slot)
);

create table if not exists public.rounds (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  round_number integer not null check (round_number > 0),
  prompt text not null,
  status text not null default 'prompt' check (status in ('prompt', 'drawing', 'judging', 'results', 'reveal', 'complete')),
  winner_player_id text references public.players(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (game_id, round_number)
);

create table if not exists public.round_submissions (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.rounds(id) on delete cascade,
  player_id text not null references public.players(id) on delete cascade,
  submitted boolean not null default false,
  submitted_at timestamptz,
  unique (round_id, player_id)
);

alter table public.players enable row level security;
alter table public.games enable row level security;
alter table public.game_players enable row level security;
alter table public.rounds enable row level security;
alter table public.round_submissions enable row level security;

create policy "m2 players readable" on public.players for select using (true);
create policy "m2 players create own guest row" on public.players for insert with check (id is not null);
create policy "m2 players update display name" on public.players for update using (true) with check (id is not null);

create policy "m2 games readable by room clients" on public.games for select using (true);
create policy "m2 games create" on public.games for insert with check (status = 'waiting');
create policy "m2 games update lifecycle" on public.games for update using (true) with check (status in ('waiting', 'active', 'ended'));

create policy "m2 game players readable" on public.game_players for select using (true);
create policy "m2 game players join" on public.game_players for insert with check (slot in (1, 2));
create policy "m2 game players update flags" on public.game_players for update using (true) with check (slot in (1, 2));

create policy "m2 rounds readable" on public.rounds for select using (true);
create policy "m2 rounds update lifecycle" on public.rounds for update using (true) with check (status in ('prompt', 'drawing', 'judging', 'results', 'reveal', 'complete'));

create policy "m2 submissions readable" on public.round_submissions for select using (true);
create policy "m2 submissions update" on public.round_submissions for update using (true) with check (submitted = true);

create or replace function public.start_round_if_ready(
  p_game_id uuid,
  p_actor_player_id text,
  p_prompt text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game games%rowtype;
  v_ready_count integer;
begin
  select * into v_game
  from games
  where id = p_game_id
  for update;

  if not found then
    raise exception 'Game not found';
  end if;

  if v_game.host_player_id <> p_actor_player_id then
    raise exception 'Only the host can start the round';
  end if;

  if v_game.status <> 'waiting' or v_game.current_round_number <> 0 then
    return;
  end if;

  select count(*) into v_ready_count
  from game_players
  where game_id = p_game_id and ready = true;

  if v_ready_count <> 2 then
    raise exception 'Both players must be ready';
  end if;

  update games
  set status = 'active', current_round_number = 1
  where id = p_game_id;

  insert into rounds (game_id, round_number, prompt, status)
  values (p_game_id, 1, p_prompt, 'prompt')
  on conflict (game_id, round_number) do nothing;
end;
$$;

create or replace function public.submit_round_drawing(
  p_game_id uuid,
  p_round_id uuid,
  p_player_id text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_submitted_count integer;
begin
  if not exists (select 1 from game_players where game_id = p_game_id and player_id = p_player_id) then
    raise exception 'Player is not in this game';
  end if;

  -- Serialize concurrent submits on this round so the 2/2 transition to
  -- 'judging' cannot be lost when both players submit at the same instant.
  perform 1 from rounds where id = p_round_id and game_id = p_game_id for update;
  if not found then
    raise exception 'Round not found';
  end if;

  insert into round_submissions (round_id, player_id, submitted, submitted_at)
  values (p_round_id, p_player_id, true, now())
  on conflict (round_id, player_id)
  do update set submitted = true, submitted_at = coalesce(round_submissions.submitted_at, now());

  select count(*) into v_submitted_count
  from round_submissions
  where round_id = p_round_id and submitted = true;

  if v_submitted_count = 2 then
    update rounds
    set status = 'judging'
    where id = p_round_id and game_id = p_game_id and status in ('drawing', 'prompt');
  end if;
end;
$$;

-- Drop the pre-correction 3-arg version if an earlier copy of this file was
-- applied, so only the server-derived-winner version below remains.
drop function if exists public.complete_fake_judging(uuid, uuid, text);

create or replace function public.complete_fake_judging(
  p_game_id uuid,
  p_round_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_winner_player_id text;
begin
  -- Deterministic fake judge: slot 1 always wins. The winner is derived
  -- server-side so it does not matter which client calls this, and both
  -- clients cannot disagree. The status guard makes a second call a no-op.
  select player_id into v_winner_player_id
  from game_players
  where game_id = p_game_id and slot = 1;

  update rounds
  set status = 'results', winner_player_id = v_winner_player_id, completed_at = now()
  where id = p_round_id
    and game_id = p_game_id
    and status = 'judging';
end;
$$;

create or replace function public.request_next_round(
  p_game_id uuid,
  p_player_id text,
  p_prompts text[]
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game games%rowtype;
  v_next_round integer;
  v_next_prompt text;
  v_ready_count integer;
begin
  update game_players
  set wants_next_round = true
  where game_id = p_game_id and player_id = p_player_id;

  select * into v_game
  from games
  where id = p_game_id
  for update;

  if not found or v_game.status <> 'active' then
    return;
  end if;

  select count(*) into v_ready_count
  from game_players
  where game_id = p_game_id and wants_next_round = true;

  if v_ready_count <> 2 then
    return;
  end if;

  v_next_round := v_game.current_round_number + 1;
  v_next_prompt := p_prompts[((v_next_round - 1) % array_length(p_prompts, 1)) + 1];

  update game_players
  set ready = false, wants_next_round = false
  where game_id = p_game_id;

  update games
  set current_round_number = v_next_round
  where id = p_game_id;

  insert into rounds (game_id, round_number, prompt, status)
  values (p_game_id, v_next_round, v_next_prompt, 'prompt')
  on conflict (game_id, round_number) do nothing;
end;
$$;

grant execute on function public.start_round_if_ready(uuid, text, text) to anon;
grant execute on function public.submit_round_drawing(uuid, uuid, text) to anon;
grant execute on function public.complete_fake_judging(uuid, uuid) to anon;
grant execute on function public.request_next_round(uuid, text, text[]) to anon;

alter publication supabase_realtime add table public.games;
alter publication supabase_realtime add table public.game_players;
alter publication supabase_realtime add table public.rounds;
alter publication supabase_realtime add table public.round_submissions;
