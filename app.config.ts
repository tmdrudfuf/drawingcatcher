import type { ConfigContext, ExpoConfig } from 'expo/config';

// M4E step 3: makes the native AdMob App ID depend on EXPO_PUBLIC_ADMOB_MODE,
// without rewriting app.json by hand. app.json remains the single source of
// truth for every field except the react-native-google-mobile-ads plugin's
// androidAppId/iosAppId -- Expo resolves app.json first and hands the
// result in as `config` here; this function only replaces that one
// plugin's config entry (by name, via .map()) and returns everything else
// completely untouched. That makes "identical to app.json except the AdMob
// App ID" true by construction, not by manual duplication that could
// silently drop a sibling field (predictiveBackGestureEnabled,
// experiments.reactCompiler, the splash-screen block, etc.) -- verified by
// diffing `npx expo config --type prebuild --json` before/after this file
// existed; see the M4E step 3 report for the exact diff.
//
// This file runs in a plain Node `require()` process at config-evaluation
// time (expo start/run/prebuild) -- NOT in the RN JS bundle -- so it reads
// process.env directly, same convention as every other EXPO_PUBLIC_* value
// in this project (see src/providers/supabase/supabase.ts).
//
// IMPORTANT: the mode/ID constants below are intentionally DUPLICATED from
// src/services/ads/admobConfig.ts rather than imported from it. Expo's
// app.config.ts loader transpiles this one file but then `require()`s
// whatever it imports as plain Node CommonJS, which cannot resolve a bare
// `.ts` file with no compiled `.js` sibling (confirmed empirically: an
// `import ... from './src/services/ads/admobConfig'` here fails with
// "Cannot find module", even though the same path resolves fine for
// Metro/tsc in the RN app). admobConfig.ts remains the single source of
// truth for the RUNTIME (JS bundle) selection in
// GoogleRewardedAdProvider.ts and is the one covered by
// admobConfig.test.ts; keep these two constant blocks in sync by hand if
// either AdMob ID ever changes.
//
// Changing the resolved androidAppId/iosAppId here does NOT take effect
// until a native rebuild: the react-native-google-mobile-ads config plugin
// bakes this value into android/app/src/main/AndroidManifest.xml's
// com.google.android.gms.ads.APPLICATION_ID meta-data during `expo
// prebuild` (which `expo run:android` runs automatically when android/ is
// stale or absent). Editing this file alone, with an existing android/
// build, changes nothing until that native regeneration happens.
const ADMOB_PLUGIN_NAME = 'react-native-google-mobile-ads';
const TEST_ANDROID_APP_ID = 'ca-app-pub-3940256099942544~3347511713';
const TEST_IOS_APP_ID = 'ca-app-pub-3940256099942544~1458002511';
const PRODUCTION_ANDROID_APP_ID = 'ca-app-pub-3024928824650244~6785974545';

// Fail-safe by construction, identical rule to admobConfig.ts's
// resolveAdMobMode: only the exact string "production" ever leaves test
// mode. Missing/malformed/unknown values all resolve to test.
const isProductionAdMobMode = process.env.EXPO_PUBLIC_ADMOB_MODE === 'production';
// No production iOS App ID has been provisioned yet -- iOS always gets the
// test App ID regardless of mode (see admobConfig.ts's iosAppIdForMode).
const androidAppId = isProductionAdMobMode ? PRODUCTION_ANDROID_APP_ID : TEST_ANDROID_APP_ID;
const iosAppId = TEST_IOS_APP_ID;

export default ({ config }: ConfigContext): ExpoConfig => {
  const plugins = (config.plugins ?? []).map((plugin) =>
    Array.isArray(plugin) && plugin[0] === ADMOB_PLUGIN_NAME
      ? [ADMOB_PLUGIN_NAME, { ...(plugin[1] as Record<string, unknown>), androidAppId, iosAppId }]
      : plugin,
  );

  return { ...config, plugins } as ExpoConfig;
};
