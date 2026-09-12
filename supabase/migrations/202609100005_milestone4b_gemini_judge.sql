-- Milestone 4B: real Gemini judge for remote games.
--
-- The `judge-round` Edge Function (service-role) downloads both players'
-- real drawings from Storage, calls Gemini once for the whole round, and
-- persists the result here. `winner_player_id` is the EXISTING column
-- (already written by the old complete_fake_judging RPC) — real judging now
-- writes it too, so RoomSnapshot.winnerPlayerId and every downstream client
-- read of it are unchanged.
--
-- Same concurrency approach as Milestone 4A characterization: a conditional
-- UPDATE claims judge_status = 'judging' for exactly one caller; see
-- supabase/functions/judge-round/index.ts for the exact query and the
-- stale-reclaim / poll-and-reuse behavior around it.
--
-- Deliberately minimal: no new table, no RPC (same reasoning as the
-- characterization migration — the claim is a plain table UPDATE from the
-- Edge Function's service-role client, so nothing new is exposed to
-- anonymous clients). judge_status doubles as the state; a completed round
-- always carries populated scores, so the client only needs to check
-- judge_player1_score is not null to know a real result exists.

alter table public.rounds
  add column if not exists judge_status text not null default 'pending'
    check (judge_status in ('pending', 'judging', 'completed', 'failed')),
  add column if not exists judge_started_at timestamptz,
  add column if not exists judge_player1_score integer check (judge_player1_score between 0 and 100),
  add column if not exists judge_player2_score integer check (judge_player2_score between 0 and 100),
  add column if not exists judge_comment text,
  add column if not exists judge_player1_reason text,
  add column if not exists judge_player2_reason text,
  add column if not exists judged_at timestamptz,
  add column if not exists judge_error text;

-- No backfill: a round already completed via the old fake-only path has
-- winner_player_id set but judge_status stays 'pending' (the column default)
-- — which is accurate, since that round genuinely was never really judged.
--
-- No new index: every claim/read here filters on rounds.id (primary key).
