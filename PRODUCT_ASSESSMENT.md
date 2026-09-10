# AI Sketch Game — Product Assessment

> Companion to `PRODUCT_BRIEF.md`. Phase: Product Definition / Validation.
> Every recommendation below is judged against one question:
> **Will players immediately want to play another round?**

This document disagrees with the brief where useful. Main points of tension:
the AI Judge is treated as a co-equal pillar in the brief; here it is demoted
to a comedy/pacing device. The brief's session math (3–5 rounds in 5–10 min)
is treated here as optimistic once animation is included.

---

## 1. Product Assessment

### Product Strengths

- **"Bring It to Life" is a real differentiator.** No mainstream drawing game
  turns *your actual sketch* into motion. The "HAHA, that's my drawing" reaction
  is a specific, ownable emotional payoff. This is the reason the product could
  exist.
- **Zero-skill inclusivity is genuine, not marketing.** Judging communication
  over art, and animating ugly drawings faithfully, both point the same
  direction: bad drawings become an asset. That is a coherent design stance.
- **The pass-one-device situation is a strong wedge.** It removes networking,
  matchmaking, accounts, and sync from the MVP. The product can be tested by two
  people and a facilitator in a room.
- **Short session ambition is correct.** A 10-minute ceiling is the right
  target for the couch/table context.
- **Judge-as-game-show-host framing** (loading beats, "eating… questionable")
  is a cheap, high-value comedy layer *if kept qualitative*.

### Product Risks (ranked by severity)

| Severity | Risk | Why it threatens Round 2 |
| --- | --- | --- |
| **Critical** | AI video cannot preserve sketch identity | If the animation reads as "the AI drew something else," the entire differentiator collapses. This is unproven and outside our control (depends on model behavior). |
| **Critical** | Video latency breaks momentum | A 30–90s blocking wait per round kills the "let's go again" impulse at the exact moment it should peak. |
| **High** | Scoring creates friction between co-located players | Couples / parent–kid / friends are already together. A contested "winner" or an arbitrary-feeling score can produce mild negativity that ends the session. |
| **High** | The magic moment is a one-time "wow," not a replay driver | Seeing *any* sketch animate is novel once. The question is whether it stays compelling at round 3. Untested. |
| **High** | Realistic round length is ~2.5–3.5 min, not ~1.5 | Two sequential 30–60s draws + judging + result + animation. 3–5 rounds likely runs 12–18 min, past the attention ceiling. |
| **Medium** | Judge commentary goes stale by round 3 | Repetition converts the funniest feature into wallpaper. |
| **Medium** | Player 2's drawing turn is dead time for Player 1 | On one device, half of every round the other player is idle and can disengage. |
| **Medium** | Judge misreads rough drawings | "That's obviously a dog!" → feel-cheated moment, needs a reroll/challenge path. |
| **Medium** | Per-session cost dominated by video | Could make "animate every round" economically impossible before we even know if it's fun. |
| **Low** | Prompt quality / judge-ability variance | Some prompts produce ambiguous drawings the judge can't score cleanly. Fixable with curation. |
| **Low** | Content safety for arbitrary drawings → animation | Real, but low frequency in supervised playtests; matters before public release, not before validation. |

### What sounds interesting but may not be fun

- **Structured numeric scoring** (Prompt Match 50% / Creativity 25% / …).
  Precise weights imply precision the judge doesn't have. Players will
  reverse-engineer and dispute them. Creativity and Fun as *numbers* are the
  weakest part of the brief.
- **Awards for everything.** Five award types per round dilutes meaning; every
  player "winning something" every round quickly reads as participation
  trophies.
- **Both drawings animated every round.** Doubles the cost and the wait for a
  marginal increase in payoff.

### Why AI ≠ automatic differentiation

| AI feature | Contributes? | Reasoning |
| --- | --- | --- |
| Identity-preserving transformation | **Yes — this is the product** | Nothing else on the market does it; it produces a specific emotional and shareable moment. |
| Judge *commentary* (tone, loading beats) | **Yes, moderately** | Cheap comedy, sets pace, gives the "result" beat personality. Value is entertainment, not accuracy. |
| Judge *scoring* (numeric, subjective) | **Weak / possibly negative** | Human judging already exists in Pictionary etc. AI scoring is only better if it's funnier or fairer; subjective scores risk being neither, and can sour a co-located game. |
| Vision element detection ("cat detected") | **Yes, narrowly** | Objective, explainable, exploit-resistant. Good backbone for scoring *if* scoring stays mostly objective. |
| AI-generated prompts | **Neutral** | Curated prompts are more reliable early; generation adds risk without adding fun. |

---

## 2. Core Product Hypothesis

### The one hypothesis the first prototype must validate

> **H0 — Seeing your own rough sketch animated, with its flaws intact, produces
> a strong enough delight that players immediately want to draw again.**

If H0 is false, the product is Pictionary with an AI gimmick and should be
reconsidered. Everything else is secondary.

### Supporting hypotheses (ranked by how much they gate H0)

| # | Hypothesis | Priority | Notes |
| --- | --- | --- | --- |
| 1 | Current AI can transform a sketch into a richer character that is still recognizable as "mine" (defining features, weird anatomy, personality, defining colors). | **Must validate first** | Technical precondition for H0. Testable with zero code. |
| 2 | Animation latency can be hidden or tolerated inside the round flow. | **High** | Determines whether H0's delight arrives before momentum dies. |
| 3 | Drawing from prompts under a timer is fun. | **Low risk** | Borrowed from proven genres (Pictionary, Gartic Phone). Assume true; confirm cheaply. |
| 4 | Funny AI Judge commentary adds enjoyment. | **Medium** | Nice-to-have; not load-bearing. |
| 5 | Players care about the score. | **Low confidence** | May be neutral or negative for co-located pairs. |
| 6 | Competition drives replay more than cooperation. | **Low confidence** | Directly contested in §6; needs a side-by-side test. |
| 7 | Players want *both* rewards (judge + animation) every round. | **Likely false** | See §5. |

---

## 3. Initial Target Player

### Comparison

| Option | Ease of testing | Tech complexity | Social fun | Replayability | Prompt quality | Audience clarity | Positioning | Validates core loop |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Date-first** | Medium (recruiting couples in a mood to be filmed is harder) | Low | High *if* it lands | Medium | Narrow, harder to write well | Very clear | Risky — brands the whole product as dating | Yes, but with confounds |
| **Family-first** | Low (kids add reading age, motor skill, attention variables) | Low–Med | High | Medium | Medium | Clear | Wholesome, broad | Yes, but noisy data |
| **Party-first** | Low (needs 4+ people, turn logistics, possibly multi-device) | High | High | High | Medium | Clear | Broad | No — adds multiplayer before the loop is proven |
| **General two-player Duo** | **Highest** — any two people who know each other | **Lowest** | High | Unknown (that's the point) | Broadest, easiest to write | Slightly fuzzy | Neutral, keeps all doors open | **Yes, cleanest** |

### Choice: **General two-player Duo**, defined by play situation

> **Two people who already know each other, choosing to sit down together with
> one shared tablet or phone, wanting a light 10-minute shared activity.**

Not a demographic. The situation is the spec: co-located, one device, passed
back and forth, low commitment, social rather than solitary.

Reasons it beats the alternatives:

- Easiest and fastest to recruit and re-run — more playtests per week.
- Fewest confounding variables (no kids' reading age, no group dynamics, no
  networking).
- Keeps Date / Family / Party alive as **prompt packs**, not forks.
- Neutral positioning; doesn't prematurely brand the product.

Duo Mode in the brief is correct. This just sharpens it: **validate with plain
friends/partners first, add themed prompt packs only after the loop works.**

---

## 4. MVP Alpha Scope

Goal: the smallest build that can test **H0 + supporting hypotheses 1–2**.
It is a playtest instrument, not a product.

### MUST HAVE

- One shared device, pass-and-play, no accounts, no network beyond an API proxy.
- Prompt reveal (from a fixed curated list of ~30–40).
- Drawing canvas + timer (single adjustable timer value).
- Two sequential drawing turns, explicit submit.
- **Identity-preserving transformation of one drawing per round** (winner's, or — if
  no scoring in this build — player-chosen).
- Animation reveal screen (watch together).
- One-tap "next round."
- Facilitator-visible round timer / logging (can be a stopwatch + notes).

### SHOULD HAVE

- Minimal judge: element-detection checklist + short humorous commentary +
  a single playful "winner" call. Qualitative, not a weighted numeric score.
- One award badge per round (e.g. "Funniest"), not five.
- Loading-beat animation to mask judge latency.
- End-of-session "reel" that replays all animations.
- 2–3 prompt packs to test tone variance.
- A crude "that's wrong" reroll button (even if it just re-runs the judge).

### NOT NOW

Accounts, profiles, friends, gallery, sharing/export infra, online or
multi-device play, real-time simultaneous drawing, weighted numeric scoring
algorithm, full awards system, seasons/progression/monetization, backend
database, multiple AI providers, Date/Family/Party as separate modes,
AI-generated prompts, content-moderation pipeline (supervised playtests only),
tutorial/onboarding flow, settings screens.

---

## 5. Determine the Core Reward

| Question | Reward A — AI Judge | Reward B — Bring It to Life |
| --- | --- | --- |
| Primary emotional reward? | No | **Yes** |
| Secondary reward? | **Yes** (tension + comedy + a "result" beat) | No |
| Replay driver? | Weak / uncertain | **Yes** (if H0 holds) |
| Shareable moment? | No | **Yes** (the only genuinely shareable artifact) |

### Recommendation

**They should not both run at full weight every round.**

- **Judge: every round, lightweight.** Fast, cheap, provides the result beat and
  the comedy. Keep it to a detection checklist + one-liner + playful winner.
  No screen-filling scorecards.
- **Animation: the reward, used with restraint.** MVP Alpha default: **one
  animation per round, on the winning / chosen drawing**, generated
  asynchronously and revealed when ready (see §10). Hard ceiling ~4 per session
  for cost predictability.

Relationship: the judge is the *setup*; the animation is the *punchline*. The
judge decides *whose* drawing gets the spotlight; the animation *is* the
spotlight. If forced to cut one for a prototype, cut the judge, not the
animation.

---

## 6. Competition vs Co-op

### Context constraint

The players are already together and want to stay in a good mood. A scoring
system that produces a clear loser every round works against that.

| Structure | Fit for couch/co-located pairs |
| --- | --- |
| Pure competitive | Risky. Fine for two friends being silly; corrosive for a couple or parent–kid if it repeats. |
| Pure cooperative | Loses the per-round tension that makes a round feel like a round; "we both drew, here's a video" flattens fast. |
| **Hybrid: light compete → shared reward** | **Best.** Keeps a small stakes beat, then hands both players the same payoff to enjoy together. |

### Recommendation for MVP Alpha

**Hybrid, weighted toward the shared reward.**

- Each round has a **playful, low-stakes winner** (framed by the game-show
  judge, not a leaderboard).
- The **animation is the shared payoff** — both players watch it together.
- Give the non-winner **agency**: they choose whether the round animates the
  winner's drawing or their own. (Consolation + a genuine decision beat.)
- Over 3–4 rounds, ensure each player's drawing is animated at least once.
- Also run a **cooperative variant in playtests** ("you both draw parts of one
  scene, AI combines them") to directly test supporting hypothesis #6.

---

## 7. Round Structure

Product-level timing (not UI).

| Phase | Target | Notes |
| --- | --- | --- |
| Prompt reveal | 3–5 s | Read aloud, big text. |
| Drawing — Player 1 | 30–45 s | 60 s feels long on a phone; start at 40 s and tune. |
| Handoff transition | 3–5 s | "Pass to Player 2." |
| Drawing — Player 2 | 30–45 s | Player 1 needs something to do here (see momentum notes). |
| Judge | target ≤ 8–10 s | Masked by loading beats; hard cap before it feels broken. |
| Result reveal | 8–12 s | Checklist + one-liner + winner + one badge. |
| Animation generation | off the critical path | Started at submit; not a blocking phase (see §10). |
| Animation reveal | 8–12 s | The 5–10 s clip + reaction time. |
| Next round | ≤ 3 s | One tap, no menus. |

**Realistic active round ≈ 2.5–3.5 min** once reactions and reveals are
included — roughly double the brief's implied ~1.5 min.

### Challenge to the 3–5 rounds / 5–10 min assumption

At ~3 min/round, **3 rounds ≈ 10–12 min** is the realistic MVP session. Design
for **3 rounds**, make a 4th explicitly opt-in ("one more?"), and treat a
spontaneous 4th-round request as the primary success signal. 5 rounds in 10
minutes is not achievable with animation in the loop.

### Where momentum is most likely to die (ranked)

1. **Waiting for video generation** — the single biggest threat. Must be hidden.
2. **Player 1 idle during Player 2's drawing turn** — half of every round has a
   disengaged player. Give P1 a micro-task (guess the score, watch a replay of
   their own strokes, pick the animation target).
3. **Judge disagreement** — a contested call stops the flow while players argue.
   Needs a fast, low-drama reroll.
4. **Repetitive commentary / reveals by round 3** — variety budget needed.

---

## 8. AI Judge Risk Analysis

### What AI should judge **objectively**

- **Prompt element detection**: are the named nouns present? ("cat", "pizza",
  "space"). Vision classification, explainable, hard to dispute, exploit via
  text-writing can be lightly guarded.

### What AI can judge **semi-subjectively** (with visible confidence, not a hard number)

- **Relationships / interactions** between elements ("cat *eating* pizza") —
  express as confidence: "eating… questionable."
- **Recognizability** — "could a stranger tell what this is?"
- **Completeness** — did they attempt the whole prompt or just part.

### What AI should **not** judge

- **Artistic quality / line beauty** — directly contradicts the game philosophy
  and smuggles skill bias back in.
- **Absolute creativity as a number** ("Creativity: 82") — no defensible basis;
  guaranteed disputes.
- **Humor as a number** — same problem.

Creativity, Fun, and Humor belong as **qualitative award badges** decided from
visible evidence, not as weighted percentages in a total.

### Recommended initial scoring philosophy

> **Mostly-objective checklist + small evidence-based bonus + no penalty for bad
> art.** The player must be able to reconstruct their result from the evidence
> list shown. Subjective qualities are expressed as badges and commentary, never
> as precise scores. The "winner" is a light, host-narrated call, not a
> statistical verdict.

Do not build the weighted algorithm yet. Test whether players even want a score
before designing how to compute one.

### Other judge risks and mitigations

- **Misreads a rough drawing** → one-tap reroll; frame as "the judge squints
  again," keep it playful.
- **Latency interrupts** → loading beats are the cover; hard cap ~10 s then show
  a partial result.
- **Deliberate exploitation** (writing words, drawing the same thing every time)
  → mild guard on text-only submissions; otherwise let it be, playtesters
  exploiting the judge is itself a useful signal.
- **Commentary staleness** → budget 20–30 comment variants for the MVP, more per
  prompt pack later.

---

## 9. Character Identity Preservation Risk

> Aligned with the refined principle (`SKETCH_VIDEO_PROBE.md` §2):
> **AI may transform the drawing, but it must preserve the drawing's identity.**
> The product does **not** require the original lines, drawing style, pixels,
> exact composition, or "roughness" to survive. Line art → 3D, realistic or
> stylized materials, added fur / skin / clothing / lighting / environment, a
> richer scene, and completing missing detail are all **allowed** — they are the
> intended transformation, not failures. What must survive is the character's
> **defining identity**.

### Importance: **Critical — this is the product's spine.**

If the transformed character doesn't read as the player's own creation, "Bring It
to Life" becomes "AI makes a video loosely inspired by your doodle" — which is
neither novel nor emotionally yours. The bar is **recognition of identity**, not
fidelity to the strokes.

### What must survive — defining features

Each sketch has a small set (typically **2–5**) of **defining features**, written
down by the drawer *before* generation (`SKETCH_VIDEO_PROBE.md` §6). Identity
passes when *those* survive the transformation. Examples of mandatory identity
features:

- giant ears · extremely long nose · three legs / unusual limb count
- asymmetrical eyes · unusual head/body ratio · crooked tail
- unusual or defining color · distinctive silhouette
- funny / awkward expression · recognizable personality · strange anatomy
- the player's unconventional interpretation of the prompt

### Ranking of model changes

| Change | Verdict | Why |
| --- | --- | --- |
| "Fixes" the strangeness — three legs → four, uneven eyes → symmetrical, giant ears → normal, bizarre proportions → realistic | **Unacceptable — Identity Normalization / Anatomy Correction** | The flaws *are* the joke and the identity. |
| Swaps the character for a conventional version of the semantic object (weird blue long-nosed cat → normal cat) | **Unacceptable — Generic Replacement** | Automatic major failure even if it looks excellent. |
| Follows the prompt words and ignores the actual drawing | **Unacceptable — Semantic Override** | Automatic major failure. |
| Drops the awkward / funny / strange personality for a generic cute character | **Unacceptable — Personality Loss** | The comedic concept is the point. |
| Loses one or more of the drawer's 2–5 defining features | **Unacceptable — Defining Feature Loss** | Recognition depends on these specific features. |
| Defining features present in the first frame but morph or vanish across the clip | **Unacceptable — Feature Drift during animation** | Identity must hold for the whole shot. |
| Invents prominent new characters / objects that change what the player made | **Unacceptable** | Dilutes ownership. |
| Rearranges major elements or drops them | **Unacceptable** | Composition is *useful, not absolute* — major layout should still carry over; the scene around it may be enriched. |
| Converts line art to 3D / realistic / painted / stylized rendering | **Allowed** | The intended transformation — *only if defining features and personality survive*. |
| Adds fur, skin, materials, clothing, lighting, depth, cinematic treatment | **Allowed** | Same condition. |
| Places the character in a richer prompt-derived scene | **Allowed** | Character stays central and roughly where the player put it. |
| Completes missing / implied detail needed to bring the character to life | **Allowed, sparingly** | Must not invent identity-competing content. |
| Adds motion to the character | **Required** | The entire point. |

### The recognition test

The transformation passes if the drawer can **point at the screen and name the
specific weird thing they drew** — "there's the third leg," "that's my lopsided
eye," "I made it green," "they kept the long nose." Required to survive:

- the drawer's **2–5 defining features**
- **unusual anatomy** — limb count, proportions, asymmetry, silhouette
- **defining color(s)** where colour is a recognition cue
- the **personality / weirdness** the sketch implied
- the player's **unconventional interpretation** of the prompt
- **major composition** — key elements roughly where the player put them

Rendering style, texture, lighting, a fuller 3D form, and a richer background
**may be added**. Identity, defining features, unusual anatomy, personality, and
interpretation **may not be changed**.

### Priority order (resolves any conflict)

1. **Character identity** (defining features)
2. **Player interpretation** (their unusual take on the prompt)
3. **Prompt context** (environment / action implied by the words)
4. **Cinematic quality** (lighting, detail, camera)

A model that reorders these — polish or prompt context above identity — fails the
product goal.

This is the **#1 thing to test before any real build** (see §14).

---

## 10. Latency Risk

### UX thresholds (product-level, provider-agnostic)

| Band | Duration | Player behavior |
| --- | --- | --- |
| Feels instant | < 1 s | No perception of waiting. |
| Acceptable | 1–5 s | No mitigation needed. |
| Noticeable | 5–15 s | Needs an entertaining overlay (loading beats, commentary). |
| Dangerous | 15–30 s | Players disengage, check phones, talk about something else. |
| Game-breaking | > 30 s blocking | Round momentum lost; the "play again" impulse does not survive. |

- **Judge:** aim for **Noticeable or better**, always masked by loading beats.
- **Video:** realistically lands in **Dangerous+** with current tech, so it
  **must not be a blocking phase.**

### When should animation happen? Trade-offs

| Timing | Momentum | Cost control | Per-round payoff | Verdict |
| --- | --- | --- | --- | --- |
| Immediately (blocking) | Worst | — | Strong | Only for isolated Prototype B, where you're measuring reaction, not flow. |
| After results (blocking) | Poor | — | Strong | Still a wait wall. |
| **Generated during next round, revealed when ready** | **Best** | Neutral | Strong (delayed one round) | **Recommended for MVP Alpha.** Slight round-N/round-N+1 disconnect. |
| End of session only ("movie reel") | Safest | **Best** | None mid-session | Good for cost + anticipation; weakens the mid-session replay pull. Recommended as the fallback / secondary variant. |
| Player-selected, one per session | Safe | **Best** | One big moment | Adds a choice beat and friction; good cost lever, weaker rhythm. |

### Recommendation

- **Prototype B (isolated):** blocking is fine — just eat the wait; you're
  timing the *reaction*, not the loop.
- **MVP Alpha:** start generation at drawing submit; **reveal the animation
  during / at the end of the following round**, and always assemble an
  **end-of-session reel**. A/B this against "reel only" to see which produces
  more spontaneous "let's do another."
- Never show a bare spinner. If nothing is ready, run a loading beat or move to
  the next prompt.

---

## 11. Cost Risk

### Per-round AI cost sources

| Action | Relative cost |
| --- | --- |
| Vision analysis (element detection) | Low |
| Judge reasoning / commentary (LLM) | Low–Medium |
| Image preprocessing | Negligible |
| **Video generation** | **Dominant — likely 10–100× everything else combined** |

**Video generation is the cost driver. Nothing else is close.** All meaningful
cost control is about *how often* video is generated.

### Product-level controls (ranked by how much magic they preserve)

1. **One animation per round, winner/chosen only** — keeps per-round payoff,
   ~50% cheaper than animating both. *Recommended MVP default.*
2. **Hard ceiling per session** (~4) — makes cost predictable regardless of
   round count.
3. **Player-selected single animation per session** — strong cut, adds a choice
   beat, weaker rhythm.
4. **End-of-session reel of N rounds** — N clips but batched and capped.
5. **One animation per session** — cheapest; loses mid-session replay pull.

Do **not** pick pricing or monetization now. Just instrument cost per playtest
session so the "animate every round" question is answered with real numbers
before production.

---

## 12. First Playtest

### Test Setup

- **2 recruited players who already know each other** (a couple or two friends).
- One tablet or large phone, quiet room, one table.
- One facilitator: silent after setup, takes notes, films **hands and faces**
  with consent.
- Prototype quality. The judge may be **Wizard-of-Oz** (facilitator triggers
  canned commentary) and animations may be **pre-generated for a fixed set of
  known prompts** if real generation isn't ready — the goal is measuring
  reaction, not infrastructure.
- One spoken sentence of instruction. No tutorial. No accounts, no network.
- **Do not tell players how many rounds there are.**

### Number of Rounds

Run **3**. Then stop and wait. Whether they ask for a 4th, unprompted, is the
headline result.

### What We Observe

- Unprompted laughter, and *when* it happens (judge vs animation).
- Who leans toward the screen during the animation reveal.
- Whether players **point at the screen** and name their own details.
- Whether a player **grabs the device to show the other one**.
- Arguments about the score; tone of those arguments.
- Phone-checking or side-conversation during any wait.
- Player 1's body language during Player 2's drawing turn.
- Whether drawing strategy changes across rounds (engagement with the judge).
- The single moment each player smiles most.

### What We Measure

- **Unprompted "another round?" — yes/no, and seconds-to-ask.**
- Count of unprompted laughs per session.
- Count of "show you" gestures (device turned toward the other player).
- Seconds of visible disengagement during waits.
- Which reveal (score vs animation) drew the larger visible reaction.
- Number of animations players asked to replay or save.

### Questions We Ask Afterward

Avoid "did you like it?" Ask:

- "What was the best moment?" (listen for: the animation)
- "Whose drawing was funnier, and why?" (did the drawing or the judge drive the
  memory?)
- "If you played this at home tonight, what would you skip or speed up?"
- "Did the score feel fair? Did it matter to you at all?"
- "Would you show any part of this to someone who isn't here? Which part?"
- "How many rounds would you have wanted?"
- "Did the animation look like *your* drawing, or like something the app made?"

---

## 13. Success / Failure Criteria

Small-N, qualitative. No false precision. Assume 3–5 test pairs for the first
read.

### Continue

- In **most pairs**, players ask for another round **unprompted**, *and*
- the animation reveal produces **visible delight** (laugh / point / show), *and*
- at least one player spontaneously recognizes the animation as **theirs**.

### Adjust

- Players enjoy it and want another round, but the driver is clearly the
  **judge / comedy**, not the animation → re-weight the loop.
- Players want more rounds but name a **specific fixable problem** (wait time,
  drawing duration, score fairness) → fix and re-test.
- Animation lands flat but the **loop still has pull** → investigate whether the
  magic moment is even necessary.

### Reconsider the concept

- Players are polite but **do not ask for another round**.
- The transformed character **consistently reads as "not mine / a different
  character the AI invented"** (Generic Replacement / Semantic Override) across
  pairs and across model attempts.
- Scoring **reliably creates real friction** between players.
- Waits cause visible checked-out behavior that **no reordering fixes**.

---

## 14. Top Product Unknowns

| # | Unknown | Why it matters | Cheap test |
| --- | --- | --- | --- |
| 1 | Can current AI transform a rough sketch into a richer character while keeping it recognizable as "mine" (defining features, weird anatomy, personality)? | The whole differentiator. Out of our control. | Collect 15–20 real amateur sketches, run them through 2–3 candidate models by hand, show outputs to the drawers and to strangers: "kept the character or replaced it?" No code. See `SKETCH_VIDEO_PROBE.md` / `probe/`. |
| 2 | Does the animation reveal create a *repeatable* replay pull (not just one-time novelty)? | Distinguishes a product from a demo. | Prototype B, 3 rounds, watch for the unprompted 4th-round request. |
| 3 | Is being scored by an AI fun, neutral, or friction between co-located players? | Determines whether the judge stays a pillar or becomes garnish. | Wizard-of-Oz judge in the first playtests; watch for arguments and deflation. |
| 4 | Realistic round and session length with animation in the loop. | The brief's 3–5 rounds / 5–10 min may be physically impossible. | Stopwatch the first playtests. No engineering. |
| 5 | Where to place video generation so latency doesn't kill momentum. | Momentum is the product goal. | A/B "revealed next round" vs "end-of-session reel" in playtests. |
| 6 | Per-session video cost at acceptable quality and length. | Could rule out "animate every round" before design. | Generate ~30 clips on candidate providers; read the bill; multiply. |
| 7 | Do prompts need curation to be reliably fun and judge-able? | Bad prompts produce unscorable drawings and dead rounds. | Write 40 prompts, playtest a fixed subset, log which produced the best and worst rounds. |
| 8 | Is Player 1 idle during Player 2's turn a real disengagement problem? | Half of every round. | Observe P1 in playtests; test one variant with a P1 micro-task. |
| 9 | Competitive vs cooperative framing — which drives more "again"? | Shapes the core loop. | Run both variants with different pairs; compare 4th-round requests. |

---

## Product Lead Recommendation

### 1. What exactly should we prototype first?

**Prototype B — the Magic Moment**, preceded by a **zero-code model probe**.

- **Step 0 (no build):** Hand-run real amateur sketches through the candidate
  models, **staged per `SKETCH_VIDEO_PROBE.md` / `probe/`** (Stage 1: 6 sketches
  × 3 models = 18 baseline runs; Stage 2 only if Stage 1 passes). If no model can
  preserve character identity (§9), stop and reconsider the concept before
  writing code.
- **Step 1 (Prototype B):** prompt → draw (~40 s) → identity-preserving
  transformation → watch together. 3 rounds. **No judge, no score, no awards.** Blocking wait
  is acceptable here. Measure: do they recognize it as theirs, and do they ask
  to do another one.

### 2. What should we deliberately NOT build?

Accounts, profiles, friends, gallery, sharing/export infrastructure, online or
multi-device play, simultaneous drawing, the weighted numeric scoring algorithm,
the full five-award system, progression/seasons/monetization, a backend
database, multiple AI providers, Date/Family/Party as separate modes,
AI-generated prompts, a content-moderation pipeline, onboarding/tutorial/settings
screens. Anything beyond a thin API proxy and a canvas.

### 3. The single most important player reaction to observe

**A player points at the animated clip, says some version of "that's my
drawing!", and in the same breath asks to do another one.** Recognition +
immediate replay desire, together, unprompted.

### 4. The `PRODUCT_BRIEF.md` assumption I'm least confident about

That the **AI Judge / scoring system is a core pillar that belongs in every
round.** For couples, parent–kid, and close friends playing side by side,
per-round scoring may be net-negative, and the judge's real value is comedy and
pacing, not verdicts. Secondary low-confidence assumption: the session math
(3–5 rounds in 5–10 minutes) is optimistic once animation is in the loop —
plan for 3 rounds in ~10–12 minutes.

### 5. If Prototype A and Prototype B are separated, which is tested first, and why?

**Prototype B first.** It contains the actual differentiator and the single
largest uncontrolled risk (character identity preservation). Prototype A is a variation on
thoroughly proven genres (Pictionary, Gartic Phone) — lower risk, lower
information value. If B fails, A alone does not justify building the product. If
B succeeds, its result will reshape what A even needs to be.
