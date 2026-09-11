import { FakeCharacterizationProvider } from './FakeCharacterizationProvider';
import type { CharacterizationProvider } from './CharacterizationProvider';

export const characterizationService: CharacterizationProvider =
  new FakeCharacterizationProvider();

export type {
  CharacterizationProvider,
  CharacterizationInput,
  CharacterizationResult,
} from './CharacterizationProvider';
