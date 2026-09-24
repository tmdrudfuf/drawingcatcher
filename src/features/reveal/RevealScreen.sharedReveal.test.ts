// Offline source-inspection checks for M6C's shared Reveal visibility and
// round-safe characterization reuse. RevealScreen.tsx imports React
// Native/Expo modules Deno cannot resolve, so this reads the file's own
// source text and checks the specific structural properties the task asked
// for, same approach as RevealScreen.styleBadge.test.ts.
//
// Run with:
//   npx deno test --allow-read=src/features/reveal src/features/reveal/RevealScreen.sharedReveal.test.ts
import { assert, assertFalse } from 'https://deno.land/std@0.224.0/assert/mod.ts';

async function readRevealScreenSource(): Promise<string> {
  return await Deno.readTextFile(new URL('./RevealScreen.tsx', import.meta.url));
}

// -- round-scoped derivation -------------------------------------------------
Deno.test('winnerSubmission is derived from remoteRoom.players (round-scoped server data), not local component state', async () => {
  const source = await readRevealScreenSource();
  assert(
    source.includes('remoteRoom?.players.find((p) => p.id === winner.id)'),
    'expected winnerSubmission to read from remoteRoom.players',
  );
});

Deno.test('remoteCharacterizationReady requires both a completed status and a real path -- never status alone', async () => {
  const source = await readRevealScreenSource();
  const match = source.match(/const remoteCharacterizationReady = Boolean\(([\s\S]*?)\);/);
  assert(match, 'could not locate remoteCharacterizationReady');
  assert(match![1].includes("characterizationStatus === 'completed'"));
  assert(match![1].includes('characterizedPath'));
});

// -- no redundant characterization request -----------------------------------
Deno.test('chooseCharacterize reuses an already-completed result directly instead of re-entering the characterizing step', async () => {
  const source = await readRevealScreenSource();
  const fnMatch = source.match(/const chooseCharacterize = \(\) => \{[\s\S]*?\n  \};/);
  assert(fnMatch, 'could not locate chooseCharacterize');
  const body = fnMatch![0];
  assert(body.includes('if (remoteCharacterizationReady && winnerSubmission?.characterizedPath)'));
  assert(body.includes("setRevealStep('characterized')"), 'the reuse branch must skip straight to characterized');
  assert(body.includes('reportCharacterizations({ [winner.id]: result })'));
  // The reuse branch must return before ever reaching the network-triggering
  // fallback path.
  const reuseIndex = body.indexOf('if (remoteCharacterizationReady');
  const fallbackIndex = body.lastIndexOf("setRevealStep('characterizing')");
  assert(reuseIndex >= 0 && fallbackIndex >= 0 && reuseIndex < fallbackIndex);
});

Deno.test('the reused result is built only from data already on hand -- no characterize-drawing call in the reuse branch', async () => {
  const source = await readRevealScreenSource();
  const fnMatch = source.match(/const chooseCharacterize = \(\) => \{[\s\S]*?\n  \};/);
  assert(fnMatch);
  const reuseBranch = fnMatch![0].match(/if \(remoteCharacterizationReady[\s\S]*?return;\n    \}/);
  assert(reuseBranch, 'could not isolate the reuse branch');
  assertFalse(reuseBranch![0].includes('characterizationService.characterize'));
  assertFalse(reuseBranch![0].includes('characterizeSafely'));
});

// -- shared visibility banner -------------------------------------------------
Deno.test('the choice screen surfaces "ready", "in progress", and "failed" banners driven by server state', async () => {
  const source = await readRevealScreenSource();
  assert(source.includes('remoteCharacterizationReady ?'), 'expected a ready-state banner branch');
  assert(source.includes('The transformation is ready!'));
  assert(source.includes('SEE IT NOW'));
  assert(source.includes('remoteCharacterizationInProgress ?'), 'expected an in-progress banner branch');
  assert(source.includes("drawing is being brought to life"));
  assert(source.includes('remoteCharacterizationFailed ?'), 'expected a failed-state banner branch');
  assert(source.includes('Couldn&apos;t bring this one to life.'));
  assert(source.includes('You can still continue with the original sketch.'));
});

// -- M6D: full four-state matrix (generating/completed/failed/none) ---------
Deno.test('remoteCharacterizationFailed is derived from the current-round winnerSubmission only, mirroring the ready/in-progress derivations', async () => {
  const source = await readRevealScreenSource();
  const match = source.match(/const remoteCharacterizationFailed = ([^;]+);/);
  assert(match, 'could not locate remoteCharacterizationFailed');
  assert(match![1].includes('isRemoteGame'));
  assert(match![1].includes("winnerSubmission?.characterizationStatus === 'failed'"));
});

Deno.test('the three banner branches and the no-banner case are mutually exclusive (a single if/else-if/else-if/else chain)', async () => {
  const source = await readRevealScreenSource();
  const chainMatch = source.match(
    /\{remoteCharacterizationReady \? \([\s\S]*?\) : remoteCharacterizationInProgress \? \([\s\S]*?\) : remoteCharacterizationFailed \? \([\s\S]*?\) : null\}/,
  );
  assert(chainMatch, 'expected exactly one ready -> in-progress -> failed -> null ternary chain');
});

Deno.test('the failed banner never claims a transformation exists, never shows the mascot, and never auto-retries/auto-triggers anything', async () => {
  const source = await readRevealScreenSource();
  const bannerMatch = source.match(/remoteCharacterizationFailed \? \(([\s\S]*?)\) : null\}/);
  assert(bannerMatch, 'could not isolate the failed banner block');
  const block = bannerMatch![1];
  assertFalse(block.includes('<MotionCat'));
  assertFalse(block.includes('<CatDoodle'));
  assertFalse(block.includes('characterizeSafely'));
  assertFalse(block.includes('characterizationService.characterize'));
  assertFalse(block.includes('showRewardedAd'));
  assertFalse(block.includes('startWinnerAnimation'));
  assertFalse(block.includes('generateRealAnimation'));
  assertFalse(block.includes('onPress'), 'the failed banner must be purely informational, no action button');
});

Deno.test('when no current-round characterization state applies (pending, or local/demo mode), no shared-status banner renders', async () => {
  const source = await readRevealScreenSource();
  // The chain's final fallback must be a bare `null` -- i.e. the "none of
  // the three" case renders nothing extra, not some other placeholder.
  assert(
    /remoteCharacterizationFailed \? \([\s\S]*?\) : null\}/.test(source),
    'expected the chain to terminate in a bare null for the no-status case',
  );
});

Deno.test('"SEE IT NOW" is wired to chooseCharacterize, the same reuse-aware handler', async () => {
  const source = await readRevealScreenSource();
  assert(source.includes('label="SEE IT NOW" size="lg" onPress={chooseCharacterize}'));
});

// -- honest failure state is untouched by this change ------------------------
Deno.test('the M6B honest-failure state (characterizationFailed) is unaffected by the new reuse/visibility logic', async () => {
  const source = await readRevealScreenSource();
  assert(source.includes('const characterizationFailed = isRemoteGame && !realCharacterUri;'));
  assert(source.includes("COULDN'T BRING THIS ONE TO LIFE"));
});

// -- non-winner clarity for the ad/animate path -------------------------------
Deno.test('the Animate card clarifies for the non-winner that only the winner can start generation', async () => {
  const source = await readRevealScreenSource();
  assert(source.includes('localPlayerId !== winner.id ? ('));
  assert(source.includes('Only {winner.name} can start the generation'));
});

// -- no automatic paid generation / ad trigger --------------------------------
Deno.test('showRewardedAd and generateRealAnimation remain reachable only from explicit onPress handlers, never from an effect', async () => {
  const source = await readRevealScreenSource();
  // Collect every call site of each function and assert none appear inside
  // a useEffect body by checking they are always preceded by an onPress=
  // wiring (the two legitimate call sites: the button in the choice screen,
  // and the function's own declaration/self-reference for a "TRY AGAIN"
  // retry button -- both explicit user presses).
  const showRewardedAdCallSites = [...source.matchAll(/showRewardedAd\(\)/g)];
  const generateRealAnimationCallSites = [...source.matchAll(/generateRealAnimation\(\)/g)];
  assert(showRewardedAdCallSites.length > 0);
  assert(generateRealAnimationCallSites.length > 0);
  for (const call of [...showRewardedAdCallSites, ...generateRealAnimationCallSites]) {
    const contextStart = Math.max(0, call.index! - 60);
    const context = source.slice(contextStart, call.index! + 20);
    assert(
      context.includes('onPress='),
      `expected every call to be wired from an explicit onPress, got context: "${context}"`,
    );
  }
});

Deno.test('no useEffect body calls startWinnerAnimation or rewardedAdProvider.show directly', async () => {
  const source = await readRevealScreenSource();
  const effectBodies = [...source.matchAll(/useEffect\(\(\) => \{[\s\S]*?\n  \}, \[[^\]]*\]\);/g)].map((m) => m[0]);
  for (const body of effectBodies) {
    assertFalse(body.includes('startWinnerAnimation('), 'an effect must never call startWinnerAnimation directly');
    assertFalse(body.includes('rewardedAdProvider.show('), 'an effect must never call rewardedAdProvider.show directly');
  }
});
