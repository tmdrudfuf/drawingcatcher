// Offline unit tests for Characterization V2/V2.1's prompt composition and
// style selection. Pure functions only, no network, no database.
//
// Run with: npx deno test supabase/functions/characterize-drawing/prompt.test.ts
import { assert, assertEquals, assertFalse, assertNotEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  buildCharacterizationPrompt,
  CURRENT_PROMPT_VERSION,
  isCharacterizationStyle,
  selectStyle,
  STYLE_KEYS,
  type CharacterizationStyle,
} from './prompt.ts';

// -- 1. all 8 styles still work ----------------------------------------------
Deno.test('STYLE_KEYS has exactly the 8 approved styles, no more, no fewer', () => {
  assertEquals(STYLE_KEYS.length, 8);
  assertEquals(
    [...STYLE_KEYS].sort(),
    ['anime', 'chibi', 'crayon', 'cute', 'epic', 'funny', 'pixel_art', 'realistic'].sort(),
  );
});

Deno.test('every style key produces a prompt containing its own STYLE header', () => {
  const expectedHeader: Record<CharacterizationStyle, string> = {
    cute: 'STYLE: CUTE',
    funny: 'STYLE: FUNNY',
    epic: 'STYLE: EPIC',
    chibi: 'STYLE: CHIBI',
    realistic: 'STYLE: REALISTIC',
    anime: 'STYLE: ANIME',
    pixel_art: 'STYLE: PIXEL ART',
    crayon: 'STYLE: CRAYON',
  };
  for (const style of STYLE_KEYS) {
    const prompt = buildCharacterizationPrompt('Superhero Cat', style);
    assert(prompt.includes(expectedHeader[style]), `missing header for ${style}`);
  }
});

Deno.test('every style produces a distinct prompt for the same round prompt', () => {
  const prompts = STYLE_KEYS.map((style) => buildCharacterizationPrompt('Superhero Cat', style));
  assertEquals(new Set(prompts).size, STYLE_KEYS.length);
});

// -- 2. identity lock exists in every assembled prompt -----------------------
Deno.test('every assembled prompt (all 8 styles) contains the identity-lock header and full "Do NOT" list', () => {
  const requiredLines = [
    "PRESERVE THE DRAWING'S IDENTITY ABOVE EVERYTHING ELSE.",
    'correct anatomy toward a normal animal, person, or object',
    'beautify away important irregularities',
    'symmetrize an asymmetric drawing',
    'replace the character with a generic example of its semantic category',
    'remove a strange feature because it looks accidental',
  ];
  for (const style of STYLE_KEYS) {
    const prompt = buildCharacterizationPrompt('Superhero Cat', style);
    for (const line of requiredLines) {
      assert(prompt.includes(line), `style ${style} is missing identity-lock line: "${line}"`);
    }
  }
});

// -- 3. round concept section exists in every assembled prompt --------------
Deno.test('every assembled prompt (all 8 styles) contains a ROUND CONCEPT section', () => {
  for (const style of STYLE_KEYS) {
    const prompt = buildCharacterizationPrompt('Superhero Cat', style);
    assert(prompt.includes('ROUND CONCEPT'), `style ${style} is missing the ROUND CONCEPT section`);
  }
});

// -- 4. the actual round prompt is included ----------------------------------
Deno.test('the literal round prompt text appears in the assembled prompt', () => {
  const prompt = buildCharacterizationPrompt('Superhero Cat', 'epic');
  assert(prompt.includes('Superhero Cat'));
  assert(prompt.includes('Round concept: "Superhero Cat"'));
});

Deno.test('round prompt text is truncated to 200 chars, same as V1/V2', () => {
  const long = 'x'.repeat(500);
  const prompt = buildCharacterizationPrompt(long, 'cute');
  assertFalse(prompt.includes('x'.repeat(201)));
  assert(prompt.includes('x'.repeat(200)));
});

// -- 5. concept additions are explicitly allowed -----------------------------
Deno.test('ROUND CONCEPT explicitly allows clothing/accessories/props/environment/effects additions', () => {
  const prompt = buildCharacterizationPrompt('Superhero Cat', 'cute');
  for (const allowed of ['costume or clothing', 'accessory', 'props the concept implies', 'environment or background', 'effects']) {
    assert(prompt.includes(allowed), `expected ROUND CONCEPT to explicitly allow: "${allowed}"`);
  }
  // The user-specified rule sentence, present near-verbatim.
  assert(prompt.includes('You MAY add clothing, accessories, props, environmental'));
});

// -- 6. anatomy/identity redesign remains forbidden --------------------------
Deno.test('anatomy/identity redesign remains explicitly forbidden alongside the new additions permission', () => {
  const prompt = buildCharacterizationPrompt('Superhero Cat', 'cute');
  assert(prompt.includes("Do not invent or correct the character's anatomy or defining physical\ntraits."));
  assert(prompt.includes('add, remove, or change limbs or any physical anatomy that is not\n  already in the sketch'));
  assert(prompt.includes('never redesign, correct, or replace its underlying anatomy, proportions,'));
});

// -- 7. identity wins if concept conflicts with the sketch -------------------
Deno.test('ROUND CONCEPT states identity wins on any conflict with the sketch', () => {
  const prompt = buildCharacterizationPrompt('Superhero Cat', 'realistic');
  assert(prompt.includes('If the concept and the original sketch ever conflict, identity wins'));
});

// -- 8. style is rendering/presentation, not redesign ------------------------
Deno.test('style is framed as rendering/presentation language, never character redesign, for every style', () => {
  // Global framing sentence, present regardless of style.
  const globalFraming = 'it is a rendering\nchoice -- never permission to redesign what is being rendered';
  for (const style of STYLE_KEYS) {
    assert(buildCharacterizationPrompt('Superhero Cat', style).includes(globalFraming));
  }
  // Plus each style's own rendering-not-redesign framing.
  const perStyleFraming: Record<CharacterizationStyle, string> = {
    cute: '"Cute" describes the finish, not the anatomy.',
    funny: 'Every funny element in the\nresult must trace back to something already drawn.',
    epic: 'EPIC changes the PRESENTATION only, never the anatomy.',
    chibi: "The original\ndrawing's proportions remain the authority",
    realistic: 'this is REALISTIC rendering of THIS creature',
    anime: 'Anime is a rendering language here, not a redesign license.',
    pixel_art: 'immediately recognizable, not smoothed away by the grid.',
    crayon: 'do not clean up\nits linework or proportions',
  };
  for (const style of STYLE_KEYS) {
    assert(
      buildCharacterizationPrompt('Superhero Cat', style).includes(perStyleFraming[style]),
      `style ${style} is missing its rendering-not-redesign framing`,
    );
  }
  // ROUND CONCEPT's own STYLE-vs-CONCEPT distinction.
  assert(
    buildCharacterizationPrompt('Superhero Cat', 'crayon').includes(
      'STYLE (below) controls the rendering language',
    ),
  );
});

// -- 9. prompt version is 3 --------------------------------------------------
Deno.test('CURRENT_PROMPT_VERSION is 3 (V2.1 bumped it from 2)', () => {
  assertEquals(CURRENT_PROMPT_VERSION, 3);
});

// -- 10. deterministic style selection is unchanged --------------------------
Deno.test('selectStyle is deterministic: same id always returns the same style', () => {
  const id = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
  const first = selectStyle(id);
  for (let i = 0; i < 20; i += 1) {
    assertEquals(selectStyle(id), first);
  }
});

Deno.test('same submission id always selects the same style across many distinct sample ids', () => {
  const sampleIds = [
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    '9f7443d7-898f-48cf-8837-99014e218081',
    '23268a04-740c-4d30-9212-0888be6e87a0',
    'de0b717d-9d5e-4395-a7e0-11582210b47e',
  ];
  for (const id of sampleIds) {
    const selected = selectStyle(id);
    assertEquals(selectStyle(id), selected);
    assertEquals(selectStyle(id), selected);
  }
});

Deno.test('selectStyle spreads a large sample of ids across all 8 buckets, roughly evenly', () => {
  const counts = new Map<CharacterizationStyle, number>(STYLE_KEYS.map((k) => [k, 0]));
  const sampleSize = 4000;
  for (let i = 0; i < sampleSize; i += 1) {
    const fakeId = `${i}-${i * 2654435761}-${(i ** 3) % 999999937}`;
    const style = selectStyle(fakeId);
    counts.set(style, (counts.get(style) ?? 0) + 1);
  }
  const expected = sampleSize / STYLE_KEYS.length;
  for (const [style, count] of counts) {
    assert(
      count > expected * 0.6 && count < expected * 1.4,
      `style ${style} got ${count} of ${sampleSize} samples, expected around ${expected}`,
    );
  }
});

Deno.test('style selection does not depend on the round prompt text (id-driven, not prompt-driven)', () => {
  const a = buildCharacterizationPrompt('a cat', 'crayon');
  const b = buildCharacterizationPrompt('a completely different dog prompt', 'crayon');
  assert(a.includes('STYLE: CRAYON') && b.includes('STYLE: CRAYON'));
  assertNotEquals(a, b); // differ only in the embedded round concept text
});

// -- 11. no Math.random -------------------------------------------------------
// Checked against selectStyle()'s own implementation specifically, not the
// whole file: prompt.ts's doc comment on selectStyle legitimately contains
// the literal text "Math.random()" while EXPLAINING that it isn't used
// ("No Math.random(), no client input...") -- a whole-file substring check
// would (and initially did, while drafting this test) false-fail on that
// comment. Scoping to the function body itself checks the real guarantee.
Deno.test("selectStyle()'s implementation never calls Math.random or any other nondeterministic RNG", async () => {
  const source = await Deno.readTextFile(new URL('./prompt.ts', import.meta.url));
  const fnMatch = source.match(/export function selectStyle\([\s\S]*?\n\}/);
  assert(fnMatch, 'could not locate selectStyle() in prompt.ts');
  const body = fnMatch![0];
  for (const forbidden of ['Math.random(', 'crypto.getRandomValues(', 'crypto.randomUUID(']) {
    assertFalse(body.includes(forbidden), `selectStyle() must not use ${forbidden}`);
  }
});

// -- 12. no client-provided style path ---------------------------------------
Deno.test('index.ts never reads a client-supplied style field from the request body', async () => {
  const source = await Deno.readTextFile(new URL('./index.ts', import.meta.url));
  assertFalse(source.includes('body.style'), 'index.ts must never read a style field off the request body');
  assertFalse(source.includes('Math.random'), 'index.ts must never use Math.random for style selection');
  // RequestBody's declared fields are exactly the 4 identifiers/prompt --
  // no style field exists to read in the first place.
  const requestBodyMatch = source.match(/interface RequestBody \{([\s\S]*?)\}/);
  assert(requestBodyMatch, 'could not locate RequestBody interface in index.ts');
  assertFalse(requestBodyMatch![1].includes('style'));
});

Deno.test('isCharacterizationStyle rejects unknown/malformed values (defense if a client ever sent one)', () => {
  for (const bad of ['CUTE', 'Cute', 'cute ', ' cute', 'pixel-art', 'unknown', '', null, undefined, 42, {}, []]) {
    assertFalse(isCharacterizationStyle(bad), `expected "${String(bad)}" to be rejected`);
  }
  for (const good of STYLE_KEYS) {
    assert(isCharacterizationStyle(good), `expected "${good}" to be accepted`);
  }
});

// -- 13. old completed rows remain reusable ----------------------------------
Deno.test('index.ts source: the "already completed" fast path returns before any style/version logic, gated only on characterized_path', async () => {
  const source = await Deno.readTextFile(new URL('./index.ts', import.meta.url));
  // The fast-path branch and its early return.
  const fastPathMatch = source.match(
    /if \(submission\.characterized_path\) \{[\s\S]*?return jsonResponse\(\{[\s\S]*?\}\);\s*\n\s*\}/,
  );
  assert(fastPathMatch, 'could not locate the "already completed" fast-path branch in index.ts');
  const fastPathBody = fastPathMatch![0];
  // It must report the persisted style as-is (including null) ...
  assert(fastPathBody.includes('submission.characterization_style ?? null'));
  // ... and it must not call selectStyle() or attemptClaim() -- i.e. a
  // pre-V2 NULL-style row is returned immediately, never regenerated.
  assertFalse(fastPathBody.includes('selectStyle('));
  assertFalse(fastPathBody.includes('attemptClaim('));
});

// -- composition order (still holds in V2.1's 5-part composition) ----------
Deno.test('prompt sections appear in order: identity lock, round concept, style block, output rules, closing reminder', () => {
  const prompt = buildCharacterizationPrompt('Superhero Cat', 'epic');
  const identityIndex = prompt.indexOf("PRESERVE THE DRAWING'S IDENTITY ABOVE EVERYTHING ELSE.");
  const conceptIndex = prompt.indexOf('ROUND CONCEPT');
  const styleIndex = prompt.indexOf('STYLE: EPIC');
  const outputRulesIndex = prompt.indexOf('OUTPUT REQUIREMENTS:');
  const closingIndex = prompt.lastIndexOf('Preserve first. Stylize second.');
  assert(
    identityIndex >= 0 && conceptIndex >= 0 && styleIndex >= 0 && outputRulesIndex >= 0 && closingIndex >= 0,
  );
  assert(identityIndex < conceptIndex, 'identity lock must come before the round concept');
  assert(conceptIndex < styleIndex, 'round concept must come before the style block');
  assert(styleIndex < outputRulesIndex, 'style block must come before output rules');
  assert(outputRulesIndex < closingIndex, 'closing reminder must be last');
});

Deno.test('every assembled prompt contains the shared output/presentation rules', () => {
  for (const style of STYLE_KEYS) {
    const prompt = buildCharacterizationPrompt('Superhero Cat', style);
    assert(prompt.includes('No before/after comparison'));
    assert(prompt.includes('Do not crop the character'));
    assert(prompt.includes('Preserve first. Stylize second.'));
  }
});
