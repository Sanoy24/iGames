import { Ball, ShotEvent, ShotInput, ShotResult, TableSpec } from './types';
import { zCross } from './vec';

/**
 * Cue tuning — maps the normalized shot inputs (power 0–1, spin -1..1) to real
 * physical quantities. Exposed so rooms can later tune "cue power" via config.
 */
export interface ShotTuning {
  /** Cue-ball speed at full power (m/s). */
  maxCueSpeed: number;
  /** Vertical-axis english at full side (rad/s). */
  maxSideSpin: number;
  /** Follow/draw spin at full vertical (rad/s). */
  maxRollSpin: number;
}

export const DEFAULT_TUNING: ShotTuning = {
  maxCueSpeed: 6.0,
  maxSideSpin: 60,
  maxRollSpin: 120,
};

export interface SimOptions {
  /** Fixed physics timestep (s). Smaller = more accurate, more steps. */
  timestep?: number;
  /** Safety cap so a shot always terminates. */
  maxSteps?: number;
  tuning?: ShotTuning;
}

const SLIP_EPS = 0.01; // below this contact-slip we treat the ball as rolling
const V_STOP = 0.01; // linear speed below which a ball is parked
const Z_STOP = 0.5; // english below which spin is considered gone

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Set the cue ball's launch velocity and spin from a shot's inputs. */
export function applyShot(balls: Ball[], input: ShotInput, tuning: ShotTuning): void {
  const cue = balls.find((b) => b.number === 0 && !b.pocketed);
  if (!cue) return;
  if (input.cuePos) cue.pos = { x: input.cuePos.x, y: input.cuePos.y };

  const speed = clamp(input.power, 0, 1) * tuning.maxCueSpeed;
  const dir = { x: Math.cos(input.angle), y: Math.sin(input.angle) };
  cue.vel = { x: dir.x * speed, y: dir.y * speed };

  // Side english about the vertical axis.
  cue.spin.z = clamp(input.spin.side, -1, 1) * tuning.maxSideSpin;

  // Follow (+) / draw (−) is roll spin about the axis perpendicular to travel.
  const rollAxis = zCross(dir);
  const rs = clamp(input.spin.vertical, -1, 1) * tuning.maxRollSpin;
  cue.spin.x = rollAxis.x * rs;
  cue.spin.y = rollAxis.y * rs;
}

/**
 * Advance the world by one fixed timestep: integrate friction + spin, then
 * resolve ball-ball collisions, pocket captures, and cushion bounces. Pushes any
 * events onto `events` with the supplied time `t`. Pure w.r.t. inputs — the same
 * ball state and dt always produce the same next state.
 */
function step(
  balls: Ball[],
  table: TableSpec,
  dt: number,
  t: number,
  events: ShotEvent[],
  pocketedOrder: number[],
): void {
  const R = table.ballRadius;
  const g = table.gravity;

  // ── 1. Integrate motion (friction, spin), then move ──────────────────────
  for (const b of balls) {
    if (b.pocketed) continue;

    // Contact-point slip velocity: u = v + ω × (0,0,−R) = (vx − ωy R, vy + ωx R)
    const ux = b.vel.x - b.spin.y * R;
    const uy = b.vel.y + b.spin.x * R;
    const uMag = Math.hypot(ux, uy);

    if (uMag > SLIP_EPS) {
      // Sliding: kinetic friction opposes slip and applies a torque at contact.
      const uhx = ux / uMag;
      const uhy = uy / uMag;
      const a = table.slidingFriction * g;
      b.vel.x -= a * uhx * dt;
      b.vel.y -= a * uhy * dt;
      const angFactor = (5 * table.slidingFriction * g) / (2 * R);
      b.spin.x += -uhy * angFactor * dt;
      b.spin.y += uhx * angFactor * dt;
    } else {
      // Rolling: light rolling resistance, and lock spin to the roll constraint.
      const speed = Math.hypot(b.vel.x, b.vel.y);
      if (speed > V_STOP) {
        const rr = table.rollingFriction * g;
        b.vel.x -= (rr * b.vel.x) / speed * dt;
        b.vel.y -= (rr * b.vel.y) / speed * dt;
      } else {
        b.vel.x = 0;
        b.vel.y = 0;
      }
      // ω = (ẑ × v) / R
      b.spin.x = -b.vel.y / R;
      b.spin.y = b.vel.x / R;
    }

    // English about the vertical axis simply decays.
    const dz = table.spinDecay * dt;
    b.spin.z = Math.abs(b.spin.z) <= dz ? 0 : b.spin.z - Math.sign(b.spin.z) * dz;

    b.pos.x += b.vel.x * dt;
    b.pos.y += b.vel.y * dt;
  }

  // ── 2. Ball-ball collisions ──────────────────────────────────────────────
  const minDist = 2 * R;
  for (let i = 0; i < balls.length; i++) {
    const bi = balls[i];
    if (bi.pocketed) continue;
    for (let j = i + 1; j < balls.length; j++) {
      const bj = balls[j];
      if (bj.pocketed) continue;
      const dx = bj.pos.x - bi.pos.x;
      const dy = bj.pos.y - bi.pos.y;
      const dist = Math.hypot(dx, dy);
      if (dist >= minDist || dist === 0) continue;

      const nx = dx / dist;
      const ny = dy / dist;
      // Positional de-overlap, split evenly.
      const overlap = (minDist - dist) / 2;
      bi.pos.x -= nx * overlap;
      bi.pos.y -= ny * overlap;
      bj.pos.x += nx * overlap;
      bj.pos.y += ny * overlap;

      // Normal-direction elastic impulse (equal masses).
      const vn = (bi.vel.x - bj.vel.x) * nx + (bi.vel.y - bj.vel.y) * ny;
      if (vn > 0) {
        const jimp = ((1 + table.ballRestitution) * vn) / 2;
        bi.vel.x -= jimp * nx;
        bi.vel.y -= jimp * ny;
        bj.vel.x += jimp * nx;
        bj.vel.y += jimp * ny;
        events.push({
          type: 'ball-ball',
          t,
          ballId: bi.id,
          ballNumber: bi.number,
          otherId: bj.id,
          otherNumber: bj.number,
        });
      }
    }
  }

  // ── 3. Pocket capture ────────────────────────────────────────────────────
  for (const b of balls) {
    if (b.pocketed) continue;
    for (let p = 0; p < table.pockets.length; p++) {
      const pk = table.pockets[p];
      if (Math.hypot(b.pos.x - pk.x, b.pos.y - pk.y) < table.pocketRadius) {
        b.pocketed = true;
        b.vel = { x: 0, y: 0 };
        b.spin = { x: 0, y: 0, z: 0 };
        pocketedOrder.push(b.number);
        events.push({
          type: b.number === 0 ? 'scratch' : 'pocket',
          t,
          ballId: b.id,
          ballNumber: b.number,
          pocketIndex: p,
        });
        break;
      }
    }
  }

  // ── 4. Cushion bounces (skip near a pocket mouth) ────────────────────────
  const mouth = table.pocketRadius * 1.2;
  for (const b of balls) {
    if (b.pocketed) continue;
    const nearPocket = table.pockets.some(
      (pk) => Math.hypot(b.pos.x - pk.x, b.pos.y - pk.y) < mouth,
    );
    if (nearPocket) continue;

    let bounced = false;
    const e = table.cushionRestitution;
    if (b.pos.x < R && b.vel.x < 0) {
      b.pos.x = R;
      b.vel.x = -b.vel.x * e;
      b.vel.y += table.cushionSpinFactor * b.spin.z; // english off the rail
      b.spin.z *= 0.6;
      bounced = true;
    } else if (b.pos.x > table.width - R && b.vel.x > 0) {
      b.pos.x = table.width - R;
      b.vel.x = -b.vel.x * e;
      b.vel.y -= table.cushionSpinFactor * b.spin.z;
      b.spin.z *= 0.6;
      bounced = true;
    }
    if (b.pos.y < R && b.vel.y < 0) {
      b.pos.y = R;
      b.vel.y = -b.vel.y * e;
      b.vel.x -= table.cushionSpinFactor * b.spin.z;
      b.spin.z *= 0.6;
      bounced = true;
    } else if (b.pos.y > table.height - R && b.vel.y > 0) {
      b.pos.y = table.height - R;
      b.vel.y = -b.vel.y * e;
      b.vel.x += table.cushionSpinFactor * b.spin.z;
      b.spin.z *= 0.6;
      bounced = true;
    }
    if (bounced) {
      events.push({ type: 'ball-cushion', t, ballId: b.id, ballNumber: b.number });
    }
  }
}

/** True once every ball on the table has effectively stopped. */
function allAtRest(balls: Ball[]): boolean {
  for (const b of balls) {
    if (b.pocketed) continue;
    if (Math.hypot(b.vel.x, b.vel.y) >= V_STOP) return false;
    if (Math.abs(b.spin.z) >= Z_STOP) return false;
  }
  return true;
}

/**
 * Run a full shot to rest and return the authoritative result. Deterministic:
 * identical `balls` + `input` + `table` always yield identical events and final
 * positions, which is exactly what lets the server verify a client's shot and
 * replay a whole match from its logged inputs.
 *
 * NOTE: `balls` is deep-copied, so the caller's array is not mutated.
 */
export function runShot(
  balls: Ball[],
  input: ShotInput,
  table: TableSpec,
  opts: SimOptions = {},
): ShotResult {
  const dt = opts.timestep ?? 0.001;
  const maxSteps = opts.maxSteps ?? 60_000;
  const tuning = opts.tuning ?? DEFAULT_TUNING;

  const world: Ball[] = balls.map((b) => ({
    ...b,
    pos: { ...b.pos },
    vel: { ...b.vel },
    spin: { ...b.spin },
  }));

  applyShot(world, input, tuning);

  const events: ShotEvent[] = [];
  const pocketedOrder: number[] = [];
  let t = 0;
  let steps = 0;
  while (steps < maxSteps && !allAtRest(world)) {
    step(world, table, dt, t, events, pocketedOrder);
    t += dt;
    steps++;
  }

  const scratch = pocketedOrder.includes(0);
  let firstContactNumber: number | null = null;
  for (const ev of events) {
    if (ev.type !== 'ball-ball') continue;
    if (ev.ballNumber === 0) {
      firstContactNumber = ev.otherNumber ?? null;
      break;
    }
    if (ev.otherNumber === 0) {
      firstContactNumber = ev.ballNumber ?? null;
      break;
    }
  }

  return {
    events,
    balls: world,
    pocketed: pocketedOrder,
    scratch,
    firstContactNumber,
    steps,
    duration: t,
  };
}
