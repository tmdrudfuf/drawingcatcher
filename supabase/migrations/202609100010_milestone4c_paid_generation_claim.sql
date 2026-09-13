-- Milestone 4C step 6A: atomic paid-generation claim foundation.
--
-- HARD COST INVARIANT (stated in the M4C foundation migration's header):
-- once animation_jobs.paid_generation_requested_at is non-null for a
-- round_submission_id, no future code path may send another Veo generation
-- create request for that submission -- not after a timeout, an ambiguous
-- HTTP response, a function crash, a retry, a concurrent request, or a later
-- status change. This migration adds the database-level guard a future step
-- will call immediately before (and only immediately before) the first Veo
-- create request: it converts "check paid_generation_requested_at, then set
-- it" from a client-orchestrated two-step race into one atomic transaction.
--
-- Deliberately does NOT call any external service, set veo_operation_name,
-- or move status into a provider-outcome state ('completed'/'failed'/
-- 'ambiguous') -- this only claims the one-time right to attempt the Veo
-- request; it never records the attempt's result. That happens in a later
-- milestone step, once an actual HTTP call exists to report on.

create or replace function public.claim_paid_generation_request(
  p_job_id uuid
) returns public.animation_jobs
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_job public.animation_jobs%rowtype;
begin
  -- Row-level locking alone is sufficient here, unlike claim_animation_job's
  -- pg_advisory_xact_lock: that function has to serialize against a job row
  -- that might not exist yet (nothing to lock before the first INSERT). Here
  -- the job row is required to already exist (p_job_id identifies it), and
  -- animation_jobs.round_submission_id is already UNIQUE, so `select ...
  -- for update` on this one primary-key row is the entire critical section
  -- -- a second concurrent caller for the same p_job_id blocks on this same
  -- row lock until the first transaction commits or rolls back, then sees
  -- the first caller's committed result. An advisory lock would add nothing:
  -- it would still need to be keyed off the same job id, i.e. the same
  -- serialization the row lock already gives for free.
  select * into v_job
  from public.animation_jobs
  where id = p_job_id
  for update;

  if not found then
    raise exception 'animation_job_not_found' using errcode = 'P0002';
  end if;

  if v_job.paid_generation_requested_at is not null then
    -- Deterministic outcome for: a genuine retry, the losing side of a
    -- concurrent race, or any caller after the marker is already set.
    -- Never touch the row -- the existing animation_jobs_before_update
    -- trigger would reject clearing it anyway, but this function must never
    -- even attempt to re-set it to a new timestamp, which the trigger would
    -- NOT catch (non-null -> non-null is not a clear).
    raise exception 'paid_generation_already_requested' using errcode = 'P0001';
  end if;

  -- Atomically claim it. Status is deliberately left untouched: no Veo
  -- request has actually been sent yet (this function makes none), so there
  -- is no new state in the existing model ('pending' | 'entitlement_required'
  -- | 'starting' | 'operation_pending' | 'downloading' | 'completed' |
  -- 'failed' | 'ambiguous') that correctly describes "about to call Veo but
  -- haven't". The step that actually issues the request and learns
  -- veo_operation_name is the appropriate place to move status forward.
  update public.animation_jobs
  set paid_generation_requested_at = now()
  where id = p_job_id
  returning * into v_job;

  return v_job;
end;
$$;

-- Server-side only, same convention as claim_animation_job and
-- verify_player_secret: this is the one-time paid-generation gate and must
-- never be reachable by anon/authenticated, which never hold the secret key.
-- Only the animate-winner Edge Function's admin client (service_role) may
-- execute it.
revoke execute on function public.claim_paid_generation_request(uuid) from public;
revoke execute on function public.claim_paid_generation_request(uuid) from anon;
revoke execute on function public.claim_paid_generation_request(uuid) from authenticated;
grant execute on function public.claim_paid_generation_request(uuid) to service_role;

-- NOTE: the existing animation_jobs_before_update trigger (see the M4C
-- foundation migration) already rejects any update that clears
-- paid_generation_requested_at from non-null to null. This migration adds no
-- new trigger and does not touch that one -- it remains the backstop even
-- against a future bug in this function or a direct admin UPDATE.
