import { supabase, supabaseConfigError } from '@/providers/supabase/supabase';
import type { JudgeProvider, JudgeRoundInput, JudgeRoundResult } from './JudgeProvider';

interface JudgeRoundResponse {
  player1Score?: number | null;
  player2Score?: number | null;
  winnerPlayerId?: string | null;
  comment?: string | null;
  player1Reason?: string | null;
  player2Reason?: string | null;
  player1PlayerId?: string | null;
  player2PlayerId?: string | null;
  reused?: boolean;
  error?: string;
  message?: string;
}

/** Generic — real drawings can be anything, unlike the old cat-specific fake cues. */
const SUSPENSE_CUES = [
  'ANALYZING SKETCHES...',
  'COMPARING TO THE PROMPT...',
  'WEIGHING CREATIVITY...',
  'CALCULATING SCORES...',
];

/**
 * Milestone 4B. Real judging via Gemini — but this class never talks to
 * Google. It only invokes the `judge-round` Supabase Edge Function, which
 * holds the Gemini API key server-side, loads both real drawings, and
 * persists the result. If that function is unreachable, errors, or returns
 * an incomplete result, this throws and the caller (JudgeScreen's
 * judgeSafely) falls back to the fake judge — Gemini failure must never be
 * the only path to a result.
 */
export class GeminiJudgeProvider implements JudgeProvider {
  async judgeRound(input: JudgeRoundInput): Promise<JudgeRoundResult> {
    const ctx = input.context;
    if (!ctx) throw new Error('Gemini judging requires game/round context.');
    if (!supabase) throw new Error(supabaseConfigError ?? 'Supabase is not available.');

    const { data, error } = await supabase.functions.invoke<JudgeRoundResponse>('judge-round', {
      body: { gameId: ctx.gameId, roundId: ctx.roundId },
    });
    if (error) throw new Error(error.message);
    if (
      !data ||
      typeof data.player1Score !== 'number' ||
      typeof data.player2Score !== 'number' ||
      !data.winnerPlayerId ||
      !data.player1PlayerId ||
      !data.player2PlayerId
    ) {
      throw new Error(data?.message ?? data?.error ?? 'Gemini judging returned an incomplete result.');
    }

    return {
      players: [
        {
          playerId: data.player1PlayerId,
          score: data.player1Score,
          recognized: true,
          observations: data.player1Reason ? [data.player1Reason] : [],
        },
        {
          playerId: data.player2PlayerId,
          score: data.player2Score,
          recognized: true,
          observations: data.player2Reason ? [data.player2Reason] : [],
        },
      ],
      winnerPlayerId: data.winnerPlayerId,
      comment: data.comment ?? 'The judge has spoken.',
      suspenseCues: SUSPENSE_CUES,
    };
  }
}
