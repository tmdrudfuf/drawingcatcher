# AI Sketch Game - mobile prototype

Casual social drawing game for friends, couples and family. Two players get the
same prompt, draw it fast, AI picks a winner, then the players' own sketches come
alive as funny characters. **Preserve first. Stylize second.**

Product source of truth lives in [`PRODUCT_BRIEF.md`](PRODUCT_BRIEF.md) and
[`docs/`](docs/) (wireflow, tech stack, architecture). The `probe/` and `design/`
folders hold earlier validation work.

## Status - Milestone 3: Real Drawing Asset Pipeline

The app supports a real two-player room flow with Supabase Postgres and Supabase
Realtime. Each player's finished sketch is now exported to a PNG, uploaded to
Supabase Storage, and shown on both devices. AI behavior is still fake and
deterministic (no Gemini / OpenAI / Veo / Runway).

```
01 Home -> 02 Create/Join -> 03 Lobby -> 04 Prompt -> 05 Drawing
-> 06 Export + Upload + Submit/Wait -> 07 AI Judge -> 08 Results
-> 09 Animated Reveal -> 10 Next Round -> Round 2 Prompt
```

Remote authoritative state:

- room code, game status, host, round number
- lobby players, ready flags, next-round votes
- current round prompt and status
- submitted/not-submitted state (a player is "submitted" only once their
  drawing asset is uploaded)
- each submission's `drawing_path` in Supabase Storage
- fake winner id (derived server-side: slot 1 always wins)

Local transient state (never uploaded):

- active canvas strokes, current tool
- this device's own drawing preview (data URI, shown without re-download)
- upload progress, suspense/loading UI
- fake characterization/animation display

### Migration note

`supabase/migrations/202609100001_milestone2_realtime_duo.sql` was **corrected**
after Milestone 2: `submit_round_drawing` now takes a row lock so a simultaneous
double-submit cannot strand the round, and `complete_fake_judging` derives the
winner server-side (its signature changed - no `p_winner_player_id`). If you
applied an earlier copy, re-apply both migration files.

## Run It

```bash
npm install
npm start
```

Other checks:

```bash
npm run typecheck
npm run lint
```

## Supabase Setup

1. Create a Supabase project.
2. Apply **both** migrations, in order, from `supabase/migrations/`:
   - `202609100001_milestone2_realtime_duo.sql` (schema, RLS, RPCs, Realtime)
   - `202609100002_milestone3_drawing_assets.sql` (drawing columns, the
     `drawings` Storage bucket, Storage policies)
3. Copy `.env.example` to `.env` (`.env` is git-ignored; never commit real keys).
4. Fill in the public client variables:

```bash
EXPO_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
```

Do not put service role keys, AI keys, or admin credentials in the Expo app.

The migrations enable RLS and add temporary guest-first policies for
playtesting. They avoid service-role access from the app, but this is not a
final production permission model because guest clients are not authenticated
yet.

### Temporary Storage security compromise

The `drawings` bucket is **public-read** and accepts **anonymous** inserts and
updates (see `202609100002_milestone3_drawing_assets.sql`). Anyone holding the
anon key can read or overwrite any drawing. Object paths carry the game and
round UUIDs (`games/{gameId}/rounds/{roundId}/{playerId}.png`), which is
obfuscation, not authorization. The same file also widens the existing
`round_submissions` UPDATE compromise: with `drawing_path` now updatable by
`anon`, a client could repoint another player's submission at a different
asset. Tighten all of this (per-room tokens or Supabase Auth with owner checks)
before any non-playtest use.

## Applying Migrations

With the Supabase CLI:

```bash
supabase link --project-ref your-project-ref
supabase db push
```

Or paste the SQL migrations into the Supabase SQL editor for local MVP testing.
The `create policy ... on storage.objects` and `insert into storage.buckets`
statements in the Milestone 3 file need an elevated role — `supabase db push`
handles them, but if the SQL editor rejects them, create the `drawings` bucket
(public) and its read/insert/update policies from the dashboard Storage UI
instead.

After applying the migration, confirm Realtime is enabled for:

- `games`
- `game_players`
- `rounds`
- `round_submissions`

## Two-Device Test

1. Start Expo with `npm start`.
2. Open the app on two devices or simulators using the same Supabase project.
3. Device A enters a display name and taps Create Game.
4. Device B enters a display name, types Device A's room code, and taps Join Game.
5. Confirm both players appear in the lobby.
6. Both players tap Ready.
7. Host taps Start Round.
8. Confirm both devices show the same prompt.
9. Both draw independently and tap Submit. On Submit the sketch is exported to
   a PNG and uploaded before the player is marked submitted.
10. Confirm the first submitter waits until both drawings have uploaded.
11. Confirm AI Judge, Results, and Reveal show **both real submitted drawings**
    (each device shows its own from the local preview, the opponent's from
    Storage).
12. Both tap Next Round and confirm Round 2 starts with the same new prompt and
    a blank canvas. Round 1 drawings remain in Storage under their own path.

## Layout

```
src/
  app/                  Expo Router routes
  features/<screen>/    one screen component per step of the flow
  components/ui/        Screen, Button, Card, Pill
  components/game/      CatDoodle, MotionCat, SketchCanvas, ScoreCard, RemoteDrawing
  providers/game/       GameProvider - local + remote game state facade
  providers/supabase/   public Supabase client
  services/ai/          judge | characterization | animation fake providers
  services/drawing/     drawing PNG upload + public URL (Supabase Storage)
  services/game/        fake prompts, guest identity, room service
  services/analytics/   dev-console event tracking
  types/  utils/
```

## Known Limitations

- Guest identity is a locally persisted id plus display name; there is no account
  creation or durable user profile.
- Drawing export uses `react-native-svg`'s `toDataURL`. It is implemented but
  has not been verified on physical iOS/Android hardware in this environment;
  web export in particular is unreliable. Export failure is handled (the player
  can retry Submit without redrawing).
- Only the finished PNG is uploaded - raw editable strokes stay on the device.
- The characterized / animated Reveal output is still a fake local transform of
  the built-in doodle (labelled "FAKE TRANSFORM (dev)" in dev builds). The
  *original* sketches shown on Judge / Results / Reveal are now the real
  uploaded drawings.
- Fake AI judge results are deterministic: slot 1 scores 87 and wins, slot 2
  scores 74. The winner is derived server-side.
- Disconnect/reconnect recovery is minimal. End Game marks the room ended and
  clients return home when they receive that update.
- The RLS policies **and** the `drawings` Storage bucket policy are intentionally
  temporary for guest playtesting (see "Temporary Storage security compromise"
  above) and should be tightened when Supabase Auth or server-side room tokens
  are introduced.
