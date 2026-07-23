import { standardTable } from './engine/table';
import { DEFAULT_TUNING } from './engine/simulator';
import { buildTable, buildTuning, DEFAULT_PHYSICS, snapshotFromConfig } from './pool-physics';

describe('pool physics config mapping', () => {
  it('fills missing fields with defaults', () => {
    expect(snapshotFromConfig({})).toEqual(DEFAULT_PHYSICS);
    expect(snapshotFromConfig({ cushionReboundPct: 70 }).cushionReboundPct).toBe(70);
    // untouched fields keep defaults
    expect(snapshotFromConfig({ cushionReboundPct: 70 }).ballReboundPct).toBe(DEFAULT_PHYSICS.ballReboundPct);
  });

  it('defaults reproduce the standard table and tuning', () => {
    const table = buildTable(DEFAULT_PHYSICS);
    const std = standardTable();
    expect(table.cushionRestitution).toBeCloseTo(std.cushionRestitution, 6);
    expect(table.ballRestitution).toBeCloseTo(std.ballRestitution, 6);
    expect(table.rollingFriction).toBeCloseTo(std.rollingFriction, 6);
    expect(table.slidingFriction).toBeCloseTo(std.slidingFriction, 6);

    const tuning = buildTuning(DEFAULT_PHYSICS);
    expect(tuning.maxCueSpeed).toBeCloseTo(DEFAULT_TUNING.maxCueSpeed, 6);
    expect(tuning.maxSideSpin).toBe(DEFAULT_TUNING.maxSideSpin);
    expect(tuning.maxRollSpin).toBe(DEFAULT_TUNING.maxRollSpin);
  });

  it('maps integer config to engine floats', () => {
    const table = buildTable(snapshotFromConfig({ cushionReboundPct: 90, rollingFrictionX1000: 80, pocketSizePct: 200 }));
    expect(table.cushionRestitution).toBeCloseTo(0.9, 6);
    expect(table.rollingFriction).toBeCloseTo(0.08, 6);
    expect(table.pocketRadius).toBeCloseTo(table.ballRadius * 2.0, 6);

    const tuning = buildTuning(snapshotFromConfig({ cueMaxSpeedX100: 750 }));
    expect(tuning.maxCueSpeed).toBeCloseTo(7.5, 6);
  });
});
