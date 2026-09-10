# AI Sketch Game — Duo Mode MVP Wireflow

## Goal

Design the shortest understandable path that gets two first-time players from opening the app to wanting to start Round 2.

**Primary success metric:** Round 2 Start Rate

---

## Core Flow

`Home → Create / Join → Lobby → Prompt → Draw → Submit / Wait → AI Judge → Results → Animated Reveal → Next Round`

The first MVP should optimize for speed and social reaction rather than account setup, customization, or deep menus.

---

# 1. Home

## Purpose
Explain the product through action instead of onboarding screens.

## Main UI
- AI Sketch Game logo/title
- Primary button: **Play**
- Small secondary entry: **How to Play**

## Interaction
Tap **Play** → Game Setup.

## Product rule
Do not require account creation before the first game.

---

# 2. Game Setup

## Purpose
Let one player host and the other join with minimal friction.

## Main UI
Two large choices:

### Create Game
Creates a Duo lobby and generates:
- short room code
- shareable invite option

### Join Game
Input:
- room code

Then tap **Join**.

## MVP assumption
Exactly 2 players.

---

# 3. Lobby

## Purpose
Confirm both players are connected and build anticipation.

## Main UI
- Room code
- Player 1 status
- Player 2 status
- simple player names / temporary nicknames
- **Ready** button

Example:

> KY ✓  
> PLAYER 2 ✓  
>
> Both players ready!

When both players are ready:

**Start Round**

A short 3…2…1 transition begins.

---

# 4. Prompt Reveal

## Purpose
Make the drawing challenge immediately clear.

## Example

# DRAW A CAT 🐱

**You have 30 seconds.**

Optional playful subtitle:

> Make it recognizable.  
> Or don't. The AI will decide.

## Interaction
After a short reveal:

**Start Drawing**

For later versions the prompt can automatically transition into the canvas.

---

# 5. Drawing Canvas

## Purpose
Create a sketch quickly without turning the game into an art application.

## Main UI
- Prompt at top
- countdown timer
- large canvas
- pen
- eraser
- undo
- clear
- **Submit**

## MVP drawing philosophy

Keep tools deliberately limited.

The game benefits from:
- rushed drawings
- mistakes
- strange proportions
- imperfect anatomy

Those imperfections later become part of the AI characterization.

## Timer
Initial test target: **30 seconds**

This is a hypothesis, not a permanent rule.

---

# 6. Submit / Waiting

## Player who submits first

Show their own sketch with:

> Drawing submitted!

Then:

> Waiting for the other player…

Use a small playful animation so this does not feel like a loading/error state.

## When both submit

Immediately transition to AI judging.

---

# 7. AI Judge

## Purpose
Turn processing latency into suspense.

## Main UI

Show both sketches side by side.

Possible sequence:

> AI is inspecting the drawings…

Then lightweight observations appear.

Example:

**Player 1**
- Cat detected ✓
- Whiskers ✓
- Tail ✓
- Anatomy… questionable

**Player 2**
- Cat detected ✓
- Ears ✓
- Four legs… probably ✓

Then:

> Calculating scores…

## Important
Do not present the AI as an objective professional art critic.

The tone should be playful.

The judging experience is entertainment first.

---

# 8. Results

## Purpose
Deliver the competitive payoff quickly.

## Main UI

### PLAYER 1 — 87
### PLAYER 2 — 74

**ROUND WINNER: PLAYER 1**

Possible short AI comment:

> “Those tiny legs somehow made the cat more powerful.”

## Interaction

Primary button:

**Bring Them to Life ✨**

The animation reveal should be positioned as a reward after judging, not buried inside the score screen.

---

# 9. Characterization Transition

## Purpose
Build anticipation before showing the transformed sketches.

Each original drawing is shown briefly.

Possible transition:

`Original Sketch → Characterized Sketch`

Text:

> Bringing your drawings to life…

## AI principle

**Preserve first. Stylize second.**

Preserve:
- silhouette
- proportions
- awkward anatomy
- facial placement
- funny mistakes
- recognizable sketch identity

Do not turn every sketch into a generic polished character.

---

# 10. Animated Reveal

## Purpose
Create the strongest emotional moment of the round.

Show both transformed drawings.

Possible animation:
- blink
- bounce
- walk
- tail wag
- stumble
- react to the other character

Initial animation target:

**3–5 seconds**

The animation should feel derived from the player's actual sketch.

## Example

A player's cat has:
- huge body
- tiny legs
- raised tail

The generated character should retain those traits.

The tiny legs could make the walk intentionally ridiculous.

That is a feature, not an error.

## Optional MVP actions
- Replay
- Share

Sharing is secondary to continuing the game.

---

# 11. Round End / Next Round

## Purpose
Test whether the core loop makes players voluntarily continue.

Main CTA:

# NEXT ROUND

Secondary action:

**End Game**

Do not add a large menu between rounds.

When both players choose Next Round:

`New Prompt → Round 2`

This event is the main early product metric:

## `round_2_started`

---

# First-Time Player Journey

A successful first session should feel approximately like this:

**0:00**
Open app

**0:05**
Create / join game

**0:15**
Both players ready

**0:20**
Prompt appears

**0:25–0:55**
Drawing

**0:55–1:05**
AI judging / suspense

**1:05**
Winner reveal

**1:10**
Character transformation

**1:15**
Funny animated payoff

**1:20**
“Again?”

The exact timing will change during testing.

The important idea is that the first payoff should arrive quickly.

---

# MVP Screen Map

```text
HOME
  │
  ▼
GAME SETUP
 ├── CREATE GAME ──┐
 └── JOIN GAME ────┤
                   ▼
                 LOBBY
                   │
                   ▼
             PROMPT REVEAL
                   │
                   ▼
             DRAWING CANVAS
                   │
                   ▼
              SUBMIT/WAIT
                   │
                   ▼
                AI JUDGE
                   │
                   ▼
                RESULTS
                   │
                   ▼
        CHARACTERIZATION
                   │
                   ▼
           ANIMATED REVEAL
                   │
             ┌─────┴─────┐
             ▼           ▼
         NEXT ROUND    END GAME
             │
             ▼
        NEW PROMPT
```

---

# Important UX Decisions to Validate

## 1. Timer length
Start with 30 seconds.

Test whether:
- it creates funny pressure
- it is enough to make recognizable sketches
- users feel rushed in a fun rather than frustrating way

## 2. Score complexity
Start simple.

Avoid exposing a complicated scoring formula.

Players primarily need:
- score
- winner
- funny explanation

## 3. Animation placement
Animation comes **after** the winner reveal.

This creates two payoffs:
1. competitive result
2. transformation surprise

## 4. Character style
Do not force the system to beautify sketches.

Funny characterization should be treated as a first-class result.

## 5. Round restart
Starting another round should require as little friction as possible.

---

# Minimum Analytics Events

For early testing, record:

- `app_opened`
- `game_created`
- `game_joined`
- `round_started`
- `drawing_submitted`
- `judge_completed`
- `results_viewed`
- `animation_viewed`
- `next_round_pressed`
- `round_2_started`
- `game_ended`

The most important funnel is:

`round_started → animation_viewed → round_2_started`

---

# Prototype Acceptance Test

Before selecting the final technical stack, a clickable or paper prototype should be understandable to a new player without explanation.

Give the prototype to two people and observe whether they can:

1. create/join a game
2. understand the prompt
3. draw and submit
4. understand who won
5. understand that their sketch became the animated character
6. find Next Round immediately

Do not explain the interface unless they become completely stuck.

Their confusion is product data.

---

# Next Step

Turn this wireflow into low-fidelity mobile screen mockups.

The first mockup set should cover:

1. Home
2. Create / Join
3. Lobby
4. Prompt
5. Drawing Canvas
6. AI Judge
7. Results
8. Animated Reveal
9. Next Round

Do not spend time on polished branding yet.

The purpose of the first visual prototype is to validate the loop and screen hierarchy.
