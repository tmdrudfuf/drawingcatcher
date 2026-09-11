import type { PlayerDrawing, SketchVariant } from '@/types/game';

export interface CharacterizationInput {
  prompt: string;
  drawing: PlayerDrawing;
}

export interface CharacterizationResult {
  sourceSketchVariant: SketchVariant;
  /** Which local characterized asset the Reveal screen should render. */
  characterAsset: SketchVariant;
  /** Traits the characterization asserts it kept. "Preserve first, stylize second." */
  preservedTraits: string[];
  styleNote: string;
}

/**
 * Provider boundary. Real implementations later: GeminiImageProvider, OpenAIImageProvider.
 * Core instruction (docs/TECH_STACK.md §8): preserve silhouette, proportions,
 * strange anatomy and funny mistakes; do not beautify.
 */
export interface CharacterizationProvider {
  characterize(input: CharacterizationInput): Promise<CharacterizationResult>;
}
