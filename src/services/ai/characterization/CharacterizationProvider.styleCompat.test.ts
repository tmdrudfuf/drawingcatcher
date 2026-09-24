// Offline source-inspection check for the "remove REALISTIC from future
// generation" task. CharacterizationProvider.ts type-imports
// '@/types/game' (a path-aliased React Native module Deno cannot
// resolve), so this reads the file's own source text, same approach as
// the other source-inspection tests in this project (e.g.
// RevealScreen.styleBadge.test.ts).
//
// Run with:
//   npx deno test --allow-read=src/services/ai/characterization src/services/ai/characterization/CharacterizationProvider.styleCompat.test.ts
import { assert } from 'https://deno.land/std@0.224.0/assert/mod.ts';

async function readSource(): Promise<string> {
  return await Deno.readTextFile(new URL('./CharacterizationProvider.ts', import.meta.url));
}

Deno.test('CHARACTERIZATION_STYLES (client display/validation list) still includes realistic, for legacy rows', async () => {
  const source = await readSource();
  const match = source.match(/export const CHARACTERIZATION_STYLES = \[([\s\S]*?)\] as const;/);
  assert(match, 'could not locate CHARACTERIZATION_STYLES');
  const body = match![1];
  for (const key of ['cute', 'funny', 'epic', 'chibi', 'realistic', 'anime', 'pixel_art', 'crayon']) {
    assert(new RegExp(`'${key}'`).test(body), `CHARACTERIZATION_STYLES is missing "${key}"`);
  }
});

Deno.test('the removal of realistic from active generation is documented as legacy-display-only here, not a re-addition to selection', async () => {
  const source = await readSource();
  assert(
    source.includes("'realistic' was removed from active generation"),
    'expected a note explaining why realistic remains in this client-side list despite being removed server-side',
  );
});
