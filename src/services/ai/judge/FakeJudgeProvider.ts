import { delay } from '@/utils/delay';
import type { JudgeProvider, JudgeRoundInput, JudgeRoundResult } from './JudgeProvider';

/** Playful game-host cues, shown one at a time on the Judge screen. */
const SUSPENSE_CUES = [
  'CAT DETECTED ✓',
  'TINY LEGS DETECTED...',
  'ANATOMY: QUESTIONABLE',
  'ARTISTIC CONFIDENCE: SOMEHOW HIGH',
];

/**
 * Milestone 1 stand-in for a real vendor. Simulates latency and returns a
 * fixed, funny verdict. No network, no keys.
 */
export class FakeJudgeProvider implements JudgeProvider {
  async judgeRound(input: JudgeRoundInput): Promise<JudgeRoundResult> {
    await delay(1800);
    const [first, second] = input.drawings;
    return {
      players: [
        {
          playerId: first?.playerId ?? 'p1',
          score: 87,
          recognized: true,
          observations: ['cat detected', 'tiny legs', 'raised curved tail'],
        },
        {
          playerId: second?.playerId ?? 'p2',
          score: 74,
          recognized: true,
          observations: ['cat detected', 'unusually long legs', 'surprised face'],
        },
      ],
      winnerPlayerId: first?.playerId ?? 'p1',
      comment: 'Those tiny legs somehow made the cat more powerful.',
      suspenseCues: SUSPENSE_CUES,
    };
  }
}
