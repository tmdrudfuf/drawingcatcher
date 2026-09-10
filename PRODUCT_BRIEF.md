# AI Sketch Game — Product Brief

## 1. Product Summary

AI Sketch Game is a mobile party/drawing game where players receive a prompt, draw a quick sketch, let AI judge the drawings, and then watch those drawings come alive as short animated characters.

The core product idea is not to “fix” bad drawings or replace them with polished AI art.

The fun comes from preserving what the player actually drew — including strange proportions, imperfect lines, and funny visual quirks — and turning those exact qualities into personality.

## 2. Initial Target

### Platform
- Mobile app
- One shared codebase/architecture for iOS and Android
- Final framework is intentionally not locked yet

### First Game Mode
**Duo Mode**

The first MVP is designed around two players playing together.

This keeps the first version easier to test while preserving the main social loop:
- both players get the same prompt
- both players draw
- AI evaluates both drawings
- results are revealed
- both drawings become animated
- players continue into another round

## 3. Core Loop

**Prompt → Draw → AI Judge → Results → Sketch-Preserving Animation → Next Round**

### Step 1 — Prompt
Both players receive the same drawing prompt.

Example:
> Draw a cat.

Prompts should be:
- immediately understandable
- drawable in a short amount of time
- visually recognizable
- fun even when drawn badly

### Step 2 — Draw
Players draw directly on a simple mobile canvas.

The drawing experience should prioritize:
- speed
- low friction
- expressive mistakes
- playful competition

The MVP does not need a professional illustration tool.

### Step 3 — AI Judge
AI analyzes each sketch in relation to the prompt.

Possible judging dimensions:
- prompt recognition
- recognizable features
- creativity
- funny/interesting interpretation

The judge should feel playful rather than academically precise.

### Step 4 — Results
Players see:
- each drawing
- score
- winner / round result
- short AI reaction or explanation

The result screen should quickly create a social reaction:
- laughing
- comparing
- teasing
- wanting to see what the AI does next

### Step 5 — Sketch-Preserving Animation
Each drawing becomes a character or short animated scene.

This is the emotional payoff of the round.

The AI should preserve:
- original silhouette
- strange proportions
- recognizable line placement
- major facial features
- intentionally or accidentally funny details
- the overall identity of the player's sketch

The AI should **not automatically beautify or normalize the sketch**.

A badly drawn cat should still feel like *that exact badly drawn cat* after transformation.

### Step 6 — Next Round
Players should be able to immediately continue.

The product should make:
> “One more round?”

feel like the natural reaction.

## 4. Characterization Direction

Characterization can use different presentation styles while preserving the source drawing.

Possible directions include:
- Funny
- Cute
- Chibi
- Epic
- Anime-inspired
- Pixel art
- Crayon / handmade
- Sticker-like
- Stylized 3D
- Simple animated sketch

### Key Principle

**Preserve first. Stylize second.**

The style may change, but the drawing's identity should remain recognizable.

A useful product test is:

> If the original artist sees the result without context, do they immediately recognize it as their drawing?

## 5. Why “Funny” Matters

The transformation should not only reward skilled artists.

In many cases, the funniest result may come from:
- oversized bodies
- tiny legs
- strange faces
- crooked eyes
- awkward anatomy
- unexpected interpretations

Those imperfections are content.

The AI should amplify them rather than erase them.

This creates a stronger social payoff than simply converting every drawing into attractive AI artwork.

## 6. MVP Scope

### Included
- Duo Mode
- Prompt display
- Mobile drawing canvas
- Round submission
- AI sketch recognition / judging
- Scores and winner
- AI reaction text
- Sketch-preserving characterization
- Short animation or animated reveal
- Next-round flow
- Basic session/game state

### Not Required for First MVP
- Large multiplayer rooms
- Public matchmaking
- Social feed
- User profiles with progression systems
- Complex drawing brushes
- Large cosmetics system
- Ranked competitive mode
- User-generated prompt marketplace
- Full video editor
- Advanced avatar system

These may be explored only after the core loop proves fun.

## 7. Main Early Product Metric

### Round 2 Start Rate

Primary question:

> After finishing Round 1 and seeing the AI result, what percentage of players choose to start Round 2?

This metric helps test whether the complete loop is actually compelling.

If users enjoy the drawing but do not start another round, the payoff or transition may not be strong enough.

## 8. Product Hypothesis

The game becomes compelling when three things work together:

1. **Fast drawing**
2. **Playful comparison**
3. **Unexpected transformation of the player's own sketch**

The AI animation is not just decoration.

It should make players feel:

> “Wait — that's actually my drawing moving.”

## 9. AI Design Principle

**AI should increase attachment to the player's drawing, not replace it.**

Bad outcome:
> Player draws a weird cat → AI generates a generic beautiful cat.

Desired outcome:
> Player draws a weird cat → AI generates a weird moving cat that clearly came from that exact drawing.

## 10. Initial Visual Test

The first reference test used a rough hand-drawn cat containing:
- uneven facial features
- simple whiskers
- oversized body
- short legs
- raised tail
- imperfect line work

The test demonstrated that the sketch can support multiple recognizable characterizations while retaining much of its original personality.

Reference files:

- `docs/references/original-cat-test.jpg`
- `docs/references/sketch-characterization-reference.png`

The **Funny Version** is especially important as a future direction because it demonstrates that imperfect drawing can become the main source of character rather than something AI needs to correct.

## 11. Validation Questions

Before expanding the project, test:

- Can users understand the game immediately?
- Is drawing on mobile fast and comfortable?
- Does AI judging feel fun rather than arbitrary?
- Do users recognize their own drawing after characterization?
- Does the reveal generate a strong emotional reaction?
- Is the result funny/shareable enough to show another person?
- Do users start Round 2 without being pushed?

## 12. Next Product Step

Create a complete MVP wireflow showing what two first-time players see from app launch through the start of Round 2.

The wireflow should cover:

**Home → Create/Join → Lobby → Prompt → Draw → Submit/Wait → AI Judge → Results → Animated Reveal → Next Round**

Technical-stack selection should happen after this flow is clear enough to identify the actual implementation requirements.

## 13. Wireflow

See [`docs/MVP_WIREFLOW.md`](docs/MVP_WIREFLOW.md) for the Duo Mode MVP screen-by-screen flow.
