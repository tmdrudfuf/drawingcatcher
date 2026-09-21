import type { PlayerDrawing, SketchVariant } from '@/types/game';

export interface CharacterizationContext {
  gameId: string;
  roundId: string;
  playerId: string;
}

/**
 * Characterization V2 (Milestone 4F). Mirrors
 * supabase/functions/characterize-drawing/prompt.ts's STYLE_KEYS exactly —
 * duplicated here (not imported) because the client and the Deno edge
 * function are separate module-resolution contexts, same reason
 * src/services/ads/admobConfig.ts's constants are duplicated into
 * app.config.ts rather than imported. The server is the sole source of
 * truth for VALUE selection (see selectStyle() there); this is only the
 * shape of what it may return.
 */
export const CHARACTERIZATION_STYLES = [
  'cute',
  'funny',
  'epic',
  'chibi',
  'realistic',
  'anime',
  'pixel_art',
  'crayon',
] as const;

export type CharacterizationStyle = (typeof CHARACTERIZATION_STYLES)[number];

export function isCharacterizationStyle(value: unknown): value is CharacterizationStyle {
  return typeof value === 'string' && (CHARACTERIZATION_STYLES as readonly string[]).includes(value);
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
  /**
   * Milestone 4F (Characterization V2): the server-selected style this
   * image was (or, for a pre-V2 row, was NOT) generated with. The server
   * is the sole authority — this is exposed here as structured data for
   * future UI/analytics, not built into any UI yet. Null for a pre-V2
   * completed characterization (no style was ever persisted for it) or a
   * fake/local result; that is a normal, expected value, not an error.
   */
  style?: CharacterizationStyle | null;
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
