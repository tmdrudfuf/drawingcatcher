-- V1: combinatorial Character x Situation drawing-prompt generator.
--
-- Replaces the fixed 80-entry curated pool from 202609100014 (which is left
-- untouched, not dropped -- its rows simply stop being selected from) with
-- two small content tables -- public.prompt_characters and
-- public.prompt_situations -- combined server-side into the final English
-- prompt string. This keeps the EXACT same integration surface as before:
-- rounds.prompt is still a plain `text` column, start_round_if_ready and
-- request_next_round keep their existing (uuid, text) signatures, and
-- roomService.ts/RoomSnapshot need zero changes -- the client still only
-- ever reads the already-assembled rounds.prompt string it always did.
--
-- CONTENT MODEL
--   prompt_characters: one row per recognizable noun ("bear", "robot", ...)
--     plus its grammatical article ('a'/'an') and a small set of
--     compatibility tags. Only three tags exist -- large, tiny, grounded --
--     each backing exactly one family of size/flight jokes below; no tag
--     was added speculatively.
--   prompt_situations: one row per trailing phrase, in three groups:
--     - universal: joins with every character unconditionally. This is
--       deliberately the majority of situations and of the resulting
--       combinations -- per the product brief, most Character x Situation
--       pairs should be embraced as funny-because-absurd (e.g. "a fish
--       riding a tiny bike"), not filtered out.
--     - tagged: joins only with characters holding every tag in
--       required_tags (array containment, required_tags <@ tags). Used only
--       for the handful of situations whose JOKE PREMISE itself depends on
--       a trait (a size contrast, or "isn't already known for flying") --
--       not used to gate physical plausibility, which the brief explicitly
--       wants ignored in favor of visual absurdity.
--     - character_specific: joins only with the one named character_noun.
--       Hand-written jokes that only work because of that specific
--       character (a dragon's fire failing, a robot's battery dying).
--   A check constraint enforces each row's shape matches its declared type
--   (e.g. a 'universal' row can never carry required_tags or
--   character_noun), so the three groups can never blur together.
--
-- ASSEMBLY
--   public.generate_drawing_prompt(p_previous_prompt) computes every valid
--   (character, situation) pair via one join with the three-branch ON
--   condition above, concatenates `article || ' ' || noun || ' ' ||
--   template`, capitalizes the first letter, excludes p_previous_prompt if
--   supplied (server-side "no immediate repeat", mirroring 202609100014's
--   own v_previous_prompt exclusion, now comparing the final assembled
--   string rather than a pool row -- sufficient because the string is a
--   deterministic function of the pair, so an identical string implies an
--   identical pair), and falls back to allowing a repeat only if excluding
--   the previous prompt leaves zero candidates (unreachable in practice --
--   see the "actual valid combination count" arithmetic in the accompanying
--   report, comfortably in the hundreds). It is an internal helper only:
--   EXECUTE is revoked from PUBLIC and never granted to anon/authenticated
--   -- only start_round_if_ready/request_next_round call it, and a
--   SECURITY DEFINER function always retains implicit access to objects
--   its own owner already has rights to, so no explicit grant is needed
--   for that internal call path.
--
-- start_round_if_ready and request_next_round are redefined with their
-- EXISTING (uuid, text) signatures (CREATE OR REPLACE, no DROP needed --
-- the signature does not change), replacing their old
-- `select ... from public.drawing_prompts` bodies with a single call to
-- generate_drawing_prompt. Every other line of both functions (row
-- locking, host/ready-count checks, the `on conflict (game_id,
-- round_number) do nothing` single-insert race guard) is unchanged from
-- 202609100014.

create table public.prompt_characters (
  id uuid primary key default gen_random_uuid(),
  noun text not null unique,
  article text not null check (article in ('a', 'an')),
  tags text[] not null default '{}'::text[],
  created_at timestamptz not null default now()
);

create table public.prompt_situations (
  id uuid primary key default gen_random_uuid(),
  template text not null unique,
  situation_type text not null check (situation_type in ('universal', 'tagged', 'character_specific')),
  required_tags text[] not null default '{}'::text[],
  character_noun text references public.prompt_characters (noun),
  created_at timestamptz not null default now(),
  constraint prompt_situations_shape check (
    (situation_type = 'universal' and character_noun is null and required_tags = '{}'::text[])
    or (situation_type = 'tagged' and character_noun is null and cardinality(required_tags) > 0)
    or (situation_type = 'character_specific' and character_noun is not null and required_tags = '{}'::text[])
  )
);

alter table public.prompt_characters enable row level security;
alter table public.prompt_situations enable row level security;

-- Game content, not sensitive -- same treatment as public.drawing_prompts
-- (202609100014): readable by any client, no insert/update/delete policy
-- since only this migration writes to these tables and the RPCs above only
-- ever SELECT from them.
create policy "m4h prompt characters readable" on public.prompt_characters
  for select using (true);
create policy "m4h prompt situations readable" on public.prompt_situations
  for select using (true);

-- ---------------------------------------------------------------------
-- Characters (30). tags: large / tiny / grounded, only where a tagged
-- situation below actually depends on it -- see the join condition in
-- generate_drawing_prompt.
-- ---------------------------------------------------------------------
insert into public.prompt_characters (noun, article, tags) values
  ('bear', 'a', array['large', 'grounded']),
  ('dog', 'a', array['grounded']),
  ('cat', 'a', array['grounded']),
  ('robot', 'a', array['grounded']),
  ('dinosaur', 'a', array['large', 'grounded']),
  ('dragon', 'a', array['large']),
  ('ghost', 'a', '{}'::text[]),
  ('alien', 'an', '{}'::text[]),
  ('monster', 'a', array['large', 'grounded']),
  ('frog', 'a', array['tiny', 'grounded']),
  ('penguin', 'a', array['grounded']),
  ('shark', 'a', array['large', 'grounded']),
  ('chicken', 'a', array['tiny', 'grounded']),
  ('rabbit', 'a', array['tiny', 'grounded']),
  ('monkey', 'a', array['grounded']),
  ('lion', 'a', array['large', 'grounded']),
  ('pig', 'a', array['grounded']),
  ('duck', 'a', array['tiny', 'grounded']),
  ('cow', 'a', array['large', 'grounded']),
  ('fish', 'a', array['tiny', 'grounded']),
  ('mouse', 'a', array['tiny', 'grounded']),
  ('turtle', 'a', array['tiny', 'grounded']),
  ('octopus', 'an', array['large', 'grounded']),
  ('elephant', 'an', array['large', 'grounded']),
  ('giraffe', 'a', array['large', 'grounded']),
  ('owl', 'an', '{}'::text[]),
  ('pirate', 'a', array['grounded']),
  ('wizard', 'a', array['grounded']),
  ('knight', 'a', array['grounded']),
  ('superhero', 'a', '{}'::text[]);

-- ---------------------------------------------------------------------
-- Universal situations (20). Join with every character unconditionally --
-- deliberately the majority of the pool. Every entry here was checked
-- against both a "has hands/legs" character (bear) and a "has neither"
-- character (fish) to confirm it still reads as a clear, drawable,
-- visually funny sentence either way (see the report's grammar review).
-- ---------------------------------------------------------------------
insert into public.prompt_situations (template, situation_type) values
  ('riding a tiny bike', 'universal'),
  ('trying to hide', 'universal'),
  ('caught stealing pizza', 'universal'),
  ('wearing clothes that are too small', 'universal'),
  ('stuck in a tree', 'universal'),
  ('holding a giant ice cream', 'universal'),
  ('wearing a huge crown', 'universal'),
  ('trying to cook', 'universal'),
  ('dancing badly', 'universal'),
  ('sleeping in a strange place', 'universal'),
  ('taking a bath', 'universal'),
  ('pretending to be a king', 'universal'),
  ('stuck in a cardboard box', 'universal'),
  ('wearing sunglasses indoors', 'universal'),
  ('eating way too much cake', 'universal'),
  ('afraid of its own shadow', 'universal'),
  ('trying to paint a picture', 'universal'),
  ('stuck upside down', 'universal'),
  ('wearing a backwards hat', 'universal'),
  ('trying to juggle', 'universal');

-- ---------------------------------------------------------------------
-- Tagged situations (6). Each depends on a trait the JOKE itself needs --
-- not physical plausibility (the brief explicitly wants absurdity kept
-- in, e.g. "a shark riding a tiny bike" stays universal above).
-- ---------------------------------------------------------------------
insert into public.prompt_situations (template, situation_type, required_tags) values
  ('afraid of a tiny mouse', 'tagged', array['large']),
  ('trying to fit through a tiny door', 'tagged', array['large']),
  ('wearing tiny shoes', 'tagged', array['large']),
  ('driving a tiny car', 'tagged', array['large']),
  ('lifting a huge weight', 'tagged', array['tiny']),
  ('trying to fly', 'tagged', array['grounded']);

-- ---------------------------------------------------------------------
-- Character-specific situations (11). One hand-written joke per named
-- character -- rare/special by design, never more than one per character.
-- ---------------------------------------------------------------------
insert into public.prompt_situations (template, situation_type, character_noun) values
  ('whose fire won''t work', 'character_specific', 'dragon'),
  ('running out of battery', 'character_specific', 'robot'),
  ('who lost the ship', 'character_specific', 'pirate'),
  ('scared of another ghost', 'character_specific', 'ghost'),
  ('whose spell went wrong', 'character_specific', 'wizard'),
  ('who forgot their sword', 'character_specific', 'knight'),
  ('whose cape got stuck in a door', 'character_specific', 'superhero'),
  ('who can''t find all its socks', 'character_specific', 'octopus'),
  ('who left the race early', 'character_specific', 'turtle'),
  ('who can''t find its glasses', 'character_specific', 'owl'),
  ('who forgot where it parked its spaceship', 'character_specific', 'alien');

-- ---------------------------------------------------------------------
-- Assembly. Internal helper only -- see the header comment for why no
-- anon/authenticated grant is needed.
-- ---------------------------------------------------------------------
create or replace function public.generate_drawing_prompt(p_previous_prompt text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prompt text;
begin
  select prompt into v_prompt
  from (
    select
      upper(left(c.article || ' ' || c.noun || ' ' || s.template, 1))
        || substring(c.article || ' ' || c.noun || ' ' || s.template from 2) as prompt
    from prompt_characters c
    join prompt_situations s
      on s.situation_type = 'universal'
      or (s.situation_type = 'tagged' and s.required_tags <@ c.tags)
      or (s.situation_type = 'character_specific' and s.character_noun = c.noun)
  ) candidates
  where prompt is distinct from p_previous_prompt
  order by random()
  limit 1;

  if v_prompt is null then
    -- Only reachable if excluding the previous round's exact prompt leaves
    -- zero candidates -- with hundreds of valid pairs this cannot happen in
    -- practice, but fall back to allowing a repeat rather than ever leaving
    -- a round without a prompt, same convention 202609100014 established.
    select prompt into v_prompt
    from (
      select
        upper(left(c.article || ' ' || c.noun || ' ' || s.template, 1))
          || substring(c.article || ' ' || c.noun || ' ' || s.template from 2) as prompt
      from prompt_characters c
      join prompt_situations s
        on s.situation_type = 'universal'
        or (s.situation_type = 'tagged' and s.required_tags <@ c.tags)
        or (s.situation_type = 'character_specific' and s.character_noun = c.noun)
    ) candidates
    order by random()
    limit 1;
  end if;

  if v_prompt is null then
    raise exception 'No drawing prompts are configured';
  end if;

  return v_prompt;
end;
$$;

revoke execute on function public.generate_drawing_prompt(text) from public;

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

  v_prompt := public.generate_drawing_prompt(null);

  update games
  set status = 'active', current_round_number = 1
  where id = p_game_id;

  insert into rounds (game_id, round_number, prompt, status)
  values (p_game_id, 1, v_prompt, 'prompt')
  on conflict (game_id, round_number) do nothing;
end;
$$;

grant execute on function public.start_round_if_ready(uuid, text) to anon;

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

  v_next_prompt := public.generate_drawing_prompt(v_previous_prompt);

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
