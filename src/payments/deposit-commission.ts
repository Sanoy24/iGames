/**
 * Phase 4 — agent deposit commission math (pure, DB-free so it is unit-testable).
 *
 * The receiving agent earns a configured percentage of every credited deposit.
 * Commission is an integer minor-unit value (never floating point), always rounded
 * DOWN so the platform can never over-pay past the deposit itself, and clamped so a
 * misconfigured rate or a non-positive deposit can never produce a negative or
 * runaway credit.
 */
export function computeDepositCommissionMinor(
  depositAmountMinor: number,
  depositCommissionPct: number,
): number {
  if (!Number.isFinite(depositAmountMinor) || depositAmountMinor <= 0) return 0;
  if (!Number.isFinite(depositCommissionPct) || depositCommissionPct <= 0) return 0;
  // Clamp the rate to [0, 100] — commission can never exceed the deposit.
  const pct = Math.min(depositCommissionPct, 100);
  return Math.floor((depositAmountMinor * pct) / 100);
}
