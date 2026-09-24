// Offline source-inspection checks for M6C's Next Round round-safety fix
// (the M6B-discovered stale-characterization-across-rounds risk).
// NextRoundScreen.tsx imports React Native/Expo modules Deno cannot
// resolve, so this reads the file's own source text, same approach as the
// other source-inspection tests in this project.
//
// Run with:
//   npx deno test --allow-read=src/features/next-round src/features/next-round/NextRoundScreen.roundSafety.test.ts
import { assert, assertFalse } from 'https://deno.land/std@0.224.0/assert/mod.ts';

async function readSource(): Promise<string> {
  return await Deno.readTextFile(new URL('./NextRoundScreen.tsx', import.meta.url));
}

Deno.test('the winner\'s characterized image is read from remotePlayers (round-scoped server state), never from state.characterizations', async () => {
  const source = await readSource();
  const fnMatch = source.match(/const renderPlayerArt = \(p: Player\) => \{[\s\S]*?\n  \};/);
  assert(fnMatch, 'could not locate renderPlayerArt');
  const body = fnMatch![0];
  assert(body.includes('remotePlayers.find((rp) => rp.id === p.id)'), 'expected the lookup to use remotePlayers');
  assertFalse(
    body.includes('state.characterizations'),
    'renderPlayerArt must not read the non-round-scoped state.characterizations map (the M6B stale-image bug)',
  );
});

Deno.test('the characterized image is only ever used for the winner, and falls back to the real original drawing otherwise', async () => {
  const source = await readSource();
  const fnMatch = source.match(/const renderPlayerArt = \(p: Player\) => \{[\s\S]*?\n  \};/);
  assert(fnMatch);
  const body = fnMatch![0];
  assert(body.includes('const characterizedUri = isWinner ? publicCharacterizedUrl(remoteSubmission?.characterizedPath) : null;'));
  assert(body.includes('const realUri = characterizedUri ?? resolveDrawingUri('));
});

Deno.test('the generic mascot (MotionCat/CatDoodle) is only reachable in local/demo mode, never for a real Duo game', async () => {
  const source = await readSource();
  const fnMatch = source.match(/const renderPlayerArt = \(p: Player\) => \{[\s\S]*?\n  \};/);
  assert(fnMatch);
  const body = fnMatch![0];
  const isRemoteGameIndex = body.indexOf('if (isRemoteGame)');
  const remoteReturnIndex = body.indexOf('return <RemoteDrawing');
  const motionCatIndex = body.indexOf('<MotionCat');
  const catDoodleIndex = body.indexOf('<CatDoodle');
  assert(isRemoteGameIndex >= 0 && remoteReturnIndex >= 0 && motionCatIndex >= 0 && catDoodleIndex >= 0);
  // The real-Duo branch (RemoteDrawing) must return before the mascot
  // fallbacks are ever reached.
  assert(remoteReturnIndex < motionCatIndex);
  assert(remoteReturnIndex < catDoodleIndex);
});

Deno.test('a not-yet-characterized current round correctly falls through to the real drawing rather than an old image', async () => {
  const source = await readSource();
  // Structural guarantee: remotePlayers comes from fetchRoomSnapshot, which
  // queries round_submissions scoped to the CURRENT round only (see
  // roomService.characterizationRoundScoping.test.ts) -- a fresh round's
  // row genuinely has characterized_path = null until this round's own
  // characterization completes, so `characterizedUri` is null and the `??`
  // fallback to resolveDrawingUri is exercised, never a stale value.
  assert(source.includes('remotePlayers'), 'expected remotePlayers to be destructured from useGame()');
  const destructureMatch = source.match(/const \{([\s\S]*?)\} = useGame\(\);/);
  assert(destructureMatch);
  assert(destructureMatch![1].includes('remotePlayers'));
});
