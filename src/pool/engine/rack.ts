import { Ball, BallKind, TableSpec } from './types';
import { footSpot, headSpot } from './table';

/** Deterministic PRNG (mulberry32) — same seed ⇒ same rack, on any platform. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function kindOf(n: number): BallKind {
  if (n === 0) return 'cue';
  if (n === 8) return 'eight';
  return n < 8 ? 'solid' : 'stripe';
}

/** Fisher–Yates shuffle driven by a seeded PRNG (deterministic). */
function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Build a legal 8-ball rack for the given seed:
 *  - apex ball on the foot spot,
 *  - the 8 ball in the centre of the third row,
 *  - the two back corners are one solid and one stripe.
 * Everything else is randomised by the seed. The cue ball is placed on the head
 * spot (or `cuePos` for ball-in-hand later).
 */
export function rackEightBall(table: TableSpec, seed: number): Ball[] {
  const rng = mulberry32(seed);
  const foot = footSpot(table);
  const s = table.ballRadius * 2 * 1.001; // touching, with a hair of clearance
  const rowDx = (s * Math.sqrt(3)) / 2;

  // Row/column layout: rows 0..4 hold 1..5 balls, apex pointing at the head.
  type Slot = { x: number; y: number; row: number; col: number };
  const slots: Slot[] = [];
  for (let row = 0; row <= 4; row++) {
    for (let col = 0; col <= row; col++) {
      slots.push({
        x: foot.x + row * rowDx,
        y: foot.y + (col - row / 2) * s,
        row,
        col,
      });
    }
  }

  // Assign object-ball numbers under the legality constraints.
  const others = shuffle(
    [1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15],
    rng,
  );
  // Ensure the two back-row corners (row 4, col 0 and col 4) differ in type.
  const cornerA = others[0];
  let cornerBIdx = others.findIndex((n, i) => i > 0 && kindOf(n) !== kindOf(cornerA));
  if (cornerBIdx === -1) cornerBIdx = 1;
  const cornerB = others.splice(cornerBIdx, 1)[0];
  others.shift(); // remove cornerA from the front
  const rest = others; // remaining 12 numbers

  const numbers: number[] = new Array(slots.length);
  let restIdx = 0;
  slots.forEach((slot, i) => {
    if (slot.row === 2 && slot.col === 1) {
      numbers[i] = 8; // centre of the third row
    } else if (slot.row === 4 && slot.col === 0) {
      numbers[i] = cornerA;
    } else if (slot.row === 4 && slot.col === 4) {
      numbers[i] = cornerB;
    } else {
      numbers[i] = rest[restIdx++];
    }
  });

  const balls: Ball[] = slots.map((slot, i) => ({
    id: numbers[i],
    number: numbers[i],
    kind: kindOf(numbers[i]),
    pos: { x: slot.x, y: slot.y },
    vel: { x: 0, y: 0 },
    spin: { x: 0, y: 0, z: 0 },
    pocketed: false,
  }));

  const head = headSpot(table);
  balls.unshift({
    id: 0,
    number: 0,
    kind: 'cue',
    pos: { x: head.x, y: head.y },
    vel: { x: 0, y: 0 },
    spin: { x: 0, y: 0, z: 0 },
    pocketed: false,
  });

  return balls;
}
