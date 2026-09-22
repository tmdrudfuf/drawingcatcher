-- Milestone 4G: authoritative random drawing-prompt selection.
--
-- Before this migration, the drawing prompt was effectively FIXED, not
-- random: src/services/game/roomService.ts hardcoded
-- src/services/game/fakeData.ts's FAKE_PROMPTS (four cat-only prompts) and
-- passed it into these RPCs as a plain argument --
-- start_round_if_ready(..., p_prompt) always received FAKE_PROMPTS[0]
-- ("Draw a cat"), and request_next_round(..., p_prompts) deterministically
-- cycled through the same fixed 4-entry array by round number
-- (`p_prompts[((round-1) % length) + 1]`). Every game, in order, always
-- saw exactly: "Draw a cat", "Draw a cat as a superhero",
-- "Draw a cat eating pizza", "Draw the grumpiest cat", then repeat.
--
-- This migration moves the prompt POOL into the database and makes both
-- RPCs select a prompt themselves, server-side, via `order by random()` --
-- the same authoritative-RPC pattern this project already uses everywhere
-- else for anything that must be decided exactly once and agreed on by
-- both Duo devices (see e.g. complete_fake_judging's server-derived
-- winner). The client no longer supplies a prompt or a prompt list at
-- all: both RPCs' signatures drop that parameter entirely, so there is no
-- remaining channel for a client to choose or influence prompt selection,
-- and two devices calling these RPCs for the same round can never
-- disagree -- there is exactly one INSERT of exactly one rounds row per
-- (game_id, round_number), same `on conflict (game_id, round_number) do
-- nothing` race guard as before, now just filled in with a
-- server-selected prompt instead of a client-supplied one.
--
-- request_next_round additionally looks up the ENDING round's own persisted
-- prompt and excludes it from the random pick, so round N+1 never
-- immediately repeats round N's prompt (falls back to allowing a repeat
-- only if the pool has been reduced to a single entry, which never
-- happens with real content -- see the function body).

create table if not exists public.drawing_prompts (
  id uuid primary key default gen_random_uuid(),
  prompt text not null unique,
  created_at timestamptz not null default now()
);

alter table public.drawing_prompts enable row level security;

-- Prompts are game content, not sensitive -- readable by any client, same
-- as games/rounds/round_submissions. No insert/update/delete policy: only
-- this migration (and any future one) ever writes to this table; the RPCs
-- below only ever SELECT from it.
drop policy if exists "m4g drawing prompts readable" on public.drawing_prompts;
create policy "m4g drawing prompts readable" on public.drawing_prompts
  for select using (true);

-- Curated MVP pool (80 prompts). Deliberately hand-curated, not generated
-- by combining words at runtime -- each is individually short, immediately
-- legible for a timed drawing game, visually distinctive, and safe. Broad
-- subject diversity on purpose: only one of these 80 mentions a cat.
insert into public.drawing_prompts (prompt) values
  ('The grumpiest cat'),
  ('A superhero potato'),
  ('A ghost afraid of ghosts'),
  ('A robot chef'),
  ('A wizard frog'),
  ('An angry toaster'),
  ('A dinosaur at the beach'),
  ('A sleepy monster'),
  ('A banana knight'),
  ('An alien on vacation'),
  ('A dog detective'),
  ('A pirate duck'),
  ('A dragon working an office job'),
  ('A very suspicious fish'),
  ('A zombie ballerina'),
  ('A vampire afraid of the dark'),
  ('A nervous shark at a job interview'),
  ('A confused owl doing taxes'),
  ('A proud snail winning a race'),
  ('A dramatic hedgehog storming off'),
  ('An awkward raccoon on a first date'),
  ('A cowboy octopus'),
  ('A scared turtle whose shell is too small'),
  ('A secret agent chicken'),
  ('A goat astronaut'),
  ('A llama giving a speech'),
  ('A sloth trying to catch a bus'),
  ('A bat afraid of caves'),
  ('A squirrel villain with an evil plan'),
  ('A crab lifeguard'),
  ('A seagull stealing a sandwich'),
  ('A mouse wrestler'),
  ('A pigeon secret agent'),
  ('A hippo ballerina'),
  ('A flamingo referee'),
  ('A walrus librarian'),
  ('A yeti stuck in traffic'),
  ('A gnome scientist'),
  ('A troll doing yoga'),
  ('A mermaid stuck in a bathtub'),
  ('A werewolf who forgot it is full moon'),
  ('A cyclops trying to thread a needle'),
  ('A robot in love'),
  ('An alien ordering coffee for the first time'),
  ('A dragon afraid of fire'),
  ('A knight who lost their sword'),
  ('A pirate who gets seasick'),
  ('A detective duck solving a mystery'),
  ('A chef penguin cooking dinner'),
  ('A superhero sock'),
  ('A villain teapot plotting revenge'),
  ('A musician cactus'),
  ('An athlete pineapple'),
  ('A dancing traffic cone'),
  ('A vacuum cleaner afraid of the dark'),
  ('An umbrella having a bad day'),
  ('A taco on a first date'),
  ('A pizza slice giving a speech'),
  ('An ice cream cone melting under pressure'),
  ('A donut trying to escape a bakery'),
  ('A mailbox waiting for good news'),
  ('A bowling pin that refuses to fall'),
  ('A scientist mouse mixing a potion'),
  ('A frog lifeguard who cannot swim'),
  ('A referee bear who breaks all the rules'),
  ('A librarian bat shushing everyone'),
  ('A wrestler snail in the ring'),
  ('A cowboy chicken riding into the sunset'),
  ('An astronaut fish who forgot their helmet'),
  ('A wizard raccoon casting a spell'),
  ('A knight afraid of dragons'),
  ('A superhero snail with no sense of urgency'),
  ('A DJ ghost at a party'),
  ('A dinosaur trying to fit through a doorway'),
  ('A very proud rooster'),
  ('A confused robot ordering food'),
  ('A sleepy dragon guarding treasure'),
  ('An alien confused by earth food'),
  ('A pirate parrot who lost its ship'),
  ('A dramatic peacock')
on conflict (prompt) do nothing;

-- start_round_if_ready: drop the 3-arg version (p_prompt was client-supplied)
-- and replace it with a 2-arg version that selects the prompt itself.
drop function if exists public.start_round_if_ready(uuid, text, text);

create or replace function public.start_round_if_ready(
  p_game_id uuid,
  p_actor_player_id text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game games%rowtype;
  v_ready_count integer;
  v_prompt text;
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

  select prompt into v_prompt
  from public.drawing_prompts
  order by random()
  limit 1;

  if v_prompt is null then
    raise exception 'No drawing prompts are configured';
  end if;

  update games
  set status = 'active', current_round_number = 1
  where id = p_game_id;

  insert into rounds (game_id, round_number, prompt, status)
  values (p_game_id, 1, v_prompt, 'prompt')
  on conflict (game_id, round_number) do nothing;
end;
$$;

grant execute on function public.start_round_if_ready(uuid, text) to anon;

-- request_next_round: drop the 3-arg version (p_prompts was
-- client-supplied) and replace it with a 2-arg version that selects the
-- next prompt itself, avoiding an immediate repeat of the ending round's
-- own prompt whenever the pool allows it.
drop function if exists public.request_next_round(uuid, text, text[]);

create or replace function public.request_next_round(
  p_game_id uuid,
  p_player_id text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game games%rowtype;
  v_next_round integer;
  v_previous_prompt text;
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

  select prompt into v_previous_prompt
  from rounds
  where game_id = p_game_id and round_number = v_game.current_round_number;

  -- Avoid an immediate repeat of the ending round's prompt whenever the
  -- pool allows it (it always does in practice -- the pool has 80 entries,
  -- so at most one is ever excluded).
  select prompt into v_next_prompt
  from public.drawing_prompts
  where prompt is distinct from v_previous_prompt
  order by random()
  limit 1;

  if v_next_prompt is null then
    -- Only reachable if the pool has been reduced to a single row that
    -- happens to equal the previous prompt -- fall back to allowing a
    -- repeat rather than ever leaving the next round without a prompt.
    select prompt into v_next_prompt
    from public.drawing_prompts
    order by random()
    limit 1;
  end if;

  if v_next_prompt is null then
    raise exception 'No drawing prompts are configured';
  end if;

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

grant execute on function public.request_next_round(uuid, text) to anon;
