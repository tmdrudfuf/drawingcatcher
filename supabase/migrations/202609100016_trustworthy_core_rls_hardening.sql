-- Trustworthy Core Step 2B, phase 1 of 2: RPC compatibility phase.
--
-- Per the Step 2A design audit: the four legitimate direct-client UPDATE
-- operations currently reachable on games, game_players, rounds, and
-- round_submissions (all four still carrying their original, unrevisited
-- Milestone-2 `using (true)` UPDATE policies) each get a narrow,
-- membership-checked replacement RPC here, following the same pattern
-- submit_round_drawing (202609100002) already established: this app has no
-- Supabase Auth session, so RLS predicates can never know *which* guest
-- player is making a request -- the only place that can be validated is
-- inside a SECURITY DEFINER function that accepts a claimed player_id and
-- checks it against game_players membership.
--
-- THIS MIGRATION IS DELIBERATELY ADDITIVE ONLY. It creates the four RPCs
-- and nothing else -- no policy is dropped, no table grant is revoked, no
-- SELECT/INSERT/DELETE behavior changes. This is phase 1 of a two-phase
-- rollout specifically so there is never a moment where either an
-- old client build (still doing direct table UPDATEs) or a new client
-- build (calling these RPCs) is unable to mutate gameplay state:
--   - the old client keeps working because the permissive UPDATE policies
--     from 202609100001 are untouched by this migration;
--   - the new client (this same change's roomService.ts/GameProvider.tsx)
--     works immediately because the RPCs it now calls exist as of this
--     migration.
-- Enforcement -- dropping those permissive policies and revoking table
-- UPDATE -- is deferred to 202609100017, applied only once the new client
-- build is confirmed to be the only version reaching production. See that
-- migration's own header comment for the enforcement half.
--
-- Scope discipline (see the Step 2A audit's out-of-scope list): this
-- migration does not touch SELECT policies, does not touch INSERT
-- policies, does not touch DELETE behavior, does not touch Storage, does
-- not touch public.players, and does not touch the
-- animation_jobs/animation_entitlements tables. It also does not attempt to
-- fix request_next_round's missing membership check or
-- submit_round_drawing's lack of caller-identity proof (both pre-existing,
-- tracked separately, out of scope for this step).

-- ---------------------------------------------------------------------
-- 1. set_ready -- will replace the direct game_players UPDATE in
--    roomService.ts's setReady(). Touches only the acting player's own
--    `ready` column; membership-checked so a caller cannot flip another
--    player's flag by simply naming their player_id.
-- ---------------------------------------------------------------------
create or replace function public.set_ready(
  p_game_id uuid,
  p_player_id text,
  p_ready boolean
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from game_players
    where game_id = p_game_id and player_id = p_player_id
  ) then
    raise exception 'Player is not in this game';
  end if;

  -- Only ready is ever written here -- slot, player_id, and game_id are
  -- immutable identity/membership columns and are never part of this SET.
  update game_players
  set ready = p_ready
  where game_id = p_game_id and player_id = p_player_id;
end;
$$;

revoke execute on function public.set_ready(uuid, text, boolean) from public;
grant execute on function public.set_ready(uuid, text, boolean) to anon;

-- ---------------------------------------------------------------------
-- 2. begin_drawing_round -- will replace the direct rounds UPDATE in
--    roomService.ts's beginDrawingRound(). Resolves game_id from the round
--    itself (the client never supplies it), so a caller cannot point this
--    at an arbitrary round outside their own game by guessing a game_id.
--    Membership-checked, not host-only, per the Step 2B instructions --
--    current runtime (PromptScreen's "START DRAWING") does not restrict
--    this to the host, so this RPC preserves that.
-- ---------------------------------------------------------------------
create or replace function public.begin_drawing_round(
  p_round_id uuid,
  p_actor_player_id text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game_id uuid;
begin
  select game_id into v_game_id
  from rounds
  where id = p_round_id;

  if not found then
    raise exception 'Round not found';
  end if;

  if not exists (
    select 1 from game_players
    where game_id = v_game_id and player_id = p_actor_player_id
  ) then
    raise exception 'Player is not in this game';
  end if;

  -- The status guard is the only transition this function can ever make
  -- (prompt -> drawing). A second/duplicate call after the first succeeded
  -- simply matches zero rows here and returns normally -- the same silent,
  -- harmless no-op the original direct UPDATE's own status guard already
  -- produced, so duplicate-call behavior is unchanged.
  update rounds
  set status = 'drawing'
  where id = p_round_id and status = 'prompt';
end;
$$;

revoke execute on function public.begin_drawing_round(uuid, text) from public;
grant execute on function public.begin_drawing_round(uuid, text) to anon;

-- ---------------------------------------------------------------------
-- 3. mark_round_reveal -- will replace the direct rounds UPDATE in
--    roomService.ts's markReveal(). Same shape as begin_drawing_round:
--    server-resolved game_id, membership check, single fixed transition.
-- ---------------------------------------------------------------------
create or replace function public.mark_round_reveal(
  p_round_id uuid,
  p_actor_player_id text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game_id uuid;
begin
  select game_id into v_game_id
  from rounds
  where id = p_round_id;

  if not found then
    raise exception 'Round not found';
  end if;

  if not exists (
    select 1 from game_players
    where game_id = v_game_id and player_id = p_actor_player_id
  ) then
    raise exception 'Player is not in this game';
  end if;

  update rounds
  set status = 'reveal'
  where id = p_round_id and status = 'results';
end;
$$;

revoke execute on function public.mark_round_reveal(uuid, text) from public;
grant execute on function public.mark_round_reveal(uuid, text) to anon;

-- ---------------------------------------------------------------------
-- 4. end_game -- will replace the direct games UPDATE in roomService.ts's
--    endRemoteGame(). Membership-checked, deliberately NOT host-only --
--    the current app lets either player end the game (Next Round's
--    "END GAME" link and the Judge-failure screen's "EXIT TO HOME" are
--    both reachable by either player), and this RPC preserves that.
--    Idempotent: a repeat call's status <> 'ended' guard leaves the
--    original ended_at untouched rather than sliding it forward, which is
--    a strict improvement over the original direct UPDATE (which had no
--    status guard at all and would have overwritten ended_at on every
--    redundant call) with no observable behavior change to the client --
--    nothing reads ended_at for gameplay logic.
-- ---------------------------------------------------------------------
create or replace function public.end_game(
  p_game_id uuid,
  p_actor_player_id text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from game_players
    where game_id = p_game_id and player_id = p_actor_player_id
  ) then
    raise exception 'Player is not in this game';
  end if;

  update games
  set status = 'ended', ended_at = now()
  where id = p_game_id and status <> 'ended';
end;
$$;

revoke execute on function public.end_game(uuid, text) from public;
grant execute on function public.end_game(uuid, text) to anon;

-- No policy is dropped and no table grant is revoked in this migration.
-- The pre-existing Milestone-2 permissive UPDATE policies on games,
-- game_players, rounds, and round_submissions remain fully in force until
-- 202609100017 is applied.
