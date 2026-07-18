import type { Ball, ShotEvent, ShotResult, TableSpec } from '../engine/types';
import { rackEightBall } from '../engine/rack';
import { footSpot, headSpot } from '../engine/table';
import type {
  BallFamily,
  GameState,
  Group,
  PoolFoul,
  Seat,
  ShotOutcome,
} from './rules-types';

export const otherSeat = (s: Seat): Seat => (s === 'A' ? 'B' : 'A');

export function ballFamily(n: number): BallFamily {
  if (n === 0) return 'cue';
  if (n === 8) return 'eight';
  return n < 8 ? 'solids' : 'stripes';
}

/** Count of a group's object balls still on the table. */
export function ballsRemaining(balls: Ball[], group: Group): number {
  return balls.filter((b) => !b.pocketed && ballFamily(b.number) === group).length;
}

/** Fresh 8-ball game: racked, `breaker` on the break, table open. */
export function newGame(table: TableSpec, seed: number, breaker: Seat = 'A'): GameState {
  return {
    balls: rackEightBall(table, seed),
    turn: breaker,
    groups: { A: null, B: null },
    tableOpen: true,
    ballInHand: false,
    phase: 'break',
    winner: null,
  };
}

/** Time of the cue ball's first contact with an object ball, or null. */
function cueFirstContactTime(events: ShotEvent[]): number | null {
  for (const e of events) {
    if (e.type !== 'ball-ball') continue;
    if (e.ballNumber === 0 || e.otherNumber === 0) return e.t;
  }
  return null;
}

/** Distinct object balls that touched a cushion — used for legal-break test. */
function distinctObjectRailCount(events: ShotEvent[]): number {
  const set = new Set<number>();
  for (const e of events) {
    if (e.type === 'ball-cushion' && e.ballNumber != null && e.ballNumber !== 0) {
      set.add(e.ballNumber);
    }
  }
  return set.size;
}

/** Re-spot a pocketed ball on the foot spot (nudging toward the foot rail if busy). */
function spotBall(balls: Ball[], number: number, table: TableSpec): void {
  const ball = balls.find((b) => b.number === number);
  if (!ball) return;
  const foot = footSpot(table);
  const R = table.ballRadius;
  let x = foot.x;
  const occupied = (px: number, py: number) =>
    balls.some(
      (b) => b !== ball && !b.pocketed && Math.hypot(b.pos.x - px, b.pos.y - py) < 2 * R,
    );
  while (x < table.width - R && occupied(x, foot.y)) x += 2 * R;
  ball.pocketed = false;
  ball.pos = { x, y: foot.y };
  ball.vel = { x: 0, y: 0 };
  ball.spin = { x: 0, y: 0, z: 0 };
}

/** Return the cue ball to the head spot (after a scratch). */
function resetCue(balls: Ball[], table: TableSpec): void {
  const cue = balls.find((b) => b.number === 0);
  if (!cue) return;
  const hs = headSpot(table);
  cue.pocketed = false;
  cue.pos = { x: hs.x, y: hs.y };
  cue.vel = { x: 0, y: 0 };
  cue.spin = { x: 0, y: 0, z: 0 };
}

/**
 * Apply one shot's physics result to the 8-ball rules and produce the next
 * game state. Pure w.r.t. `pre`; the returned state carries `result.balls` as
 * the new board (mutated only for re-spotting the 8 / resetting the cue).
 *
 * Ruleset: WPA-style with common simplifications — any legal pot counts (no
 * call-shot on object balls); the table stays open through the break; groups are
 * assigned on the first post-break shot that pockets exactly one group; the 8 is
 * legal only once the shooter's group is cleared and the shot carries no foul.
 */
export function resolveShot(pre: GameState, result: ShotResult, table: TableSpec): ShotOutcome {
  const board = result.balls;
  const shooter = pre.turn;
  const opp = otherSeat(shooter);
  const pocketedObjects = result.pocketed.filter((n) => n !== 0);
  const scratch = result.scratch;
  const firstContact = result.firstContactNumber;
  const contactT = cueFirstContactTime(result.events);

  const fouls: PoolFoul[] = [];
  let groups = { ...pre.groups };
  let tableOpen = pre.tableOpen;

  // ── BREAK ──────────────────────────────────────────────────────────────────
  if (pre.phase === 'break') {
    // 8 on the break is re-spotted (not a win/loss under WPA).
    if (result.pocketed.includes(8)) spotBall(board, 8, table);

    const railBalls = distinctObjectRailCount(result.events);
    const madeBall = pocketedObjects.some((n) => n !== 8);
    const legalBreak = madeBall || railBalls >= 4;
    if (scratch) fouls.push('scratch');
    if (!legalBreak && !scratch) fouls.push('illegal-break');
    if (scratch) resetCue(board, table);

    const foul = fouls.length > 0;
    let turn = shooter;
    let turnPassed = false;
    let ballInHand = false;
    if (foul) {
      turn = opp;
      turnPassed = true;
      ballInHand = true;
    } else if (!madeBall) {
      turn = opp;
      turnPassed = true;
    }

    const reason = foul
      ? scratch
        ? 'Scratch on the break — ball in hand'
        : 'Illegal break — ball in hand'
      : madeBall
        ? 'Break pocketed a ball — table open, continue'
        : 'Legal break, no ball made — turn passes';

    return {
      state: {
        balls: board,
        turn,
        groups,
        tableOpen: true,
        ballInHand,
        phase: 'play',
        winner: null,
      },
      pocketed: pocketedObjects,
      fouls,
      turnPassed,
      assignedGroups: false,
      gameOver: false,
      winner: null,
      reason,
    };
  }

  // ── FOUL DETECTION (normal play) ────────────────────────────────────────────
  if (scratch) fouls.push('scratch');

  if (firstContact === null) {
    fouls.push('no-contact');
  } else if (tableOpen) {
    if (firstContact === 8) fouls.push('eight-first');
  } else {
    const shooterGroup = groups[shooter]!;
    const onEight = ballsRemaining(pre.balls, shooterGroup) === 0;
    if (onEight) {
      if (firstContact !== 8) fouls.push('wrong-ball-first');
    } else if (ballFamily(firstContact) !== shooterGroup) {
      fouls.push('wrong-group-first');
    }
  }

  // After legal contact, a ball must be pocketed or driven to a rail.
  if (firstContact !== null) {
    const railAfter =
      contactT != null &&
      result.events.some((e) => e.type === 'ball-cushion' && e.t >= contactT);
    if (result.pocketed.length === 0 && !railAfter) fouls.push('no-rail');
  }

  // ── 8-BALL POCKETED → game over ─────────────────────────────────────────────
  if (result.pocketed.includes(8)) {
    const foul = fouls.length > 0;
    const shooterGroup = groups[shooter];
    const cleared = shooterGroup !== null && ballsRemaining(board, shooterGroup) === 0;
    const legal8 = !tableOpen && shooterGroup !== null && cleared && !foul;
    const winner = legal8 ? shooter : opp;
    if (scratch) resetCue(board, table);
    return {
      state: {
        balls: board,
        turn: winner,
        groups,
        tableOpen,
        ballInHand: false,
        phase: 'gameover',
        winner,
      },
      pocketed: pocketedObjects,
      fouls,
      turnPassed: false,
      assignedGroups: false,
      gameOver: true,
      winner,
      reason: legal8
        ? `${shooter} legally pockets the 8 — ${shooter} wins`
        : foul
          ? `8 pocketed on a foul — ${opp} wins`
          : `8 pocketed too early — ${opp} wins`,
    };
  }

  // ── GROUP ASSIGNMENT (open table, clean shot) ───────────────────────────────
  let assignedGroups = false;
  if (tableOpen && fouls.length === 0 && pocketedObjects.length > 0) {
    const madeSolids = pocketedObjects.some((n) => n < 8);
    const madeStripes = pocketedObjects.some((n) => n > 8);
    if (madeSolids && !madeStripes) {
      groups = { ...groups, [shooter]: 'solids', [opp]: 'stripes' } as GameState['groups'];
      tableOpen = false;
      assignedGroups = true;
    } else if (madeStripes && !madeSolids) {
      groups = { ...groups, [shooter]: 'stripes', [opp]: 'solids' } as GameState['groups'];
      tableOpen = false;
      assignedGroups = true;
    }
    // Both groups pocketed → table stays open.
  }

  // ── CONTINUATION ────────────────────────────────────────────────────────────
  const foul = fouls.length > 0;
  let turn = shooter;
  let turnPassed = false;
  let ballInHand = false;
  if (foul) {
    turn = opp;
    turnPassed = true;
    ballInHand = true;
  } else {
    const ownGroup = groups[shooter];
    const pocketedOwn =
      ownGroup !== null
        ? pocketedObjects.some((n) => ballFamily(n) === ownGroup)
        : pocketedObjects.length > 0; // still open (made both groups) → keep shooting
    if (!pocketedOwn) {
      turn = opp;
      turnPassed = true;
    }
  }
  if (scratch) resetCue(board, table);

  const reason = foul
    ? `Foul (${fouls.join(', ')}) — ${opp} ball in hand`
    : assignedGroups
      ? `${shooter} takes ${groups[shooter]} and continues`
      : turnPassed
        ? `No ball made — turn passes to ${opp}`
        : `${shooter} pockets and continues`;

  return {
    state: {
      balls: board,
      turn,
      groups,
      tableOpen,
      ballInHand,
      phase: 'play',
      winner: null,
    },
    pocketed: pocketedObjects,
    fouls,
    turnPassed,
    assignedGroups,
    gameOver: false,
    winner: null,
    reason,
  };
}
