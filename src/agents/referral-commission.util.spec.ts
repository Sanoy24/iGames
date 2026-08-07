import { resolveReferralCommissionPct } from './referral-commission.util';

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
