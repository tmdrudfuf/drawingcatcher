// Characterization V2.3 (Milestone 4I, "Sketch-First Transformation"):
// compositional Gemini prompt.
//
// GLOBAL_IDENTITY_LOCK + COMPOSITION_LOCK + CONTENT_LOCK + ROUND_CONCEPT +
// BACKGROUND_BUDGET + CINEMATIC_RESTRICTION + SHADOW_RULE + STYLE_AUTHORITY
// + STYLE_BLOCKS[style] + RESTRAINED_POLISH + CLOSING_REMINDER, composed by
// buildCharacterizationPrompt(). This is the only place any of these
// layers live -- iterate on wording here, never inline in index.ts.
//
// Core product principle, unchanged since V1, sharpened again in V2.3:
// preserve first, composition second, stylize third, invent almost
// nothing. V2.2 closed the "invented semantic object" loophole (extra
// props/characters/background story), but real-device testing exposed a
// second loophole: the model could still turn a simple, sparsely-composed
// sketch into a new cinematic ILLUSTRATION purely through composition,
// lighting, atmosphere, and shadow changes -- e.g. a simple strange cow
// sketch rendered as an EPIC cave scene with a spotlight, haze, and a
// giant narrative wall shadow, with barely any new "objects" added at
// all. V2.3 closes this: it adds an explicit COMPOSITION lock (position,
// size, orientation, framing, negative space) as its own priority between
// identity and content, and adds three new cross-cutting restrictions --
// a background addition budget of zero, a cinematic-effect restriction,
// and a shadow rule -- so atmosphere/lighting/shadow can no longer smuggle
// in a new scene the way free-form "semantic objects" used to.
//
// EXPLICIT PRIORITY ORDER (V2.3), each yielding only to the ones above it:
//   1. ORIGINAL DRAWING IDENTITY -- anatomy, proportions, silhouette.
//   2. ORIGINAL COMPOSITION -- position, size, orientation, framing,
//      spatial relationships, negative/empty space. New in V2.3.
//   3. ORIGINAL DRAWING CONTENT -- objects/props the player actually drew.
//   4. MINIMUM REQUIRED ROUND-CONCEPT ELEMENT -- add only if the drawing
//      does not already communicate the prompt, and only the single
//      smallest necessary cue.
//   5. STYLE / RENDERING LANGUAGE -- a material/rendering choice only;
//      redefined in V2.3 to explicitly exclude composition/content.
//   6. RESTRAINED VISUAL POLISH -- lighting/texture/shadow/color only,
//      now explicitly bounded by the background/cinematic/shadow rules
//      below so it can no longer compose a new scene under the guise of
//      "just lighting."
// Higher priorities always override lower priorities. The AI's role is
// primarily to RENDER THE DRAWING, not to create a scene inspired by it.

export const STYLE_KEYS = [
  'cute',
  'funny',
  'epic',
  'chibi',
  'realistic',
  'anime',
  'pixel_art',
  'crayon',
] as const;

export type CharacterizationStyle = (typeof STYLE_KEYS)[number];

export function isCharacterizationStyle(value: unknown): value is CharacterizationStyle {
  return typeof value === 'string' && (STYLE_KEYS as readonly string[]).includes(value);
}

/**
 * Deterministic, server-only style selection. A pure function of the
 * immutable round_submissions.id (unique per (round_id, player_id), set
 * once by gen_random_uuid() at submission time, never changes) — so this
 * needs no new coordination primitive: every concurrent caller for the
 * same row computes the identical value before racing on index.ts's
 * attemptClaim(), and a retried/reloaded request for the same submission
 * gets the same style forever. No Math.random(), no client input anywhere
 * in this chain — index.ts's RequestBody has no style field, so there is
 * no channel for a client to influence this. Unchanged since V2 (V2.1,
 * V2.2, and V2.3 change only prompt wording, never this algorithm).
 *
 * djb2 string hash — not cryptographic, doesn't need to be; just
 * deterministic and close enough to uniform over high-entropy UUIDs for
 * "approximately even distribution across 8 buckets".
 */
export function selectStyle(submissionId: string): CharacterizationStyle {
  let hash = 5381;
  for (let i = 0; i < submissionId.length; i += 1) {
    hash = ((hash << 5) + hash + submissionId.charCodeAt(i)) >>> 0;
  }
  return STYLE_KEYS[hash % STYLE_KEYS.length];
}

// Bump whenever GLOBAL_IDENTITY_LOCK, COMPOSITION_LOCK, CONTENT_LOCK,
// ROUND_CONCEPT, the background/cinematic/shadow rules, STYLE_AUTHORITY,
// any STYLE_BLOCKS entry, RESTRAINED_POLISH, or CLOSING_REMINDER changes
// wording -- this lets an already-generated row
// (characterization_prompt_version) be distinguished from what current
// code would produce, without reinterpreting or regenerating old rows.
// V2.3 ("Sketch-First Transformation") bumps this 4 -> 5. Existing rows
// with characterized_path already set are never touched by this bump
// (see index.ts's claim query, gated on `characterized_path is null`) --
// they keep reusing their original V2.2 (or earlier) result under
// existing reuse semantics; only newly-generated rows use V2.3.
export const CURRENT_PROMPT_VERSION = 5;

function buildPriorityPreamble(): string {
  return `PRESERVE FIRST. COMPOSITION SECOND. STYLIZE THIRD. INVENT ALMOST NOTHING.

The AI's role here is primarily to RENDER THE DRAWING -- not to create a
scene inspired by the drawing.

PRIORITY ORDER (read this before anything else)

The instructions below are organized into six numbered priorities.
Higher-numbered sections never override lower-numbered ones -- a HIGHER
priority (lower number) always wins over a LOWER priority (higher number)
if they ever seem to conflict:
  1. ORIGINAL DRAWING IDENTITY (highest)
  2. ORIGINAL COMPOSITION
  3. ORIGINAL DRAWING CONTENT
  4. MINIMUM REQUIRED ROUND-CONCEPT ELEMENT
  5. STYLE / RENDERING LANGUAGE
  6. RESTRAINED VISUAL POLISH (lowest)

If the round concept, the selected style, or any visual polish would
ever require changing what a higher priority protects, do not change it --
express the concept or style entirely through what is allowed at that
priority's own level instead.`;
}

function buildIdentityLock(): string {
  return `PRIORITY 1 -- ORIGINAL DRAWING IDENTITY

PRESERVE THE DRAWING'S IDENTITY ABOVE EVERYTHING ELSE.

The submitted sketch is the AUTHORITATIVE character design, not a rough
draft to be improved. Whatever style is applied below, it is a rendering
choice -- never permission to redesign what is being rendered. Whatever
the round concept below calls for, it is something added around this
character -- never permission to redesign the character itself.

Drawing mistakes are character traits, not errors to correct. The
unusual proportions, awkward anatomy, asymmetry, crooked shapes, strange
facial placement, tiny or oversized body parts, unexpected limb count,
and funny mistakes are intentional character traits, not errors. Treat
poor drawing skill as a design signal, not noise to clean up.

Preserve, exactly as drawn, whenever present:
- overall silhouette
- body proportions and head-to-body ratio
- unusual body length or width
- eye count, relative eye size, and eye placement
- facial layout, nose/mouth characteristics
- ear shape and placement
- limb count and approximate limb placement
- unusually short or long limbs
- tail shape, length, and direction
- asymmetry and strange geometry
- unusual lines, features, or recognizable drawing mistakes
- any other distinctive visual quirk unique to this drawing

Do NOT, under any style or round concept:
- correct anatomy toward a normal animal, person, or object
- beautify away important irregularities
- symmetrize an asymmetric drawing
- replace the character with a generic example of its semantic category
  (if this looks like a "cat," it is THIS drawn cat's design, not a
  reference for what a nice cat should look like)
- add, remove, or change limbs or any physical anatomy that is not
  already in the sketch
- remove a strange feature because it looks accidental
- change proportions merely because the selected style's typical
  treatment, or the round concept's typical presentation, usually uses
  different proportions`;
}

/**
 * V2.3, new layer: closes the "cinematic recomposition" loophole real
 * device testing exposed. V2.2 protected anatomy (Priority 1) and drawn
 * objects (content, now Priority 3), but nothing protected HOW those
 * things were arranged on the page -- Gemini was free to recenter,
 * reframe, rotate, or otherwise recompose the sketch into a more
 * "professional" layout, which is exactly what made results feel like a
 * new illustration rather than a rendering of the same drawing.
 */
function buildCompositionLock(): string {
  return `PRIORITY 2 -- ORIGINAL COMPOSITION

Preserve, as closely as possible, exactly how the sketch is composed on
the page:
- subject position
- subject size
- subject orientation
- facing direction
- relative placement of body parts
- relative placement of multiple drawn forms
- spacing between drawn elements
- framing
- negative/empty space
- overall visual balance created by the sketch

Do NOT:
- recenter the character just because it looks more professional
- rotate or flip the subject
- change the camera angle
- zoom dramatically in or out
- rearrange drawn elements
- separate connected strange forms
- combine forms that were separate
- create a new cinematic composition

If the player's sketch is awkwardly composed, preserve that
awkwardness. The awkward composition is part of the drawing's identity,
not a flaw to correct.`;
}

/**
 * V2.2's content lock, unchanged in spirit, renumbered to Priority 3 in
 * V2.3's six-priority hierarchy.
 */
function buildContentLock(): string {
  return `PRIORITY 3 -- ORIGINAL DRAWING CONTENT

Preserve the objects and props the player actually drew, not just the
character's anatomy. If the sketch already contains something that
functions as an object the round concept needs (a bike, a pizza, a
sword -- however roughly drawn), that drawn object IS the object. Keep
it, exactly as drawn, however badly drawn it is.

Do NOT:
- replace an existing drawn object with a more polished or different
  object merely because it seems to fit the round concept better
- invent extra characters -- this is a single-character portrait of
  exactly the one character in the sketch
- invent background story elements, implied events, or narrative detail
  that is not visible in the sketch itself
- discard a drawn element because it looks unclear -- render it
  faithfully rather than guessing at, or replacing, what it might mean`;
}

/**
 * V2.2's decision procedure and budget, unchanged, renumbered to Priority
 * 4. V2.3 adds one new worked example (cow/balloon) reinforcing that an
 * imperfect drawn attempt at the required object must be preserved
 * rather than replaced with a cleaner one -- the same principle Priority
 * 3 states for content in general, restated here because it is
 * specifically relevant to round-concept additions.
 */
function buildRoundConcept(safePrompt: string): string {
  return `PRIORITY 4 -- MINIMUM REQUIRED ROUND-CONCEPT ELEMENT

Round concept: "${safePrompt}"

If the original drawing already communicates the round prompt, add
nothing. Add only what is necessary to make the round situation
readable -- do not decorate the scene with invented content.

DEFAULT SEMANTIC ADDITION BUDGET: 0.
MAXIMUM NORMAL SEMANTIC ADDITION BUDGET: 1.

Decide additions with this exact procedure, in order:

A. Does the drawing already communicate the round concept -- even
   crudely, even badly drawn? If yes: add zero semantic elements. Do
   not decorate, embellish, or "help" an already-readable drawing.

B. Only if the answer to A is no: is there exactly one missing object
   or visual cue that is necessary (not merely nice-to-have) for the
   round concept to be understandable? If yes: add that one smallest
   possible cue or object, and nothing else. If the honest answer is
   still no, or you are unsure, add nothing.

If the player attempted to draw the required object -- even
imperfectly, even ambiguously -- preserve that attempt instead of
replacing it with a cleaner or more legible version.

Worked examples of this exact rule (illustrative, not necessarily the
current round):
- "A bear caught stealing pizza": if the drawing already contains
  something recognizable as pizza, add nothing. If it contains the bear
  but no readable pizza, one simple pizza or pizza slice is acceptable --
  never a restaurant, a chef, a police officer, a cash register, tables,
  signs, customers, extra food, or any narrative background beyond that
  single object.
- "A dinosaur riding a tiny bike": if the player drew something that
  functions as the bike, preserve it exactly, however badly drawn -- do
  not replace it. If there is genuinely no bike, one simple tiny bike may
  be added. Nothing else is required.
- "A robot running out of battery": do not automatically add a charging
  station, cables, a laboratory, warning signs, engineers, or a
  futuristic room. Prefer a minimal visual cue only if necessary, such as
  a simple low-battery indicator -- nothing more.
- "A cow holding a giant balloon": if an awkward circular shape in the
  sketch could plausibly be the balloon, preserve it exactly -- do NOT
  generate a cleaner, rounder, more obviously-balloon-shaped balloon.
  Only add a balloon if there genuinely is no corresponding drawn form.

Empty space is preferable to invented content. When genuinely uncertain
whether an addition is necessary, do not add it.

If the round concept and the original sketch ever conflict, identity,
composition, and content win (Priorities 1-3): keep the sketch's exact
silhouette, proportions, features, composition, and drawn objects, and
express the concept only through the single minimal addition this
procedure allows -- never by changing what the character, its
composition, or its drawn objects already are.

STYLE (below) controls the rendering language -- how everything is
drawn. This priority controls only whether, and what, minimal content
may be added -- never a license to redesign the character (Priority 1),
its composition (Priority 2), or replace what was already drawn
(Priority 3).`;
}

/**
 * V2.3, new cross-cutting rule: this is the specific fix for the observed
 * failure (a bare cow sketch becoming a detailed EPIC cave scene). A
 * background is not a "semantic object" in the Priority 4 sense, so
 * nothing in V2.2 actually stopped Gemini from inventing one -- this rule
 * closes that gap independently of the addition budget.
 */
function buildBackgroundBudget(): string {
  return `BACKGROUND ADDITION BUDGET: 0

If the original drawing has no meaningful background, do NOT invent a
location. Do not create a cave, a room, a street, a forest, a castle, a
laboratory, a restaurant, a stage, a landscape, a building, or any other
narrative scenery.

Use only:
- plain background
- paper-like background
- simple flat color
- extremely subtle gradient
- a minimal neutral ground plane, only if absolutely needed for
  readability

Empty space is good. Empty space should remain empty.

If the player actually drew background elements, preserve and stylize
those elements instead of replacing them.`;
}

/**
 * V2.3, new cross-cutting rule: V2.2 treated lighting/texture/shadow as
 * non-semantic "polish" with no restriction on degree -- that was the
 * exact loophole that produced a dramatic spotlight, atmospheric haze,
 * and a giant narrative wall shadow around a simple cow sketch. This rule
 * bounds effects explicitly, independent of the background rule above.
 */
function buildCinematicRestriction(): string {
  return `CINEMATIC EFFECT RESTRICTION

Lighting, shadows, atmosphere, particles, fog, dust, glow, and effects
must remain SUBORDINATE to the original sketch -- they may never turn
this into a new illustration.

Do NOT add, unless an equivalent element clearly exists in the original
drawing:
- dramatic spotlight compositions
- volumetric light beams
- heavy fog
- cinematic smoke
- decorative particles
- explosions
- giant environmental shadows
- narrative silhouettes
- dramatic weather
- complex reflections

Simple rendering light and restrained contact shadows are allowed only
to make the transformed drawing visually readable -- nothing more.`;
}

function buildShadowRule(): string {
  return `SHADOW RULE

A shadow must:
- correspond directly to an existing drawn subject
- remain visually subordinate to that subject
- use a natural scale
- not introduce a new pose, creature, joke, or story
- not become a dominant composition element

A giant wall shadow or stylized narrative silhouette is forbidden unless
the player actually drew it.`;
}

/**
 * V2.3: makes STYLE's authority explicit and narrower than V2.1/V2.2
 * implied. Previously each style block argued its own "rendering not
 * redesign" case individually; this shared header states the boundary
 * once, in the same MAY/MAY NOT format the rest of V2.3 uses, so every
 * style inherits the same explicit ceiling before its own specifics.
 */
function buildStyleAuthorityHeader(): string {
  return `PRIORITY 5 -- STYLE / RENDERING LANGUAGE

Style is a material and rendering language, not a content or
composition decision.

STYLE MAY CHANGE:
- rendering medium
- line treatment
- texture
- restrained color treatment
- restrained material appearance
- restrained lighting quality

STYLE MAY NOT CHANGE:
- composition
- anatomy
- number of characters
- props
- environment
- narrative
- pose
- camera angle
- silhouette
- spatial relationships

The style below describes HOW the same drawing looks. It does not
decide WHAT the image contains.`;
}

const STYLE_BLOCKS: Record<CharacterizationStyle, string> = {
  cute: `STYLE: CUTE (rendering language only, never composition or content)

Render this exact character as a polished, adorable version of itself:
soft rounded dimensional shading, charming expressive eyes where the
sketch's eye placement allows it, pleasant materials, warm appealing
lighting, mascot-quality presentation.

Do not turn the sketch into a conventional polished mascot. A long
strange body stays long and strange. Tiny legs stay tiny. Asymmetry
stays asymmetric. "Cute" describes the finish, not the anatomy, the
composition, or the content.`,

  funny: `STYLE: FUNNY (rendering language only, never composition or content)

Celebrate the funniest visual characteristics already present in this
sketch: playful expression, comedic presentation, whimsical dimensional
rendering. You may slightly emphasize an oddity that is already there
(a lopsided eye, a crooked tooth, a stray limb).

Do not invent additional jokes. The player's weird drawing is the joke.
Every funny element in the result must trace back to something already
drawn.`,

  epic: `STYLE: EPIC (rendering language only, never composition or content)

Epic means a stronger RENDERING treatment of the exact same sketch, not
a new scene.

Allowed: somewhat stronger contrast, richer texture, restrained dramatic
color and lighting.

Forbidden, regardless of how well the round concept seems to justify
them: caves, castles, armies, weapons, armor, explosions, giant
shadows, volumetric spotlight scenes, or any other cinematic
environment construction. An EPIC result must still preserve the
original blank or minimal composition if that is what the sketch had --
EPIC is not permission to compose a scene the sketch does not contain.`,

  chibi: `STYLE: CHIBI (rendering language only, never composition or content)

Do not create chibi proportions. Render the EXISTING proportions using
chibi-like visual language: soft forms, charming expression, playful
polished rendering. The original drawing's proportions remain the
authority -- if the sketch already has a huge head and tiny body, lean
into that; if it has a long thin body, CHIBI must not force it short.`,

  realistic: `STYLE: REALISTIC (rendering language only, never composition or content)

Make the impossible original anatomy look physically rendered: realistic
materials (fur, skin, surface as appropriate), physically believable
lighting, photographic dimensionality. Do not make the anatomy realistic
or correct -- if the sketch shows an impossibly long cat with tiny legs,
the result is a photoreal impossibly long cat with tiny legs. The
strangeness is the point, rendered as if it were real, not corrected
because reality "doesn't work that way."`,

  anime: `STYLE: ANIME (rendering language only, never composition or content)

Translate this exact character into an anime-inspired visual treatment:
clean expressive linework, stylized lighting and color, animation-style
presentation.

Do not redesign the subject as a conventional anime character. Preserve
the exact strange structure -- the character's actual proportions,
silhouette, and features are unchanged; only the rendering technique is
anime.`,

  pixel_art: `STYLE: PIXEL ART (rendering language only, never composition or content)

Translate the same composition and forms into pixel-art rendering:
intentional pixel-art style, readable silhouette, controlled palette
appropriate to the drawing. Render at a size and clarity large enough to
remain a single clear, detailed character image (not a tiny
low-resolution sprite) -- the pixel art LOOK is stylistic, not a literal
small-canvas constraint. Do not add game-world elements (coins,
platforms, UI, health bars) that were not already part of the drawing.`,

  crayon: `STYLE: CRAYON (rendering language only, never composition or content)

Translate the same composition and forms into crayon rendering: visible
crayon texture, handmade marks, playful imperfect coloring, paper-like
visual feeling. Celebrate the handmade nature of the original drawing --
do not clean up its linework, proportions, or composition in the process
of adding crayon texture.`,
};

/**
 * V2.2's "optional visual polish" renamed and tightened for V2.3:
 * explicitly the lowest of six priorities now (was the lowest of five),
 * and explicitly bounded by the background/cinematic/shadow rules above
 * rather than being an unrestricted catch-all for "just lighting."
 */
function buildRestrainedPolish(): string {
  return `PRIORITY 6 -- RESTRAINED VISUAL POLISH (lowest priority)

Simple lighting, texture, line rendering, and the color treatment
required by the selected style are allowed and are NOT counted as
semantic additions against Priority 4's budget -- but they remain
governed by the BACKGROUND ADDITION BUDGET, CINEMATIC EFFECT
RESTRICTION, and SHADOW RULE above.

Polish must stop immediately if it would change identity, composition,
content, empty space, or narrative meaning. A less polished result that
preserves the player's drawing is BETTER than a beautiful result that
invents a scene.

OUTPUT REQUIREMENTS:
- One single character, one single image. No before/after comparison,
  no multi-panel grid, no side-by-side variations.
- Do not add unrelated objects or a second character.
- Do not crop the character -- keep the full subject visible in frame.
- Keep the background simple and uncluttered enough that the character
  reads as the clear subject at a glance (see BACKGROUND ADDITION
  BUDGET above).
- No added text, captions, watermarks, borders, or UI chrome baked into
  the image.`;
}

const CLOSING_REMINDER = `Render the player's drawing. Do not reinterpret it.

The output should look like the exact same strange sketch gaining
material, color, and life. Preserve the original composition and empty
space. Do not turn the drawing into a cinematic scene.

If choosing between a beautiful new idea and faithful preservation,
always choose faithful preservation. The player's weirdness is the
final design.`;

/**
 * Composes the full Gemini prompt in priority order: a preamble stating
 * the six-part hierarchy explicitly, then identity lock, composition
 * lock, content lock, round concept, the background/cinematic/shadow
 * restrictions, the style authority header and selected style block, the
 * restrained-polish/output rules, then a closing reminder (recency-
 * weighted reinforcement of the single most important instruction).
 * `style` must be one of STYLE_KEYS; callers select it server-side only
 * (see index.ts's selectStyle()) -- there is no parameter here for a
 * client-supplied style, by construction.
 */
export function buildCharacterizationPrompt(roundPrompt: string, style: CharacterizationStyle): string {
  const safePrompt = roundPrompt.trim().slice(0, 200);
  return [
    buildPriorityPreamble(),
    buildIdentityLock(),
    buildCompositionLock(),
    buildContentLock(),
    buildRoundConcept(safePrompt),
    buildBackgroundBudget(),
    buildCinematicRestriction(),
    buildShadowRule(),
    buildStyleAuthorityHeader(),
    STYLE_BLOCKS[style],
    buildRestrainedPolish(),
    CLOSING_REMINDER,
  ].join('\n\n');
}
