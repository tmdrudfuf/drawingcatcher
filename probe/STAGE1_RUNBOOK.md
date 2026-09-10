# Stage 1 — Character Transformation Probe Runbook

> Manual test. **No application code, no framework, no provider API integration,
> no Spec.** Companion to `SKETCH_VIDEO_PROBE.md` (full method),
> `PRODUCT_BRIEF.md`, and `PRODUCT_ASSESSMENT.md`.
>
> Files in this kit: `STAGE1_RUNBOOK.md` (this), `STAGE1_PROMPTS.md` (frozen
> prompts), `stage1-results.csv` (18 pre-created rows), `sketches/README.md`.

---

## Status: `READY FOR EXECUTION`

The Stage 1 experimental design is **frozen**. The four documents
(`SKETCH_VIDEO_PROBE.md`, this runbook, `STAGE1_PROMPTS.md`, `stage1-results.csv`)
agree on the principle, priority order, metric, Layer A / Layer B structure, the
6 × 3 = 18-run matrix, the candidate models, and the 7 hard-failure codes.

**Do not keep redesigning the experiment before there are real results.** Any
future change to the sketch set, prompts, rubric, gate thresholds, or failure
vocabulary must be motivated by **actual Stage 1 evidence** (e.g. a follow-up
triggered per §9), not by further pre-run refinement. Proceed to §14 — *What the
human tester does next*.

---

## 1. The question Stage 1 answers

> Can current AI systems **transform** a rough amateur sketch into an
> animated / cinematic character while preserving enough **identity** that the
> original artist immediately thinks *"that's my character"*?

We are **not** asking "can the AI preserve the exact original drawing?"
We are **not** asking "which model makes the prettiest movie?"

### Priority order (use to resolve any conflict)

1. **Character identity** — the defining features of what the player drew
2. **Player interpretation** — their unusual take on the prompt
3. **Prompt context** — the environment / action implied by the words
4. **Cinematic quality** — lighting, detail, camera

A model that reorders these fails the product goal, however good it looks.

---

## 2. Test size

**6 sketches × 3 candidate models = 18 primary generations.** Baseline prompt,
attempt 1.

| Model family | Notes |
| --- | --- |
| Google Veo 3.1 | Candidate |
| Runway Gen-4.5 | Candidate |
| Seedance 2.5 | Candidate |

- **No winner is declared in advance.**
- **Access check before you start:** confirm each model is reachable at the exact
  version string, and record the exact build / date per generation
  (`model_version` column).
- If a model is unavailable at run time, the tester **records that** in the CSV
  and notes rather than silently substituting another model. A replacement
  (Kling, Hailuo, Pika, Luma) may be *proposed* with a reason, not swapped in
  quietly.

---

## 3. Source sketches (fixed IDs)

Collected per `sketches/README.md`. ~40 s each, non-designers, no cleanup, no AI
enhancement, no redraw after seeing output. One source image per sketch, reused
unchanged across all three models.

| ID | Category | What it tests |
| --- | --- | --- |
| **S01** | Simple character — crude but recognizable | Can a basic drawing become a compelling transformed character while staying recognizable? |
| **S02** | **Weird character — MOST IMPORTANT TEST.** Several intentionally visible identity markers: unusual color, giant ears, long nose, asymmetrical eyes, unusual limb count, strange proportions, crooked tail. Exact design may vary. | Does the model **normalize** the strangeness? A model that "fixes" these fails. |
| **S03** | Object interaction — prompt *"A cat eating pizza."* | Does character identity survive interaction with another object? |
| **S04** | Full prompt scene — prompt *"A cat eating pizza in space."* | Can the AI add the prompt world without replacing the player's character? |
| **S05** | Child-like drawing — very crude / simple | Does poor drawing ability still work with the product? |
| **S06** | Unexpected interpretation — prompt *"A cat eating pizza in space,"* drawn unusually (e.g. pizza is the moon, cat drifting toward it) | Does the AI preserve the player's interpretation rather than normalize the scene? |

Before any generation, each drawer writes down that sketch's **2–5 defining
features** into `identity_features`. Evaluation grades against *that list*, not
against pixels.

---

## 4. Prompts

Frozen text lives in `STAGE1_PROMPTS.md`. Summary:

- **All 18 primary runs use the Baseline Transformation Prompt.** It asks for a
  fuller animated / cinematic character, allows 3D / texture / lighting /
  environment, and forbids only normalization and semantic replacement. It does
  **not** say "preserve every line" or "do not redesign anything."
- **Strong Identity Prompt:** marked *DO NOT USE FOR THE PRIMARY 18*. Targeted
  follow-up only, when a baseline fails by normalization / replacement. It
  protects limb count, proportions, asymmetry, colors, silhouette, facial
  structure, accessories, and the player's interpretation; it prohibits anatomy
  correction, conventional replacement, generic redesign, personality
  normalization; it does **not** prohibit 3D, texture, stylization, cinematic
  lighting, or environmental enrichment.
- **Motion** per sketch is in `STAGE1_PROMPTS.md` §3 and pre-filled in the CSV.
  Keep it small — this is an identity test, not action choreography.
- If a model has an image-conditioning / fidelity control, set it to its
  strongest "stay close to the input character" value and record it.

---

## 5. Evaluation rubric (1–5, higher is always better)

Score with the **source sketch + its defining-feature list on screen next to the
video**. Score the identity block first, then the quality block, then the
headline metric. Use 2–3 scorers where possible; the **drawer always scores
"That's My Character"** for their own sketch.

### Identity block (gates the quality block — see §6)

| Dimension | Question |
| --- | --- |
| `core_identity` | Does the transformed character clearly originate from the sketch? |
| `defining_feature_preservation` | Are the sketch's 2–5 most distinctive characteristics still present? |
| `anatomy_preservation` | Are unusual proportions, limb counts, facial structure, and silhouette maintained? |
| `personality_preservation` | Did the character keep the awkward / funny / strange personality of the drawing? |
| `color_visual_signature` | Are important visual signatures (defining colors) retained? |
| `hallucination_control` | 1 = major identity-erasing inventions; 5 = added content does not damage identity. |

### Quality block (only meaningful after identity passes)

| Dimension | Question |
| --- | --- |
| `transformation_quality` | Did the crude drawing successfully become an appealing transformed character? |
| `scene_integration` | Does the transformed character fit naturally into the requested environment? |
| `motion_quality` | Does it actually feel alive? Motion is a **floor**, not the primary optimization target. |

### Headline metric

| Dimension | Question |
| --- | --- |
| `thats_my_character` | Ask the sketch author: *if you drew the original, would you immediately recognize this transformed animated character as your character?* **Most important score.** |

Optional cheap cross-check: blind 4-way lineup — show a scorer the video only,
ask them to pick the source sketch from 4 same-category candidates. Record hit /
miss in notes.

---

## 6. Two-layer gate

Every result is judged in two layers. **Layer A gates Layer B.**

### Layer A — Identity Success (mandatory)

The transformed output must preserve the character's identity. Pass when the
identity block holds (roughly: `core_identity` ≥ 3, `defining_feature_preservation` ≥ 3,
`anatomy_preservation` ≥ 3, `personality_preservation` ≥ 3, **and no Generic
Replacement or Semantic Override**). Record `layer_a_identity_pass` = PASS / FAIL.

**If Layer A fails, cinematic quality does not matter** — do not score Layer B.

### Layer B — Magic Success (only after Layer A passes)

Does the transformation feel funny / exciting / surprising / cinematic / worth
watching / worth drawing another character for? Score `layer_b_magic_score` 1–5
from the quality block plus evaluator gut reaction.

> A beautiful movie that fails Layer A is still a product failure.

---

## 7. Hard failures (record explicitly in `hard_failure_type`)

| Code | Meaning |
| --- | --- |
| `IDENTITY_NORMALIZATION` | AI "fixes" the strangeness (3 legs → 4, uneven eyes → symmetrical, giant ears → normal). |
| `GENERIC_REPLACEMENT` | Character swapped for a conventional version of the semantic object. **Automatic major failure.** |
| `ANATOMY_CORRECTION` | Unusual proportions / limb counts / facial structure corrected toward realism. |
| `PERSONALITY_LOSS` | Awkward / creepy / goofy character becomes generic and cute. |
| `DEFINING_FEATURE_LOSS` | One or more of the drawer's 2–5 defining features gone. |
| `FEATURE_DRIFT` | Defining features present at first frame but morph or vanish across the animation. |
| `SEMANTIC_OVERRIDE` | Text prompt drives the output more than the actual drawing. **Automatic major failure.** |

Set `semantic_replacement` = yes/no separately as a fast flag.

> This 7-code set is authoritative for Stage 1 and matches `SKETCH_VIDEO_PROBE.md`
> §5 and its appendix logging sheet exactly. Identity-erasing invention is scored
> through `hallucination_control` (1–5), not a failure code — there is no
> `EXCESSIVE_HALLUCINATION` code. `GENERIC_REPLACEMENT` and `SEMANTIC_OVERRIDE`
> are automatic major failures; the other five contribute to a Layer A identity
> failure depending on severity.

---

## 8. Retry policy

- **Attempt 1 is the primary result** and the one that feeds the gate. Bad output
  is useful experimental data — keep it.
- **Max 2 attempts** per sketch × model × prompt cell.
- Retry **only** for: technical generation failure, corrupted output, or a
  clearly abnormal provider failure (wrong aspect ratio, empty video).
- **Do not** retry because the output looks bad, identity failed, motion is weak,
  or another seed might look nicer. **No cherry-picking.**

---

## 9. Targeted follow-ups (after all 18 primary generations)

Appended as **additional** rows — they never replace a baseline row.

1. **Strong Identity follow-up:** on specific baseline cells that failed by
   normalization / replacement, re-run with the Strong Identity Prompt
   (`prompt_type = STRONG_IDENTITY`). Answers "can an explicit instruction fix
   it?"
2. **Semantic Override isolation (S04, S06):** if text appears to override the
   sketch, run `SEMOVR_A` (image + full prompt context) vs `SEMOVR_B` (image +
   minimal semantic restatement + identity/motion). If B preserves identity and A
   does not, the prompt text itself is causing character replacement — record
   that; it shapes how the real product feeds prompts to the model.

---

## 10. PASS gate (refined identity principle)

**PASS** (→ Stage 2) means approximately:

- Layer A passes on **at least 5 of 6 sketches**
- median `thats_my_character` **≥ 4**
- **no Generic Replacement**, **no Semantic Override**
- defining abnormal features **usually survive**
- Layer B / magic quality **≥ 3 on most identity-passing clips**
- motion is sufficient to feel alive

**PASS does NOT require:** identical line art, identical rendering style,
identical background, or literal pixel preservation. **A line drawing becoming a
detailed 3D creature can be an excellent PASS** if identity survives.

**CONDITIONAL:** median `thats_my_character` = 3, or ≥ 4 with one clustered,
nameable, plausibly fixable weakness (e.g. only colors drift; only S05 fails;
normalization only without the Strong Identity Prompt). → Stage 2 with the fix
applied and noted.

**FAIL:** frequent Identity Normalization or Generic Replacement, or any
repeatable Semantic Override, or Layer A fails on the majority of sketches, or
Layer B ~1 across the board despite Layer A passing.

Retain the best 1–2 models for Stage 2 (`SKETCH_VIDEO_PROBE.md` §19).

---

## 11. Human reaction signals (for the later Magic Moment test, `SKETCH_VIDEO_PROBE.md` §21)

The strongest later playtest reactions include:

- "That's my character."
- laughing because the weird feature survived
- pointing out preserved anatomy / details on screen
- turning the device to show the other player
- asking to save / share the clip
- wanting to see another sketch transformed
- **deliberately exaggerating features in the next drawing**
- **drawing something stranger specifically to influence the AI result**

Especially important:

> After seeing one result, players **intentionally change how they draw the next
> character** because they expect their distinctive features to survive into the
> transformation.

That indicates Bring It to Life is becoming part of the actual **gameplay
strategy**, not a passive reward — the strongest signal for the product
hypothesis.

---

## 12. Experimental checklist

Prerequisite already completed: `PRODUCT_ASSESSMENT.md` has been aligned with the
Character Identity Preservation principle (§9, "Character Identity Preservation
Risk"). Re-read it if you want to confirm before starting.

- [ ] Six human sketches collected
- [ ] 2–5 identity-defining features written down BEFORE generation
- [ ] Original sketch files frozen
- [ ] Candidate model / version recorded
- [ ] Baseline prompt frozen
- [ ] Generation order fixed
- [ ] No model-specific tuning during the primary run
- [ ] Attempt 1 retained
- [ ] Generation time recorded
- [ ] Identity evaluated before cinematic quality
- [ ] No cherry-picking

---

## 13. Mobile product context

The production product is confirmed to be a **mobile application for iOS and
Android**, with a shared cross-platform codebase preferred.

This **does not affect this probe.** Do **not**, as part of Stage 1:

- select the mobile framework
- create a React Native / Expo / Flutter / iOS native / Android native project
- write provider API integrations
- start application implementation or a Spec

The mobile technical architecture phase begins only after the core product
hypothesis is sufficiently validated.

---

## 14. What the human tester does next

1. Recruit 2–3 non-designer drawers. Collect S01–S06 per `sketches/README.md`
   (~40 s each, timer, no cleanup). Save the exact filenames.
2. For each sketch, the drawer writes its 2–5 **defining features**; put them in
   `stage1-results.csv` (`identity_features`) and keep a copy on paper.
3. Confirm access to Veo 3.1, Runway Gen-4.5, Seedance 2.5; record exact
   versions. Note any unavailable model instead of substituting.
4. Freeze `STAGE1_PROMPTS.md`. Fix the generation order (CSV row order is fine).
5. Run the **18 baseline generations**, attempt 1. For each: fill `model_version`,
   `generation_date`, `duration_*`, `generation_time_seconds`,
   `generation_success`. Retry only per §8.
6. Score every clip with the sketch beside it — identity block first, then
   quality, then `thats_my_character` (drawer-scored). Set `layer_a_identity_pass`,
   then `layer_b_magic_score` only if Layer A passed. Record `hard_failure_type`,
   `semantic_replacement`, `author_reaction`, `evaluator_notes`, `result_status`.
7. Run targeted follow-ups per §9 as appended rows.
8. Apply the PASS gate (§10). Record the per-model verdict and carry the best 1–2
   into Stage 2.

**Do not begin Stage 1 generations as part of preparing this kit. This is setup
only.**
