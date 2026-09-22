// Offline source-inspection checks for the Characterization V2.1 Reveal UI
// cleanup (Milestone 4G part B). RevealScreen.tsx itself imports React
// Native/Expo modules Deno cannot resolve, and this repo has no React
// Native component test runner (confirmed absent throughout this
// project), so this reads the file's own source text and checks the
// specific structural properties the task asked for, rather than
// rendering the component.
//
// Run with:
//   npx deno test --allow-read=src/features/reveal src/features/reveal/RevealScreen.styleBadge.test.ts
import { assert, assertFalse } from 'https://deno.land/std@0.224.0/assert/mod.ts';

async function readRevealScreenSource(): Promise<string> {
  return await Deno.readTextFile(new URL('./RevealScreen.tsx', import.meta.url));
}

const ALL_STYLE_KEYS = ['cute', 'funny', 'epic', 'chibi', 'realistic', 'anime', 'pixel_art', 'crayon'];

// -- 9. Reveal renders all 8 known styles safely -----------------------------
Deno.test('STYLE_BADGE_LABEL covers exactly the 8 known CharacterizationStyle keys', async () => {
  const source = await readRevealScreenSource();
  const mapMatch = source.match(/const STYLE_BADGE_LABEL: Record<CharacterizationStyle, string> = \{([\s\S]*?)\};/);
  assert(mapMatch, 'could not locate STYLE_BADGE_LABEL in RevealScreen.tsx');
  const body = mapMatch![1];
  for (const key of ALL_STYLE_KEYS) {
    assert(new RegExp(`\\b${key}:`).test(body), `STYLE_BADGE_LABEL is missing an entry for "${key}"`);
  }
  // Exactly 8 keys -- no extra/stray entries, no missing ones.
  const keyMatches = [...body.matchAll(/^\s*([a-z_]+):/gm)];
  assert(keyMatches.length === 8, `expected exactly 8 STYLE_BADGE_LABEL entries, found ${keyMatches.length}`);
});

// -- 10. null/unknown style falls back safely --------------------------------
Deno.test('the style badge falls back to "REAL CHARACTER" when style is null/unset', async () => {
  const source = await readRevealScreenSource();
  assert(
    source.includes("winnerCharacterization?.style ? STYLE_BADGE_LABEL[winnerCharacterization.style] : 'REAL CHARACTER'"),
    'expected the badge label to fall back to REAL CHARACTER for a null/unset style',
  );
});

// -- 11. placeholder trait chips are removed ---------------------------------
Deno.test('the old placeholder trait-chip row (winner.drawing.traits) is removed from the Reveal render', async () => {
  const source = await readRevealScreenSource();
  assertFalse(source.includes('winner.drawing.traits'), 'a trait-chip render still reads winner.drawing.traits');
  assertFalse(
    source.includes('{winner.drawing.traits.map'),
    'the placeholder trait-chip mapping block was not removed',
  );
});

Deno.test('the old fixed "REAL CHARACTER" badge literal (unconditional) is gone -- it is now conditional on style', async () => {
  const source = await readRevealScreenSource();
  // The literal must still exist (as the null-style fallback, checked
  // above), but never as a bare unconditional `<Pill label="REAL CHARACTER"`
  // the way it was before this task.
  assertFalse(source.includes('<Pill label="REAL CHARACTER" tone="green" />'));
});
