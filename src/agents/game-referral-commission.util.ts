import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { WalletService } from '../wallet/wallet.service';
import {
    CommissionGameType,
    CommissionPctByGame,
    resolveGameReferralCommissionPct,
} from './referral-commission.util';

export interface AgentStakeRow {
    agentId: string;
    stakedMinor: number;
}

interface MinimalLogger {
    log(message: string): void;
    error(message: string, stack?: string): void;
}

export interface SettleGameReferralCommissionInput {
    dataSource: DataSource;
    walletService: WalletService;
    game: CommissionGameType;
    /** Unique reference id for this settlement unit (drawId/roundId/matchId/tournamentId). */
    referenceId: string;
    /** Per-agent total real-player stake for this unit  already bot-excluded, one row per agent. */
    agentStakes: AgentStakeRow[];
    /** Bingo/Crash: stake × houseEdgePct% is the commission base. Keno/Pool/Werk: pass null for a flat % of stake. */
    houseEdgePct: number | null;
    /** Ledger `sourceType`, e.g. 'keno_referral_commission'. */
    sourceType: string;
    logger: MinimalLogger;
}

/**
 * Shared implementation of the per-game referral-commission settlement that
 * `BingoService.settleReferralCommission` pioneered, generalized for
 * Keno/Crash/Pool/Werk. Never throws  failures are logged and persisted to
 * `commission_settlement_errors` (the same table Bingo already writes to, via
 * raw SQL so no per-module entity wiring is needed) so an admin can see them
 * without server log access.
 */
export async function settleGameReferralCommission(
    input: SettleGameReferralCommissionInput,
): Promise<void> {
    const {
        dataSource,
        walletService,
        game,
        referenceId,
        agentStakes,
        houseEdgePct,
        sourceType,
        logger,
    } = input;
    if (agentStakes.length === 0) return;

    try {
        const [globalRow]: Array<{
            referralCommissionPct: number | string | null;
            referralCommissionPctByGame: unknown;
        }> = await dataSource.query(
            "SELECT referralCommissionPct, referralCommissionPctByGame FROM system_configs WHERE `key` = 'global' LIMIT 1",
        );
        const globalScalarPct = Number(globalRow?.referralCommissionPct ?? 0);
        const globalMap = parsePctByGame(
            globalRow?.referralCommissionPctByGame,
        );

        const agentIds = [...new Set(agentStakes.map((r) => r.agentId))];
        const placeholders = agentIds.map(() => '?').join(',');
        const agentRows: Array<{
            id: string;
            referralCommissionPct: number | string | null;
            referralCommissionPctByGame: unknown;
        }> = await dataSource.query(
            `SELECT id, referralCommissionPct, referralCommissionPctByGame FROM users WHERE id IN (${placeholders})`,
            agentIds,
        );
        const agentById = new Map(agentRows.map((r) => [r.id, r]));

        for (const row of agentStakes) {
            if (row.stakedMinor <= 0) continue;
            const agent = agentById.get(row.agentId);
            const pct = resolveGameReferralCommissionPct(
                game,
                parsePctByGame(agent?.referralCommissionPctByGame),
                agent ? Number(agent.referralCommissionPct ?? 0) : null,
                globalMap,
                globalScalarPct,
            );
            if (pct <= 0) continue;

            const baseMinor =
                houseEdgePct == null
                    ? row.stakedMinor
                    : Math.floor((row.stakedMinor * houseEdgePct) / 100);
            if (baseMinor <= 0) continue;

            const commissionMinor = Math.floor((baseMinor * pct) / 100);
            if (commissionMinor <= 0) continue;

            await dataSource.transaction(async (manager) => {
                await walletService.creditInSession(
                    {
                        userId: row.agentId,
                        amountMinor: commissionMinor,
                        entryType: 'agent_receipt',
                        sourceType,
                        sourceId: referenceId,
                        idempotencyKey: `${sourceType}:${referenceId}:${row.agentId}`,
                        metadata: {
                            referenceId,
                            baseMinor,
                            commissionPct: pct,
                            kind: 'referral_commission',
                        },
                    },
                    manager,
                );
            });
            logger.log(
                `${sourceType}: ${referenceId} → agent ${row.agentId} credited ${commissionMinor} (${pct}% of ${baseMinor})`,
            );
        }
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const stack = err instanceof Error ? err.stack : undefined;
        logger.error(`${sourceType} settlement failed`, stack);
        try {
            await dataSource.query(
                'INSERT INTO commission_settlement_errors (id, roomId, source, message, stack, createdAt) VALUES (?, ?, ?, ?, ?, NOW())',
                [randomUUID(), referenceId, sourceType, message, stack ?? null],
            );
        } catch {
            // best-effort  never let error persistence itself throw
        }
    }
}

function parsePctByGame(value: unknown): CommissionPctByGame | null {
    if (!value) return null;
    if (typeof value === 'object') return value as CommissionPctByGame;
    if (typeof value === 'string') {
        try {
            return JSON.parse(value);
        } catch {
            return null;
        }
    }
    return null;
}
