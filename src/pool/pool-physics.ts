import { standardTable } from './engine/table';
import type { TableSpec } from './engine/types';
import type { ShotTuning } from './engine/simulator';

/**
 * Physics tuning captured onto a match at creation time. Stored as plain
 * integers (admin-friendly, DB-backed per CLAUDE.md) and snapshotted per match
 * so that later admin edits never change an in-flight game or break the
 * deterministic replay of a finished one.
 */
export interface PoolPhysicsSnapshot {
  slidingFrictionX100: number; // 0.20 → 20
  rollingFrictionX1000: number; // 0.06 → 60
  cushionReboundPct: number; // restitution 0.82 → 82
  ballReboundPct: number; // restitution 0.94 → 94
  pocketSizePct: number; // pocket radius as % of ball radius (1.90× → 190)
  cueMaxSpeedX100: number; // 6.0 m/s → 600
  maxSideSpin: number; // rad/s at full english
  maxRollSpin: number; // rad/s at full follow/draw
}

// Mirrors the engine's standardTable()/DEFAULT_TUNING so config defaults and the
// engine agree exactly (verified in pool-physics.spec.ts).
export const DEFAULT_PHYSICS: PoolPhysicsSnapshot = {
  slidingFrictionX100: 20,
  rollingFrictionX1000: 12,
  cushionReboundPct: 82,
  ballReboundPct: 94,
  pocketSizePct: 190,
  cueMaxSpeedX100: 600,
  maxSideSpin: 60,
  maxRollSpin: 120,
};

/** Read a snapshot from config, filling any missing field with its default. */
export function snapshotFromConfig(cfg: Partial<PoolPhysicsSnapshot> = {}): PoolPhysicsSnapshot {
  return {
    slidingFrictionX100: cfg.slidingFrictionX100 ?? DEFAULT_PHYSICS.slidingFrictionX100,
    rollingFrictionX1000: cfg.rollingFrictionX1000 ?? DEFAULT_PHYSICS.rollingFrictionX1000,
    cushionReboundPct: cfg.cushionReboundPct ?? DEFAULT_PHYSICS.cushionReboundPct,
    ballReboundPct: cfg.ballReboundPct ?? DEFAULT_PHYSICS.ballReboundPct,
    pocketSizePct: cfg.pocketSizePct ?? DEFAULT_PHYSICS.pocketSizePct,
    cueMaxSpeedX100: cfg.cueMaxSpeedX100 ?? DEFAULT_PHYSICS.cueMaxSpeedX100,
    maxSideSpin: cfg.maxSideSpin ?? DEFAULT_PHYSICS.maxSideSpin,
    maxRollSpin: cfg.maxRollSpin ?? DEFAULT_PHYSICS.maxRollSpin,
  };
}

/** Build the engine table geometry + physics from a snapshot. */
export function buildTable(s: PoolPhysicsSnapshot): TableSpec {
  const base = standardTable();
  return standardTable({
    slidingFriction: s.slidingFrictionX100 / 100,
    rollingFriction: s.rollingFrictionX1000 / 1000,
    cushionRestitution: s.cushionReboundPct / 100,
    ballRestitution: s.ballReboundPct / 100,
    pocketRadius: base.ballRadius * (s.pocketSizePct / 100),
  });
}

/** Build the cue tuning from a snapshot. */
export function buildTuning(s: PoolPhysicsSnapshot): ShotTuning {
  return {
    maxCueSpeed: s.cueMaxSpeedX100 / 100,
    maxSideSpin: s.maxSideSpin,
    maxRollSpin: s.maxRollSpin,
  };
}
