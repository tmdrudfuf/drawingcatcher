-- Milestone 4A hardening: server-side concurrency/idempotency for Gemini
-- characterization.
--
-- Problem: two devices can both reach Reveal for the same round and both
-- call characterize-drawing for the same (round_id, player_id) at nearly the
-- same instant. The previous guard ("read characterized_path, generate if
-- null") is a check-then-act race — both requests can pass the read before
-- either writes, so both call Gemini. The deterministic Storage path only
-- prevented a duplicate *file*, not a duplicate *paid generation*.
--
-- Fix: an explicit status column, claimed with a single conditional UPDATE
-- from the Edge Function (service role). Postgres serializes concurrent
-- UPDATEs to the same row — once one caller's UPDATE commits, a second
-- caller's UPDATE re-evaluates its WHERE clause against the now-committed
-- row and, if the predicate no longer matches, updates zero rows. That is
-- the atomicity guarantee: no RPC, no explicit row lock, and no window where
-- two callers can both believe they hold the claim. See
-- supabase/functions/characterize-drawing/index.ts for the exact query.
--
-- Deliberately no new RPC: the claim is a plain table UPDATE issued by the
-- Edge Function's service-role client, so there is nothing new to grant to
-- (or expose to) anonymous clients.

alter table public.round_submissions
  add column if not exists characterization_status text not null default 'pending'
    check (characterization_status in ('pending', 'generating', 'completed', 'failed')),
  add column if not exists characterization_started_at timestamptz,
  add column if not exists characterization_error text;

-- Backfill: a row that already has a characterized asset (from before this
-- column existed) is retroactively 'completed'. No-op on a fresh database —
-- every row is 'pending' from the column default until it's ever attempted.
update public.round_submissions
set characterization_status = 'completed'
where characterized_path is not null
  and characterization_status = 'pending';

-- No new index: every claim/read here filters on (round_id, player_id),
-- which is already covered by this table's existing unique constraint.
