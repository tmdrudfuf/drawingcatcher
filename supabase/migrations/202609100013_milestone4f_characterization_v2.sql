-- Milestone 4F: Characterization V2 -- 8-style deterministic characterization.
--
-- Prior to this migration, characterize-drawing always applied one fixed
-- style ("playful stylized animated character, friendly but funny") to
-- every submission. V2 replaces that with a compositional prompt (global
-- identity lock + one of 8 style blocks + common output rules) and a
-- server-only, deterministic style selection so the SAME visual variety
-- effect works across retries, reloads, and both Duo devices without any
-- new coordination primitive -- see supabase/functions/characterize-drawing/
-- index.ts's selectStyle() and prompt.ts's buildCharacterizationPrompt().
--
-- Both columns are nullable and purely additive:
--   * characterization_style is set exactly once, atomically, inside the
--     EXISTING claim UPDATE (see the M4A concurrency migration) -- this
--     migration adds no new race window, no new RPC, and no new policy.
--   * characterization_prompt_version lets a future prompt-wording change
--     be distinguished from what an already-generated row was actually
--     produced under, without needing to touch or reinterpret old rows.
-- Existing (pre-V2) completed rows keep NULL for both -- see index.ts for
-- why a NULL style must never trigger regeneration of an existing asset.

alter table public.round_submissions
  add column if not exists characterization_style text
    check (
      characterization_style is null
      or characterization_style in (
        'cute', 'funny', 'epic', 'chibi', 'realistic', 'anime', 'pixel_art', 'crayon'
      )
    ),
  add column if not exists characterization_prompt_version integer;

-- No new index: every read/write here already filters on (round_id,
-- player_id), covered by round_submissions' existing unique constraint
-- (see the M2 base migration) -- same rationale as the M4A concurrency
-- migration's "no new index" note.
