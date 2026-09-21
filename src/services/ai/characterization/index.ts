import { FakeCharacterizationProvider } from './FakeCharacterizationProvider';
import { GeminiCharacterizationProvider } from './GeminiCharacterizationProvider';
import type { CharacterizationInput, CharacterizationProvider, CharacterizationResult } from './CharacterizationProvider';

const fakeProvider = new FakeCharacterizationProvider();
const geminiProvider = new GeminiCharacterizationProvider();

/**
 * Routes to the real Gemini-backed provider when the caller supplies Supabase
 * game/round/player context, and to the local fake provider otherwise.
 * Screens depend only on this router and the shared interface — never on
 * Gemini or the Edge Function directly.
 */
class CharacterizationRouter implements CharacterizationProvider {
  characterize(input: CharacterizationInput): Promise<CharacterizationResult> {
    return input.context ? geminiProvider.characterize(input) : fakeProvider.characterize(input);
  }
}

export const characterizationService: CharacterizationProvider = new CharacterizationRouter();

export {
  CHARACTERIZATION_STYLES,
  isCharacterizationStyle,
  type CharacterizationContext,
  type CharacterizationInput,
  type CharacterizationProvider,
  type CharacterizationResult,
  type CharacterizationStyle,
} from './CharacterizationProvider';
