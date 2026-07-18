import { Ball } from '../engine/types';

/** The two seats in a head-to-head match. */
export type Seat = 'A' | 'B';

/** A player's assigned ball group in 8-ball. */
export type Group = 'solids' | 'stripes';

/** Which family a ball number belongs to. */
export type BallFamily = 'cue' | 'solids' | 'stripes' | 'eight';

/** Foul categories the rules engine can flag on a shot. */
export type PoolFoul =
  | 'scratch' // cue ball pocketed or driven off table
  | 'no-contact' // cue ball hit nothing
  | 'wrong-group-first' // first contact was not the shooter's group
  | 'eight-first' // hit the 8 first while it was not legal
  | 'wrong-ball-first' // on the 8, but hit something else first
  | 'no-rail' // after contact, no ball pocketed and none reached a rail
  | 'illegal-break'; // break neither pocketed a ball nor drove 4 to a rail

export type GamePhase = 'break' | 'play' | 'gameover';

/**
 * Full authoritative state of one 8-ball game. `balls` is the board *as it
 * currently stands* (before the next shot). The rules engine consumes this plus
 * a physics `ShotResult` and returns the next `GameState`.
 */
export interface GameState {
  balls: Ball[];
  turn: Seat;
  groups: { A: Group | null; B: Group | null };
  /** True until groups are assigned (i.e. right after the break). */
  tableOpen: boolean;
  /** The player at `turn` may place the cue ball anywhere before shooting. */
  ballInHand: boolean;
  phase: GamePhase;
  winner: Seat | null;
}

/** The result of applying one shot's physics to the rules. */
export interface ShotOutcome {
  state: GameState;
  /** Object balls (excluding the cue) pocketed on this shot, in drop order. */
  pocketed: number[];
  fouls: PoolFoul[];
  /** True if the turn moved to the opponent. */
  turnPassed: boolean;
  /** Groups were assigned on this very shot. */
  assignedGroups: boolean;
  gameOver: boolean;
  winner: Seat | null;
  /** Human-readable one-line summary for logs / the client feed. */
  reason: string;
}
