// Offline source-inspection checks for Trustworthy Core Step 2B (client-side
// half): roomService.ts imports the Supabase JS client and process.env, but
// this reads its own source text rather than importing/executing it, same
// approach as every other source-inspection test in this project.
//
// Run with:
//   npx deno test --allow-read=src src/services/game/roomService.trustworthyCore.test.ts
import { assert, assertFalse } from 'https://deno.land/std@0.224.0/assert/mod.ts';

async function roomServiceSource(): Promise<string> {
  return await Deno.readTextFile(new URL('./roomService.ts', import.meta.url));
}

// -- 13. no direct UPDATE remains on any of the four hardened tables --------
Deno.test('roomService contains zero direct .update(...) calls against games/game_players/rounds/round_submissions', async () => {
  const source = await roomServiceSource();
  assertFalse(source.includes(".from('games').update("));
  assertFalse(source.includes(".from('game_players').update("));
  assertFalse(source.includes(".from('rounds').update("));
  assertFalse(source.includes(".from('round_submissions').update("));
});

// -- 14. roomService calls all four new RPCs ---------------------------------
Deno.test('setReady, beginDrawingRound, markReveal, and endRemoteGame all route through the new RPCs', async () => {
  const source = await roomServiceSource();
  assert(source.includes("rpc('set_ready',"));
  assert(source.includes("rpc('begin_drawing_round',"));
  assert(source.includes("rpc('mark_round_reveal',"));
  assert(source.includes("rpc('end_game',"));
});

Deno.test('beginDrawingRound, markReveal, and endRemoteGame now require an actor player id parameter', async () => {
  const source = await roomServiceSource();
  assert(/export async function beginDrawingRound\(roundId: string, actorPlayerId: string\)/.test(source));
  assert(/export async function markReveal\(roundId: string, actorPlayerId: string\)/.test(source));
  assert(/export async function endRemoteGame\(gameId: string, actorPlayerId: string\)/.test(source));
});

Deno.test('every RPC call site forwards the correct parameter names the migration expects', async () => {
  const source = await roomServiceSource();
  assert(/p_game_id: gameId,\s*p_player_id: playerId,\s*p_ready: ready,/.test(source));
  assert(/p_round_id: roundId,\s*p_actor_player_id: actorPlayerId,/.test(source));
  assert(/p_game_id: gameId,\s*p_actor_player_id: actorPlayerId,/.test(source));
});
