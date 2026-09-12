import type { PlayerDrawing, PlayerId } from '@/types/game';

export interface JudgeContext {
  gameId: string;
  roundId: string;
}

export interface JudgeRoundInput {
  prompt: string;
  drawings: PlayerDrawing[];
  /**
   * Milestone 4B: present only for Supabase-backed rounds. Lets a real
   * provider locate both uploaded drawings and judge server-side — the
   * client never handles raw image bytes for this call. Absent in
   * local/fake-only mode, which is how the router picks a provider.
   */
  context?: JudgeContext;
}

export interface JudgePlayerResult {
  playerId: PlayerId;
  score: number;
  recognized: boolean;
  observations: string[];
}

export interface JudgeRoundResult {
  players: JudgePlayerResult[];
  winnerPlayerId: PlayerId;
  comment: string;
  /** Ordered playful cues for the Judge screen's staged suspense reveal. */
  suspenseCues: string[];
}

/**
 * Provider boundary (docs/MVP_ARCHITECTURE.md §Provider Boundary).
 * Real implementation (Milestone 4B): GeminiJudgeProvider, which never talks
 * to Google directly — it calls the `judge-round` Supabase Edge Function.
 */
export interface JudgeProvider {
  judgeRound(input: JudgeRoundInput): Promise<JudgeRoundResult>;
}
