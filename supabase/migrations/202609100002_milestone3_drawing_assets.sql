-- Milestone 3: real drawing asset pipeline.
--
-- Each player's finished sketch is exported to a PNG on the device, uploaded to
-- Supabase Storage, and its deterministic path is stored alongside the round
-- submission. The image bytes live in Storage, never in Postgres.
--
-- Storage layout (bucket `drawings`):
--   games/{gameId}/rounds/{roundId}/{playerId}.png
--
-- SECURITY NOTE (temporary, guest MVP): the `drawings` bucket is public-read and
-- accepts anonymous inserts/updates. Anyone holding the anon key can read or
-- overwrite any drawing. This matches the Milestone 2 RLS compromise and must be
-- tightened once Supabase Auth or server-side room tokens exist. Paths carry
-- UUIDs (game id, round id) so they are not trivially enumerable, but that is
-- obfuscation, not authorization.

alter table public.round_submissions
  add column if not exists drawing_path text,
  add column if not exists drawing_uploaded_at timestamptz;

-- Redefine submit_round_drawing to record the uploaded asset path and to only
-- treat a submission as complete once its drawing asset is actually available.
drop function if exists public.submit_round_drawing(uuid, uuid, text);

create or replace function public.submit_round_drawing(
  p_game_id uuid,
  p_round_id uuid,
  p_player_id text,
  p_drawing_path text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_submitted_count integer;
begin
  if p_drawing_path is null or length(p_drawing_path) = 0 then
    raise exception 'A drawing asset path is required';
  end if;

  if not exists (select 1 from game_players where game_id = p_game_id and player_id = p_player_id) then
    raise exception 'Player is not in this game';
  end if;

  -- Serialize concurrent submits on this round so the 2/2 transition to
  -- 'judging' cannot be lost when both players submit at the same instant.
  perform 1 from rounds where id = p_round_id and game_id = p_game_id for update;
  if not found then
    raise exception 'Round not found';
  end if;

  insert into round_submissions (round_id, player_id, submitted, submitted_at, drawing_path, drawing_uploaded_at)
  values (p_round_id, p_player_id, true, now(), p_drawing_path, now())
  on conflict (round_id, player_id)
  do update set
    submitted = true,
    submitted_at = coalesce(round_submissions.submitted_at, now()),
    drawing_path = excluded.drawing_path,
    drawing_uploaded_at = now();

  select count(*) into v_submitted_count
  from round_submissions
  where round_id = p_round_id and submitted = true and drawing_path is not null;

  if v_submitted_count = 2 then
    update rounds
    set status = 'judging'
    where id = p_round_id and game_id = p_game_id and status in ('drawing', 'prompt');
  end if;
end;
$$;

grant execute on function public.submit_round_drawing(uuid, uuid, text, text) to anon;

-- Storage bucket + temporary guest-MVP policies.
insert into storage.buckets (id, name, public)
values ('drawings', 'drawings', true)
on conflict (id) do nothing;

drop policy if exists "m3 drawings readable" on storage.objects;
drop policy if exists "m3 drawings insert" on storage.objects;
drop policy if exists "m3 drawings update" on storage.objects;

create policy "m3 drawings readable" on storage.objects
  for select using (bucket_id = 'drawings');

create policy "m3 drawings insert" on storage.objects
  for insert with check (bucket_id = 'drawings');

create policy "m3 drawings update" on storage.objects
  for update using (bucket_id = 'drawings') with check (bucket_id = 'drawings');
