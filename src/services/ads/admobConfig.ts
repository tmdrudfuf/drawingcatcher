// M4E step 3: explicit TEST/PRODUCTION AdMob selection.
//
// Deliberately a standalone, import-free module (no react-native-google-mobile-ads,
// no expo, no '@/' path aliases): app.config.ts imports it too, at
// prebuild/config-evaluation time in a plain Node process, and that loader
// does not resolve this project's Metro/TS path aliases or native modules.
// Keeping this file dependency-free is what lets ONE source of truth drive
// both the native AdMob App ID (app.config.ts, requires a rebuild to take
// effect) and the JS-selected rewarded ad unit ID (GoogleRewardedAdProvider.ts,
// takes effect immediately at runtime) without duplicating the mode logic.
//
// It is also runnable directly with `npx deno test` (see admobConfig.test.ts)
// for exactly the same reason: no import this repo's other test runner (Deno,
// used for the Supabase Edge Functions) can't resolve.

export type AdMobMode = 'test' | 'production';

// Google's official public sample IDs -- always safe to ship, never serve a
// real ad, and require no AdMob account of our own.
const TEST_ANDROID_APP_ID = 'ca-app-pub-3940256099942544~3347511713';
const TEST_IOS_APP_ID = 'ca-app-pub-3940256099942544~1458002511';

// Drawing Catcher's real AdMob app/ad-unit (Android only -- see
// iosAppIdForMode below).
const PRODUCTION_ANDROID_APP_ID = 'ca-app-pub-3024928824650244~6785974545';
const PRODUCTION_REWARDED_AD_UNIT_ID = 'ca-app-pub-3024928824650244/9979114091';

/**
 * Fail-safe by construction: the ONLY input that ever resolves to
 * 'production' is the exact string "production". Missing, empty, unknown,
 * or misspelled values (undefined, "", "prod", "Production", " production")
 * all resolve to 'test' -- there is no code path where an absent or
 * malformed value resolves to 'production'.
 *
 * Deliberately NOT based on __DEV__: a development build must be able to
 * opt into 'production' mode on purpose (for an SSV E2E test), and a
 * release build must not silently default to production ads just because
 * __DEV__ happens to be false there.
 */
export function resolveAdMobMode(
  rawValue: string | undefined = typeof process !== 'undefined' ? process.env.EXPO_PUBLIC_ADMOB_MODE : undefined,
): AdMobMode {
  return rawValue === 'production' ? 'production' : 'test';
}

export function androidAppIdForMode(mode: AdMobMode): string {
  return mode === 'production' ? PRODUCTION_ANDROID_APP_ID : TEST_ANDROID_APP_ID;
}

// No production iOS App ID/ad unit has been provisioned yet -- iOS always
// uses Google's sample/test App ID regardless of mode. This is a
// deliberate, temporary limitation (not an oversight): there is currently
// no way to select a production iOS ad at all, on any mode, until a real
// iOS App ID is added here.
export function iosAppIdForMode(_mode: AdMobMode): string {
  return TEST_IOS_APP_ID;
}

/**
 * `testRewardedId` is passed in by the caller (react-native-google-mobile-ads'
 * own `TestIds.REWARDED`) rather than imported here, so this module never
 * depends on that native package -- app.config.ts can still import it
 * safely from a plain Node process.
 */
export function rewardedAdUnitIdForMode(mode: AdMobMode, testRewardedId: string): string {
  return mode === 'production' ? PRODUCTION_REWARDED_AD_UNIT_ID : testRewardedId;
}
