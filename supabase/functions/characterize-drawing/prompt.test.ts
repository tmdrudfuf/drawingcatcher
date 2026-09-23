// Offline unit tests for Characterization V2/V2.1/V2.2/V2.3's prompt
// composition and style selection. Pure functions only, no network, no
// database, no Gemini calls.
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

// -- 2. identity lock (Priority 1) exists in every assembled prompt ---------
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

Deno.test('mistakes are explicitly framed as character traits, not errors', () => {
  for (const style of STYLE_KEYS) {
    const prompt = buildCharacterizationPrompt('Superhero Cat', style);
    assert(
      prompt.includes('Drawing mistakes are character traits, not errors to correct.'),
      `style ${style} is missing the "mistakes are character traits" line`,
    );
  }
});

// -- 3. composition lock (Priority 2, new in V2.3) ---------------------------
Deno.test('every assembled prompt contains the Priority 2 composition lock', () => {
  for (const style of STYLE_KEYS) {
    const prompt = buildCharacterizationPrompt('Superhero Cat', style);
    assert(prompt.includes('PRIORITY 2 -- ORIGINAL COMPOSITION'), `style ${style} missing composition lock header`);
  }
});

Deno.test('composition lock preserves position, size, orientation, relative placement, and negative/empty space', () => {
  const prompt = buildCharacterizationPrompt('Superhero Cat', 'epic');
  for (const preserved of [
    'subject position',
    'subject size',
    'subject orientation',
    'facing direction',
    'relative placement of body parts',
    'relative placement of multiple drawn forms',
    'spacing between drawn elements',
    'framing',
    'negative/empty space',
    'overall visual balance created by the sketch',
  ]) {
    assert(prompt.includes(preserved), `composition lock missing preserved item: "${preserved}"`);
  }
});

Deno.test('composition lock explicitly forbids recentering, rotation, camera-angle changes, and recomposition', () => {
  const prompt = buildCharacterizationPrompt('Superhero Cat', 'epic');
  for (const forbidden of [
    'recenter the character just because it looks more professional',
    'rotate or flip the subject',
    'change the camera angle',
    'zoom dramatically in or out',
    'rearrange drawn elements',
    'separate connected strange forms',
    'combine forms that were separate',
    'create a new cinematic composition',
  ]) {
    assert(prompt.includes(forbidden), `composition lock missing forbidden item: "${forbidden}"`);
  }
  assert(prompt.includes('If the player\'s sketch is awkwardly composed, preserve that'));
});

// -- 4. content lock (Priority 3) --------------------------------------------
Deno.test('every assembled prompt contains the Priority 3 content-lock section protecting drawn objects', () => {
  for (const style of STYLE_KEYS) {
    const prompt = buildCharacterizationPrompt('Superhero Cat', style);
    assert(prompt.includes('PRIORITY 3 -- ORIGINAL DRAWING CONTENT'), `style ${style} missing content lock header`);
    assert(prompt.includes('Preserve the objects and props the player actually drew'));
    assert(prompt.includes('invent extra characters'));
    assert(prompt.includes('invent background story elements'));
  }
});

// -- 5. round concept (Priority 4) exists in every assembled prompt ---------
Deno.test('every assembled prompt (all 8 styles) contains the MINIMUM REQUIRED ROUND-CONCEPT ELEMENT section', () => {
  for (const style of STYLE_KEYS) {
    const prompt = buildCharacterizationPrompt('Superhero Cat', style);
    assert(prompt.includes('PRIORITY 4 -- MINIMUM REQUIRED ROUND-CONCEPT ELEMENT'), `style ${style} is missing the round-concept section`);
  }
});

Deno.test('the literal round prompt text appears in the assembled prompt', () => {
  const prompt = buildCharacterizationPrompt('Superhero Cat', 'epic');
  assert(prompt.includes('Superhero Cat'));
  assert(prompt.includes('Round concept: "Superhero Cat"'));
});

Deno.test('round prompt text is truncated to 200 chars, same as V1/V2/V2.1/V2.2', () => {
  const long = 'x'.repeat(500);
  const prompt = buildCharacterizationPrompt(long, 'cute');
  assertFalse(prompt.includes('x'.repeat(201)));
  assert(prompt.includes('x'.repeat(200)));
});

// -- 6. strict addition rule (kept from V2.2) --------------------------------
Deno.test('the round-concept decision procedure explicitly requires adding nothing when the drawing already communicates the prompt', () => {
  const prompt = buildCharacterizationPrompt('Superhero Cat', 'cute');
  assert(prompt.includes('If the original drawing already communicates the round prompt, add\nnothing.'));
  assert(prompt.includes('Does the drawing already communicate the round concept'));
  assert(prompt.includes('If yes: add zero semantic elements.'));
  assert(prompt.includes('Empty space is preferable to invented content.'));
});

Deno.test('the semantic addition budget is explicit: default 0, maximum 1', () => {
  const prompt = buildCharacterizationPrompt('Superhero Cat', 'cute');
  assert(prompt.includes('DEFAULT SEMANTIC ADDITION BUDGET: 0.'));
  assert(prompt.includes('MAXIMUM NORMAL SEMANTIC ADDITION BUDGET: 1.'));
});

Deno.test('an attempted-but-imperfect drawn object must be preserved instead of replaced', () => {
  const prompt = buildCharacterizationPrompt('A cow holding a giant balloon', 'cute');
  assert(
    prompt.includes(
      'If the player attempted to draw the required object -- even\nimperfectly, even ambiguously -- preserve that attempt instead of\nreplacing it with a cleaner or more legible version.',
    ),
  );
});

// -- 7. anatomy/identity/composition redesign remains forbidden -------------
Deno.test('anatomy and composition redesign remain explicitly forbidden alongside the addition procedure', () => {
  const prompt = buildCharacterizationPrompt('Superhero Cat', 'cute');
  assert(prompt.includes('add, remove, or change limbs or any physical anatomy that is not\n  already in the sketch'));
  assert(
    prompt.includes(
      "never a license to redesign the character (Priority 1),\nits composition (Priority 2), or replace what was already drawn\n(Priority 3)",
    ),
  );
});

// -- 8. priority order is explicit, six levels, higher wins on conflict -----
Deno.test('the prompt states an explicit six-level priority order, with higher priorities always overriding lower ones', () => {
  const prompt = buildCharacterizationPrompt('Superhero Cat', 'realistic');
  assert(prompt.includes('PRIORITY ORDER (read this before anything else)'));
  assert(prompt.includes('1. ORIGINAL DRAWING IDENTITY (highest)'));
  assert(prompt.includes('2. ORIGINAL COMPOSITION'));
  assert(prompt.includes('3. ORIGINAL DRAWING CONTENT'));
  assert(prompt.includes('4. MINIMUM REQUIRED ROUND-CONCEPT ELEMENT'));
  assert(prompt.includes('5. STYLE / RENDERING LANGUAGE'));
  assert(prompt.includes('6. RESTRAINED VISUAL POLISH (lowest)'));
  assert(prompt.includes('a HIGHER\npriority (lower number) always wins over a LOWER priority'));
  assert(prompt.includes('If the round concept and the original sketch ever conflict, identity,\ncomposition, and content win'));
});

Deno.test('the core mantra states preserve/composition/stylize/invent-almost-nothing, and frames the AI as rendering, not creating', () => {
  const prompt = buildCharacterizationPrompt('Superhero Cat', 'realistic');
  assert(prompt.includes('PRESERVE FIRST. COMPOSITION SECOND. STYLIZE THIRD. INVENT ALMOST NOTHING.'));
  assert(prompt.includes('primarily to RENDER THE DRAWING -- not to create a\nscene inspired by the drawing.'));
});

// -- 9. background addition budget = 0 (new in V2.3) -------------------------
Deno.test('background addition budget is explicitly zero, forbidding invented locations', () => {
  for (const style of STYLE_KEYS) {
    const prompt = buildCharacterizationPrompt('A cow standing still', style);
    assert(prompt.includes('BACKGROUND ADDITION BUDGET: 0'), `style ${style} missing background budget header`);
    for (const forbiddenLocation of ['cave', 'room', 'street', 'forest', 'castle', 'laboratory', 'restaurant', 'stage', 'landscape', 'building']) {
      assert(prompt.includes(forbiddenLocation), `style ${style} background rule missing "${forbiddenLocation}"`);
    }
    assert(prompt.includes('Empty space is good. Empty space should remain empty.'));
  }
});

// -- 10. cinematic effect restriction (new in V2.3) --------------------------
Deno.test('cinematic effects are restricted: no spotlight/fog/smoke/explosions/giant shadows/dramatic weather unless already drawn', () => {
  for (const style of STYLE_KEYS) {
    const prompt = buildCharacterizationPrompt('A cow standing still', style);
    assert(prompt.includes('CINEMATIC EFFECT RESTRICTION'), `style ${style} missing cinematic restriction header`);
    for (const forbidden of [
      'dramatic spotlight compositions',
      'volumetric light beams',
      'heavy fog',
      'cinematic smoke',
      'decorative particles',
      'explosions',
      'giant environmental shadows',
      'narrative silhouettes',
      'dramatic weather',
      'complex reflections',
    ]) {
      assert(prompt.includes(forbidden), `style ${style} cinematic restriction missing "${forbidden}"`);
    }
  }
});

// -- 11. shadow rule (new in V2.3) -------------------------------------------
Deno.test('giant wall shadows and stylized narrative silhouettes are explicitly forbidden unless the player drew them', () => {
  for (const style of STYLE_KEYS) {
    const prompt = buildCharacterizationPrompt('A cow standing still', style);
    assert(prompt.includes('SHADOW RULE'), `style ${style} missing shadow rule header`);
    assert(prompt.includes('correspond directly to an existing drawn subject'));
    assert(prompt.includes('not become a dominant composition element'));
    assert(
      prompt.includes('A giant wall shadow or stylized narrative silhouette is forbidden unless\nthe player actually drew it.'),
    );
  }
});

// -- 12. style is rendering/presentation, cannot change composition/content -
Deno.test('style authority header states style cannot change composition, anatomy, props, environment, narrative, pose, camera angle, silhouette, or spatial relationships', () => {
  for (const style of STYLE_KEYS) {
    const prompt = buildCharacterizationPrompt('Superhero Cat', style);
    assert(prompt.includes('PRIORITY 5 -- STYLE / RENDERING LANGUAGE'));
    assert(prompt.includes('STYLE MAY CHANGE:'));
    assert(prompt.includes('STYLE MAY NOT CHANGE:'));
    for (const forbidden of [
      'composition',
      'anatomy',
      'number of characters',
      'props',
      'environment',
      'narrative',
      'pose',
      'camera angle',
      'silhouette',
      'spatial relationships',
    ]) {
      assert(prompt.includes(`- ${forbidden}`), `style ${style} authority header missing "${forbidden}" in the MAY NOT CHANGE list`);
    }
    assert(prompt.includes('It does not\ndecide WHAT the image contains.'));
  }
});

Deno.test('every style block frames itself as rendering language only, never composition or content, for every style', () => {
  for (const style of STYLE_KEYS) {
    const prompt = buildCharacterizationPrompt('Superhero Cat', style);
    assert(
      prompt.includes('(rendering language only, never composition or content)'),
      `style ${style} missing its own "rendering language only" framing`,
    );
  }
  // Plus each style's own rendering-not-redesign framing.
  const perStyleFraming: Record<CharacterizationStyle, string> = {
    cute: '"Cute" describes the finish, not the anatomy, the\ncomposition, or the content.',
    funny: 'Every funny element in the result must trace back to something already\ndrawn.',
    epic: 'Epic means a stronger RENDERING treatment of the exact same sketch, not\na new scene.',
    chibi: "drawing's proportions remain the\nauthority",
    realistic: 'Do not make the anatomy realistic\nor correct',
    anime: 'Do not redesign the subject as a conventional anime character. Preserve\nthe exact strange structure',
    pixel_art: 'Render at a size and clarity large enough to\nremain a single clear, detailed character image',
    crayon: 'do not clean up its linework, proportions, or composition in the process\nof adding crayon texture.',
  };
  for (const style of STYLE_KEYS) {
    assert(
      buildCharacterizationPrompt('Superhero Cat', style).includes(perStyleFraming[style]),
      `style ${style} is missing its rendering-not-redesign framing`,
    );
  }
});

// -- 13. EPIC-specific regression protection (cow/cave/spotlight failure) --
Deno.test('EPIC explicitly forbids automatically adding caves/castles/armies/weapons/armor/explosions/giant shadows/volumetric spotlight scenes', () => {
  const prompt = buildCharacterizationPrompt('A cow standing still', 'epic');
  for (const forbidden of [
    'caves',
    'castles',
    'armies',
    'weapons',
    'armor',
    'explosions',
    'giant\nshadows',
    'volumetric spotlight scenes',
    'cinematic\nenvironment construction',
  ]) {
    assert(prompt.includes(forbidden), `EPIC missing forbidden item: "${forbidden}"`);
  }
  assert(
    prompt.includes(
      'An EPIC result must still preserve the\noriginal blank or minimal composition if that is what the sketch had',
    ),
  );
});

Deno.test('REGRESSION: a simple cow sketch + EPIC receives instructions that specifically forbid the observed cave/spotlight/giant-shadow failure', () => {
  const prompt = buildCharacterizationPrompt('A cow standing still', 'epic');
  // The exact three failure modes observed in real-device testing.
  assert(prompt.includes('caves'), 'must forbid cave invention');
  assert(prompt.includes('giant\nshadows') || prompt.includes('giant environmental shadows') || prompt.includes('giant wall shadow'), 'must forbid a giant wall/environmental shadow');
  assert(prompt.includes('dramatic spotlight compositions') || prompt.includes('volumetric spotlight scenes'), 'must forbid a dramatic spotlight scene');
  // And the general cross-cutting rules must also be present regardless of
  // style, reinforcing the restriction from multiple independent angles.
  assert(prompt.includes('BACKGROUND ADDITION BUDGET: 0'));
  assert(prompt.includes('CINEMATIC EFFECT RESTRICTION'));
  assert(prompt.includes('SHADOW RULE'));
  assert(prompt.includes('A giant wall shadow or stylized narrative silhouette is forbidden unless\nthe player actually drew it.'));
});

// -- 14. restrained visual polish is explicitly the lowest priority ---------
Deno.test('visual polish is explicitly framed as the lowest priority and must yield to identity/composition/content/empty space', () => {
  for (const style of STYLE_KEYS) {
    const prompt = buildCharacterizationPrompt('Superhero Cat', style);
    assert(prompt.includes('PRIORITY 6 -- RESTRAINED VISUAL POLISH (lowest priority)'), `style ${style} missing polish priority header`);
    assert(
      prompt.includes(
        'Polish must stop immediately if it would change identity, composition,\ncontent, empty space, or narrative meaning.',
      ),
    );
  }
});

Deno.test('faithful preservation is explicitly preferred over a more beautiful invented result', () => {
  const prompt = buildCharacterizationPrompt('Superhero Cat', 'epic');
  assert(
    prompt.includes(
      'A less polished result that\npreserves the player\'s drawing is BETTER than a beautiful result that\ninvents a scene.',
    ),
  );
  assert(
    prompt.includes(
      'If choosing between a beautiful new idea and faithful preservation,\nalways choose faithful preservation.',
    ),
  );
});

// -- 15. prompt version is 5 (V2.3 bumped it from 4) -------------------------
Deno.test('CURRENT_PROMPT_VERSION is 5 (V2.3 "Sketch-First Transformation" bumped it from 4)', () => {
  assertEquals(CURRENT_PROMPT_VERSION, 5);
});

// -- 16. deterministic style selection is unchanged --------------------------
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

// -- 17. no Math.random -------------------------------------------------------
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

// -- 18. no client-provided style path ---------------------------------------
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

// -- 19. old completed rows remain reusable (claim/reuse logic untouched) ---
Deno.test('index.ts source: the "already completed" fast path returns before any style/version logic, gated only on characterized_path', async () => {
  const source = await Deno.readTextFile(new URL('./index.ts', import.meta.url));
  const fastPathMatch = source.match(
    /if \(submission\.characterized_path\) \{[\s\S]*?return jsonResponse\(\{[\s\S]*?\}\);\s*\n\s*\}/,
  );
  assert(fastPathMatch, 'could not locate the "already completed" fast-path branch in index.ts');
  const fastPathBody = fastPathMatch![0];
  assert(fastPathBody.includes('submission.characterization_style ?? null'));
  assertFalse(fastPathBody.includes('selectStyle('));
  assertFalse(fastPathBody.includes('attemptClaim('));
});

Deno.test('index.ts still writes CURRENT_PROMPT_VERSION only on the new-generation claim path, not the reuse path', async () => {
  const source = await Deno.readTextFile(new URL('./index.ts', import.meta.url));
  assert(
    source.includes('characterization_prompt_version: CURRENT_PROMPT_VERSION'),
    'the claim write must still stamp the current version onto newly-claimed rows',
  );
  assert(
    source.includes(".is('characterized_path', null)"),
    'the claim must remain gated on characterized_path being null -- an already-characterized row is never reclaimed at a new version',
  );
});

// -- composition order (V2.3's 12-part composition) -------------------------
Deno.test('prompt sections appear in order: preamble, identity, composition, content, round concept, background, cinematic, shadow, style authority, style block, polish, closing', () => {
  const prompt = buildCharacterizationPrompt('Superhero Cat', 'epic');
  const indices = {
    preamble: prompt.indexOf('PRESERVE FIRST. COMPOSITION SECOND.'),
    identity: prompt.indexOf("PRESERVE THE DRAWING'S IDENTITY ABOVE EVERYTHING ELSE."),
    composition: prompt.indexOf('PRIORITY 2 -- ORIGINAL COMPOSITION'),
    content: prompt.indexOf('PRIORITY 3 -- ORIGINAL DRAWING CONTENT'),
    concept: prompt.indexOf('PRIORITY 4 -- MINIMUM REQUIRED ROUND-CONCEPT ELEMENT'),
    background: prompt.indexOf('BACKGROUND ADDITION BUDGET: 0'),
    cinematic: prompt.indexOf('CINEMATIC EFFECT RESTRICTION'),
    shadow: prompt.indexOf('SHADOW RULE'),
    styleAuthority: prompt.indexOf('PRIORITY 5 -- STYLE / RENDERING LANGUAGE'),
    styleBlock: prompt.indexOf('STYLE: EPIC'),
    polish: prompt.indexOf('PRIORITY 6 -- RESTRAINED VISUAL POLISH'),
    closing: prompt.lastIndexOf("Render the player's drawing."),
  };
  for (const [name, index] of Object.entries(indices)) {
    assert(index >= 0, `could not locate ${name}`);
  }
  const order: (keyof typeof indices)[] = [
    'preamble', 'identity', 'composition', 'content', 'concept',
    'background', 'cinematic', 'shadow', 'styleAuthority', 'styleBlock', 'polish', 'closing',
  ];
  for (let i = 0; i < order.length - 1; i += 1) {
    assert(indices[order[i]] < indices[order[i + 1]], `${order[i]} must come before ${order[i + 1]}`);
  }
});

Deno.test('every assembled prompt contains the shared output/presentation rules', () => {
  for (const style of STYLE_KEYS) {
    const prompt = buildCharacterizationPrompt('Superhero Cat', style);
    assert(prompt.includes('No before/after comparison'));
    assert(prompt.includes('Do not crop the character'));
    assert(prompt.includes("Render the player's drawing. Do not reinterpret it."));
  }
});

Deno.test('the closing reminder explicitly forbids turning the drawing into a cinematic scene and preserves composition/empty space', () => {
  const prompt = buildCharacterizationPrompt('Superhero Cat', 'anime');
  assert(prompt.includes('Preserve the original composition and empty\nspace. Do not turn the drawing into a cinematic scene.'));
  assert(prompt.includes("The player's weirdness is the\nfinal design."));
});

// -- representative round prompts (construction only, no Gemini calls) ------
Deno.test('representative round prompts (giraffe, cow, dinosaur/bike, robot/battery) all produce well-formed, budget- and composition-constrained prompts', () => {
  const representativePrompts = [
    'A giraffe dancing badly',
    'A cow taking a bath',
    'A dinosaur riding a tiny bike',
    'A robot running out of battery',
  ];
  for (const roundPrompt of representativePrompts) {
    for (const style of STYLE_KEYS) {
      const prompt = buildCharacterizationPrompt(roundPrompt, style);
      assert(prompt.includes(`Round concept: "${roundPrompt}"`), `missing literal round prompt for "${roundPrompt}" (${style})`);
      assert(prompt.includes('DEFAULT SEMANTIC ADDITION BUDGET: 0.'));
      assert(prompt.includes('MAXIMUM NORMAL SEMANTIC ADDITION BUDGET: 1.'));
      assert(prompt.includes('BACKGROUND ADDITION BUDGET: 0'));
      assert(prompt.includes('PRIORITY 2 -- ORIGINAL COMPOSITION'));
      assert(prompt.includes('CINEMATIC EFFECT RESTRICTION'));
      assert(prompt.includes('SHADOW RULE'));
    }
  }
});

Deno.test('the bear/pizza, dinosaur/bike, robot/battery, and cow/balloon worked examples are present verbatim as illustrative guidance', () => {
  // These are static illustrative examples baked into the instruction
  // template itself (see buildRoundConcept) -- present regardless of what
  // the actual current round prompt is.
  const prompt = buildCharacterizationPrompt("A dragon whose fire won't work", 'realistic');
  assert(prompt.includes('"A bear caught stealing pizza"'));
  assert(prompt.includes('never a restaurant, a chef, a police officer, a cash register'));
  assert(prompt.includes('"A dinosaur riding a tiny bike"'));
  assert(prompt.includes('one simple tiny bike may\n  be added'));
  assert(prompt.includes('"A robot running out of battery"'));
  assert(prompt.includes('a simple low-battery indicator'));
  assert(prompt.includes('"A cow holding a giant balloon"'));
  assert(prompt.includes('do NOT\n  generate a cleaner, rounder, more obviously-balloon-shaped balloon'));
});
