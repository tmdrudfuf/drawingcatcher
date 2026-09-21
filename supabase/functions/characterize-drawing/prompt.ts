// Characterization V2.1 (Milestone 4F/4F.1): compositional Gemini prompt.
//
// GLOBAL_IDENTITY_LOCK + ROUND_CONCEPT + STYLE_BLOCKS[style] +
// COMMON_OUTPUT_RULES + CLOSING_REMINDER, composed by
// buildCharacterizationPrompt(). This is the only place any of these five
// layers live -- iterate on wording here, never inline in index.ts.
//
// Core product principle, unchanged since V1: preserve first, stylize
// second. The unusual proportions and funny mistakes in the player's
// sketch ARE the character -- Gemini must not "fix" them, regardless of
// style or round concept. Style is a rendering choice, never a redesign
// license; the round concept is a visual theme to communicate through
// ADDITIONS (costume, props, environment, effects), never a redesign
// license either.
//
// IDENTITY -> CONCEPT -> STYLE -> OUTPUT, in that priority order:
//   1. Preserve the original drawing's character identity.
//   2. Strongly express the ROUND CONCEPT (the round prompt as a visual
//      theme, not just context) through what is added around/onto the
//      character.
//   3. Apply the deterministic STYLE as the rendering language.
// If concept and identity ever conflict, identity wins -- see
// buildRoundConcept() below.

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
 * no channel for a client to influence this. Unchanged since V2 (V2.1
 * changes only prompt wording, never this algorithm).
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

// Bump whenever GLOBAL_IDENTITY_LOCK, ROUND_CONCEPT, any STYLE_BLOCKS
// entry, COMMON_OUTPUT_RULES, or CLOSING_REMINDER changes wording -- this
// lets an already-generated row (characterization_prompt_version) be
// distinguished from what current code would produce, without
// reinterpreting or regenerating old rows. V2.1 bumps this 2 -> 3.
export const CURRENT_PROMPT_VERSION = 3;

function buildIdentityLock(): string {
  return `PRESERVE THE DRAWING'S IDENTITY ABOVE EVERYTHING ELSE.

The submitted sketch is the AUTHORITATIVE character design, not a rough
draft to be improved. Whatever style is applied below, it is a rendering
choice -- never permission to redesign what is being rendered. Whatever
the round concept below calls for, it is something added around this
character -- never permission to redesign the character itself.

The unusual proportions, awkward anatomy, asymmetry, crooked shapes,
strange facial placement, tiny or oversized body parts, unexpected limb
count, and funny mistakes are intentional character traits, not errors.
Treat poor drawing skill as a design signal, not noise to clean up.

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
  different proportions

Clothing, accessories, props, environment, lighting, and effects may be
added ONLY as described under ROUND CONCEPT below, and only ever
decorate this character -- they must never alter its silhouette,
proportions, or any trait listed above.`;
}

/**
 * V2.1: the round prompt is now a real visual direction, not merely
 * context to read past. This section is deliberately its own layer,
 * separate from GLOBAL_IDENTITY_LOCK, so the two responsibilities stay
 * clean: identity says what must never change; this says what may be
 * added, and states plainly that identity wins on any conflict.
 */
function buildRoundConcept(safePrompt: string): string {
  return `ROUND CONCEPT

The round concept is the VISUAL THEME this image must communicate -- not
just background context to read past.

Round concept: "${safePrompt}"

Make the final image immediately recognizable as this concept whenever
possible, while the character underneath remains exactly the one in the
sketch, unchanged.

You MAY add whatever is necessary to communicate the concept:
- costume or clothing appropriate to the concept
- a cape, emblem, badge, or other identifying accessory
- props the concept implies
- an appropriate environment or background
- lighting, atmosphere, or dramatic effects that support the concept
- a pose or presentation that reads as the concept

Do not invent or correct the character's anatomy or defining physical
traits. You MAY add clothing, accessories, props, environmental
elements, lighting, and effects when they are clearly motivated by the
round prompt and help communicate the concept.

These additions decorate and support the existing character. They must
never redesign, correct, or replace its underlying anatomy, proportions,
silhouette, or any trait GLOBAL IDENTITY LOCK protects above.

If the concept and the original sketch ever conflict, identity wins:
keep the sketch's exact silhouette, proportions, and features, and
express the concept only through what is added around and onto that
unchanged character -- never by changing what the character IS.

STYLE (below) controls the rendering language -- how everything is
drawn. ROUND CONCEPT controls what visual theme is being communicated --
what is drawn. They are independent: this same concept could be
rendered in any style, and this same style could express any concept.`;
}

const STYLE_BLOCKS: Record<CharacterizationStyle, string> = {
  cute: `STYLE: CUTE

Render this exact character as a polished, adorable version of itself:
soft rounded dimensional shading, charming expressive eyes where the
sketch's eye placement allows it, pleasant materials, warm appealing
lighting, mascot-quality presentation.

A long strange body stays long and strange. Tiny legs stay tiny.
Asymmetry stays asymmetric. "Cute" describes the finish, not the anatomy.`,

  funny: `STYLE: FUNNY

Celebrate the funniest visual characteristics already present in this
sketch: playful expression, comedic presentation, whimsical dimensional
rendering. You may slightly emphasize an oddity that is already there
(a lopsided eye, a crooked tooth, a stray limb).

Do not invent a new joke or a new design. Every funny element in the
result must trace back to something already drawn.`,

  epic: `STYLE: EPIC

Present this exact character as dramatically heroic and cinematic:
dramatic lighting, energetic atmosphere, heroic framing, powerful
environmental effects, high-impact composition.

EPIC changes the PRESENTATION only, never the anatomy. A badly drawn
tiny-legged creature becomes an EPIC badly drawn tiny-legged creature --
not a correctly proportioned fantasy animal. Keep the character as the
single clear subject; environmental effects must not obscure or replace
its actual silhouette.`,

  chibi: `STYLE: CHIBI

Give this exact character an adorable, compact treatment: soft forms,
charming expression, playful polished rendering.

Do NOT apply generic chibi proportions (oversized head, shortened limbs)
if doing so would override what the sketch actually drew. The original
drawing's proportions remain the authority -- if the sketch already has a
huge head and tiny body, lean into that; if it has a long thin body,
CHIBI must not force it short.`,

  realistic: `STYLE: REALISTIC

Imagine that the exact creature in this sketch physically exists.
Render it with realistic materials (fur, skin, surface as appropriate),
physically believable lighting, environmental depth, photographic
dimensionality.

CRITICAL: this is REALISTIC rendering of THIS creature, not a realistic
rendering of the normal animal/object it superficially resembles. If the
sketch shows an impossibly long cat with tiny legs, the result is a
photoreal impossibly long cat with tiny legs -- the strangeness is the
point, rendered as if it were real, not corrected because reality
"doesn't work that way."`,

  anime: `STYLE: ANIME

Translate this exact character into an anime-inspired visual treatment:
clean expressive linework, stylized lighting and color, animation-style
presentation.

Anime is a rendering language here, not a redesign license. The
character's actual proportions, silhouette, and features are unchanged --
only the rendering technique is anime.`,

  pixel_art: `STYLE: PIXEL ART

Translate this exact character into a charming, game-character pixel-art
treatment: intentional pixel-art rendering style, readable silhouette,
controlled palette appropriate to the drawing.

Render at a size and clarity large enough to remain a single clear,
detailed character image (not a tiny low-resolution sprite) -- the pixel
art LOOK is stylistic, not a literal small-canvas constraint. The
distinctive silhouette and proportions from the sketch must stay
immediately recognizable, not smoothed away by the grid.`,

  crayon: `STYLE: CRAYON

Translate this exact character into a handmade crayon / children's-book
treatment: visible crayon texture, handmade marks, playful imperfect
coloring, paper-like visual feeling.

Celebrate the handmade nature of the original drawing -- do not clean up
its linework or proportions in the process of adding crayon texture. The
imperfections are the point of both the original sketch and this style.`,
};

const COMMON_OUTPUT_RULES = `OUTPUT REQUIREMENTS:
- One single character, one single image. No before/after comparison,
  no multi-panel grid, no side-by-side variations.
- Do not add unrelated objects or a second character.
- Do not crop the character -- keep the full subject visible in frame.
- Keep the background simple and uncluttered enough that the character
  reads as the clear subject at a glance, even when the round concept
  calls for an environment or effects.
- No added text, captions, watermarks, borders, or UI chrome baked into
  the image.`;

const CLOSING_REMINDER = 'Preserve first. Stylize second.';

/**
 * Composes the full Gemini prompt in priority order: identity lock, then
 * the round concept, then the selected style block, then the shared
 * output/presentation rules, then a closing reminder (recency-weighted
 * reinforcement of the single most important instruction). `style` must
 * be one of STYLE_KEYS; callers select it server-side only (see
 * index.ts's selectStyle()) -- there is no parameter here for a
 * client-supplied style, by construction.
 */
export function buildCharacterizationPrompt(roundPrompt: string, style: CharacterizationStyle): string {
  const safePrompt = roundPrompt.trim().slice(0, 200);
  return [
    buildIdentityLock(),
    buildRoundConcept(safePrompt),
    STYLE_BLOCKS[style],
    COMMON_OUTPUT_RULES,
    CLOSING_REMINDER,
  ].join('\n\n');
}
