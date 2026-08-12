import {
  resolveReferralCommissionPct,
  resolveGameReferralCommissionPct,
} from './referral-commission.util';

describe('resolveReferralCommissionPct', () => {
  it('uses the agent override when set', () => {
    expect(resolveReferralCommissionPct(35, 40)).toBe(35);
  });

  it('falls back to the global default when the override is null', () => {
    expect(resolveReferralCommissionPct(null, 40)).toBe(40);
  });

  it('falls back to the global default when the override is undefined', () => {
    expect(resolveReferralCommissionPct(undefined, 40)).toBe(40);
  });

  it('allows an explicit 0 override to win over a nonzero global default', () => {
    expect(resolveReferralCommissionPct(0, 40)).toBe(0);
  });
});

describe('resolveGameReferralCommissionPct', () => {
  it('bingo reads the legacy scalar columns, ignoring the per-game maps entirely', () => {
    expect(
      resolveGameReferralCommissionPct('bingo', { keno: 99 }, null, { keno: 1 }, 40),
    ).toBe(40);
    expect(
      resolveGameReferralCommissionPct('bingo', { keno: 99 }, 35, { keno: 1 }, 40),
    ).toBe(35);
  });

  it('non-bingo games use the agent per-game override when set', () => {
    expect(
      resolveGameReferralCommissionPct('keno', { keno: 12 }, null, { keno: 5 }, 40),
    ).toBe(12);
  });

  it('non-bingo games fall back to the global per-game default when no override key exists', () => {
    expect(
      resolveGameReferralCommissionPct('crash', {}, null, { crash: 7 }, 40),
    ).toBe(7);
    expect(
      resolveGameReferralCommissionPct('crash', null, null, { crash: 7 }, 40),
    ).toBe(7);
  });

  it('non-bingo games with no map entry anywhere resolve to 0, never the bingo scalar', () => {
    expect(
      resolveGameReferralCommissionPct('werk', null, null, null, 40),
    ).toBe(0);
  });

  it('an explicit 0 override wins over a nonzero global default for a non-bingo game', () => {
    expect(
      resolveGameReferralCommissionPct('pool', { pool: 0 }, null, { pool: 25 }, 40),
    ).toBe(0);
  });
});
