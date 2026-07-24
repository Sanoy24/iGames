import { computeDepositCommissionMinor } from './deposit-commission';

describe('computeDepositCommissionMinor', () => {
  it('takes the configured percentage of the deposit', () => {
    expect(computeDepositCommissionMinor(10_000, 5)).toBe(500);
    expect(computeDepositCommissionMinor(2_000, 10)).toBe(200);
  });

  it('rounds DOWN to whole minor units (never over-pays)', () => {
    // 3% of 199 = 5.97 → 5
    expect(computeDepositCommissionMinor(199, 3)).toBe(5);
    // 1% of 1050 = 10.5 → 10
    expect(computeDepositCommissionMinor(1_050, 1)).toBe(10);
  });

  it('returns 0 when the rate is 0 or negative', () => {
    expect(computeDepositCommissionMinor(10_000, 0)).toBe(0);
    expect(computeDepositCommissionMinor(10_000, -5)).toBe(0);
  });

  it('returns 0 for a non-positive or invalid deposit', () => {
    expect(computeDepositCommissionMinor(0, 5)).toBe(0);
    expect(computeDepositCommissionMinor(-100, 5)).toBe(0);
    expect(computeDepositCommissionMinor(Number.NaN, 5)).toBe(0);
  });

  it('clamps the rate at 100% so commission never exceeds the deposit', () => {
    expect(computeDepositCommissionMinor(10_000, 100)).toBe(10_000);
    expect(computeDepositCommissionMinor(10_000, 150)).toBe(10_000);
  });

  it('never produces a fractional value', () => {
    for (let amt = 1; amt <= 333; amt++) {
      const c = computeDepositCommissionMinor(amt, 7);
      expect(Number.isInteger(c)).toBe(true);
      expect(c).toBeLessThanOrEqual(amt);
    }
  });
});
