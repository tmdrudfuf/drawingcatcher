# AI Sketch Game — MVP Tech Stack

## Decision Summary

For the first MVP, use:

- **App:** Expo + React Native + TypeScript
- **Navigation:** Expo Router
- **Drawing:** React Native Skia or an equivalent Expo-compatible drawing layer
- **Backend:** Supabase
- **Database:** Supabase Postgres
- **Realtime:** Supabase Realtime
- **Storage:** Supabase Storage
- **Auth:** Anonymous / guest-first session identity for MVP, with upgrade path to Supabase Auth
- **AI Judge:** Gemini first, behind a provider interface
- **Characterization:** Gemini Image first, benchmarked against OpenAI Image
- **Animation / Video:** Veo first, benchmarked against Runway
- **Analytics:** Lightweight event tracking focused on Round 2 Start Rate

The architecture must avoid hard-coding any single AI vendor into the product logic.

---

# 1. Why Expo + React Native

## Why it fits this project

The MVP is primarily:

- mobile UI
- touch drawing
- realtime room state
- image upload
- AI API orchestration
- result reveal
- short generated media playback

It does not require a full game engine.

Expo + React Native gives:

- one codebase for iOS and Android
- TypeScript
- fast iteration
- strong compatibility with AI coding agents
- straightforward API integration
- simpler deployment/testing than a custom native stack

## Why not Flutter first

Flutter is excellent for custom rendering and animation, but the MVP does not currently need enough rendering complexity to justify switching the primary development language to Dart.

Flutter remains a valid fallback if the drawing or animation layer becomes a major technical limitation later.

---

# 2. App Architecture

Recommended feature-oriented structure:

```text
src/
  app/
    (router files)

  features/
    home/
    lobby/
    prompt/
    drawing/
    judging/
    results/
    reveal/
    next-round/

  components/
    ui/
    game/

  services/
    ai/
      judge/
      characterization/
      animation/
    game/
    analytics/

  providers/
    supabase/

  hooks/
  types/
  utils/
```

## Principle

Feature UI should not directly call vendor SDKs.

Bad:

```text
DrawingScreen
  -> Gemini API
```

Good:

```text
DrawingScreen
  -> CharacterizationService
      -> CharacterizationProvider
          -> GeminiCharacterizationProvider
```

---

# 3. AI Provider Abstraction

## Judge

```ts
export interface JudgeProvider {
  judgeRound(input: JudgeRoundInput): Promise<JudgeRoundResult>;
}
```

Possible implementations:

```text
GeminiJudgeProvider
OpenAIJudgeProvider
```

## Characterization

```ts
export interface CharacterizationProvider {
  characterize(input: CharacterizationInput): Promise<CharacterizationResult>;
}
```

Possible implementations:

```text
GeminiImageProvider
OpenAIImageProvider
```

## Animation

```ts
export interface AnimationProvider {
  animate(input: AnimationInput): Promise<AnimationJob>;
  getStatus(jobId: string): Promise<AnimationJobStatus>;
}
```

Possible implementations:

```text
VeoAnimationProvider
RunwayAnimationProvider
```

## Why this matters

AI models and pricing will change.

The product should be able to swap providers without rewriting:

- game logic
- screens
- score flow
- storage
- analytics
- room state

---

# 4. Supabase Responsibilities

Use Supabase for:

## Postgres
Persistent game state.

## Realtime
Room synchronization.

Examples:
- player joined
- ready state changed
- round started
- drawing submitted
- judge completed
- reveal ready
- next round accepted

## Storage
Store:

```text
original drawings
characterized images
generated animation/video
optional share assets
```

## Auth

For the first MVP, avoid mandatory sign-up.

Preferred initial flow:

```text
Open app
→ receive anonymous/guest player identity
→ create or join room
→ play
```

Account creation can be added later if retention requires:

- history
- friends
- saved creations
- cosmetics
- profile

---

# 5. Suggested Database Schema

## players

```text
id
display_name
created_at
```

## games

```text
id
room_code
status
host_player_id
current_round_number
created_at
ended_at
```

Possible status values:

```text
waiting
active
ended
```

## game_players

```text
game_id
player_id
slot
ready
joined_at
```

For MVP:

```text
slot = 1 or 2
```

## rounds

```text
id
game_id
round_number
prompt
status
winner_player_id
created_at
completed_at
```

Possible round status:

```text
prompt
drawing
judging
results
generating
reveal
complete
```

## drawings

```text
id
round_id
player_id
original_asset_path
submitted_at
```

## judge_results

```text
id
round_id
player_id
score
recognized_subject
comment
raw_provider_result
created_at
```

## generated_assets

```text
id
drawing_id
asset_type
provider
provider_job_id
status
storage_path
created_at
completed_at
```

Possible asset types:

```text
character_image
animation_video
```

---

# 6. Realtime State Model

Supabase Realtime should synchronize durable state from the database.

Avoid making the frontend the authority for important game transitions.

Recommended flow:

```text
Player A submits drawing
        │
        ▼
Server records submission
        │
        ▼
Realtime update
        │
        ├── Player A sees "waiting"
        └── Player B continues drawing
```

When both drawings exist:

```text
Round state → judging
```

Then the backend starts AI judging.

---

# 7. AI Judge Pipeline

Input:

```text
Prompt
Player 1 sketch
Player 2 sketch
```

Expected structured output:

```json
{
  "players": [
    {
      "playerId": "p1",
      "score": 87,
      "recognized": true,
      "observations": [
        "cat detected",
        "tiny legs"
      ]
    },
    {
      "playerId": "p2",
      "score": 74,
      "recognized": true,
      "observations": [
        "cat detected",
        "unusually long legs"
      ]
    }
  ],
  "winnerPlayerId": "p1",
  "comment": "Those tiny legs somehow made the cat more powerful."
}
```

## Judge rules

The judge should prioritize:

1. prompt recognizability
2. relevant visible features
3. creativity / interpretation
4. playful commentary

Do not present score precision as scientific truth.

---

# 8. Characterization Pipeline

Input:

```text
original sketch
prompt
characterization instruction
```

Core instruction:

> Preserve first. Stylize second.

The output must preserve:

- silhouette
- proportions
- major line placement
- facial arrangement
- strange anatomy
- funny mistakes
- recognizable identity

## MVP benchmark

Use the existing cat reference as the first benchmark.

Evaluate each provider on:

```text
recognizability
sketch preservation
funny character quality
latency
failure rate
cost
```

---

# 9. Animation Pipeline

Preferred MVP pipeline:

```text
Original sketch
    │
    ▼
Characterization
    │
    ▼
Character image
    │
    ▼
Animation provider
    │
    ▼
Short video
```

The animation prompt should reference traits from the source drawing.

Example:

```text
Make this strange cat waddle using its extremely tiny legs.
Preserve its oversized oval body, uneven eyes, whiskers,
and raised curved tail. Do not correct its anatomy.
```

## Suggested motion library

Start with a small set:

```text
waddle
blink
bounce
tail wag
stumble
hop
look around
```

The backend can choose a motion based on the sketch.

---

# 10. Winner-Only Video Experiment

Because video generation may dominate per-round cost, support an MVP experiment:

## Variant A
Both players:
- characterized image
- generated video

## Variant B
Winner:
- characterized image
- generated video

Loser:
- characterized image only

Track whether Variant B meaningfully reduces enjoyment or Round 2 Start Rate.

Do not permanently design around winner-only animation until tested.

---

# 11. Backend Execution

AI calls should not be performed directly from the mobile client.

Preferred architecture:

```text
Mobile App
    │
    ▼
Backend API / Server Function
    │
    ├── AI Judge Provider
    ├── Characterization Provider
    └── Animation Provider
```

Reasons:

- API keys stay private
- retries can be controlled
- jobs can continue if app briefly disconnects
- provider switching is easier
- cost limits can be enforced
- output validation can happen server-side

For MVP, Supabase Edge Functions may be sufficient.

If long-running video jobs become awkward in Edge Functions, add a small dedicated backend worker later.

Do not introduce extra infrastructure before it is needed.

---

# 12. Job State for Generated Media

AI video generation is asynchronous.

Each generated asset should use states such as:

```text
queued
processing
completed
failed
```

The mobile UI should subscribe to status changes.

Example:

```text
processing
→ "Bringing your drawing to life..."

completed
→ Animated Reveal
```

Failure should degrade gracefully.

Example fallback:

```text
video generation failed
→ show characterized image with lightweight client-side motion
→ allow Next Round
```

A failed AI generation must not trap the entire game session.

---

# 13. Drawing Layer

Initial requirements:

- touch drawing
- pen
- eraser
- undo
- clear
- export canvas to image
- predictable behavior on iOS and Android

Preferred candidate:

**React Native Skia**

Reason:

- strong custom drawing support
- high-performance rendering
- suitable for a simple sketch canvas

Do not add complex brushes, layers, selections, or editing tools in MVP.

---

# 14. Analytics

Primary metric:

## Round 2 Start Rate

Formula:

```text
sessions where round_2_started
--------------------------------
sessions that completed round_1
```

Minimum events:

```text
app_opened
game_created
game_joined
round_started
drawing_submitted
judge_started
judge_completed
results_viewed
characterization_started
characterization_completed
animation_started
animation_completed
animation_viewed
next_round_pressed
round_2_started
game_ended
generation_failed
```

Also capture latency:

```text
judge_latency_ms
characterization_latency_ms
animation_latency_ms
```

These timings matter because AI delay is part of the gameplay experience.

---

# 15. Environment Strategy

Use separate environments:

```text
development
preview
production
```

Never place production AI keys in the app bundle.

Keep secrets server-side.

Suggested environment variables:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY

GEMINI_API_KEY
OPENAI_API_KEY

VEO_API_KEY
RUNWAY_API_KEY
```

Only configure providers that are actively being tested.

---

# 16. MVP Technical Milestones

## Milestone 1 — Local Game Shell

Build:

```text
Home
Create/Join
Lobby
Prompt
Drawing
Results
Next Round
```

Use fake data.

No AI yet.

Success:
The entire 9-screen wireflow can be navigated locally.

## Milestone 2 — Realtime Duo

Add:

```text
room creation
room code
join
ready state
round state
two-device synchronization
```

Success:
Two real phones can complete a fake-data round together.

## Milestone 3 — Drawing Upload

Add:

```text
canvas
export image
upload
submission state
```

Success:
Both drawings are stored and visible on both devices.

## Milestone 4 — AI Judge

Connect the first JudgeProvider.

Success:
Two sketches receive valid structured scores and a winner.

## Milestone 5 — Characterization

Connect CharacterizationProvider.

Success:
The original sketch remains clearly identifiable after transformation.

## Milestone 6 — Animation

Connect AnimationProvider.

Success:
A characterized sketch produces a short motion asset and the reveal screen handles async status.

## Milestone 7 — Product Analytics

Measure:

```text
Round 1 completion
animation viewed
Round 2 start
AI latency
generation failures
```

Then begin real user testing.

---

# 17. What We Are Intentionally NOT Choosing Yet

Do not lock these prematurely:

- permanent AI vendor
- final animation vendor
- advanced authentication model
- monetization
- social feed
- matchmaking architecture
- large-scale backend
- final art direction
- complex progression

The first objective is to prove that the loop is fun.

---

# 18. Architecture Rule

When uncertain, optimize for:

**the fastest path to a real two-player test without creating vendor lock-in.**

The architecture should remain simple enough for one developer with AI coding assistance to understand and change quickly.
