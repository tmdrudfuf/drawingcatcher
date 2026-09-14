-- Milestone 4C step 6E-1: atomic animation completion + entitlement consumption.
--
-- The caller must upload the completed video before invoking this function.
-- This transaction then makes the durable database state agree atomically:
-- the existing animation job becomes completed and its reserved entitlement
-- becomes consumed. It never calls a provider, creates a job, or changes the
-- one-time paid-generation marker or persisted Veo operation name.

create or replace function public.finalize_animation_job(
  p_job_id uuid,
  p_video_path text,
  p_video_content_type text,
  p_video_content_length bigint
) returns public.animation_jobs
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_job public.animation_jobs%rowtype;
  v_entitlement public.animation_entitlements%rowtype;
  v_finalized_at timestamptz := now();
begin
  if p_job_id is null then
    raise exception 'invalid_animation_job_id' using errcode = 'P0001';
  end if;
  if p_video_path is null or length(trim(p_video_path)) = 0 then
    raise exception 'invalid_animation_video_path' using errcode = 'P0001';
  end if;
  if p_video_content_type is null or length(trim(p_video_content_type)) = 0 then
    raise exception 'invalid_animation_video_content_type' using errcode = 'P0001';
  end if;
  if p_video_content_length is null or p_video_content_length <= 0 then
    raise exception 'invalid_animation_video_content_length' using errcode = 'P0001';
  end if;

  select * into v_job
  from public.animation_jobs
  where id = p_job_id
  for update;

  if not found then
    raise exception 'animation_job_not_found' using errcode = 'P0002';
  end if;

  if v_job.status = 'completed' then
    if v_job.video_path is distinct from p_video_path
       or v_job.video_content_type is distinct from p_video_content_type
       or v_job.video_content_length is distinct from p_video_content_length
       or v_job.completed_at is null
       or v_job.entitlement_id is null then
      raise exception 'finalization_conflict' using errcode = 'P0001';
    end if;

    select * into v_entitlement
    from public.animation_entitlements
    where id = v_job.entitlement_id
    for update;

    if not found
       or v_entitlement.status <> 'consumed'
       or v_entitlement.reserved_job_id is distinct from p_job_id
       or v_entitlement.consumed_job_id is distinct from p_job_id
       or v_entitlement.consumed_at is null then
      raise exception 'finalization_conflict' using errcode = 'P0001';
    end if;

    return v_job;
  end if;

  if v_job.status not in ('operation_pending', 'downloading')
     or v_job.paid_generation_requested_at is null
     or v_job.veo_operation_name is null
     or v_job.entitlement_id is null then
    raise exception 'animation_job_not_ready_for_finalization' using errcode = 'P0001';
  end if;

  select * into v_entitlement
  from public.animation_entitlements
  where id = v_job.entitlement_id
  for update;

  if not found
     or v_entitlement.status <> 'reserved'
     or v_entitlement.reserved_job_id is distinct from p_job_id
     or v_entitlement.consumed_job_id is not null
     or v_entitlement.consumed_at is not null then
    raise exception 'entitlement_finalization_conflict' using errcode = 'P0001';
  end if;

  update public.animation_jobs
  set status = 'completed',
      video_path = p_video_path,
      video_content_type = p_video_content_type,
      video_content_length = p_video_content_length,
      completed_at = v_finalized_at,
      provider_error_code = null,
      provider_error_status = null,
      error_code = null,
      error_message = null,
      failed_at = null
  where id = p_job_id
  returning * into v_job;

  update public.animation_entitlements
  set status = 'consumed',
      consumed_job_id = p_job_id,
      consumed_at = v_finalized_at
  where id = v_job.entitlement_id;

  return v_job;
end;
$$;

revoke execute on function public.finalize_animation_job(uuid, text, text, bigint) from public;
revoke execute on function public.finalize_animation_job(uuid, text, text, bigint) from anon;
revoke execute on function public.finalize_animation_job(uuid, text, text, bigint) from authenticated;
grant execute on function public.finalize_animation_job(uuid, text, text, bigint) to service_role;
