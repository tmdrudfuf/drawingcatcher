-- Milestone 4E step 2: rewarded-ad server-side verification foundation.
--
-- The client's EARNED_REWARD callback only means "the SDK reported a
-- reward" -- it is never trusted as authorization to grant a paid animation
-- entitlement (see src/services/ads/RewardedAdProvider.ts). Only a
-- cryptographically verified Google AdMob SSV callback may create a
-- rewarded_ad animation_entitlements row, and it may create at most one per
-- reward event.
--
-- Two tables:
--
--   * rewarded_ad_correlations -- a short-lived, single-use, server-issued
--     opaque token binding (game, round, winner submission, winner player)
--     BEFORE the ad is shown. The animate-winner Edge Function issues these
--     (new 'request-rewarded-ad-correlation' action, via
--     issue_rewarded_ad_correlation below) only after verifying the
--     requesting device's playerSecret and game membership, and resolving
--     the round's real winner_player_id/winning submission server-side --
--     never from client-supplied ids alone.
--
--   * rewarded_ad_transactions -- replay protection ledger. Google's
--     transaction_id is the PRIMARY KEY, so `insert ... on conflict
--     (transaction_id) do nothing` is the entire atomic "claim this
--     transaction, or discover someone already did" step -- no advisory
--     lock needed, and it can never deadlock against a concurrent duplicate
--     callback for the same transaction_id.
--
-- Both the correlation token and the AdMob SSV callback only ever appear as
-- plaintext `text` RPC parameters, hashed with extensions.digest() inside
-- the function body -- exactly the register_or_touch_player /
-- verify_player_secret pattern from the M4C step 5A migration ("high-entropy
-- random bearer token, never a human password, so a fast unsalted digest is
-- an intentional, appropriate choice"). Neither table's token_hash column is
-- ever populated from a plain client insert; only these two
-- SECURITY DEFINER functions can write it.
--
-- grant_rewarded_ad_entitlement(...) is the only place a rewarded_ad
-- entitlement is ever created. It is called exclusively by the
-- rewarded-ad-ssv Edge Function, and only after that function has already
-- verified the AdMob SSV signature cryptographically -- this function
-- trusts p_transaction_id/p_key_id/p_token completely and performs no
-- signature verification of its own; it only enforces replay-once and
-- correlation validity.

create table public.rewarded_ad_correlations (
  id uuid primary key default gen_random_uuid(),
  token_hash bytea not null,
  game_id uuid not null references public.games(id) on delete cascade,
  round_id uuid not null references public.rounds(id) on delete cascade,
  round_submission_id uuid not null references public.round_submissions(id) on delete cascade,
  -- The player who will RECEIVE the entitlement -- always the round's
  -- verified winner_player_id, regardless of which device requested the
  -- correlation (Reveal is shown to both players; either may trigger the
  -- ad). This must match what animate-winner's 'start' action passes as
  -- claim_animation_job's p_player_id, or the entitlement this eventually
  -- grants would be unclaimable by anyone.
  player_id text not null references public.players(id) on delete cascade,
  -- The device that actually requested the correlation. Recorded for audit
  -- only -- never used for entitlement scoping.
  requested_by_player_id text not null references public.players(id) on delete cascade,
  status text not null default 'issued' check (status in ('issued', 'consumed')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  consumed_by_transaction_id text
);

-- A token hash must resolve to at most one correlation row. Enforced as a
-- unique index (not just "look up the newest") so two correlations can never
-- collide on the same stored hash even under a (practically impossible)
-- random-token collision.
create unique index rewarded_ad_correlations_token_hash_key
  on public.rewarded_ad_correlations (token_hash);

create index rewarded_ad_correlations_submission_idx
  on public.rewarded_ad_correlations (round_submission_id);

alter table public.rewarded_ad_correlations enable row level security;
-- No policies added, same convention as player_credentials: RLS with zero
-- policies already denies all access to non-owner roles. Revoking table
-- privileges too means even a future accidental policy addition can't
-- expose this table to anon/authenticated.
revoke all on public.rewarded_ad_correlations from public;
revoke all on public.rewarded_ad_correlations from anon;
revoke all on public.rewarded_ad_correlations from authenticated;

create table public.rewarded_ad_transactions (
  transaction_id text primary key,
  key_id text,
  correlation_id uuid references public.rewarded_ad_correlations(id) on delete set null,
  entitlement_id uuid references public.animation_entitlements(id) on delete set null,
  -- 'pending' is transient (set by the initial insert, corrected to a
  -- terminal value before the function returns) and must never be visible
  -- outside the transaction that created it -- either the function commits
  -- a terminal outcome onto this same row, or the whole transaction
  -- (including this insert) rolls back.
  outcome text not null default 'pending'
    check (outcome in ('pending', 'granted', 'correlation_invalid', 'correlation_consumed', 'correlation_expired')),
  verified_at timestamptz not null default now()
);

alter table public.rewarded_ad_transactions enable row level security;
revoke all on public.rewarded_ad_transactions from public;
revoke all on public.rewarded_ad_transactions from anon;
revoke all on public.rewarded_ad_transactions from authenticated;

-- Issuance: called by animate-winner's 'request-rewarded-ad-correlation'
-- action, itself only reachable after verify_player_secret has proven the
-- caller owns p_requested_by_player_id and the caller has been confirmed as
-- a member of p_game_id with a ready winner for p_round_id (both checked in
-- the Edge Function before this RPC runs -- this function trusts its
-- arguments and only hashes + inserts).
create or replace function public.issue_rewarded_ad_correlation(
  p_game_id uuid,
  p_round_id uuid,
  p_round_submission_id uuid,
  p_winner_player_id text,
  p_requested_by_player_id text,
  p_token text,
  p_ttl_seconds integer
) returns public.rewarded_ad_correlations
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_row public.rewarded_ad_correlations%rowtype;
begin
  if p_token is null or length(p_token) < 32 then
    raise exception 'invalid_correlation_token' using errcode = 'P0001';
  end if;
  if p_ttl_seconds is null or p_ttl_seconds <= 0 or p_ttl_seconds > 86400 then
    raise exception 'invalid_correlation_ttl' using errcode = 'P0001';
  end if;

  insert into public.rewarded_ad_correlations (
    token_hash, game_id, round_id, round_submission_id,
    player_id, requested_by_player_id, expires_at
  ) values (
    extensions.digest(p_token, 'sha256'), p_game_id, p_round_id, p_round_submission_id,
    p_winner_player_id, p_requested_by_player_id, now() + make_interval(secs => p_ttl_seconds)
  )
  returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function public.issue_rewarded_ad_correlation(uuid, uuid, uuid, text, text, text, integer) from public;
revoke execute on function public.issue_rewarded_ad_correlation(uuid, uuid, uuid, text, text, text, integer) from anon;
revoke execute on function public.issue_rewarded_ad_correlation(uuid, uuid, uuid, text, text, text, integer) from authenticated;
grant execute on function public.issue_rewarded_ad_correlation(uuid, uuid, uuid, text, text, text, integer) to service_role;

-- Consumption + grant: called by rewarded-ad-ssv only after the AdMob SSV
-- signature has already been verified cryptographically.
create or replace function public.grant_rewarded_ad_entitlement(
  p_token text,
  p_transaction_id text,
  p_key_id text
) returns table (grant_outcome text, granted_entitlement_id uuid)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_correlation public.rewarded_ad_correlations%rowtype;
  v_correlation_found boolean := false;
  v_entitlement_id uuid;
  v_claimed_tx text;
  v_outcome text;
begin
  if p_transaction_id is null or length(trim(p_transaction_id)) = 0 then
    raise exception 'invalid_transaction_id' using errcode = 'P0001';
  end if;
  if p_token is null or length(p_token) < 32 then
    raise exception 'invalid_correlation_token' using errcode = 'P0001';
  end if;

  -- Atomic replay guard, and it MUST run before correlation validity is
  -- even checked: transaction_id is the PK, so a concurrent duplicate
  -- callback for the SAME transaction_id conflicts here and does nothing --
  -- never blocks, never deadlocks, and is always the very first thing that
  -- can distinguish "first delivery" from "redelivery/race" for this
  -- transaction_id, regardless of what the correlation turns out to be.
  insert into public.rewarded_ad_transactions (transaction_id, key_id)
  values (p_transaction_id, p_key_id)
  on conflict (transaction_id) do nothing
  returning transaction_id into v_claimed_tx;

  if v_claimed_tx is null then
    -- Someone (this exact callback redelivered, or a genuine concurrent
    -- duplicate) already claimed this transaction_id. Report it as
    -- 'replayed' -- never touch animation_entitlements or the correlation
    -- row again for it, and never re-read the original row's outcome here
    -- (the caller only needs to know no NEW grant happened).
    return query select 'replayed'::text, null::uuid;
    return;
  end if;

  select * into v_correlation
  from public.rewarded_ad_correlations
  where token_hash = extensions.digest(p_token, 'sha256')
  for update;
  v_correlation_found := found;

  if not v_correlation_found then
    v_outcome := 'correlation_invalid';
  elsif v_correlation.status <> 'issued' then
    v_outcome := 'correlation_consumed';
  elsif v_correlation.expires_at <= now() then
    v_outcome := 'correlation_expired';
  else
    v_outcome := 'granted';
  end if;

  if v_outcome <> 'granted' then
    -- The transaction row is already claimed (above) regardless of this
    -- outcome -- a bad callback's transaction_id is burned, not left
    -- retryable, so it can never be re-presented to try a different (or
    -- since-fixed) correlation. Record the terminal outcome on it.
    update public.rewarded_ad_transactions
    set outcome = v_outcome,
        correlation_id = case when v_correlation_found then v_correlation.id else null end
    where transaction_id = p_transaction_id;
    return query select v_outcome, null::uuid;
    return;
  end if;

  insert into public.animation_entitlements (
    game_id, round_id, player_id, round_submission_id, source, status
  ) values (
    v_correlation.game_id, v_correlation.round_id, v_correlation.player_id,
    v_correlation.round_submission_id, 'rewarded_ad', 'available'
  )
  returning id into v_entitlement_id;

  update public.rewarded_ad_correlations
  set status = 'consumed', consumed_at = now(), consumed_by_transaction_id = p_transaction_id
  where id = v_correlation.id;

  update public.rewarded_ad_transactions
  set outcome = 'granted', correlation_id = v_correlation.id, entitlement_id = v_entitlement_id
  where transaction_id = p_transaction_id;

  return query select 'granted'::text, v_entitlement_id;
end;
$$;

-- Server-side only, same convention as every other paid-flow RPC in this
-- project: never reachable by anon/authenticated, which never hold the
-- secret key. Only the rewarded-ad-ssv Edge Function's admin client (which
-- authenticates as service_role, and only after verifying the AdMob
-- signature) may execute it.
revoke execute on function public.grant_rewarded_ad_entitlement(text, text, text) from public;
revoke execute on function public.grant_rewarded_ad_entitlement(text, text, text) from anon;
revoke execute on function public.grant_rewarded_ad_entitlement(text, text, text) from authenticated;
grant execute on function public.grant_rewarded_ad_entitlement(text, text, text) to service_role;

-- NOTE: two genuine, independently-verified ad completions for the same
-- round_submission_id will each create their own 'available' rewarded_ad
-- entitlement row -- this function does not deduplicate across different
-- transaction_ids/correlations. This is intentional and harmless: only one
-- is ever spendable, because animation_jobs.round_submission_id is UNIQUE
-- (see the M4C foundation migration) and claim_animation_job reuses any
-- existing job for that submission rather than reserving a second
-- entitlement. The extra entitlement simply remains unconsumed.
