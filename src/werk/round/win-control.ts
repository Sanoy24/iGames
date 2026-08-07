import type { WinMode } from '../sim';

/**
 * Multiplayer win control for a shared Werk round.
 *
 * Unlike the original single-human house edge, a shared round can hold several
 * real players at different onboarding stages plus house bots, all ranked
 * together. We never rewrite a HUMAN's collected coin value (that would be
 * visible and unfair to paying players)  the only lever is the BOTS' final coin
 * values. By raising or capping bots we can force a human out of the paying
 * ranks (a "loss") or guarantee they beat every bot (a "win").
 *
 * All randomness (margins, ordering) is supplied by the caller as a seeded `rng`
 * so the caller can draw it from the RNG service and keep the whole decision
 * auditable. This module is pure and unit-tested directly.
 */

export type WinRequirement = 'win' | 'lose' | 'neutral';

export interface RoundHuman {
    /** Stable key (participant id) used in the returned per-human map. */
    key: string;
    coinValue: number;
    reachedCenter: boolean;
    /** Settled Werk games this user has already played (drives onboarding). */
    gamesPlayed: number;
}

export interface RoundBot {
    id: number;
    coinValue: number;
    reachedCenter: boolean;
}

export interface WinControlOptions {
    mode: WinMode;
    /** Bots actually play this round (false once real players hit the threshold). */
    botsEnabled: boolean;
    /** Number of REAL players in the round. */
    realPlayers: number;
    /** How many ranks pay a prize (payout multiplier > 0). At least 1. */
    payingRanks: number;
    /** Total coin value in the maze  every boost is clamped to this. */
    poolTotal: number;
    onboardingEnabled: boolean;
    onboardingBotWinGames: number;
    onboardingUserWinGames: number;
    winControlEnabled: boolean;
    houseGuaranteedBelowPlayers: number;
    /** True when the periodic "force a bot win" counter fires this round. */
    periodicForceLose: boolean;
}

export interface WinControlResult {
    bots: RoundBot[];
    forced: boolean;
    perHuman: Record<string, WinRequirement>;
}

/** Onboarding stage for one human, before house rules are layered on. */
function onboardingRequirement(
    h: RoundHuman,
    o: WinControlOptions,
): WinRequirement {
    if (!o.onboardingEnabled) return 'neutral';
    if (h.gamesPlayed < o.onboardingBotWinGames) return 'lose';
    if (h.gamesPlayed < o.onboardingBotWinGames + o.onboardingUserWinGames)
        return 'win';
    return 'neutral';
}

/**
 * Decide each human's requirement and reshape the bots' coin values to satisfy
 * it as best as possible. Deterministic given `rng`.
 */
export function applyRoundWinControl(
    rng: () => number,
    humans: RoundHuman[],
    bots: RoundBot[],
    o: WinControlOptions,
): WinControlResult {
    const perHuman: Record<string, WinRequirement> = {};
    for (const h of humans) perHuman[h.key] = 'neutral';

    // No bots to steer with → pure competition, nothing to force.
    if (!o.botsEnabled || bots.length === 0) {
        return { bots, forced: false, perHuman };
    }

    const smallRound =
        o.winControlEnabled && o.realPlayers < o.houseGuaranteedBelowPlayers;

    for (const h of humans) {
        let req = onboardingRequirement(h, o);
        // House rules only ever turn a NEUTRAL human into a forced loss; they never
        // override an onboarding 'win' (the user's promised early win takes priority).
        if (
            req === 'neutral' &&
            o.winControlEnabled &&
            (smallRound || o.periodicForceLose)
        ) {
            req = 'lose';
        }
        perHuman[h.key] = req;
    }

    const winHumans = humans.filter((h) => perHuman[h.key] === 'win');
    const loseHumans = humans.filter((h) => perHuman[h.key] === 'lose');
    if (winHumans.length === 0 && loseHumans.length === 0) {
        return { bots, forced: false, perHuman };
    }

    const out = bots.map((b) => ({ ...b }));
    const clamp = (v: number) => Math.max(0, Math.min(o.poolTotal, v));
    // Bots eligible in Mode B must be marked as having reached the center.
    const markReached = (b: RoundBot) => {
        if (o.mode === 'B') b.reachedCenter = true;
    };

    const winFloor = winHumans.length
        ? Math.min(...winHumans.map((h) => h.coinValue))
        : null;
    const loseCeil = loseHumans.length
        ? Math.max(...loseHumans.map((h) => h.coinValue))
        : null;

    if (winFloor !== null) {
        // Win humans must beat every bot → cap all bots strictly below the lowest
        // win-human value. (Win precedence: this can slightly weaken a same-round
        // forced loss, an accepted rare edge.)
        const ceil = Math.max(0, winFloor - 1);
        for (const b of out) b.coinValue = clamp(Math.min(b.coinValue, ceil));

        // Still try to push some bots above the lose humans, but never above the cap.
        if (loseCeil !== null && ceil > loseCeil) {
            const need = Math.min(o.payingRanks, out.length);
            const ordered = [...out]
                .sort((a, b) => b.coinValue - a.coinValue)
                .slice(0, need);
            for (const b of ordered) {
                const target = loseCeil + 1 + Math.floor(rng() * 3);
                b.coinValue = clamp(
                    Math.min(Math.max(b.coinValue, target), ceil),
                );
                markReached(b);
            }
        }
    } else if (loseCeil !== null) {
        // Only losses to enforce: push the top `payingRanks` bots strictly above the
        // highest lose-human so every lose human falls out of the paying ranks.
        const need = Math.min(o.payingRanks, out.length);
        const ordered = [...out]
            .sort((a, b) => b.coinValue - a.coinValue)
            .slice(0, need);
        ordered.forEach((b, i) => {
            // Distinct, descending margins so the forced bots occupy the top ranks.
            const target =
                loseCeil + 1 + (need - i) * 4 + Math.floor(rng() * 4);
            b.coinValue = clamp(Math.max(b.coinValue, target));
            markReached(b);
        });
    }

    return { bots: out, forced: true, perHuman };
}

// ── Joint ranking (all participants, humans + bots) ──────────────────────────
export interface RankEntry {
    key: string;
    isHuman: boolean;
    coinValue: number;
    reachedCenter: boolean;
}

export interface RankedEntry extends RankEntry {
    rank: number;
    tieCount: number;
    eligible: boolean;
}

/**
 * Rank every participant together. Mode B eliminates anyone who didn't reach the
 * center (ranked last). Ties share a rank; `tieCount` is how many share it.
 */
export function rankParticipants(
    mode: WinMode,
    entries: RankEntry[],
): RankedEntry[] {
    const total = entries.length;
    const eligibleOf = (reached: boolean) => (mode === 'B' ? reached : true);
    const rows = entries.map((e) => ({
        ...e,
        eligible: eligibleOf(e.reachedCenter),
        rank: 0,
        tieCount: 1,
    }));
    rows.sort((a, b) => {
        if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
        return b.coinValue - a.coinValue;
    });
    let rank = 0,
        seen = 0,
        lastVal = Infinity,
        lastElig = true;
    for (const e of rows) {
        seen++;
        if (e.coinValue !== lastVal || e.eligible !== lastElig) {
            rank = seen;
            lastVal = e.coinValue;
            lastElig = e.eligible;
        }
        e.rank = e.eligible ? rank : total;
    }
    for (const e of rows) {
        e.tieCount = e.eligible
            ? rows.filter((r) => r.eligible && r.rank === e.rank).length
            : 1;
    }
    return rows;
}
