/**
 * Resolve the effective referral-commission % for an agent: their own override
 * (`User.referralCommissionPct`) if set, otherwise the global default
 * (`SystemConfig.referralCommissionPct`). Null/undefined override = disabled,
 * fall through to the global default  there is no separate enable/disable flag.
 */
export function resolveReferralCommissionPct(
    agentOverridePct: number | null | undefined,
    globalDefaultPct: number,
): number {
    return agentOverridePct ?? globalDefaultPct;
}

/** Games that pay referral commission. Bingo was first and keeps its own scalar
 * config columns (`SystemConfig.referralCommissionPct` / `User.referralCommissionPct`)
 * for backward compatibility; the other four are configured through the newer
 * `referralCommissionPctByGame` map on both entities. */
export type CommissionGameType = 'bingo' | 'keno' | 'crash' | 'pool' | 'werk';

export type CommissionPctByGame = Partial<
    Record<Exclude<CommissionGameType, 'bingo'>, number>
>;

/**
 * Same resolution as `resolveReferralCommissionPct`, generalized across all 5
 * commission-paying games. Bingo is special-cased to keep reading the original
 * scalar columns unchanged (no migration, no behavior change for existing
 * configured rates); Keno/Crash/Pool/Werk read the newer per-game maps, where a
 * missing key means "no commission configured for this game" (0%).
 */
export function resolveGameReferralCommissionPct(
    game: CommissionGameType,
    agentOverrideMap: CommissionPctByGame | null | undefined,
    agentLegacyScalarPct: number | null | undefined,
    globalMap: CommissionPctByGame | null | undefined,
    globalLegacyScalarPct: number,
): number {
    if (game === 'bingo') {
        return resolveReferralCommissionPct(
            agentLegacyScalarPct,
            globalLegacyScalarPct,
        );
    }
    const agentOverride = agentOverrideMap?.[game] ?? null;
    const globalDefault = globalMap?.[game] ?? 0;
    return agentOverride ?? globalDefault;
}
