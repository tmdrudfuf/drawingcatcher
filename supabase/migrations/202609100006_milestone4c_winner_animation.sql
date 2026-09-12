-- Milestone 4C: real winner animation database/storage foundation.
--
-- The future `animate-winner` Edge Function will be the only component that
-- creates/updates animation jobs, verifies entitlements, talks to Veo, and
-- creates signed URLs for completed videos. Anonymous clients get no direct
-- mutation access here, and generated videos live in a private Storage bucket.
--
-- HARD COST INVARIANT for the Edge Function implementation:
-- once `paid_generation_requested_at` is non-null for a round_submission_id,
-- no future code path may send another Veo generation create request for that
-- submission, even if the job later becomes failed or ambiguous. Polling an
-- existing operation is allowed; creating another paid operation is not.

insert into storage.buckets (id, name, public)
values ('animations', 'animations', false)
on conflict (id) do update
set public = false;

create table if not exists public.animation_jobs (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  round_id uuid not null references public.rounds(id) on delete cascade,
  player_id text not null references public.players(id) on delete cascade,
  round_submission_id uuid not null references public.round_submissions(id) on delete cascade,
  status text not null default 'pending'
    check (status in (
      'pending',
      'entitlement_required',
      'starting',
      'operation_pending',
      'downloading',
      'completed',
      'failed',
      'ambiguous'
    )),
  entitlement_source text check (
    entitlement_source is null
    or entitlement_source in ('mvp_manual', 'rewarded_ad', 'subscription_credit', 'purchased_credit')
  ),
  entitlement_id uuid,
  veo_operation_name text,
  video_path text,
  video_content_type text,
  video_content_length bigint check (video_content_length is null or video_content_length >= 0),
  provider text not null default 'veo',
  provider_model text not null default 'veo-3.1-generate-preview',
  provider_error_code text,
  provider_error_status text,
  error_code text,
  error_message text,
  paid_generation_requested_at timestamptz,
  started_at timestamptz,
  last_polled_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (round_submission_id)
);

create table if not exists public.animation_entitlements (
  id uuid primary key default gen_random_uuid(),
  game_id uuid references public.games(id) on delete cascade,
  round_id uuid references public.rounds(id) on delete cascade,
  player_id text not null references public.players(id) on delete cascade,
  round_submission_id uuid references public.round_submissions(id) on delete cascade,
  source text not null check (source in ('mvp_manual', 'rewarded_ad', 'subscription_credit', 'purchased_credit')),
  status text not null default 'available'
    check (status in ('available', 'reserved', 'consumed', 'expired', 'revoked')),
  reserved_job_id uuid references public.animation_jobs(id) on delete set null,
  consumed_job_id uuid references public.animation_jobs(id) on delete set null,
  available_at timestamptz not null default now(),
  reserved_at timestamptz,
  consumed_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  check (round_submission_id is null or round_id is not null)
);

alter table public.animation_jobs
  add constraint animation_jobs_entitlement_id_fkey
  foreign key (entitlement_id) references public.animation_entitlements(id)
  on delete set null;

create or replace function public.animation_jobs_before_update()
returns trigger
language plpgsql
as $$
begin
  if old.paid_generation_requested_at is not null
     and new.paid_generation_requested_at is null then
    raise exception 'paid_generation_requested_at cannot be cleared once set';
  end if;

  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists animation_jobs_before_update on public.animation_jobs;

create trigger animation_jobs_before_update
before update on public.animation_jobs
for each row
execute function public.animation_jobs_before_update();

create index if not exists animation_jobs_status_updated_idx
  on public.animation_jobs (status, updated_at);

create index if not exists animation_jobs_operation_pending_idx
  on public.animation_jobs (last_polled_at, updated_at)
  where status in ('operation_pending', 'downloading');

create index if not exists animation_jobs_round_player_idx
  on public.animation_jobs (round_id, player_id);

create unique index if not exists animation_jobs_veo_operation_name_key
  on public.animation_jobs (veo_operation_name)
  where veo_operation_name is not null;

create index if not exists animation_entitlements_available_idx
  on public.animation_entitlements (player_id, status, expires_at, available_at)
  where status = 'available';

create index if not exists animation_entitlements_submission_idx
  on public.animation_entitlements (round_submission_id)
  where round_submission_id is not null;

alter table public.animation_jobs enable row level security;
alter table public.animation_entitlements enable row level security;

-- Deliberately no anon/client policies for INSERT, UPDATE, or DELETE on either
-- table. The future animate-winner Edge Function will use the configured
-- server-side Supabase secret key and mediate all job/entitlement access.
--
-- Deliberately no Storage policy for the `animations` bucket. It must remain
-- private; animate-winner will issue short-lived signed URLs for completed
-- videos instead of exposing public reads.
