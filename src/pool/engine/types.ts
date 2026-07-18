import type { Vec2, Vec3 } from './vec';

/**
 * A ball's kind in 8-ball. `cue` is the white; `eight` is the black; the rest
 * are `solid` (1–7) or `stripe` (9–15).
 */
export type BallKind = 'cue' | 'solid' | 'stripe' | 'eight';

export interface Ball {
  /** Stable id; the cue ball is always id 0, ball number 0. */
  id: number;
  number: number; // 0 = cue, 1–15 object balls, 8 = eight
  kind: BallKind;
  pos: Vec2;
  vel: Vec2;
  /** Angular velocity (rad/s). x,y = rolling axes on the cloth; z = english. */
  spin: Vec3;
  pocketed: boolean;
}

/**
 * Physical table + ball parameters, in SI units (metres, kilograms, seconds).
 * Everything the simulation needs is here so nothing is hardcoded in the maths.
 * Later these map to DB-backed config so rooms can tune felt speed etc.
 */
export interface TableSpec {
  /** Playing-surface dimensions (cushion nose to cushion nose), metres. */
  width: number; // long axis (x)
  height: number; // short axis (y)
  ballRadius: number;
  ballMass: number;
  /** Capture radius of a pocket, measured from its centre. */
  pocketRadius: number;
  /** Pocket centres (6): 4 corners + 2 side. */
  pockets: Vec2[];
  gravity: number;
  /** Coefficient of sliding friction (ball skidding on cloth). */
  slidingFriction: number;
  /** Coefficient of rolling resistance (ball rolling naturally). */
  rollingFriction: number;
  /** Decay rate of vertical-axis english per second. */
  spinDecay: number;
  /** Cushion energy return along the normal (0–1). */
  cushionRestitution: number;
  /** Ball-to-ball energy return along the contact normal (0–1). */
  ballRestitution: number;
  /** How strongly english pushes the ball sideways off a cushion. */
  cushionSpinFactor: number;
}

export interface ShotSpin {
  /** Side english: -1 (full left) … +1 (full right). */
  side: number;
  /** Vertical: +1 (full follow / top) … -1 (full draw / bottom). */
  vertical: number;
}

/**
 * A single shot's inputs — the ONLY thing a client sends to the server. The
 * server replays these through the deterministic engine to get the authoritative
 * result, so a modified client cannot fake an outcome.
 */
export interface ShotInput {
  /** Aim direction the cue ball travels, radians. */
  angle: number;
  /** Cue power, 0–1, mapped to an initial speed by the engine. */
  power: number;
  spin: ShotSpin;
  /** Optional cue-ball placement for break / ball-in-hand. */
  cuePos?: Vec2;
}

export type ShotEventType =
  | 'ball-ball'
  | 'ball-cushion'
  | 'pocket'
  | 'scratch'; // cue ball pocketed

export interface ShotEvent {
  type: ShotEventType;
  /** Simulation time of the event, seconds from shot start. */
  t: number;
  /** Primary ball involved (e.g. the ball pocketed, or first in a collision). */
  ballId?: number;
  ballNumber?: number;
  /** Second ball for `ball-ball`. */
  otherId?: number;
  otherNumber?: number;
  /** Pocket index for `pocket` / `scratch`. */
  pocketIndex?: number;
}

export interface ShotResult {
  events: ShotEvent[];
  balls: Ball[];
  /** Numbers of balls pocketed this shot, in the order they dropped. */
  pocketed: number[];
  /** True if the cue ball was pocketed (scratch). */
  scratch: boolean;
  /** First object ball the cue ball contacted (for foul detection). null if none. */
  firstContactNumber: number | null;
  steps: number;
  duration: number;
}
