import type { PlayerDrawing, PlayerId } from '@/types/game';

export interface JudgeRoundInput {
  prompt: string;
  drawings: PlayerDrawing[];
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
 * Real implementations later: GeminiJudgeProvider, OpenAIJudgeProvider.
 */
export interface JudgeProvider {
  judgeRound(input: JudgeRoundInput): Promise<JudgeRoundResult>;
}
