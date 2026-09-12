-- Milestone 4C step 4: atomic entitlement reservation + animation job claim.
--
-- Two devices (or a retried request) can call animate-winner's `start` for
-- the same round_submission_id at nearly the same instant. A naive
-- select-entitlement -> insert-job -> update-entitlement sequence from the
-- Edge Function would be a check-then-act race across three separate round
-- trips, same class of bug the M4A characterization concurrency migration
-- fixed for Gemini calls. Here the stakes are entitlements (a scarce,
-- player-owned resource), so the whole claim is one Postgres transaction
-- via this SECURITY DEFINER RPC rather than a client-orchestrated sequence.
--
-- animation_jobs.round_submission_id is already UNIQUE (see the M4C
-- foundation migration), which is the final backstop against two job rows
-- for the same submission. This function additionally guarantees:
--   * concurrent callers for the SAME round_submission_id converge on one
--     job instead of racing/erroring (pg_advisory_xact_lock below), and
--   * concurrent callers for DIFFERENT submissions never reserve the same
--     entitlement row twice (`for update skip locked` below).
--
-- Deliberately does NOT set paid_generation_requested_at, veo_operation_name,
-- or call any external service — this only claims the right to animate, it
-- never spends it. That happens in a later milestone step.

create or replace function public.claim_animation_job(
  p_game_id uuid,
  p_round_id uuid,
  p_player_id text,
  p_round_submission_id uuid
) returns setof public.animation_jobs
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_job public.animation_jobs%rowtype;
  v_entitlement_id uuid;
  v_entitlement_source text;
  v_now timestamptz := now();
begin
  -- Serialize every claim attempt for this one round_submission_id. Two
  -- concurrent callers for the SAME submission would otherwise both pass the
  -- "does a job already exist?" read below before either has inserted one.
  -- pg_advisory_xact_lock blocks the second caller until the first caller's
  -- transaction commits (or rolls back) and releases the lock automatically
  -- — no explicit unlock, no cleanup job. hashtextextended gives a 64-bit
  -- key, so a lock collision between two unrelated submission ids is
  -- astronomically unlikely (and even if it happened, the only cost is
  -- those two claims briefly serializing, never an incorrect result).
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_round_submission_id::text, 0));

  -- Reuse: a prior call (this request retried, or the other device) already
  -- created the job. Return it as-is; never create a second one.
  select * into v_job
  from public.animation_jobs
  where round_submission_id = p_round_submission_id;

  if found then
    return next v_job;
    return;
  end if;

  -- Pick the single best-scoped available entitlement for this player.
  -- A null scope column means "unscoped" (matches anything); a non-null
  -- scope column must match the request exactly. Specificity is ranked
  -- narrowest-first: exact submission, then round, then game, then
  -- unscoped; ties broken by the oldest available_at.
  --
  -- `for update skip locked`: if a concurrent claim for a DIFFERENT
  -- submission already holds this exact entitlement row locked, this query
  -- skips it and considers the next-best match (or finds none) instead of
  -- blocking and later double-reserving it.
  select id, source into v_entitlement_id, v_entitlement_source
  from public.animation_entitlements
  where player_id = p_player_id
    and status = 'available'
    and available_at <= v_now
    and (expires_at is null or expires_at > v_now)
    and (round_submission_id is null or round_submission_id = p_round_submission_id)
    and (round_id is null or round_id = p_round_id)
    and (game_id is null or game_id = p_game_id)
  order by
    case
      when round_submission_id = p_round_submission_id then 0
      when round_id = p_round_id then 1
      when game_id = p_game_id then 2
      else 3
    end,
    available_at asc
  for update skip locked
  limit 1;

  if v_entitlement_id is null then
    -- No claimable entitlement. No job row is created — the caller
    -- (animate-winner) surfaces this as entitlement_required and the
    -- request can be retried later once one becomes available.
    return;
  end if;

  insert into public.animation_jobs (
    game_id, round_id, player_id, round_submission_id,
    status, entitlement_source, entitlement_id
  ) values (
    p_game_id, p_round_id, p_player_id, p_round_submission_id,
    'starting', v_entitlement_source, v_entitlement_id
  )
  returning * into v_job;

  update public.animation_entitlements
  set status = 'reserved', reserved_at = v_now, reserved_job_id = v_job.id
  where id = v_entitlement_id;

  return next v_job;
end;
$$;

-- Server-side only: this reserves a scarce entitlement and must not be
-- callable directly by anon/authenticated clients (they never hold the
-- secret key). Only the animate-winner Edge Function's admin client, which
-- authenticates as service_role, may execute it.
revoke execute on function public.claim_animation_job(uuid, uuid, text, uuid) from public;
revoke execute on function public.claim_animation_job(uuid, uuid, text, uuid) from anon;
revoke execute on function public.claim_animation_job(uuid, uuid, text, uuid) from authenticated;
grant execute on function public.claim_animation_job(uuid, uuid, text, uuid) to service_role;
