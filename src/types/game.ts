/**
 * Core game domain types shared across features.
 * Milestone 1 uses fake, local data only — see src/services/game/fakeData.ts.
 */

export type PlayerId = string;

/** Which built-in doodle a fake drawing renders as. Deliberately two distinct cats. */
export type SketchVariant = 'p1' | 'p2';

/**
 * The abstract "drawing" a player submits. In M1 this is a fake descriptor;
 * later milestones replace it with an uploaded image reference. Screens and the
 * AI services only ever see this shape — never a canvas or raw strokes.
 */
export interface PlayerDrawing {
  playerId: PlayerId;
  sketchVariant: SketchVariant;
  /** Human-readable quirks — the imperfections that must survive characterization. */
  traits: string[];
  /**
   * Milestone 3: Supabase Storage object path of the player's real exported PNG,
   * e.g. `games/{gameId}/rounds/{roundId}/{playerId}.png`. Null until the asset
   * has been uploaded. Local/fake M1 rounds leave this undefined.
   */
  drawingPath?: string | null;
}

export interface Player {
  id: PlayerId;
  name: string;
  drawing: PlayerDrawing;
}

/** Mirrors the round status vocabulary in docs/TECH_STACK.md §5. */
export type RoundPhase =
  | 'prompt'
  | 'drawing'
  | 'judging'
  | 'results'
  | 'characterizing'
  | 'reveal'
  | 'complete';

export interface RoundSetup {
  roundNumber: number;
  prompt: string;
  players: [Player, Player];
}
