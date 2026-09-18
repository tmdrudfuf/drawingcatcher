// Offline unit tests for the AdMob TEST/PRODUCTION mode resolver. Pure
// functions, no React Native/Expo imports -- runnable directly with:
//   npx deno test src/services/ads/admobConfig.test.ts
import { assert, assertEquals, assertNotEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { androidAppIdForMode, iosAppIdForMode, resolveAdMobMode, rewardedAdUnitIdForMode } from './admobConfig.ts';

const TEST_REWARDED_ID = 'ca-app-pub-3940256099942544/5224354917'; // stand-in for TestIds.REWARDED
const PRODUCTION_ANDROID_APP_ID = 'ca-app-pub-3024928824650244~6785974545';
const PRODUCTION_REWARDED_AD_UNIT_ID = 'ca-app-pub-3024928824650244/9979114091';

// A. missing ad mode -> TEST
Deno.test('A: undefined mode resolves to test', () => {
  assertEquals(resolveAdMobMode(undefined), 'test');
});

// B. ad mode=test -> TEST
Deno.test('B: explicit "test" resolves to test', () => {
  assertEquals(resolveAdMobMode('test'), 'test');
});

// C. malformed mode -> TEST
Deno.test('C: malformed/unknown values all fail safe to test', () => {
  for (const bad of ['prod', 'Production', ' production', 'production ', 'PRODUCTION', '1', 'true', '']) {
    assertEquals(resolveAdMobMode(bad), 'test', `expected "${bad}" to resolve to test`);
  }
});

// D. explicit production mode -> production IDs
Deno.test('D: exact "production" resolves to production, and production mode selects production IDs', () => {
  const mode = resolveAdMobMode('production');
  assertEquals(mode, 'production');
  assertEquals(androidAppIdForMode(mode), PRODUCTION_ANDROID_APP_ID);
  assertEquals(rewardedAdUnitIdForMode(mode, TEST_REWARDED_ID), PRODUCTION_REWARDED_AD_UNIT_ID);
});

// E. test mode never selects the production Rewarded Ad Unit ID.
Deno.test('E: test mode never returns the production ad unit id, for any input shape', () => {
  const testModeResult = rewardedAdUnitIdForMode('test', TEST_REWARDED_ID);
  assertEquals(testModeResult, TEST_REWARDED_ID);
  assert(!testModeResult.includes('3024928824650244'), 'test mode leaked the production publisher id');
  // Same invariant via every fail-safe path into 'test'.
  for (const bad of [undefined, '', 'prod', 'Production']) {
    const mode = resolveAdMobMode(bad);
    const id = rewardedAdUnitIdForMode(mode, TEST_REWARDED_ID);
    assert(!id.includes('3024928824650244'), `mode resolved from "${bad}" leaked the production ad unit`);
  }
});

// F. production mode selects the exact intended Rewarded Ad Unit ID.
Deno.test('F: production mode selects the exact production ad unit id', () => {
  assertEquals(rewardedAdUnitIdForMode('production', TEST_REWARDED_ID), PRODUCTION_REWARDED_AD_UNIT_ID);
});

Deno.test('android app id differs between modes; ios app id never does (no production iOS id exists yet)', () => {
  assertNotEquals(androidAppIdForMode('test'), androidAppIdForMode('production'));
  assertEquals(iosAppIdForMode('test'), iosAppIdForMode('production'));
});
