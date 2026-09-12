-- Milestone 4A: real Gemini characterization.
--
-- The `characterize-drawing` Edge Function (service-role, never the client)
-- downloads the player's real drawing from the `drawings` bucket, calls
-- Gemini, and writes the result here and to a new `characterized` bucket.
-- Postgres never stores image bytes.
--
-- Deliberately minimal schema: no job/status table and no
-- `characterization_status` column. `characterized_path` doubles as the
-- status — null means "not generated yet", non-null means "done" — because
-- the Edge Function itself is the single place that decides whether to call
-- Gemini (it re-checks this column first) or return the existing asset.
--
-- SECURITY: unlike the Milestone 3 `drawings` bucket, `characterized` grants
-- NO anonymous insert/update — only the Edge Function (service role, which
-- bypasses Storage RLS entirely) ever writes to it. This is strictly
-- *tighter* than the existing guest-MVP compromise, not wider.

alter table public.round_submissions
  add column if not exists characterized_path text,
  add column if not exists characterized_at timestamptz;

insert into storage.buckets (id, name, public)
values ('characterized', 'characterized', true)
on conflict (id) do nothing;

drop policy if exists "m4a characterized readable" on storage.objects;

create policy "m4a characterized readable" on storage.objects
  for select using (bucket_id = 'characterized');
