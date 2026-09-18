// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    // Deno runtime code (different globals/module resolution) — not part of
    // the Expo app's lint surface. src/**/*.test.ts covers admobConfig.test.ts
    // (M4E step 3): plain-TS client modules that are deliberately run with
    // `npx deno test` instead of a JS test runner, since this repo has none.
    ignores: ["dist/*", "supabase/functions/**", "src/**/*.test.ts"],
  }
]);
