import type { PlayerDrawing, SketchVariant } from '@/types/game';

export interface CharacterizationContext {
  gameId: string;
  roundId: string;
  playerId: string;
}

export interface CharacterizationInput {
  prompt: string;
  drawing: PlayerDrawing;
  /**
   * Milestone 4A: present only for Supabase-backed rounds. Lets a real
   * provider locate the uploaded drawing and write its output server-side —
   * the client never handles raw image bytes for this call. Absent in
   * local/fake-only mode, which is how the router below picks a provider.
   */
  context?: CharacterizationContext;
}

export interface CharacterizationResult {
  sourceSketchVariant: SketchVariant;
  /** Local doodle asset to fall back to when no real image is available. */
  characterAsset: SketchVariant;
  /** Traits the characterization asserts it kept. "Preserve first, stylize second." */
  preservedTraits: string[];
  styleNote: string;
  /**
   * Milestone 4A: Supabase Storage path (in the `characterized` bucket) of the
   * real Gemini-generated PNG. Null/absent for fake results or a failed
   * real-characterization attempt (the fallback result still satisfies this
   * interface — screens can render `characterAsset` instead).
   */
  characterizedImagePath?: string | null;
}

/**
 * Provider boundary. Real implementation (Milestone 4A): GeminiCharacterizationProvider,
 * which never talks to Google directly — it calls the `characterize-drawing`
 * Supabase Edge Function. Core instruction (docs/TECH_STACK.md §8): preserve
 * silhouette, proportions, strange anatomy and funny mistakes; do not beautify.
 */
export interface CharacterizationProvider {
  characterize(input: CharacterizationInput): Promise<CharacterizationResult>;
}
