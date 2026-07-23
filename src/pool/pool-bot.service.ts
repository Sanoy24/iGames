import { Injectable } from '@nestjs/common';
import { RngService } from '../rng/rng.service';
import { mulberry32 } from './engine/rack';
import { standardTable } from './engine/table';
import { Ball, ShotInput, TableSpec } from './engine/types';
import { PoolBotDifficulty } from './entities/pool-config.entity';
import { GameState, Seat } from './rules/rules-types';
import { ballFamily } from './rules/rules';

/** Per-difficulty aim accuracy (1 = perfect) and worst-case aim jitter (rad). */
const PROFILE: Record<PoolBotDifficulty, { accuracy: number; maxJitter: number }> = {
  easy: { accuracy: 0.55, maxJitter: 0.13 },
  medium: { accuracy: 0.8, maxJitter: 0.07 },
  hard: { accuracy: 0.95, maxJitter: 0.025 },
};

interface Candidate {
  target: Ball;
  aim: number;
  power: number;
  score: number; // lower is better
  pocketIndex: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Computes a shot for the AI opponent in single-player. Uses the ghost-ball
 * method: to sink object ball `T` in pocket `P`, aim the cue at the point one
 * ball-diameter behind `T` along the T→P line. Picks the easiest unobstructed
 * pot, else plays a safe contact on its own group. Aim noise is scaled by
 * difficulty and seeded from the RNG service (never Math.random) so bot play is
 * deterministic + auditable.
 */
@Injectable()
export class PoolBotService {
  constructor(private readonly rngService: RngService) {}

  async computeShot(
    state: GameState,
    botSeat: Seat,
    difficulty: PoolBotDifficulty,
    table: TableSpec = standardTable(),
  ): Promise<ShotInput> {
    const rng = await this.seededRng();
    const profile = PROFILE[difficulty];
    const cue = state.balls.find((b) => b.number === 0 && !b.pocketed);
    if (!cue) return { angle: 0, power: 0.5, spin: { side: 0, vertical: 0 } };

    const onTable = state.balls.filter((b) => !b.pocketed && b.number !== 0);
    const targets = this.legalTargets(onTable, state, botSeat);
    const best = this.bestPot(cue, targets, onTable, table);

    // Ball in hand: pick the placement that yields the best pot, then shoot it.
    if (state.ballInHand) {
      const placed = this.bestPlacement(cue, targets, onTable, table);
      if (placed) {
        const jitter = (rng() * 2 - 1) * profile.maxJitter * (1 - profile.accuracy) * 4;
        // Always call the pocket it's aiming into (required by the 8-ball rule and
        // by strict call-shot mode; harmless for regular balls in casual mode).
        return { angle: placed.pot.aim + jitter, power: placed.pot.power, spin: { side: 0, vertical: 0 }, cuePos: placed.pos, calledPocket: placed.pot.pocketIndex };
      }
    }

    if (best) {
      const jitter = (rng() * 2 - 1) * profile.maxJitter * (1 - profile.accuracy) * 4;
      return { angle: best.aim + jitter, power: best.power, spin: { side: 0, vertical: 0 }, calledPocket: best.pocketIndex };
    }
    return this.safetyShot(cue, targets, rng, profile.maxJitter);
  }

  /** A fresh deterministic PRNG seeded from crypto randomness via the RNG service. */
  private async seededRng(): Promise<() => number> {
    const draw = await this.rngService.drawSeed({});
    return mulberry32(draw.numbers[0]);
  }

  /** The balls the bot may legally strike first this turn. */
  private legalTargets(onTable: Ball[], state: GameState, botSeat: Seat): Ball[] {
    const group = state.groups[botSeat];
    if (state.tableOpen || group === null) {
      return onTable.filter((b) => b.number !== 8); // 8 illegal first on open table
    }
    const own = onTable.filter((b) => ballFamily(b.number) === group);
    return own.length > 0 ? own : onTable.filter((b) => b.number === 8);
  }

  /** Best straight-in pot across all target×pocket pairs, or null if none feasible. */
  private bestPot(cue: Ball, targets: Ball[], onTable: Ball[], table: TableSpec): Candidate | null {
    const R = table.ballRadius;
    let best: Candidate | null = null;

    for (const target of targets) {
      for (let pocketIndex = 0; pocketIndex < table.pockets.length; pocketIndex++) {
        const pocket = table.pockets[pocketIndex];
        const bpx = pocket.x - target.pos.x;
        const bpy = pocket.y - target.pos.y;
        const bpLen = Math.hypot(bpx, bpy);
        if (bpLen < 1e-6) continue;
        const dirBPx = bpx / bpLen;
        const dirBPy = bpy / bpLen;

        // Ghost-ball contact point behind the target along the target→pocket line.
        const ghostX = target.pos.x - dirBPx * 2 * R;
        const ghostY = target.pos.y - dirBPy * 2 * R;

        const cgx = ghostX - cue.pos.x;
        const cgy = ghostY - cue.pos.y;
        const cgLen = Math.hypot(cgx, cgy);
        if (cgLen < 1e-6) continue;
        const aimX = cgx / cgLen;
        const aimY = cgy / cgLen;

        // Cut angle: how square the hit is. <=0 means an impossible (>90°) cut.
        const cutCos = aimX * dirBPx + aimY * dirBPy;
        if (cutCos <= 0.15) continue;

        // Skip if a ball blocks the cue→ghost path or the target→pocket path.
        if (this.segmentBlocked(cue.pos.x, cue.pos.y, ghostX, ghostY, onTable, R, [target.number])) continue;
        if (this.segmentBlocked(target.pos.x, target.pos.y, pocket.x, pocket.y, onTable, R, [target.number])) continue;

        const distance = cgLen + bpLen;
        const score = distance * (2 - cutCos); // prefer square, short cuts
        const power = clamp(0.32 + distance / (table.width * 1.6), 0.32, 0.9);
        if (!best || score < best.score) {
          best = { target, aim: Math.atan2(aimY, aimX), power, score, pocketIndex };
        }
      }
    }
    return best;
  }

  /**
   * With ball in hand, try placing the cue in line behind each target (opposite
   * its pocket) and keep the placement that gives the best straight pot. Only
   * legal spots (inside the cushions, not overlapping a ball) are considered.
   */
  private bestPlacement(
    cue: Ball,
    targets: Ball[],
    onTable: Ball[],
    table: TableSpec,
  ): { pos: { x: number; y: number }; pot: Candidate } | null {
    const R = table.ballRadius;
    let best: { pos: { x: number; y: number }; pot: Candidate } | null = null;

    for (const target of targets) {
      for (const pocket of table.pockets) {
        const bpx = pocket.x - target.pos.x;
        const bpy = pocket.y - target.pos.y;
        const bpLen = Math.hypot(bpx, bpy);
        if (bpLen < 1e-6) continue;
        const dbx = bpx / bpLen, dby = bpy / bpLen;
        // Sit the cue a comfortable distance behind the target, in line with the pocket.
        const pos = {
          x: clamp(target.pos.x - dbx * (2 * R + 6 * R), R, table.width - R),
          y: clamp(target.pos.y - dby * (2 * R + 6 * R), R, table.height - R),
        };
        if (onTable.some((b) => Math.hypot(b.pos.x - pos.x, b.pos.y - pos.y) < 2 * R)) continue;
        const pot = this.bestPot({ ...cue, pos }, targets, onTable, table);
        if (pot && (!best || pot.score < best.pot.score)) best = { pos, pot };
      }
    }
    return best;
  }

  /** True if any ball (except those in `ignore`) lies on the segment a→b. */
  private segmentBlocked(
    ax: number,
    ay: number,
    bx: number,
    by: number,
    balls: Ball[],
    R: number,
    ignore: number[],
  ): boolean {
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    return balls.some((b) => {
      if (ignore.includes(b.number)) return false;
      const t = (b.pos.x - ax) * ux + (b.pos.y - ay) * uy;
      if (t <= 0 || t >= len) return false;
      const px = ax + ux * t;
      const py = ay + uy * t;
      return Math.hypot(b.pos.x - px, b.pos.y - py) < 2 * R;
    });
  }

  private safetyShot(cue: Ball, targets: Ball[], rng: () => number, maxJitter: number): ShotInput {
    let nearest = targets[0];
    let bestD = Infinity;
    for (const t of targets) {
      const d = Math.hypot(t.pos.x - cue.pos.x, t.pos.y - cue.pos.y);
      if (d < bestD) {
        bestD = d;
        nearest = t;
      }
    }
    const angle = nearest
      ? Math.atan2(nearest.pos.y - cue.pos.y, nearest.pos.x - cue.pos.x)
      : 0;
    const jitter = (rng() * 2 - 1) * maxJitter;
    return { angle: angle + jitter, power: 0.5, spin: { side: 0, vertical: 0 } };
  }
}
