import { supabase, supabaseConfigError } from '@/providers/supabase/supabase';
import type {
  CharacterizationInput,
  CharacterizationProvider,
  CharacterizationResult,
} from './CharacterizationProvider';

interface CharacterizeDrawingResponse {
  characterizedPath?: string;
  reused?: boolean;
  error?: string;
  message?: string;
}

/**
 * Milestone 4A. Real characterization via Gemini — but this class never talks
 * to Google. It only invokes the `characterize-drawing` Supabase Edge
 * Function, which holds the Gemini API key server-side and does the actual
 * download/generate/upload work. If that function is unreachable, errors, or
 * returns no image, this throws and the caller (RevealScreen's
 * characterizeSafely) falls back to a fake result — Gemini failure must never
 * be the only path to a result.
 */
export class GeminiCharacterizationProvider implements CharacterizationProvider {
  async characterize(input: CharacterizationInput): Promise<CharacterizationResult> {
    const ctx = input.context;
    if (!ctx) throw new Error('Gemini characterization requires game/round/player context.');
    if (!supabase) throw new Error(supabaseConfigError ?? 'Supabase is not available.');

    const { data, error } = await supabase.functions.invoke<CharacterizeDrawingResponse>(
      'characterize-drawing',
      { body: { gameId: ctx.gameId, roundId: ctx.roundId, playerId: ctx.playerId, prompt: input.prompt } },
    );
    if (error) throw new Error(error.message);
    if (!data?.characterizedPath) {
      throw new Error(data?.message ?? data?.error ?? 'Gemini characterization returned no image.');
    }

    return {
      sourceSketchVariant: input.drawing.sketchVariant,
      characterAsset: input.drawing.sketchVariant,
      preservedTraits: input.drawing.traits,
      styleNote: 'Gemini 3.1 Flash Image — preserve first, stylize second',
      characterizedImagePath: data.characterizedPath,
    };
  }
}
