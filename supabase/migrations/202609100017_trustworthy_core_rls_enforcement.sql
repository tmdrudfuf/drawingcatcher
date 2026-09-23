-- Trustworthy Core Step 2B, phase 2 of 2: enforcement phase.
--
-- Closes direct UPDATE access to games, game_players, rounds, and
-- round_submissions now that every legitimate write has a replacement RPC
-- (set_ready, begin_drawing_round, mark_round_reveal, end_game -- all
-- created in 202609100016, phase 1). This migration must only be applied
-- once the client build that calls those RPCs (this same Trustworthy Core
-- Step 2B change's roomService.ts/GameProvider.tsx) is confirmed to be the
-- only version reaching production -- applying it any earlier would break
-- every still-running old client's ready/begin-drawing/reveal/end-game
-- actions, since their direct table UPDATEs would start being rejected.
--
-- Drop the four open policies, then revoke the table-level grant -- the
-- same two-step treatment 202609100009 gave public.players. SELECT and
-- INSERT policies are untouched; this migration recreates nothing (the
-- RPCs already exist from 202609100016, unaffected by this migration since
-- privileges on a function and privileges on the tables it internally
-- reads/writes as SECURITY DEFINER are independent).
--
-- Scope discipline (see the Step 2A audit's out-of-scope list): this
-- migration does not touch SELECT policies, does not touch INSERT
-- policies, does not touch DELETE behavior, does not touch Storage, does
-- not touch public.players, and does not touch the
-- animation_jobs/animation_entitlements tables.
--
-- Post-0016 verification found the four RPCs also carry an implicit
-- `authenticated EXECUTE = true`, inherited from Supabase/Postgres default
-- role-specific function privileges -- 202609100016's own
-- `revoke execute ... from public` only removes the world-visible-via-PUBLIC
-- grant, it does not touch a role's own separate, explicitly-held grant.
-- This app is guest-only and has no `authenticated` users anywhere (see the
-- Step 2A/2B design audit), so that grant is unused, latent surface with no
-- legitimate caller -- closed here alongside the table-level enforcement,
-- not as a new class of change. `anon` EXECUTE is left untouched; only the
-- four RPCs' function-level EXECUTE privilege is affected, never their
-- implementation.

drop policy if exists "m2 games update lifecycle" on public.games;
drop policy if exists "m2 game players update flags" on public.game_players;
drop policy if exists "m2 rounds update lifecycle" on public.rounds;
drop policy if exists "m2 submissions update" on public.round_submissions;

revoke update on table public.games from anon, authenticated;
revoke update on table public.game_players from anon, authenticated;
revoke update on table public.rounds from anon, authenticated;
revoke update on table public.round_submissions from anon, authenticated;

revoke execute on function public.set_ready(uuid, text, boolean) from authenticated;
revoke execute on function public.begin_drawing_round(uuid, text) from authenticated;
revoke execute on function public.mark_round_reveal(uuid, text) from authenticated;
revoke execute on function public.end_game(uuid, text) from authenticated;
