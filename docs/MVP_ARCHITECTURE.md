# AI Sketch Game — MVP Architecture

## High-Level System

```text
┌──────────────────────────────┐
│      Expo / React Native     │
│          Mobile App          │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│          Supabase            │
│                              │
│ Postgres                     │
│ Realtime                     │
│ Storage                      │
│ Edge Functions / API         │
└──────────────┬───────────────┘
               │
       ┌───────┼─────────┐
       ▼       ▼         ▼
   AI Judge  Character  Animation
   Provider   Provider    Provider
```

## Client Responsibilities

The app owns:

- UI
- drawing input
- room presence display
- local loading / suspense presentation
- video/image playback
- user interactions

The app does **not** own:

- AI secrets
- authoritative scoring
- generation job orchestration
- winner selection
- durable round transitions

## Server Responsibilities

The backend owns:

- room and round authority
- AI API calls
- result validation
- storage paths
- job retries
- generation status
- cost controls

## Round Sequence

```text
CREATE/JOIN GAME
      │
      ▼
READY
      │
      ▼
ROUND START
      │
      ▼
PROMPT
      │
      ▼
DRAW
      │
      ▼
UPLOAD + SUBMIT
      │
      ▼
BOTH SUBMITTED?
      │
      ▼ yes
AI JUDGE
      │
      ▼
RESULTS
      │
      ▼
CHARACTERIZE
      │
      ▼
ANIMATE
      │
      ▼
REVEAL
      │
      ▼
NEXT ROUND?
```

## Provider Boundary

```text
Game Logic
   │
   ├── JudgeService
   │      └── JudgeProvider
   │
   ├── CharacterizationService
   │      └── CharacterizationProvider
   │
   └── AnimationService
          └── AnimationProvider
```

No feature screen should know which vendor is active.

## Failure Strategy

AI failure should not break the room.

```text
Judge failure
→ retry
→ fallback response / recoverable round error

Characterization failure
→ retry
→ original drawing can still be shown

Animation failure
→ characterized still image
→ optional lightweight client animation
→ Next Round remains available
```

## First Implementation Rule

The first coded version should use fake providers:

```text
FakeJudgeProvider
FakeCharacterizationProvider
FakeAnimationProvider
```

This allows the full product loop to be implemented and tested before spending money or debugging multiple external APIs.
