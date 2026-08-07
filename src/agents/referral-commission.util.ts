/**
 * Resolve the effective referral-commission % for an agent: their own override
 * (`User.referralCommissionPct`) if set, otherwise the global default
 * (`SystemConfig.referralCommissionPct`). Null/undefined override = disabled,
 * fall through to the global default — there is no separate enable/disable flag.
 */
export function resolveReferralCommissionPct(
  agentOverridePct: number | null | undefined,
  globalDefaultPct: number,
): number {
  return agentOverridePct ?? globalDefaultPct;
}
