# Stage 1 — Frozen Prompts

Companion to `STAGE1_RUNBOOK.md`. Aligned with `SKETCH_VIDEO_PROBE.md` §2, §11, §12.

**Freeze these before the first generation. Do not edit mid-run.** If a prompt
changes, the run before the change and the run after are not comparable — start a
new dated prompt version and note it.

Principle these prompts encode:

> **AI may transform the drawing, but it must preserve the drawing's identity.**
> 3D / realistic / stylized / cinematic output is wanted, *not* penalised. What
> must survive is the character's defining identity, weird anatomy, personality,
> and the player's interpretation.

---

## 1. Baseline Transformation Prompt — used for all 18 primary runs

Fill the three bracketed slots per sketch (values in §3). Everything else is
verbatim.

```
Transform this rough sketch into a more complete animated/cinematic character
while preserving the character's defining identity. Preserve distinctive anatomy,
proportions, silhouette, colors, unusual features, and personality. Do not
normalize unusual features or replace the character with a conventional version
of the semantic object. Add only the detail and environment necessary to bring
the character to life.

[MOTION]

[PROMPT_CONTEXT]
```

- `[MOTION]` is required.
- `[PROMPT_CONTEXT]` is optional — include it only for sketches that have a scene
  (S03, S04, S06). Omit the line entirely for S01, S02, S05.
- Do **not** add per-model phrasing, negative blocks, or "keep every line"
  language to the baseline. That is the Strong Identity Prompt (§2), which is not
  part of the primary 18.
- If the model exposes an image-conditioning / fidelity / "stay close to input"
  control, set it to the value that keeps the output closest to the drawn
  character and record that value in `stage1-results.csv` notes. That is a
  measured capability, not prompt engineering.

---

## 2. Strong Identity Prompt

### DO NOT USE FOR THE PRIMARY 18 RUNS.

Use **only** as a targeted follow-up when a baseline result fails because the AI
normalized, redesigned, or replaced the character (hard failure
`IDENTITY_NORMALIZATION`, `GENERIC_REPLACEMENT`, `ANATOMY_CORRECTION`,
`PERSONALITY_LOSS`, `DEFINING_FEATURE_LOSS`, or `SEMANTIC_OVERRIDE`). Append the
result as a new row with `prompt_type = STRONG_IDENTITY`; it does **not** replace
the baseline row.

```
Transform this rough sketch into a more complete animated/cinematic character
while preserving the character's defining identity. Preserve distinctive anatomy,
proportions, silhouette, colors, unusual features, and personality. Add only the
detail and environment necessary to bring the character to life.

You MUST preserve, exactly as drawn:
- the number of limbs / eyes / other body parts
- the abnormal proportions and head-to-body ratio
- asymmetric or lopsided features
- the defining colors
- the overall silhouette
- the strange facial structure and expression
- any unusual accessories
- the player's unconventional interpretation of the prompt

You MUST NOT:
- correct or "fix" any anatomy, symmetry, or proportion
- replace the character with a conventional / realistic version of the animal or object
- give it a generic redesign or make it cuter or prettier
- normalize the personality — if the drawing is awkward, creepy, or goofy, keep it

You MAY (these are wanted, not restricted):
- render it in 3D
- add realistic or stylized texture and materials
- add cinematic lighting and depth
- enrich the environment around the character

[MOTION]

[PROMPT_CONTEXT]
```

---

## 3. Per-sketch slot values

| Sketch | `[MOTION]` | `[PROMPT_CONTEXT]` |
| --- | --- | --- |
| **S01** Simple character | Character looks around and makes a small body movement. Minimal camera movement. | *(omit)* |
| **S02** Weird character | Character takes two awkward steps and reacts to the camera. Its defining abnormal anatomy must remain unchanged throughout. Minimal camera movement. | *(omit)* |
| **S03** Object interaction | Character takes one slow bite of the pizza. Minimal camera movement. | Scene: the character with its pizza, on a plain plate / table. |
| **S04** Full prompt scene | Character floats slightly in space and takes one bite while the background moves subtly. Minimal camera movement. | Scene: space — stars and dark sky behind the character. Add the environment without replacing the character. |
| **S05** Child-like drawing | Character waves, or takes one simple step. Minimal camera movement. | *(omit)* |
| **S06** Unexpected interpretation | Animate the player's unusual interpretation as they drew it. Do not normalize it into the obvious version of the prompt. Keep motion small. | Scene: the player's own unconventional scene (e.g. the pizza is the moon and the cat drifts toward it). Follow the drawing, not the literal words. |

Keep motion small and simple. This is an identity-transformation test, not an
action sequence.

---

## 4. Semantic Override isolation test (S04 and S06 only)

Run only if the primary 18 show signs that the text prompt is overriding the
drawing (a `SEMANTIC_OVERRIDE` / `GENERIC_REPLACEMENT` pattern on S04/S06).
Append rows; do not replace baselines.

- **Test A — image + full prompt context:** the Baseline Prompt exactly as in §1,
  including the full `[PROMPT_CONTEXT]` line. `prompt_type = SEMOVR_A`.
- **Test B — image + minimal semantic restatement:** drop the scene description
  to the bare minimum and lead with identity + motion. `prompt_type = SEMOVR_B`.

```
Animate the character in this sketch exactly as it is drawn. Keep its identity,
its unusual features, its colors, and its personality. [MOTION] Keep any
environment minimal and secondary to the character.
```

If B preserves identity and A does not, the prompt text itself is causing the
replacement — record that finding; it shapes how the real product must feed the
prompt to the model.
