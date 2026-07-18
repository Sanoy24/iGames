import type { TableSpec } from './types';
import type { Vec2 } from './vec';

/**
 * Standard regulation 9-foot table in SI units. Values are physically plausible
 * and tuned for a comfortable, realistic feel; every one is overridable so rooms
 * can later expose "fast cloth" / "slow cloth" style variants via DB config.
 */
export function standardTable(overrides: Partial<TableSpec> = {}): TableSpec {
  const width = 2.54; // 100" playing surface
  const height = 1.27; // 50"
  const ballRadius = 0.028575; // 2.25" diameter
  const pockets: Vec2[] = [
    { x: 0, y: 0 },
    { x: width / 2, y: 0 },
    { x: width, y: 0 },
    { x: 0, y: height },
    { x: width / 2, y: height },
    { x: width, y: height },
  ];
  const base: TableSpec = {
    width,
    height,
    ballRadius,
    ballMass: 0.17,
    pocketRadius: ballRadius * 1.9,
    pockets,
    gravity: 9.8,
    slidingFriction: 0.2,
    rollingFriction: 0.012,
    spinDecay: 4.5,
    cushionRestitution: 0.82,
    ballRestitution: 0.94,
    cushionSpinFactor: 0.35,
  };
  return { ...base, ...overrides };
}

/** Head spot (where the cue ball breaks from), on the long axis, 1/4 in. */
export function headSpot(table: TableSpec): Vec2 {
  return { x: table.width * 0.25, y: table.height / 2 };
}

/** Foot spot (apex of the rack), 3/4 up the long axis. */
export function footSpot(table: TableSpec): Vec2 {
  return { x: table.width * 0.75, y: table.height / 2 };
}
