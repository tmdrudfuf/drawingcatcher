// Offline source-inspection checks for Trustworthy Core Step 1 (honest Judge
// failure UI, no fabricated 87/74 scores or fake winner). JudgeScreen.tsx and
// GameProvider.tsx import React Native/Expo modules Deno cannot resolve, and
// this repo has no React Native component test runner (confirmed absent
// throughout this project -- see RevealScreen.styleBadge.test.ts), so this
// reads each file's own source text and checks the specific structural
// properties the task asked for, rather than rendering the components.
//
// Run with:
//   npx deno test --allow-read=src src/features/judging/JudgeScreen.trustworthyCore.test.ts
import { assert, assertEquals, assertFalse } from 'https://deno.land/std@0.224.0/assert/mod.ts';

async function read(relativeToThisFile: string): Promise<string> {
  return await Deno.readTextFile(new URL(relativeToThisFile, import.meta.url));
}

async function judgeScreenSource(): Promise<string> {
  return await read('./JudgeScreen.tsx');
}

async function gameProviderSource(): Promise<string> {
  return await read('../../providers/game/GameProvider.tsx');
}

async function roomServiceSource(): Promise<string> {
  return await read('../../services/game/roomService.ts');
}

async function judgeIndexSource(): Promise<string> {
  return await read('../../services/ai/judge/index.ts');
}

// -- 2/3. Gemini Judge failure does not produce 87/74 or a fake winner ------
Deno.test('JudgeScreen no longer imports or calls the fake judge fallback', async () => {
  const source = await judgeScreenSource();
  assertFalse(source.includes('fakeJudgeService'), 'JudgeScreen must not reference fakeJudgeService');
  assertFalse(/\bimport\b[\s\S]*FakeJudgeProvider/.test(source), 'JudgeScreen must not import FakeJudgeProvider');
});

Deno.test('the fake judge fallback is no longer exported for direct use', async () => {
  const source = await judgeIndexSource();
  assertFalse(source.includes('fakeJudgeService'), 'judge/index.ts must not export a direct fake-fallback handle');
});

Deno.test('judgeSafely reports a real failure honestly instead of returning a fabricated JudgeRoundResult', async () => {
  const source = await judgeScreenSource();
  assert(source.includes("status: 'failed'"), 'expected an honest failed-status outcome branch');
  assert(source.includes("status: 'success'"), 'expected an honest success-status outcome branch');
  // The literal 87/74 fallback scores must not exist anywhere reachable from
  // JudgeScreen's own source.
  assertFalse(/\b87\b/.test(source), 'JudgeScreen must not contain the literal fake score 87');
  assertFalse(/\b74\b/.test(source), 'JudgeScreen must not contain the literal fake score 74');
});

// -- 4. GameProvider does not reconstruct deterministic scores --------------
Deno.test('buildDeterministicJudgeResult no longer exists in GameProvider', async () => {
  const source = await gameProviderSource();
  assertFalse(source.includes('buildDeterministicJudgeResult'));
  assertFalse(/score:\s*87\b/.test(source), 'no fabricated score of 87 may remain');
  assertFalse(/score:\s*74\b/.test(source), 'no fabricated score of 74 may remain');
});

Deno.test('judgeResult in the state derivation requires a real judgeSummary, with no deterministic-placeholder branch', async () => {
  const source = await gameProviderSource();
  const memoMatch = source.match(/const judgeResult =[\s\S]*?: null;/);
  assert(memoMatch, 'could not locate the judgeResult derivation in the state useMemo');
  const body = memoMatch![0];
  assert(body.includes('remoteRoom.judgeSummary'), 'judgeResult must still gate on a real judgeSummary');
  assert(body.includes('buildRealJudgeResult'), 'judgeResult must still use the real-result builder on success');
  assertFalse(body.includes('buildDeterministicJudgeResult'));
});

// -- 7. null winner is not converted to Player 1 -----------------------------
Deno.test('buildRealJudgeResult never defaults a missing winner to players[0]', async () => {
  const source = await gameProviderSource();
  assertFalse(
    source.includes('winnerPlayerId: remote.winnerPlayerId ?? players[0].id'),
    'a null/absent winner must never be silently converted to Player 1',
  );
  const fnMatch = source.match(/function buildRealJudgeResult\([\s\S]*?\n}/);
  assert(fnMatch, 'could not locate buildRealJudgeResult');
  const body = fnMatch![0];
  assert(
    /if \(!remote\.winnerPlayerId\) return null;/.test(body),
    'buildRealJudgeResult must return null rather than fabricate a winner when winnerPlayerId is absent',
  );
});

Deno.test('completeRemoteJudging / complete_fake_judging are no longer referenced from src/', async () => {
  const files = [await judgeScreenSource(), await gameProviderSource(), await roomServiceSource()];
  for (const source of files) {
    assertFalse(source.includes('completeRemoteJudging'));
    assertFalse(source.includes('complete_fake_judging'));
  }
});

// -- 1/8. Real completed Judge result / success flow remain unchanged -------
Deno.test('buildRealJudgeResult still maps the real persisted Gemini scores/comment/reasons on success', async () => {
  const source = await gameProviderSource();
  const fnMatch = source.match(/function buildRealJudgeResult\([\s\S]*?\n}/);
  assert(fnMatch);
  const body = fnMatch![0];
  assert(body.includes('summary.player1Score'));
  assert(body.includes('summary.player2Score'));
  assert(body.includes('summary.comment'));
  assert(body.includes('summary.player1Reason'));
  assert(body.includes('summary.player2Reason'));
});

Deno.test('the real Gemini success path in JudgeScreen is untouched: judgeService is still called for the real result', async () => {
  const source = await judgeScreenSource();
  assert(source.includes('judgeService.judgeRound(input)'));
  assert(source.includes("track('judge_completed'"));
});

// -- 5/6. shared/server-derived failure state is honest and observable ------
Deno.test('RoomSnapshot exposes a real judgeStatus/judgeError pair sourced from the DB row, not derived client-side', async () => {
  const source = await roomServiceSource();
  assert(source.includes('judgeStatus:'));
  assert(source.includes('judgeError:'));
  assert(source.includes("judge_status, judge_error"), 'the round select must fetch judge_status/judge_error columns');
});

Deno.test('JudgeScreen surfaces a shared-state judge failure (second device / reload) without fabricating a result', async () => {
  const source = await judgeScreenSource();
  assert(
    source.includes("remoteRoom?.judgeStatus === 'failed'"),
    'JudgeScreen must react to the server-authoritative judgeStatus, not only its own local call outcome',
  );
  assert(
    source.includes('remoteRoom.judgeError'),
    'the failure UI must be able to show the real server-persisted error, not a placeholder string',
  );
});

Deno.test('reloading onto an already-failed round does not silently trigger another Gemini call', async () => {
  const source = await judgeScreenSource();
  // The one-shot mount effect must check judgeStatus === 'failed' BEFORE
  // calling runJudge(), and return without calling it in that case.
  const effectMatch = source.match(/useEffect\(\(\) => \{\s*if \(state\.roundNumber === 0\)[\s\S]*?\}, \[state\.roundNumber\]\);/);
  assert(effectMatch, 'could not locate the one-shot mount effect');
  const body = effectMatch![0];
  const failedCheckIndex = body.indexOf("remoteRoom?.judgeStatus === 'failed'");
  const runJudgeCallIndex = body.lastIndexOf('runJudge');
  assert(failedCheckIndex !== -1, 'expected an already-failed guard in the mount effect');
  assert(runJudgeCallIndex !== -1, 'expected the mount effect to still trigger runJudge for the normal case');
  assert(failedCheckIndex < runJudgeCallIndex, 'the already-failed guard must be checked before the automatic call');
});

// -- Retry safety: only offered because judge-round's claim is reclaimable --
Deno.test('Retry re-invokes the real judge attempt explicitly (no fabricated result, no separate fake path)', async () => {
  const source = await judgeScreenSource();
  assert(source.includes('onPress={runJudge}'), 'expected an explicit Retry action wired to runJudge');
  assert(source.includes('disabled={busy}'), 'expected the retry control to be disabled while a call is in flight');
});

Deno.test('a safe exit action (endGame) is offered on the failure screen', async () => {
  const source = await judgeScreenSource();
  assert(source.includes('endGame'), 'expected a safe exit action using the existing, already-real endGame() flow');
});

Deno.test('the failure screen never renders the normal "AI is judging" content, and vice versa', async () => {
  const source = await judgeScreenSource();
  assert(/if \(failure\) \{\s*return \(/.test(source), 'expected an early-return failure branch, not an inline conditional mixed into the main render');
});
