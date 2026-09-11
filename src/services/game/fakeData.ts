import type { Player, PlayerDrawing, RoundSetup } from '@/types/game';

/**
 * Milestone 1 uses fixed local data. Prompts are all cat-themed so the two
 * built-in cat doodles always match the prompt.
 */
export const FAKE_PROMPTS = [
  'Draw a cat',
  'Draw a cat as a superhero',
  'Draw a cat eating pizza',
  'Draw the grumpiest cat',
];

/** Two deliberately different bad drawings — this is the point of the demo. */
const P1_DRAWING: PlayerDrawing = {
  playerId: 'p1',
  sketchVariant: 'p1',
  traits: ['huge oval body', 'tiny legs', 'uneven eyes', 'raised curved tail'],
};

const P2_DRAWING: PlayerDrawing = {
  playerId: 'p2',
  sketchVariant: 'p2',
  traits: ['oversized head', 'small body', 'long thin legs', 'crooked tail', 'surprised face'],
};

export const FAKE_PLAYERS: [Player, Player] = [
  { id: 'p1', name: 'KY', drawing: P1_DRAWING },
  { id: 'p2', name: 'FRIEND', drawing: P2_DRAWING },
];

export function buildRound(roundNumber: number): RoundSetup {
  const prompt = FAKE_PROMPTS[(roundNumber - 1) % FAKE_PROMPTS.length] ?? FAKE_PROMPTS[0]!;
  return { roundNumber, prompt, players: FAKE_PLAYERS };
}
