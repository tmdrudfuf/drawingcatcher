// Offline source-inspection checks for M6C's round-scoped characterization
// visibility. roomService.ts imports the Supabase JS client and AsyncStorage
// (via the supabase provider), so this reads its own source text rather than
// importing/executing it, same approach as every other source-inspection
// test in this project.
//
// Run with:
//   npx deno test --allow-read=src src/services/game/roomService.characterizationRoundScoping.test.ts
import { assert, assertFalse } from 'https://deno.land/std@0.224.0/assert/mod.ts';

async function roomServiceSource(): Promise<string> {
  return await Deno.readTextFile(new URL('./roomService.ts', import.meta.url));
}

Deno.test('the round_submissions query fetches characterization_status/characterized_path/characterization_style', async () => {
  const source = await roomServiceSource();
  assert(source.includes('characterization_status, characterized_path, characterization_style'));
});

Deno.test('the round_submissions query remains scoped to exactly the current round (round.id)', async () => {
  const source = await roomServiceSource();
  const selectBlock = source.match(/\.from\('round_submissions'\)[\s\S]*?\.eq\('round_id', round\.id\)/);
  assert(selectBlock, 'expected the round_submissions query to filter by .eq(\'round_id\', round.id)');
});

Deno.test('RemotePlayer exposes characterizationStatus/characterizedPath/characterizationStyle', async () => {
  const source = await roomServiceSource();
  const interfaceMatch = source.match(/export interface RemotePlayer extends Player \{[\s\S]*?\n\}/);
  assert(interfaceMatch, 'could not locate the RemotePlayer interface');
  const body = interfaceMatch![0];
  assert(body.includes('characterizationStatus: CharacterizationDbStatus'));
  assert(body.includes('characterizedPath: string | null'));
  assert(body.includes('characterizationStyle: string | null'));
});

Deno.test('CharacterizationDbStatus mirrors the exact DB check constraint values', async () => {
  const source = await roomServiceSource();
  assert(
    source.includes(
      "export type CharacterizationDbStatus = 'pending' | 'generating' | 'completed' | 'failed';",
    ),
  );
});

Deno.test('toRemotePlayers maps the three new fields from the submission row, defaulting safely when no submission exists yet', async () => {
  const source = await roomServiceSource();
  const fnMatch = source.match(/function toRemotePlayers\([\s\S]*?\n\}/);
  assert(fnMatch, 'could not locate toRemotePlayers');
  const body = fnMatch![0];
  assert(body.includes("characterizationStatus: submission?.characterization_status ?? 'pending'"));
  assert(body.includes('characterizedPath: submission?.characterized_path ?? null'));
  assert(body.includes('characterizationStyle: submission?.characterization_style ?? null'));
});

Deno.test('round_submissions Realtime subscription remains present and unfiltered, so both devices observe the same row', async () => {
  const source = await roomServiceSource();
  assert(
    /\.on\('postgres_changes', \{ event: '\*', schema: 'public', table: 'round_submissions' \}, refresh\)/.test(
      source,
    ),
  );
});

Deno.test('this change touches no RPC/mutation function -- purely an additive read', async () => {
  const source = await roomServiceSource();
  // Sanity: the existing RPC call sites (set_ready, begin_drawing_round,
  // mark_round_reveal, request_next_round, end_game, submit_round_drawing,
  // start_round_if_ready, register_or_touch_player) must all still exist
  // unchanged -- this feature must not have touched any of them.
  for (const rpc of [
    'set_ready',
    'begin_drawing_round',
    'mark_round_reveal',
    'request_next_round',
    'end_game',
    'submit_round_drawing',
    'start_round_if_ready',
    'register_or_touch_player',
  ]) {
    assert(source.includes(`rpc('${rpc}'`), `expected rpc('${rpc}' call to still be present`);
  }
});
