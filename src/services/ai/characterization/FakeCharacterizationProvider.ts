import { delay } from '@/utils/delay';
import type {
  CharacterizationInput,
  CharacterizationProvider,
  CharacterizationResult,
} from './CharacterizationProvider';

/**
 * Milestone 1 stand-in. Returns a pointer to a local characterized doodle that
 * keeps the source silhouette — no image generation, no network.
 */
export class FakeCharacterizationProvider implements CharacterizationProvider {
  async characterize(input: CharacterizationInput): Promise<CharacterizationResult> {
    await delay(1400);
    return {
      sourceSketchVariant: input.drawing.sketchVariant,
      characterAsset: input.drawing.sketchVariant,
      preservedTraits: input.drawing.traits,
      styleNote: 'same silhouette — exaggerated, not corrected',
    };
  }
}
