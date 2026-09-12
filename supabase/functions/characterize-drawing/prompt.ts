// Centralized Gemini characterization prompt (Milestone 4A). This is the only
// place the transformation instructions live — iterate on this string during
// the probe, not inline in index.ts.
//
// Core product principle: preserve first, stylize second. The unusual
// proportions and funny mistakes in the player's sketch ARE the character —
// Gemini must not "fix" them.
export function buildCharacterizationPrompt(roundPrompt: string): string {
  const safePrompt = roundPrompt.trim().slice(0, 200);

  return `Transform this exact hand-drawn sketch into a polished playful character.

PRESERVE THE DRAWING'S IDENTITY ABOVE EVERYTHING ELSE.

The unusual proportions, awkward anatomy, asymmetry, crooked shapes,
strange facial placement, tiny or oversized body parts, and funny mistakes
are intentional character traits.

Do NOT correct, normalize, beautify, redesign, or replace the anatomy.

The transformed character must immediately look like this exact drawing
came to life.

Preserve:
- overall silhouette
- body proportions
- head-to-body ratio
- limb count and limb length
- tail shape and direction
- facial feature placement
- distinctive asymmetry
- unusual shapes
- funny imperfections

Use the game prompt only to understand what the player intended to draw.

Round prompt:
"${safePrompt}"

You may add:
- dimensional volume
- simple texture
- material
- lighting
- depth
- subtle character detail

Do not add unrelated objects.
Do not crop the character.
Keep the full transformed subject visible.
Use a simple clean background.

Style:
playful stylized animated character,
friendly but funny,
recognizably based on the exact sketch.

Preserve first. Stylize second.`;
}
