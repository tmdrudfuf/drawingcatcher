# Sketch → Character Transformation Probe

> Companion to `PRODUCT_BRIEF.md` and `PRODUCT_ASSESSMENT.md`.
> Phase: Product Definition / Validation. **Zero-code, manual model evaluation.**
> No application code, no framework, no provider integration, no Spec.

This probe exists to answer **one** question:

> **Is Sketch → Character Transformation strong and reliable enough to justify
> building the rest of AI Sketch Game around it?**

It does **not** exist to answer "which model makes the prettiest video."

> **Terminology note.** This document uses **Character Identity Preservation**
> (also *Sketch Identity Preservation*). It deliberately does **not** use
> "Sketch Preservation," which wrongly implied the original pixels or line work
> must survive untouched. The visual representation may evolve; the character
> identity must survive. The informal player reaction *"that's my drawing"* is
> still fine to quote; the formal evaluation metric is **"That's My Character."**

---

## 1. Core Hypothesis

Product hypothesis (not tested here):

> Seeing your own rough sketch transformed into an animated character, with its
> identity and weirdness intact, creates enough delight that players immediately
> want to draw again.

**Technical precondition tested by this probe:**

> Current image-to-video / image-to-character models can transform amateur
> sketches into richer animated characters **without erasing the identity of the
> drawing** — the strange proportions, wrong anatomy, odd colors, and comedic
> concept that make it unmistakably that player's creation.

If the precondition fails, the emotional test in §17 is not worth running yet.

### Explicitly out of scope for this phase

Multiplayer, scoring, AI Judge, app UX, onboarding, authentication, backend,
monetization, cost modelling, prompt curation. Ignore all of it until a model
passes.

---

## 2. New Core Principle

Replaces the earlier, stricter assumption ("AI should animate the drawing, not
redesign it").

> **AI may transform the drawing, but it must preserve the drawing's identity.**

Clarifications:

| Aspect | Requirement |
| --- | --- |
| Exact line work | **Optional.** Line art may become 3D, painted, rendered, stylized. |
| Exact rendering style | **Optional.** Cinematic / realistic / animated styling is allowed. |
| Exact composition | **Useful, not absolute.** Major layout should carry over; the scene may be enriched. |
| Identity-defining features | **Mandatory.** The small set of features that make it *this* character. |
| Unusual anatomy | **Mandatory to keep recognizable** (limb count, proportions, asymmetry). |
| Weirdness / humor | **Mandatory to survive** the transformation. |

A polished transformation is acceptable. A generic replacement is not.

> Good: a crude weird cat becomes a detailed cinematic creature that still
> *obviously* has the big ears, long nose, uneven eyes, and awkward body.
> Bad: the same sketch becomes a normal, attractive, four-legged realistic cat —
> even though it looks better.

---

## 3. Character Identity Preservation

### Character Identity Features

The candidate features that can carry a drawing's identity:

- silhouette
- head / body ratio
- limb count
- limb length
- eye size and placement
- ear shape and size
- nose / snout shape
- tail shape
- color
- facial expression
- unusual anatomy
- accessories
- distinctive mistakes (accidental and deliberate)
- comedic abnormalities
- the overall personality implied by the sketch

### The rule

The AI does **not** need to preserve every feature equally. Each sketch has a
**small number of features (typically 2–5)** that make it unmistakably that
player's creation. Those are the **defining features** for that sketch.

Before generation, the evaluator writes down the defining features for each
sketch (see §6, Identity Feature Extraction). Evaluation then asks whether
*those specific features* survived — not whether the picture is identical.

---

## 4. Acceptable Transformation

All of the following are **allowed** and do **not** by themselves count against a
model:

- line art → 3D character
- line art → realistic creature
- line art → stylized animation
- added fur / skin / material / texture
- cinematic lighting and depth
- a richer environment derived from the prompt
- camera movement
- clothing that matches the scene
- scene-specific props
- subtle design completion (finishing an implied shape, closing a gap)

These are acceptable **only if the defining features and personality remain
intact**. A crude sketch of a strange cat becoming a detailed 3D creature is a
**success** if the player would still immediately say *"that's my weird cat."*

### Acceptable incidental changes

- small deformation from motion
- slight perspective shift
- subtle shading variation between frames
- minor interpolation artifacts
- natural deformation needed to move a limb or mouth

The distinction:

> **Stylistic and motion transformation is acceptable.
> Identity-replacing transformation is not.**

---

## 5. Unacceptable Transformation (Hard Failures)

Seven hard-failure codes. **This set is authoritative for Stage 1** and matches
`hard_failure_type` in `probe/stage1-results.csv` and `probe/STAGE1_RUNBOOK.md`
§7. Record every code observed on a clip.

| Code | Failure | Definition |
| --- | --- | --- |
| `IDENTITY_NORMALIZATION` | Identity Normalization | AI removes or "fixes" the strange identity of the sketch. Example: giant ears become normal-sized; bizarre proportions become realistic. |
| `GENERIC_REPLACEMENT` | Generic Replacement | AI replaces the player's character with a conventional semantic version. Example: weird blue long-nosed cat becomes a normal realistic cat. **Automatic major failure.** |
| `ANATOMY_CORRECTION` | Anatomy Correction | AI changes intentionally unusual anatomy. Example: three legs become four; uneven eyes become symmetrical. |
| `PERSONALITY_LOSS` | Personality Loss | The original awkward, creepy, goofy, strange, or funny personality disappears; the output is generic or cute. |
| `DEFINING_FEATURE_LOSS` | Defining Feature Loss | One or more of the drawer's pre-recorded 2–5 identity-defining features (§6) disappear. |
| `FEATURE_DRIFT` | Feature Drift | Important identity features are present in the first frame but change significantly during the animation itself. |
| `SEMANTIC_OVERRIDE` | Semantic Override | The written prompt / context overrides the actual player's drawing or interpretation; the model illustrates the words and ignores the character. **Automatic major failure.** |

### Severity

- **`GENERIC_REPLACEMENT` and `SEMANTIC_OVERRIDE` are automatic major failures.**
  A single clear occurrence fails that clip's Layer A (§14), regardless of how
  good the video looks.
- The other five codes **contribute to Layer A identity failure depending on
  severity**: a minor one-off may still leave Layer A passable; clustered or
  severe instances fail it. The identity-block scores (§13) are how severity is
  judged.

### Hallucination is not a hard-failure code

Added detail is **not** automatically a failure. Fur, clothing, texture, lighting,
a richer environment, scene props, and cinematic detail are all allowed (§4).
Invented content is a problem **only** when it:

- competes with the player's identity
- erases defining features
- replaces the player's interpretation
- significantly changes the character

That damage is captured by the **`hallucination_control` 1–5 score** (§13), not by
a separate hard-failure code — there is **no `EXCESSIVE_HALLUCINATION` code**.
When invented content is severe enough that the character is no longer the
player's, it already registers as `GENERIC_REPLACEMENT` or
`DEFINING_FEATURE_LOSS`.

---

## 6. Conceptual Pipeline

The transformation the product wants, as stages. This probe evaluates the
**end-to-end result**, but naming the stages keeps evaluation and later prompting
honest.

```
Prompt
  → Rough Sketch
    → Identity Feature Extraction
      → Character Transformation
        → Scene Integration
          → Animation / Video
```

### Identity Feature Extraction

Identify the features that make the sketch unique. Done **by the evaluator, on
paper, before generation** — it is the checklist the output is graded against.

> Example: huge ears · extremely long nose · narrow sleepy eyes · short body ·
> strange proportions.

### Character Transformation

Convert the rough drawing into a more complete visual character while preserving
those features. Style (cinematic / 3D / realistic / stylized) is **secondary to
identity**.

### Scene Integration

Place the transformed character into a context derived from the game prompt
(space, kitchen, etc.). The character stays central; the scene supports it.

### Animation

Generate short motion or a brief cinematic moment. Keep it simple for the probe
(§11) so motion artifacts don't mask identity results.

---

## 7. Prompt Is Part of the Final Scene

Refinement: the drawing prompt is **not only** a scoring input. It should also
guide the final animation, creating continuity:

```
Prompt  →  Drawing  →  Final Movie
```

> Prompt: *"Draw a cat eating pizza in space."*
> Player draws: a strange long-nosed cat with a pizza.
> Ideal output: **that same recognizable long-nosed character**, floating in
> space, eating pizza.

The player's interpretation stays central. The semantic prompt must **not**
override the actual sketch.

### Priority order (use this to resolve any conflict)

1. **Sketch identity** — the defining features of what the player drew
2. **Player interpretation** — their unusual take on the prompt
3. **Prompt context** — the environment / action implied by the words
4. **Cinematic polish** — lighting, detail, camera

A model that reorders these (polish or prompt context above identity) fails the
product goal.

---

## 8. Candidate Models

First probe evaluates three current image-to-video families:

| # | Model family | Role |
| --- | --- | --- |
| 1 | **Google Veo 3.1** | Candidate |
| 2 | **Runway Gen-4.5** | Candidate |
| 3 | **Seedance 2.5** | Candidate |

Rules:

- **No winner is declared before testing.**
- The most cinematic / realistic output is **not** assumed best. The goal is
  **recognizable transformation, not literal preservation, and not maximum
  polish.**
- **Access check before Stage 1:** confirm each model is reachable at the exact
  version above; record the exact build / date per generation.
- If a model is impractical to access, **document the limitation in the log** —
  do not silently swap it. A replacement (e.g. Kling, Hailuo, Pika, Luma) may be
  proposed only if a listed model is genuinely unavailable, with the reason
  noted.

### Evaluation philosophy

Prefer the model that best balances, in this order:

1. character identity
2. defining-feature preservation
3. compelling transformation (does the rough sketch become an exciting character?)
4. usable motion
5. acceptable latency
6. cost

Consequences of this ordering:

- A model that **significantly changes rendering style** (line art → 3D) and
  keeps identity **can still PASS**.
- A model that **keeps the original line art** but produces **weak, lifeless
  motion** may be **less desirable**, not automatically better.

### Reference row (weak control)

Optionally include the source sketch held static with a slow zoom / parallax as a
floor for Motion Quality. Note: it is a *weaker* anchor than in the old probe —
the product now expects transformation, so a static image is no longer a
meaningful "perfect preservation" ceiling.

---

## 9. Two-Stage Probe

Do **not** run 15–20 sketches through all three models up front. Staged:

| Stage | Scope | Generations | Goal |
| --- | --- | --- | --- |
| **Stage 1 — Screening** | 6 sketches × 3 models | ~18 | Does any model show credible identity-preserving transformation? Cut the clearly unsuitable. |
| **Stage 2 — Validation** | ~10–12 sketches × surviving 1–2 models | ~10–24 | Is identity preservation *reliable across drawing types*? |

Stage 2 count may shrink if the result is obvious early. The goal is a
**plausibility verdict**, not statistical significance.

---

## 10. Stage 1 Sketch Set

Six sketches, same structure as before, **reinterpreted** for the new principle.
Each must look like something a normal player produces in **30–60 seconds** — not
polished artwork.

### Sourcing (matters for validity)

- Have **2–3 people who are not designers** draw them, on the target device form
  factor, under a real 40–60 s timer.
- For each sketch, the drawer writes down its **defining features** (§6).
- The **drawer scores the "That's My Character" dimension** for that sketch's
  videos. Nobody else can honestly give that score.
- Keep the source files; the same source image is reused across all models.

### Cases

| ID | Category | What it now tests |
| --- | --- | --- |
| **S01** | Simple character | Can a crude sketch become a **compelling** character while staying recognizable? |
| **S02** | **Weird character** — **the most important test.** Use obvious identity markers: unusual limb count, giant ears, long nose, asymmetrical eyes, strange proportions, unusual color. | Does the model **normalize** the strangeness? A model that "fixes" these features **fails**. |
| **S03** | Object interaction (e.g. cat eating pizza) | Does identity survive **during interaction / motion**? |
| **S04** | Full prompt scene (character + object + background + interaction) | Can the **prompt environment be added** without replacing the character? |
| **S05** | Child-like drawing (stick figures, primitive shapes) | Can **extremely crude** input still be transformed into a recognizable character? |
| **S06** | Unexpected interpretation (e.g. pizza as the moon, cat floating toward it) | Does the model keep the player's **unusual creative interpretation**, or revert to the obvious semantic reading? |

---

## 11. Input Control

For each sketch, hold constant across all three models:

- the **same source image** (same file, same resolution)
- the **same target action**
- the **same standardized transformation instruction**

Do **not** tune each model independently in Stage 1 — otherwise the probe
measures *best prompt engineering per model* instead of *baseline capability*.

If a model exposes an **image-conditioning / fidelity** control, set it to the
value that keeps the output **closest to the input character** and record it.
That is a measured capability, not prompt engineering.

### Standardized transformation instruction (baseline)

Reuse verbatim; swap only the bracketed clauses per sketch.

> Transform this rough hand-drawn sketch into a richer animated character and
> short scene. You may add texture, lighting, depth, materials, a fuller 3D or
> cinematic form, and a background that fits the scene. **You must keep the
> identity of the drawn character:** keep its distinctive silhouette and
> proportions, its [defining features: e.g. oversized ears, long nose, uneven
> eyes, three legs, crooked tail], its colors, and its funny / strange
> personality. Do NOT normalize the anatomy, do NOT make it a normal or
> conventional version of the animal, do NOT replace it with a different
> character. This must read as *the player's character, brought to life* — not a
> new illustration of the same subject. Scene: [prompt context, e.g. floating in
> space]. Motion only: [small head movement and looking around; one slow bite;
> the pizza shifts slightly; stars drift]. Minimal camera movement; keep the
> motion small and simple.

Per-sketch clauses:

| Sketch | Defining-features clause (fill from §6) | Scene clause | Motion clause |
| --- | --- | --- | --- |
| S01 | (drawer's list) | neutral / plain | small head movement, looks around |
| S02 | (drawer's list — the weird markers) | neutral / plain | shifts weight, tail twitches, uneven blink |
| S03 | (drawer's list) | on a plate / table | one slow bite; pizza moves slightly |
| S04 | (drawer's list) | prompt environment (e.g. space) | one bite; stars drift behind |
| S05 | (drawer's list) | neutral / plain | waves one arm; slight bob |
| S06 | (drawer's list) | the player's unusual scene | slow drift toward the pizza-moon; stars drift |

---

## 12. Prompt Variants

Two strategies only. This must not become a prompt-engineering project.

### Baseline Prompt

The standardized instruction in §11.

### Strong Identity Prompt

Baseline plus an explicit anti-normalization block:

> Do NOT correct or "fix" any anatomy, symmetry, or proportion. Do NOT make the
> character cuter, prettier, or more normal. Do NOT convert it into a
> conventional version of the animal or object. Do NOT change its colors. Do NOT
> swap it for a different character. If the drawing is "wrong," keep it wrong —
> the wrongness is the character.

Note: the Strong Identity Prompt targets **feature normalization and generic
replacement**. It no longer forbids rendering, 3D conversion, or added
detail — those are now allowed.

### Recommendation

- **Stage 1 pass 1:** every model, every sketch, **Baseline only** (~18
  generations).
- **Stage 1 pass 2 (targeted):** re-run the **Strong Identity Prompt only on the
  specific model × sketch cells** that showed Identity Normalization, Generic
  Replacement, or Personality Loss. Answers "can an explicit instruction fix it?"
  without multiplying the whole matrix.
- **Semantic Override isolation cell (now central):** on S04 and S06, run each
  model **with the full prompt sentence** and **image-only / minimal text**.
  Because "prompt is part of the scene" (§7), the risk that the text overrides
  the drawing is the single most dangerous failure mode. If pass 1 shows heavy
  Semantic Override, expand this comparison before judging any model.

---

## 13. Evaluation Rubric

Score every generated video **1–5** on each dimension. **Higher is always
better.**

Scoring procedure to reduce cinematic bias:

1. Put the **source sketch + its defining-feature list** on screen next to the
   video.
2. Score **identity dimensions first**, with the sketch visible.
3. Only then score the **quality** dimensions.
4. Where feasible, score with audio off and at reduced size.
5. Use **2–3 independent scorers**; the drawer always scores "That's My
   Character" for their own sketch.

### Identity block (mandatory — see Layer A, §14)

| Dimension | Question | 1 | 5 |
| --- | --- | --- | --- |
| **Core Identity Preservation** | Does the transformed character clearly come from the original sketch? | Different character | Unmistakably from this sketch |
| **Defining Feature Preservation** | Are the 2–5 defining features (§6) retained? | All lost | All retained |
| **Anatomy Preservation** | Are unusual limb counts, proportions, facial structure, and silhouette retained? | Normalized | Fully retained |
| **Weirdness / Personality Preservation** | Does the strange or funny character personality survive? | Generic / cute | Fully intact |
| **Color / Visual Signature** | Are defining colors / visual signatures preserved (when relevant)? | Recolored | Exact |
| **Hallucination Control** | Does the AI avoid inventing changes that erase identity? | Severe identity-erasing invention | Almost none |

### Quality block (matters only after the identity block)

| Dimension | Question | 1 | 5 |
| --- | --- | --- | --- |
| **Transformation Quality** | Does the AI turn the rough sketch into a compelling animated / cinematic character? | Flat / broken | Genuinely compelling |
| **Scene Integration** | Does the transformed character fit naturally into the scene? | Pasted on / clashing | Natural |
| **Motion Quality** | Does the character move convincingly? | Static / broken | Lively, stable |

### Headline metric

| Dimension | Question | 1 | 5 |
| --- | --- | --- | --- |
| **"That's My Character"** | *If I drew the original sketch, would I immediately recognize this transformed animated character as the character I created?* | "That's not mine" | "That's my character, alive" |

**"That's My Character" carries the most weight in the final recommendation.** It
replaces the older, stricter **"That's My Drawing"** metric.

### What changed from the old rubric

- **Removed as scored dimensions:** exact Line / Drawing-Style Preservation;
  Shape/Proportion as *pixel fidelity*.
- **Demoted:** Composition Preservation — now folded into Scene Integration and
  no longer a heavy standalone score (major elements should still carry over).
- **Added:** Defining Feature Preservation, Anatomy Preservation, Weirdness /
  Personality Preservation, Transformation Quality, Scene Integration.
- **Reframed:** "Added Hallucination" → "Hallucination Control" (identity-erasing
  invention specifically).
- **Renamed:** "That's My Drawing" → "That's My Character."

### Objective identity cross-check (cheap, recommended)

Blind lineup: show a scorer the video only, then ask them to pick the source
sketch from **4 candidates** (real one + 3 same-category decoys). Record hit /
miss. A model whose outputs fail the lineup has an identity problem no rubric
score can excuse.

---

## 14. Two-Layer Success Test

Every generation is judged in two layers. **Layer A gates Layer B.**

### Layer A — Identity Success (mandatory)

> Does the transformed character still clearly belong to the player's original
> sketch?

Pass Layer A when the **Identity block** holds up: Core Identity ≥ 3,
Defining Feature ≥ 3, Anatomy ≥ 3, Weirdness ≥ 3, **and no Generic Replacement
or Semantic Override**. Otherwise Layer A fails and Layer B is not scored for
that clip.

### Layer B — Magic Success (the emotional payoff)

> Does the transformation feel exciting, funny, cinematic, or surprising enough
> that players want to see another drawing transformed?

Read from Transformation Quality, Scene Integration, Motion Quality, and the
evaluator's gut reaction. Scored **only** for clips that passed Layer A.

> A beautiful movie that fails Layer A is still a product failure.

---

## 15. Example Evaluation

**Original sketch**

- cat-like creature
- very large ears
- extremely long nose
- half-closed (sleepy) eyes
- short, awkward body
- funny expression

Defining features (§6): large ears · long nose · sleepy eye shape · awkward
proportions · funny/strange vibe.

**Possible generated result**

- detailed furry 3D creature
- cinematic lighting
- richer background
- added motion
- extra scene props

**SUCCESS** if:

- large ears remain
- long nose remains
- eye shape remains recognizable
- awkward proportions remain recognizable
- funny / strange identity survives

**FAILURE** if:

- the result becomes a normal cat or a mouse
- the long nose disappears
- proportions become generic
- the strange facial identity is lost

The 3D conversion, the fur, the lighting, and the richer background are **not**
failures — they are the intended transformation.

---

## 16. Test Logging

Manual. One row per generation. No software.

| Field | Notes |
| --- | --- |
| Sketch ID | S01–S06 (Stage 1), plus Stage 2 IDs |
| Drawer | who drew it |
| Defining features | the 2–5 from §6 |
| Model + exact version | e.g. "Veo 3.1 (build 2026-08)" |
| Prompt | Baseline / Strong Identity / image-only |
| Fidelity setting | if the model has one |
| Attempt # | 1 or 2 (see §18) |
| Video duration | seconds |
| Approx. generation time | wall-clock, submit → playable |
| Generation failed? | yes/no + error |
| Core Identity Preservation | 1–5 |
| Defining Feature Preservation | 1–5 |
| Anatomy Preservation | 1–5 |
| Weirdness / Personality Preservation | 1–5 |
| Color / Visual Signature | 1–5 |
| Hallucination Control | 1–5 (5 = almost no identity-erasing invention) |
| Transformation Quality | 1–5 |
| Scene Integration | 1–5 |
| Motion Quality | 1–5 |
| **"That's My Character"** | 1–5 (drawer-scored) |
| Layer A | PASS / FAIL |
| Layer B | 1–5 (only if Layer A passed) |
| Lineup cross-check | hit / miss |
| Hard failures observed | list from §5 |
| Notes | one or two sentences |

Blank sheet in the appendix.

---

## 17. Retry Policy

Strict — unlimited retries would hide model weaknesses.

- **Maximum 2 attempts per sketch × model × prompt cell.**
- **Attempt 1 is the primary result** and the one that feeds the gate.
- Attempt 2 only for (a) generation failure, or (b) obviously abnormal output
  (corrupt frames, wrong aspect ratio, empty video) — not "the first wasn't as
  nice as I hoped."
- **No cherry-picking** the best of many generations.

A game needs consistency. A model that produces one great result after ten tries
is unsuitable for a real-time product.

### Consistency spot-check (Stage 2 only)

On **2 Stage 2 sketches**, run the surviving model **3 times with different
seeds** and record the spread of "That's My Character" scores. High variance is
itself a FAIL signal even if the median is good.

---

## 18. Stage 1 Decision Gate

After ~18 Stage 1 generations, classify each model.

Decision priority (in order):

1. **"That's My Character"**
2. Core identity + defining-feature preservation
3. Anatomy / weirdness preservation
4. Scene integration
5. Transformation quality & motion

Cinematic polish must **not** dominate.

### Working thresholds (guidance, not false precision)

| Verdict | Rough rule |
| --- | --- |
| **PASS** | **Layer A passes on ≥ 5 of 6 sketches**, median "That's My Character" ≥ 4, **no Generic Replacement or Semantic Override**, and Layer B ≥ 3 on most passing clips. → Stage 2. |
| **CONDITIONAL** | Median "That's My Character" = 3, **or** ≥ 4 but with one clustered, nameable, plausibly fixable identity weakness (e.g. only colors drift; only S05 fails; normalization only without the Strong Identity Prompt). → Stage 2 with the fix applied and noted. |
| **FAIL** | Frequent Identity Normalization or Generic Replacement, **or** any repeatable Semantic Override, **or** Layer A fails on the majority of sketches, **or** Layer B ~1 across the board despite Layer A passing (identity kept but lifeless). |

**Interpretation of PASS under the new principle:** PASS no longer means "the
lines survived." It means the **transformed** character still reads
unmistakably as the player's creation (Layer A) **and** the transformation is
worth watching (Layer B). A model that heavily restyles the sketch but keeps its
identity and adds real life is exactly what PASS is meant to capture. A model
that keeps the sketch literal but adds nothing is CONDITIONAL at best.

Retain the **best 1–2** models for Stage 2.

---

## 19. Stage 2

Only the top 1–2 models advance. Increase drawing-type diversity to test whether
identity preservation is *reliable*, not just possible. ~10–12 sketches spanning:

- human stick figure
- animal
- monster / creature
- vehicle
- two-character interaction
- family scene (multiple figures)
- abstract creature
- intentionally malformed drawing
- very colorful drawing
- nearly monochrome drawing
- extremely sparse sketch (3–4 strokes)
- one repeat from Stage 1 (continuity check)

Same rubric, same logging, same retry policy, plus the consistency spot-check
(§17). Keep drawer-scoring for "That's My Character."

---

## 20. Stop / Continue Gate

### GREEN — continue product development

At least one model **repeatedly** produces videos where the drawer reasonably
says *"that's my character."* Style may differ heavily from the sketch; identity
and weirdness survive. Lineup cross-check mostly hits. Layer B is consistently
enjoyable. → Proceed to the Human Magic Moment test (§21).

### YELLOW — continue experimentation only

Identity-preserving transformation works **sometimes**; it is inconsistent, or it
keeps identity but lacks magic (Layer A passes, Layer B weak), or it needs
per-sketch prompt babysitting. **Do not start MVP development.** Investigate one
variable at a time:

- prompt strategy (Strong Identity Prompt, anti-normalization block)
- simpler / smaller motion
- image preprocessing (contrast, background flattening, upscaling, feature
  emphasis)
- alternate image representation (framing as "child's drawing," annotating the
  defining features)
- alternate / newer model

Then repeat a **smaller** probe (3–4 sketches × the one or two candidates).

### RED — reconsider core concept

**No** tested model reliably keeps identity: outputs consistently normalize
anatomy or produce Generic Replacement / Semantic Override, regardless of
prompt. Then:

- Do **not** build the full game around generative video yet.
- Evaluate non-generative or hybrid "bring it to life" techniques that preserve
  identity **by construction** because they move the player's own artwork:
  auto-rigging / puppet-warp of the sketch bitmap, 2D cut-out layer animation,
  mesh deformation, sprite motion, parallax + particle effects over a lightly
  stylized version of the sketch.
- A hybrid is plausible: light AI stylization of the sketch itself (not a
  regenerated character) + rig-based motion.
- Do not force generative video into the product if it cannot support the
  identity principle.

Note: the RED bar is now **lower** than in the old probe — models get credit for
transformation, not just literal preservation — so RED is less likely. But
Generic Replacement and Semantic Override remain disqualifying.

---

## 21. Human Magic Moment Test (only after GREEN)

Isolated prototype. No AI Judge, no score, no winner, no awards.

> Prompt → Draw (~40 s) → Generate Transformation → Reveal → Next Drawing

- ~3 rounds.
- Purpose: isolate the **emotional value of the reveal**.
- A **blocking generation wait is tolerated here** because the reveal itself is
  what's being tested.
- **Record generation time**, but do **not** treat tolerance in this isolated
  setup as proof that the same latency is acceptable in the real game loop.
  Production game-flow latency is a separate test (`PRODUCT_ASSESSMENT.md` §10).

### Transformation style for the first test

Use **one visual style** (or very few). The first question is only whether
identity-preserving transformation is fun **at all** — not which style is best.
Multiple styles are a later feature (§23).

---

## 22. Human Reaction Signals

Observe behavior; don't rely on "did you like it?"

Strong positive signals:

- "That's my character."
- "They kept the weird nose."
- "It still has three legs!"
- laughing at how a strange sketch became cinematic
- turning the device to show the other player
- asking to save / share the clip
- **deliberately exaggerating the next drawing** to see how the AI transforms it
- **drawing unusual features on purpose** because they now expect those features
  to appear in the movie
- wanting to see what happens if they draw something even stranger
- asking for another prompt before being prompted

Especially important:

> The player intentionally creates distinctive or ridiculous features in the
> next round **because they now understand those features will survive into the
> final animation.**

That means Bring It to Life has become part of the **gameplay strategy itself**,
not a passive reward — the strongest possible signal for the product hypothesis.

---

## 23. Product Implication — Transformation Styles

Bring It to Life may eventually offer multiple transformation styles:

- Cinematic
- Anime
- Fantasy
- Horror
- Superhero
- Clay / stop-motion
- Retro cartoon

**Do not add these to MVP scope.** The first validation uses **one, or very few,
styles**. The first question is whether identity-preserving transformation is fun
at all. Style variety is an expansion lever for later, once the core is proven.

---

## 24. Final Decision

This probe answers:

> **Is Sketch → Character Transformation strong and reliable enough to justify
> building the rest of AI Sketch Game around it?**

It does **not** answer:

> Which AI model produces the prettiest or most realistic video?

The target is **recognizable transformation, not literal preservation.**

A GREEN result unlocks §21 and, after that, MVP Alpha planning. YELLOW keeps the
project in experimentation. RED sends the "bring it to life" mechanic back to
technique selection before any production commitment.

---

## 25. Known Limitations of This Probe Design

1. **One sample per cell cannot measure consistency**, which is a gate
   criterion. Partly mitigated by the Stage 2 seed spot-check (§17); Stage 1
   verdicts are directional only.
2. **"That's My Character" is subjective and identity-dependent.** Mitigated by
   drawer-scoring + the blind 4-way lineup, but the drawer pool is tiny (2–3
   non-designers) and may not represent real players.
3. **Probe sketches are made to order.** Even under a timer, someone who knows
   the test may draw model-friendly shapes. Non-designers, unbriefed on the
   models, reduces but does not remove this.
4. **Identity vs Transformation Quality is a genuine tradeoff** the flat 1–5
   rubric treats as separate blocks. §14 handles it by making Layer A a gate,
   not an average — evaluators must apply that.
5. **"Defining features" are chosen by the evaluator/drawer** before generation.
   That choice is itself subjective; two evaluators might pick different
   features. Mitigation: record the list per sketch so scoring is at least
   consistent within a sketch.
6. **Model version strings drift.** "Veo 3.1 / Gen-4.5 / Seedance 2.5" must be
   confirmed at probe time; exact build/date logged per generation.
7. **Non-prompt fidelity controls differ per model** and are hard to equalize.
   Setting each to its strongest "stay close to the character" value is a
   judgment call; record it.
8. **Stage 1 and Stage 2 use different sketch sets**, so a CONDITIONAL model's
   "fixable weakness" could be a sketch-set artifact. The one repeated sketch in
   Stage 2 is the only continuity control.
9. **Semantic Override is only partially isolated** (S04 / S06 cells in §12).
   Given the new "prompt is part of the scene" direction, this is the highest
   product risk; expand the comparison if early results show it.
10. **Evaluator fatigue and cinematic seduction** across ~18–40 videos. The
    sketch-side-by-side, identity-first scoring order (§13) is the main guard;
    spread scoring across sessions.
11. **The static-image reference row is now a weak anchor** — the product expects
    transformation, so "perfect preservation" is no longer the ceiling. It only
    anchors the Motion Quality floor.

None of these invalidate the probe. They mean a **PASS is provisional** and must
be confirmed by the Human Magic Moment test with real players and their own
drawings.

---

## Appendix — Blank Logging Sheet

```
Sketch ID:            ___   Drawer: ______   Category: ______
Defining features:    _______________________________________
Model / version:      ______________________
Prompt:               [ Baseline | Strong Identity | Image-only ]
Fidelity setting:     ______
Attempt #:            [ 1 | 2 ]      Failed? [ Y | N ]  ______
Duration (s):         ___   Gen time (s): ___

-- Identity block (gates Layer B) --
Core Identity Preservation      [1 2 3 4 5]
Defining Feature Preservation   [1 2 3 4 5]
Anatomy Preservation            [1 2 3 4 5]
Weirdness / Personality         [1 2 3 4 5]
Color / Visual Signature        [1 2 3 4 5]
Hallucination Control           [1 2 3 4 5]   (5 = no identity-erasing invention)

-- Quality block --
Transformation Quality          [1 2 3 4 5]
Scene Integration               [1 2 3 4 5]
Motion Quality                  [1 2 3 4 5]

"That's My Character"           [1 2 3 4 5]   (drawer-scored)

Layer A (identity):             [ PASS | FAIL ]
Layer B (magic, if A passed):   [1 2 3 4 5]
Lineup cross-check:             [ hit | miss ]

Hard failures:        [ IDENTITY_NORMALIZATION | GENERIC_REPLACEMENT |
                       ANATOMY_CORRECTION | PERSONALITY_LOSS |
                       DEFINING_FEATURE_LOSS | FEATURE_DRIFT |
                       SEMANTIC_OVERRIDE | none ]
                       (GENERIC_REPLACEMENT / SEMANTIC_OVERRIDE = automatic major failure)
Notes:               _______________________________________
```
