-- Milestone 4C step 5A: player credential database foundation.
--
-- Step 3/4 verified that a `start` caller supplied the real winner's
-- playerId, but playerId is a client-generated string (see
-- src/services/game/guestIdentity.ts) that both players in a room can see --
-- nothing proved the HTTP caller actually IS that device. This migration adds
-- the credential the caller will have to prove ownership with (Step 5B wires
-- animate-winner to require it; this step is the database foundation only).
--
-- Deliberately a SEPARATE table rather than a column on public.players:
-- players stays openly readable (Duo Mode/Realtime depend on that), and a
-- secret_hash column there would be reachable by any select=... query unless
-- column-level grants were bolted on. player_credentials instead has NO
-- policies and NO table privileges for anon/authenticated at all -- it is
-- reachable only through the two SECURITY DEFINER functions below, which run
-- as the (privileged) function owner and so are unaffected by its RLS.
create table public.player_credentials (
  player_id text primary key references public.players(id) on delete cascade,
  secret_hash bytea not null,
  created_at timestamptz not null default now()
);

alter table public.player_credentials enable row level security;
-- No policies added: RLS with zero policies already denies all access to
-- non-owner roles. Revoking table privileges too is belt-and-suspenders --
-- it means even a future accidental policy addition still can't expose this
-- table, since anon/authenticated have no privilege to select/insert/
-- update/delete it in the first place.
revoke all on public.player_credentials from public;
revoke all on public.player_credentials from anon;
revoke all on public.player_credentials from authenticated;

-- Creates a brand-new player+credential pair, or verifies ownership of an
-- existing one before touching display_name. The secret is a high-entropy
-- random bearer token (never a human password), so a fast unsalted digest is
-- an intentional, appropriate choice here -- see extensions.digest() below.
create or replace function public.register_or_touch_player(
  p_player_id text,
  p_display_name text,
  p_secret text
) returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_secret_hash bytea;
begin
  if p_player_id is null or length(trim(p_player_id)) = 0 then
    raise exception 'invalid_player_id' using errcode = 'P0001';
  end if;
  if p_display_name is null or length(trim(p_display_name)) = 0 then
    raise exception 'invalid_display_name' using errcode = 'P0001';
  end if;
  if p_secret is null or length(p_secret) = 0 then
    raise exception 'invalid_player_secret_input' using errcode = 'P0001';
  end if;

  -- Serialize every registration attempt for this one player_id. Without
  -- this, two concurrent calls for the SAME brand-new id (e.g. a retried
  -- request) could both pass the "does this player exist?" check below
  -- before either has inserted -- one would then hit a duplicate-key error
  -- instead of converging cleanly. Same pattern as claim_animation_job's
  -- per-submission advisory lock (transaction-scoped, auto-released).
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_player_id, 0));

  if not exists (select 1 from public.players where id = p_player_id) then
    -- Case A: brand-new identity. Create the player and its credential
    -- together, in the same transaction. secret_hash is set exactly once,
    -- right here -- no other code path in this function ever writes it.
    insert into public.players (id, display_name) values (p_player_id, p_display_name);
    insert into public.player_credentials (player_id, secret_hash)
    values (p_player_id, extensions.digest(p_secret, 'sha256'));
    return;
  end if;

  select pc.secret_hash into v_secret_hash
  from public.player_credentials pc
  where pc.player_id = p_player_id;

  if v_secret_hash is null then
    -- Case C: this player row exists but has no credential (e.g. it predates
    -- this migration). Refuse to let this caller attach a credential to an
    -- identity string it doesn't already provably own -- "first caller wins"
    -- here would let anyone who has merely SEEN that playerId (any other
    -- device in the same room) claim it. The caller must rotate to a fresh
    -- player_id/secret pair instead (client-side, a later step).
    raise exception 'legacy_identity_requires_rotation' using errcode = 'P0001';
  end if;

  if v_secret_hash <> extensions.digest(p_secret, 'sha256') then
    -- Case D: wrong secret for an existing credential. Never touch
    -- display_name, never touch the stored hash.
    raise exception 'invalid_player_secret' using errcode = 'P0001';
  end if;

  -- Case B: verified owner. Touch display_name only -- secret_hash is never
  -- overwritten once it is set in Case A above.
  update public.players set display_name = p_display_name where id = p_player_id;
end;
$$;

revoke execute on function public.register_or_touch_player(text, text, text) from public;
revoke execute on function public.register_or_touch_player(text, text, text) from authenticated;
grant execute on function public.register_or_touch_player(text, text, text) to anon;

-- Read-only ownership check for a privileged server-side caller (Step 5B:
-- animate-winner) to confirm the HTTP caller holds the secret for the
-- playerId it supplied, before trusting that playerId for anything.
create or replace function public.verify_player_secret(
  p_player_id text,
  p_secret text
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_secret_hash bytea;
begin
  if p_player_id is null or length(trim(p_player_id)) = 0 then
    return false;
  end if;
  if p_secret is null or length(p_secret) = 0 then
    return false;
  end if;

  select pc.secret_hash into v_secret_hash
  from public.player_credentials pc
  where pc.player_id = p_player_id;

  if v_secret_hash is null then
    return false;
  end if;

  return v_secret_hash = extensions.digest(p_secret, 'sha256');
end;
$$;

-- Server-side only: this is the ownership check a paid generation path relies
-- on. Only animate-winner's admin client (service_role) may execute it --
-- exposing it to anon/authenticated would let a caller brute-force secrets
-- directly against it with no rate limiting.
revoke execute on function public.verify_player_secret(text, text) from public;
revoke execute on function public.verify_player_secret(text, text) from anon;
revoke execute on function public.verify_player_secret(text, text) from authenticated;
grant execute on function public.verify_player_secret(text, text) to service_role;

-- NOTE: public.players' existing INSERT/UPDATE policies are intentionally
-- left untouched by this migration. src/services/game/roomService.ts's
-- upsertPlayer() still writes to players directly today (called from
-- createGame/joinGame) -- that call site is not replaced until the Step 5
-- client migration lands. Revoking direct players INSERT/UPDATE now would
-- break room creation/joining immediately. See the step report for the full
-- inventory of current direct players writes.
