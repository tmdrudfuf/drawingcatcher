// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    // Deno runtime code (different globals/module resolution) — not part of
    // the Expo app's lint surface.
    ignores: ["dist/*", "supabase/functions/**"],
  }
]);
