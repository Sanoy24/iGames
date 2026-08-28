import {
    BadRequestException,
    ConflictException,
    Injectable,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager, In } from 'typeorm';
import { createHash } from 'crypto';
import { LedgerService } from '../ledger/ledger.service';
import {
    LedgerEntry,
    LedgerEntryType,
} from '../ledger/entities/ledger-entry.entity';
import { GameEventsGateway } from '../events/game-events.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import {
    AgentActionLog,
    AgentActionType,
} from '../agents/entities/agent-action-log.entity';
import { Wallet } from './entities/wallet.entity';
import { WagerLimit } from './entities/wager-limit.entity';
import { Withdrawal, WithdrawalStatus } from './entities/withdrawal.entity';
import { WithdrawalFeeRange } from './entities/withdrawal-fee-range.entity';
import { resolveWithdrawalFeeMinor } from './withdrawal-fee-range.util';
import { User } from '../users/entities/user.entity';
import { SystemConfig } from '../admin/entities/system-config.entity';
import { normalizeEthiopianPhone } from '../common/phone.util';
import { AdminNotificationBotService } from '../telegram/admin-notification-bot.service';
import {
    describeNextOpen,
    getNextWindowOpen,
    isWithinWorkingWindow,
    WorkingWindowAgent,
} from '../common/agent-duty.util';

export type WalletSummary = {
    id: string;
    userId: string;
    currencyCode: string;
    availableMinor: number;
    reservedMinor: number;
    status: string;
};

export type LedgerEntrySummary = {
    id: string;
    walletId: string;
    currencyCode: string;
    amountMinor: number;
    direction: string;
    entryType: string;
    sourceType: string;
    sourceId: string;
    idempotencyKey?: string;
    balanceAfterMinor: number;
    metadata: Record<string, unknown>;
    createdAt?: Date;
};

export type WalletMutationInput = {
    userId: string;
    amountMinor: number;
    entryType: LedgerEntryType;
    sourceType: string;
    sourceId: string;
    idempotencyKey: string;
    metadata?: Record<string, unknown>;
    currencyCode?: string;
};

export type WalletMutationResult = {
    wallet: WalletSummary;
    ledgerEntry: LedgerEntrySummary;
    idempotent: boolean;
};

@Injectable()
export class WalletService {
    constructor(
        private readonly dataSource: DataSource,
        @InjectRepository(Wallet)
        private readonly walletRepository: Repository<Wallet>,
        @InjectRepository(WagerLimit)
        private readonly wagerLimitRepository: Repository<WagerLimit>,
        @InjectRepository(Withdrawal)
        private readonly withdrawalRepository: Repository<Withdrawal>,
        @InjectRepository(SystemConfig)
        private readonly systemConfigRepository: Repository<SystemConfig>,
        @InjectRepository(WithdrawalFeeRange)
        private readonly withdrawalFeeRangeRepository: Repository<WithdrawalFeeRange>,
        private readonly ledgerService: LedgerService,
        private readonly gameEventsGateway: GameEventsGateway,
        private readonly notificationsService: NotificationsService,
        private readonly adminNotificationBotService: AdminNotificationBotService,
    ) {}

    private readonly logger = new Logger(WalletService.name);

    async ensureDefaultWallet(
        userId: string,
        manager?: EntityManager,
    ): Promise<Wallet> {
        const repo = manager
            ? manager.getRepository(Wallet)
            : this.walletRepository;
        const existingWallet = await repo.findOneBy({
            userId,
            currencyCode: 'CREDIT',
        });

        if (existingWallet) {
            return existingWallet;
        }

        const wallet = repo.create({
            userId,
            currencyCode: 'CREDIT',
            availableMinor: 0,
            reservedMinor: 0,
            status: 'active',
        });

        return await repo.save(wallet);
    }

    async getDefaultWalletSummary(userId: string): Promise<WalletSummary> {
        const wallet = await this.walletRepository.findOneBy({
            userId,
            currencyCode: 'CREDIT',
        });

        if (!wallet) {
            throw new NotFoundException('Wallet not found');
        }

        return this.toWalletSummary(wallet);
    }

    /**
     * Bulk `availableMinor` lookup  a user with no wallet row yet is simply
     * absent from the map (callers should treat that as 0). Used where an N+1
     * per-user lookup would be wasteful, e.g. filtering an agent list by balance.
     */
    async getAvailableBalances(
        userIds: string[],
    ): Promise<Map<string, number>> {
        if (userIds.length === 0) return new Map();
        const wallets = await this.walletRepository.find({
            where: { userId: In(userIds), currencyCode: 'CREDIT' },
        });
        return new Map(wallets.map((w) => [w.userId, w.availableMinor]));
    }

    /**
     * How much of an agent's wallet is admin-allocated deposit float still
     * unspent  NOT the same as the wallet's raw balance. An agent's wallet also
     * receives money that was never allocated as deposit float: referral/
     * assigned-player commission (BingoService.settleReferralCommission) and
     * withdrawal-payout reimbursement (`agent_receipt`, see recordAgentAction
     * callers above). Both count toward `availableMinor` but neither means an
     * admin actually gave this agent cash to hand out for deposits  an agent
     * who was never funded could otherwise still pass a raw-balance check just
     * by having an active referred player. Computed from ledger history
     * (`admin_to_agent_transfer` credits minus `agent_deposit_funding` debits,
     * both already recorded verbatim by transferAdminToAgent/
     * fundUserCreditFromAgent) rather than a separate tracked balance, so there
     * is nothing to migrate or backfill. Capped at the wallet's actual
     * available balance in case the agent separately drained it through an
     * unrelated debit (e.g. transferAgentToUser)  the delta alone could then
     * overstate what they can actually still hand out.
     */
    async getAgentFloatRemaining(
        agentIds: string[],
    ): Promise<Map<string, number>> {
        if (agentIds.length === 0) return new Map();

        const [balances, rows] = await Promise.all([
            this.getAvailableBalances(agentIds),
            this.dataSource
                .getRepository(LedgerEntry)
                .createQueryBuilder('le')
                .select('le.userId', 'userId')
                .addSelect('le.sourceType', 'sourceType')
                .addSelect('le.direction', 'direction')
                .addSelect('SUM(le.amountMinor)', 'total')
                .where('le.userId IN (:...agentIds)', { agentIds })
                .andWhere('le.sourceType IN (:...sourceTypes)', {
                    sourceTypes: [
                        'admin_to_agent_transfer',
                        'agent_deposit_funding',
                    ],
                })
                .groupBy('le.userId')
                .addGroupBy('le.sourceType')
                .addGroupBy('le.direction')
                .getRawMany<{
                    userId: string;
                    sourceType: string;
                    direction: string;
                    total: string;
                }>(),
        ]);

        const deltaByAgent = new Map<string, number>();
        for (const row of rows) {
            const signed =
                row.sourceType === 'admin_to_agent_transfer' &&
                row.direction === 'credit'
                    ? Number(row.total)
                    : row.sourceType === 'agent_deposit_funding' &&
                        row.direction === 'debit'
                      ? -Number(row.total)
                      : 0;
            deltaByAgent.set(
                row.userId,
                (deltaByAgent.get(row.userId) ?? 0) + signed,
            );
        }

        const result = new Map<string, number>();
        for (const agentId of agentIds) {
            const delta = deltaByAgent.get(agentId) ?? 0;
            const rawBalance = balances.get(agentId) ?? 0;
            result.set(agentId, Math.max(0, Math.min(delta, rawBalance)));
        }
        return result;
    }

    async getLedgerEntries(input: {
        userId: string;
        limit: number;
    }): Promise<LedgerEntrySummary[]> {
        const limit = Math.min(Math.max(input.limit || 50, 1), 100);
        const entries = await this.ledgerService.findUserEntries({
            userId: input.userId,
            limit,
        });

        return entries.map((entry) => ({
            id: entry.id,
            walletId: entry.walletId,
            currencyCode: entry.currencyCode,
            amountMinor: entry.amountMinor,
            direction: entry.direction,
            entryType: entry.entryType,
            sourceType: entry.sourceType,
            sourceId: entry.sourceId,
            idempotencyKey: entry.idempotencyKey,
            balanceAfterMinor: entry.balanceAfterMinor,
            metadata: entry.metadata || {},
            createdAt: entry.createdAt,
        }));
    }

    /** House bot accounts always carry productMetadata.botPolicy  same exclusion
     * used everywhere else a "real players only" view is needed (UsersService,
     * AdminService, WalletService.getLeaderboard). */
    private static readonly REAL_PLAYER_ONLY =
        "JSON_EXTRACT(u.productMetadata, '$.botPolicy') IS NULL";

    async getRecentPlatformWins(limit: number): Promise<{
        enabled: boolean;
        wins: Array<{
            displayName: string;
            amountMinor: number;
            game: string;
            timestamp: string;
        }>;
    }> {
        const config = await this.systemConfigRepository.findOneBy({
            key: 'global',
        });
        if (!config?.recentWinsEnabled) return { enabled: false, wins: [] };

        const safeLimit = Math.min(Math.max(limit || 20, 1), 50);
        const rows = await this.dataSource
            .getRepository(LedgerEntry)
            .createQueryBuilder('le')
            .innerJoin('le.user', 'u')
            .select([
                'COALESCE(JSON_UNQUOTE(JSON_EXTRACT(le.metadata, "$.displayName")), u.displayName) AS displayName',
                'le.amountMinor AS amountMinor',
                'le.sourceType AS sourceType',
                'le.createdAt AS createdAt',
            ])
            .where('le.entryType = :type', { type: 'win' })
            .andWhere('le.direction = :dir', { dir: 'credit' })
            .andWhere('le.amountMinor > 0')
            .andWhere(WalletService.REAL_PLAYER_ONLY)
            .orderBy('le.createdAt', 'DESC')
            .limit(safeLimit)
            .getRawMany<{
                displayName: string;
                amountMinor: string;
                sourceType: string;
                createdAt: Date | string;
            }>();

        return {
            enabled: true,
            wins: rows.map((row) => ({
                displayName: row.displayName ?? 'Player',
                amountMinor: Number(row.amountMinor ?? 0),
                game: String(row.sourceType ?? '')
                    .toLowerCase()
                    .includes('keno')
                    ? 'Keno'
                    : 'Bingo',
                timestamp:
                    row.createdAt instanceof Date
                        ? row.createdAt.toISOString()
                        : String(row.createdAt),
            })),
        };
    }

    async getLeaderboard(input: { period?: string; limit: number }): Promise<{
        enabled: boolean;
        entries: Array<{
            rank: number;
            displayName: string;
            totalWinMinor: number;
            winCount: number;
        }>;
    }> {
        const config = await this.systemConfigRepository.findOneBy({
            key: 'global',
        });
        if (!config?.leaderboardEnabled) return { enabled: false, entries: [] };

        const safeLimit = Math.min(Math.max(input.limit || 10, 1), 50);
        let since: Date | undefined;
        if (input.period === 'weekly')
            since = new Date(Date.now() - 7 * 86400 * 1000);
        if (input.period === 'monthly')
            since = new Date(Date.now() - 30 * 86400 * 1000);

        const qb = this.dataSource
            .getRepository(LedgerEntry)
            .createQueryBuilder('le')
            .innerJoin('le.user', 'u')
            .select('u.displayName', 'displayName')
            .addSelect('SUM(le.amountMinor)', 'totalWinMinor')
            .addSelect('COUNT(le.id)', 'winCount')
            .where('le.entryType = :type', { type: 'win' })
            .andWhere('le.direction = :dir', { dir: 'credit' })
            .andWhere('le.amountMinor > 0')
            .andWhere(WalletService.REAL_PLAYER_ONLY);

        if (since) qb.andWhere('le.createdAt >= :since', { since });

        const rows = await qb
            .groupBy('u.id')
            .addGroupBy('u.displayName')
            .orderBy('totalWinMinor', 'DESC')
            .limit(safeLimit)
            .getRawMany<{
                displayName: string;
                totalWinMinor: string;
                winCount: string;
            }>();

        return {
            enabled: true,
            entries: rows.map((row, i) => ({
                rank: i + 1,
                displayName: row.displayName ?? 'Player',
                totalWinMinor: Number(row.totalWinMinor ?? 0),
                winCount: Number(row.winCount ?? 0),
            })),
        };
    }

    debit(input: WalletMutationInput): Promise<WalletMutationResult> {
        return this.mutateWalletInOwnTransaction({
            ...input,
            direction: 'debit',
        });
    }

    credit(input: WalletMutationInput): Promise<WalletMutationResult> {
        return this.mutateWalletInOwnTransaction({
            ...input,
            direction: 'credit',
        });
    }

    debitInSession(
        input: WalletMutationInput,
        manager: EntityManager,
    ): Promise<WalletMutationResult> {
        return this.mutateWalletInSession(
            {
                ...input,
                direction: 'debit',
            },
            manager,
        );
    }

    creditInSession(
        input: WalletMutationInput,
        manager: EntityManager,
    ): Promise<WalletMutationResult> {
        return this.mutateWalletInSession(
            {
                ...input,
                direction: 'credit',
            },
            manager,
        );
    }

    private async mutateWalletInOwnTransaction(
        input: WalletMutationInput & { direction: 'debit' | 'credit' },
    ): Promise<WalletMutationResult> {
        return this.dataSource.transaction(async (manager) => {
            return await this.mutateWalletInSession(input, manager);
        });
    }

    private async mutateWalletInSession(
        input: WalletMutationInput & { direction: 'debit' | 'credit' },
        manager: EntityManager,
    ): Promise<WalletMutationResult> {
        this.assertPositiveAmount(input.amountMinor);

        const currencyCode = input.currencyCode ?? 'CREDIT';
        const action = `wallet.${input.direction}.${input.entryType}.${input.sourceType}`;
        const requestHash = this.hashRequest({
            userId: input.userId,
            amountMinor: input.amountMinor,
            currencyCode,
            direction: input.direction,
            entryType: input.entryType,
            sourceType: input.sourceType,
            sourceId: input.sourceId,
            metadata: input.metadata ?? {},
        });

        let idempotencyRecord = await this.ledgerService.findIdempotencyRecord({
            key: input.idempotencyKey,
            userId: input.userId,
            action,
            manager,
        });

        if (idempotencyRecord) {
            this.ledgerService.assertIdempotentRequestMatches(
                idempotencyRecord,
                requestHash,
            );

            if (
                idempotencyRecord.status === 'completed' &&
                idempotencyRecord.response
            ) {
                return {
                    ...(idempotencyRecord.response as WalletMutationResult),
                    idempotent: true,
                };
            }

            throw new ConflictException(
                'Idempotent wallet mutation is already in progress',
            );
        }

        idempotencyRecord =
            await this.ledgerService.createPendingIdempotencyRecord({
                key: input.idempotencyKey,
                userId: input.userId,
                action,
                requestHash,
                manager,
            });

        // LOCK user wallet row
        const wallet = await manager.getRepository(Wallet).findOne({
            where: { userId: input.userId, currencyCode },
            lock: { mode: 'pessimistic_write' },
        });

        if (!wallet) {
            throw new NotFoundException('Wallet not found');
        }

        if (wallet.status !== 'active') {
            throw new ConflictException('Wallet is not active');
        }

        if (input.entryType === 'stake') {
            await this.enforceWagerLimit(
                input.userId,
                input.amountMinor,
                manager,
            );
        }

        const incAmount =
            input.direction === 'credit'
                ? input.amountMinor
                : -input.amountMinor;

        if (
            input.direction === 'debit' &&
            wallet.availableMinor < input.amountMinor
        ) {
            throw new ConflictException(
                'Insufficient wallet balance or concurrent update failed',
            );
        }

        wallet.availableMinor += incAmount;
        const updatedWallet = await manager.getRepository(Wallet).save(wallet);

        const ledgerEntry = await this.ledgerService.createEntry(
            {
                userId: input.userId,
                walletId: updatedWallet.id,
                currencyCode,
                amountMinor: input.amountMinor,
                direction: input.direction,
                entryType: input.entryType,
                sourceType: input.sourceType,
                sourceId: input.sourceId,
                idempotencyKey: input.idempotencyKey,
                balanceAfterMinor: updatedWallet.availableMinor,
                metadata: input.metadata,
            },
            manager,
        );

        // Update global platform stats using MySQL native UPSERT
        if (input.entryType === 'stake') {
            await manager.query(
                `
        INSERT INTO platform_stats (\`key\`, totalTicketVolumeMinor)
        VALUES ('global', ?)
        ON DUPLICATE KEY UPDATE totalTicketVolumeMinor = totalTicketVolumeMinor + ?
      `,
                [input.amountMinor, input.amountMinor],
            );
        } else if (input.entryType === 'win') {
            await manager.query(
                `
        INSERT INTO platform_stats (\`key\`, totalPayoutsMinor)
        VALUES ('global', ?)
        ON DUPLICATE KEY UPDATE totalPayoutsMinor = totalPayoutsMinor + ?
      `,
                [input.amountMinor, input.amountMinor],
            );
        } else if (input.entryType === 'refund') {
            await manager.query(
                `
        INSERT INTO platform_stats (\`key\`, totalRefundsMinor)
        VALUES ('global', ?)
        ON DUPLICATE KEY UPDATE totalRefundsMinor = totalRefundsMinor + ?
      `,
                [input.amountMinor, input.amountMinor],
            );
        }

        const result: WalletMutationResult = {
            wallet: this.toWalletSummary(updatedWallet),
            ledgerEntry: {
                id: ledgerEntry.id,
                walletId: ledgerEntry.walletId,
                currencyCode: ledgerEntry.currencyCode,
                amountMinor: ledgerEntry.amountMinor,
                direction: ledgerEntry.direction,
                entryType: ledgerEntry.entryType,
                sourceType: ledgerEntry.sourceType,
                sourceId: ledgerEntry.sourceId,
                idempotencyKey: ledgerEntry.idempotencyKey,
                balanceAfterMinor: ledgerEntry.balanceAfterMinor,
                metadata: ledgerEntry.metadata || {},
                createdAt: ledgerEntry.createdAt,
            },
            idempotent: false,
        };

        await this.ledgerService.completeIdempotencyRecord({
            record: idempotencyRecord,
            response: result,
            manager,
        });

        this.gameEventsGateway.emitWalletUpdated(input.userId, result.wallet);

        return result;
    }

    private toWalletSummary(wallet: Wallet): WalletSummary {
        return {
            id: wallet.id,
            userId: wallet.userId,
            currencyCode: wallet.currencyCode,
            availableMinor: wallet.availableMinor,
            reservedMinor: wallet.reservedMinor,
            status: wallet.status,
        };
    }

    private assertPositiveAmount(amountMinor: number): void {
        if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
            throw new BadRequestException(
                'amountMinor must be a positive integer',
            );
        }
    }

    private async enforceWagerLimit(
        userId: string,
        amountMinor: number,
        manager: EntityManager,
    ): Promise<void> {
        const now = new Date();
        const wagerLimitRepo = manager.getRepository(WagerLimit);

        let wagerLimit = await wagerLimitRepo.findOneBy({ userId });

        if (!wagerLimit) {
            const tomorrow = new Date(now);
            tomorrow.setUTCHours(24, 0, 0, 0);
            const nextWeek = new Date(tomorrow);
            nextWeek.setDate(nextWeek.getDate() + 7);

            wagerLimit = wagerLimitRepo.create({
                userId,
                dailyLimitMinor: 0,
                weeklyLimitMinor: 0,
                currentDailyWagerMinor: 0,
                currentWeeklyWagerMinor: 0,
                dailyResetAt: tomorrow,
                weeklyResetAt: nextWeek,
            });
            await wagerLimitRepo.save(wagerLimit);
        }

        if (now >= wagerLimit.dailyResetAt) {
            wagerLimit.currentDailyWagerMinor = 0;
            const tomorrow = new Date(now);
            tomorrow.setUTCHours(24, 0, 0, 0);
            wagerLimit.dailyResetAt = tomorrow;
        }
        if (now >= wagerLimit.weeklyResetAt) {
            wagerLimit.currentWeeklyWagerMinor = 0;
            const nextWeek = new Date(now);
            nextWeek.setUTCHours(24, 0, 0, 0);
            nextWeek.setDate(nextWeek.getDate() + 7);
            wagerLimit.weeklyResetAt = nextWeek;
        }

        if (
            wagerLimit.dailyLimitMinor > 0 &&
            wagerLimit.currentDailyWagerMinor + amountMinor >
                wagerLimit.dailyLimitMinor
        ) {
            throw new ConflictException('Daily wagering limit exceeded');
        }
        if (
            wagerLimit.weeklyLimitMinor > 0 &&
            wagerLimit.currentWeeklyWagerMinor + amountMinor >
                wagerLimit.weeklyLimitMinor
        ) {
            throw new ConflictException('Weekly wagering limit exceeded');
        }

        wagerLimit.currentDailyWagerMinor += amountMinor;
        wagerLimit.currentWeeklyWagerMinor += amountMinor;
        await wagerLimitRepo.save(wagerLimit);
    }

    private hashRequest(value: Record<string, unknown>): string {
        return createHash('sha256')
            .update(this.stableStringify(value))
            .digest('hex');
    }

    private stableStringify(value: unknown): string {
        if (Array.isArray(value)) {
            return `[${value.map((item) => this.stableStringify(item)).join(',')}]`;
        }

        if (value && typeof value === 'object') {
            return `{${Object.entries(value)
                .sort(([leftKey], [rightKey]) =>
                    leftKey.localeCompare(rightKey),
                )
                .map(
                    ([key, nestedValue]) =>
                        `${JSON.stringify(key)}:${this.stableStringify(nestedValue)}`,
                )
                .join(',')}}`;
        }

        return JSON.stringify(value);
    }

    /** Player-facing withdrawal fee config, so the withdraw form can show a fee
     * estimate before submission without requiring the agent role. Also
     * carries the withdrawal-schedule status so the form can tell the player
     * up front (before they even fill it in) when withdrawals reopen. */
    async getWithdrawalFeeConfig(): Promise<{
        withdrawalFeeRanges: Array<{
            minAmountMinor: number;
            maxAmountMinor: number | null;
            feeMinor: number;
        }>;
        schedule: { open: boolean; message?: string };
    }> {
        const [ranges, systemConfig] = await Promise.all([
            this.withdrawalFeeRangeRepository.find({
                where: { active: true },
                order: { minAmountMinor: 'ASC' },
            }),
            this.systemConfigRepository.findOneBy({ key: 'global' }),
        ]);
        return {
            withdrawalFeeRanges: ranges.map((r) => ({
                minAmountMinor: r.minAmountMinor,
                maxAmountMinor: r.maxAmountMinor,
                feeMinor: r.feeMinor,
            })),
            schedule: this.getWithdrawalScheduleStatus(systemConfig ?? undefined),
        };
    }

    /**
     * Builds the isWithinWorkingWindow-compatible shape from the raw
     * withdrawal-schedule config fields, or null when the schedule is off
     * (always open) or the config row doesn't exist yet. Accepts either a
     * SystemConfig entity (JSON column already parsed) or a raw SQL row
     * (JSON column possibly still a string, hence the defensive parse)  see
     * requestWithdrawal's raw `SELECT *` vs getWithdrawalFeeConfig's repository read.
     */
    private buildWithdrawalScheduleWindow(cfg?: {
        withdrawalScheduleEnabled?: boolean | number | null;
        withdrawalScheduleDaysOfWeek?: unknown;
        withdrawalScheduleStartHour?: number | null;
        withdrawalScheduleStartMinute?: number | null;
        withdrawalScheduleEndHour?: number | null;
        withdrawalScheduleEndMinute?: number | null;
    }): WorkingWindowAgent | null {
        if (!cfg?.withdrawalScheduleEnabled) return null;
        const daysRaw = cfg.withdrawalScheduleDaysOfWeek;
        const days: number[] = Array.isArray(daysRaw)
            ? daysRaw
            : typeof daysRaw === 'string' && daysRaw
              ? JSON.parse(daysRaw)
              : [];
        return {
            workDaysOfWeek: days,
            workStartHour: cfg.withdrawalScheduleStartHour ?? null,
            workStartMinute: cfg.withdrawalScheduleStartMinute ?? null,
            workEndHour: cfg.withdrawalScheduleEndHour ?? null,
            workEndMinute: cfg.withdrawalScheduleEndMinute ?? null,
        };
    }

    private getWithdrawalScheduleStatus(
        cfg?: Parameters<WalletService['buildWithdrawalScheduleWindow']>[0],
    ): { open: boolean; message?: string } {
        const window = this.buildWithdrawalScheduleWindow(cfg);
        if (!window) return { open: true };
        if (isWithinWorkingWindow(window)) return { open: true };
        const nextOpen = getNextWindowOpen(window);
        return {
            open: false,
            message: nextOpen
                ? describeNextOpen(nextOpen)
                : 'Withdrawals are currently closed.',
        };
    }

    async requestWithdrawal(
        userId: string,
        amountMinor: number,
        destinationAccount: string,
    ): Promise<Withdrawal> {
        this.assertPositiveAmount(amountMinor);
        if (!destinationAccount || destinationAccount.trim() === '') {
            throw new BadRequestException('Destination account is required');
        }

        const withdrawal = await this.dataSource.transaction(async (manager) => {
            const config = await manager.query(
                `SELECT * FROM system_configs WHERE \`key\` = 'global' LIMIT 1`,
            );
            const systemConfig = config?.[0];
            const minAmount =
                (systemConfig?.withdrawalMinAmountMinor as number) ?? 0;
            const maxAmount =
                (systemConfig?.withdrawalMaxAmountMinor as number) ?? 0;
            const maxPending =
                (systemConfig?.maxPendingWithdrawalsPerUser as number) ?? 1;
            const minWalletBalance =
                (systemConfig?.minWalletBalanceMinor as number) ?? 0;

            const schedule = this.getWithdrawalScheduleStatus(systemConfig);
            if (!schedule.open) {
                throw new ConflictException(schedule.message);
            }

            if (minAmount > 0 && amountMinor < minAmount) {
                throw new BadRequestException(
                    `Minimum withdrawal is ${minAmount} credits`,
                );
            }
            if (maxAmount > 0 && amountMinor > maxAmount) {
                throw new BadRequestException(
                    `Maximum withdrawal is ${maxAmount} credits`,
                );
            }

            const withdrawalRepo = manager.getRepository(Withdrawal);
            const walletRepo = manager.getRepository(Wallet);

            if (maxPending > 0) {
                const pendingCount = await withdrawalRepo.countBy({
                    userId,
                    status: In(['pending', 'claimed', 'processing']),
                });
                if (pendingCount >= maxPending) {
                    throw new ConflictException(
                        `You already have ${pendingCount} pending withdrawal(s). Wait for them to complete before requesting another.`,
                    );
                }
            }

            // Lock user wallet row
            const wallet = await walletRepo.findOne({
                where: { userId, currencyCode: 'CREDIT' },
                lock: { mode: 'pessimistic_write' },
            });

            if (!wallet) {
                throw new NotFoundException('Wallet not found');
            }

            if (wallet.status !== 'active') {
                throw new ConflictException('Wallet is not active');
            }

            if (wallet.availableMinor < amountMinor) {
                throw new ConflictException('Insufficient available balance');
            }

            if (
                minWalletBalance > 0 &&
                wallet.availableMinor - amountMinor < minWalletBalance
            ) {
                throw new ConflictException(
                    `Withdrawal would drop your balance below the required minimum of ${minWalletBalance} credits`,
                );
            }

            wallet.availableMinor -= amountMinor;
            wallet.reservedMinor += amountMinor;
            await walletRepo.save(wallet);

            const withdrawal = withdrawalRepo.create({
                userId,
                amountMinor,
                status: 'pending',
                destinationAccount: destinationAccount.trim(),
            });
            await withdrawalRepo.save(withdrawal);

            await this.ledgerService.createEntry(
                {
                    userId,
                    walletId: wallet.id,
                    currencyCode: 'CREDIT',
                    amountMinor,
                    direction: 'debit',
                    entryType: 'withdrawal',
                    sourceType: 'withdrawal',
                    sourceId: withdrawal.id,
                    balanceAfterMinor: wallet.availableMinor,
                    metadata: { destinationAccount: destinationAccount.trim() },
                },
                manager,
            );

            this.gameEventsGateway.emitWalletUpdated(
                userId,
                this.toWalletSummary(wallet),
            );
            this.gameEventsGateway.emitWithdrawalPending({
                withdrawalId: withdrawal.id,
                userId,
                amountMinor: withdrawal.amountMinor,
                destinationAccount: withdrawal.destinationAccount,
            });

            return withdrawal;
        });

        // Outside the transaction, best-effort: an admin-alert failure must never
        // affect the withdrawal that already committed.
        void this.notifyAdminsOfWithdrawalRequested(userId, withdrawal).catch(
            (err) =>
                this.logger.error(
                    `Failed to notify admins of withdrawal ${withdrawal.id}`,
                    err instanceof Error ? err.stack : err,
                ),
        );

        return withdrawal;
    }

    private async notifyAdminsOfWithdrawalRequested(
        userId: string,
        withdrawal: Withdrawal,
    ): Promise<void> {
        const user = await this.dataSource
            .getRepository(User)
            .findOneBy({ id: userId });
        await this.adminNotificationBotService.notifyWithdrawalRequested({
            withdrawalId: withdrawal.id,
            displayName: user?.displayName ?? 'Unknown user',
            phoneNumber: user?.phoneNumber,
            amountMinor: withdrawal.amountMinor,
            destinationAccount: withdrawal.destinationAccount,
        });
    }

    async processWithdrawal(
        withdrawalId: string,
        action: 'approve' | 'reject',
        adminNotes?: string,
        adminUserId?: string,
    ): Promise<Withdrawal> {
        if (action === 'reject' && (adminNotes?.trim().length ?? 0) < 15) {
            throw new BadRequestException(
                'Rejection remark must be at least 15 characters',
            );
        }

        const settled = await this.dataSource.transaction(async (manager) => {
            const withdrawalRepo = manager.getRepository(Withdrawal);
            const walletRepo = manager.getRepository(Wallet);

            const withdrawal = await withdrawalRepo.findOneBy({
                id: withdrawalId,
            });

            if (!withdrawal) {
                throw new NotFoundException('Withdrawal request not found');
            }

            const settleable: WithdrawalStatus[] =
                action === 'approve'
                    ? ['pending', 'processing']
                    : ['pending', 'claimed', 'processing'];
            if (!settleable.includes(withdrawal.status)) {
                throw new ConflictException(
                    `Withdrawal is already in '${withdrawal.status}' status`,
                );
            }

            // Lock user wallet row
            const wallet = await walletRepo.findOne({
                where: { userId: withdrawal.userId, currencyCode: 'CREDIT' },
                lock: { mode: 'pessimistic_write' },
            });

            if (!wallet) {
                throw new NotFoundException('Wallet not found');
            }

            if (action === 'approve') {
                if (wallet.reservedMinor < withdrawal.amountMinor) {
                    throw new ConflictException(
                        'Insufficient reserved balance in wallet',
                    );
                }

                wallet.reservedMinor -= withdrawal.amountMinor;
                await walletRepo.save(wallet);

                withdrawal.status = 'completed';
                withdrawal.adminNotes = adminNotes;
                withdrawal.processedAt = new Date();
                withdrawal.processedBy = adminUserId;
                await withdrawalRepo.save(withdrawal);

                this.gameEventsGateway.emitWalletUpdated(
                    withdrawal.userId,
                    this.toWalletSummary(wallet),
                );
            } else {
                if (wallet.reservedMinor < withdrawal.amountMinor) {
                    throw new ConflictException(
                        'Insufficient reserved balance in wallet to refund',
                    );
                }

                wallet.reservedMinor -= withdrawal.amountMinor;
                wallet.availableMinor += withdrawal.amountMinor;
                await walletRepo.save(wallet);

                withdrawal.status = 'rejected';
                withdrawal.adminNotes = adminNotes;
                withdrawal.processedAt = new Date();
                withdrawal.processedBy = adminUserId;
                await withdrawalRepo.save(withdrawal);

                await this.ledgerService.createEntry(
                    {
                        userId: withdrawal.userId,
                        walletId: wallet.id,
                        currencyCode: 'CREDIT',
                        amountMinor: withdrawal.amountMinor,
                        direction: 'credit',
                        entryType: 'refund',
                        sourceType: 'withdrawal',
                        sourceId: withdrawal.id,
                        balanceAfterMinor: wallet.availableMinor,
                        metadata: {
                            action: 'reject',
                            reason: adminNotes || 'Admin rejection',
                        },
                    },
                    manager,
                );

                await manager.query(
                    `
          INSERT INTO platform_stats (\`key\`, totalRefundsMinor)
          VALUES ('global', ?)
          ON DUPLICATE KEY UPDATE totalRefundsMinor = totalRefundsMinor + ?
        `,
                    [withdrawal.amountMinor, withdrawal.amountMinor],
                );

                this.gameEventsGateway.emitWalletUpdated(
                    withdrawal.userId,
                    this.toWalletSummary(wallet),
                );
            }

            return withdrawal;
        });

        await this.notifyWithdrawalSettled(settled, adminNotes);
        return settled;
    }

    /**
     * Post-commit, best-effort notification for a settled withdrawal. Called after
     * the DB transaction so a notification failure can never roll back the payout.
     */
    private async notifyWithdrawalSettled(
        withdrawal: Withdrawal,
        remark?: string,
    ): Promise<void> {
        const amount = withdrawal.amountMinor.toLocaleString();
        if (withdrawal.status === 'completed') {
            await this.notificationsService.safeCreate({
                userId: withdrawal.userId,
                type: 'withdrawal',
                title: 'Withdrawal approved',
                body: `Your ${amount} ETB payout has been approved and sent.`,
                data: {
                    withdrawalId: withdrawal.id,
                    amountMinor: withdrawal.amountMinor,
                    status: 'completed',
                },
            });
        } else if (withdrawal.status === 'rejected') {
            const reason = remark?.trim() ?? withdrawal.adminNotes?.trim();
            await this.notificationsService.safeCreate({
                userId: withdrawal.userId,
                type: 'withdrawal',
                title: 'Withdrawal rejected',
                body: reason
                    ? `Your ${amount} ETB payout request was rejected. Reason: ${reason}`
                    : `Your ${amount} ETB payout request was rejected.`,
                data: {
                    withdrawalId: withdrawal.id,
                    amountMinor: withdrawal.amountMinor,
                    status: 'rejected',
                    reason: reason ?? null,
                },
            });
        }
    }

    async getPlayerWithdrawals(userId: string): Promise<Withdrawal[]> {
        return this.withdrawalRepository.find({
            where: { userId },
            order: { createdAt: 'DESC' },
        });
    }

    async getPendingWithdrawals(): Promise<Withdrawal[]> {
        return this.withdrawalRepository.find({
            where: { status: 'pending' },
            relations: ['user'],
            order: { createdAt: 'ASC' },
        });
    }

    async getAllWithdrawals(): Promise<Withdrawal[]> {
        return this.withdrawalRepository.find({
            relations: ['user', 'agent'],
            order: { createdAt: 'DESC' },
        });
    }

    /**
     * Pending withdrawals THIS agent may claim. When `agentWithdrawalRoutingEnabled`
     * is on, that's only requests from players attributed to this agent
     * (COALESCE(referredByAgentId, assignedAgentId))  a player with no agent at
     * all never appears here, they fall straight to the admin-only queue. When
     * off, no agent sees anything (empty list)  every request is admin-only. See
     * SystemConfig.agentWithdrawalRoutingEnabled and claimWithdrawal's matching
     * server-side guard below.
     */
    async getAvailableWithdrawals(agentId: string): Promise<Withdrawal[]> {
        const config = await this.systemConfigRepository.findOneBy({
            key: 'global',
        });
        if (!config?.agentWithdrawalRoutingEnabled) return [];

        return this.withdrawalRepository
            .createQueryBuilder('w')
            .leftJoinAndSelect('w.user', 'user')
            .where('w.status = :status', { status: 'pending' })
            .andWhere(
                'COALESCE(user.referredByAgentId, user.assignedAgentId) = :agentId',
                { agentId },
            )
            .orderBy('w.createdAt', 'ASC')
            .getMany();
    }

    /**
     * ALL withdrawals (any status) from players attributed to this agent, for the
     * admin "per-agent withdrawal requests" drill-down  unlike getAgentWithdrawals
     * (filtered by `withdrawal.agentId`, the CLAIMANT), this is filtered by the
     * REQUESTING player's attribution, so it still shows requests the agent never
     * got to claim (e.g. routing was off, or admin claimed it directly).
     */
    async getWithdrawalsByUsersAgent(agentId: string): Promise<Withdrawal[]> {
        return this.withdrawalRepository
            .createQueryBuilder('w')
            .leftJoinAndSelect('w.user', 'user')
            .leftJoinAndSelect('w.agent', 'claimedByAgent')
            .where(
                'COALESCE(user.referredByAgentId, user.assignedAgentId) = :agentId',
                { agentId },
            )
            .orderBy('w.createdAt', 'DESC')
            .getMany();
    }

    async getAgentWithdrawals(agentId: string): Promise<Withdrawal[]> {
        return this.withdrawalRepository.find({
            // Include awaiting_verification so a submitted-but-not-yet-verified payout
            // stays visible to the agent (status badge only  no action left for them).
            where: {
                agentId,
                status: In(['claimed', 'processing', 'awaiting_verification']),
            },
            relations: ['user'],
            order: { claimedAt: 'DESC' },
        });
    }

    /** A withdrawal that is currently claimed by this agent, or throw. */
    async getClaimedWithdrawalForAgent(
        withdrawalId: string,
        agentId: string,
    ): Promise<Withdrawal> {
        const withdrawal = await this.withdrawalRepository.findOneBy({
            id: withdrawalId,
            status: 'claimed',
            agentId,
        });
        if (!withdrawal) {
            throw new ConflictException(
                'Withdrawal not found or not assigned to you',
            );
        }
        return withdrawal;
    }

    /** Withdrawals assigned to this agent not yet fully completed  dashboard "Pending" count. */
    async countPendingAgentWithdrawals(agentId: string): Promise<number> {
        return this.withdrawalRepository.count({
            where: {
                agentId,
                status: In(['claimed', 'processing', 'awaiting_verification']),
            },
        });
    }

    /** Withdrawals this agent has fully completed  dashboard "Completed" count. */
    async countCompletedAgentWithdrawals(agentId: string): Promise<number> {
        return this.withdrawalRepository.count({
            where: { agentId, status: 'completed' },
        });
    }

    async getAgentWithdrawalHistory(agentId: string): Promise<Withdrawal[]> {
        return this.withdrawalRepository.find({
            where: { agentId },
            relations: ['user'],
            order: { updatedAt: 'DESC' },
            take: 100,
        });
    }

    async claimWithdrawal(
        withdrawalId: string,
        agentId: string,
    ): Promise<Withdrawal> {
        const config = await this.systemConfigRepository.findOneBy({
            key: 'global',
        });
        if (!config?.agentWithdrawalRoutingEnabled) {
            throw new ConflictException(
                'Agent withdrawal routing is currently off  withdrawals are handled by admin only.',
            );
        }

        const withdrawal = await this.withdrawalRepository
            .createQueryBuilder('w')
            .leftJoinAndSelect('w.user', 'user')
            .where('w.id = :id', { id: withdrawalId })
            .andWhere('w.status = :status', { status: 'pending' })
            .getOne();
        if (!withdrawal) {
            throw new ConflictException(
                'Withdrawal is not available to claim (not pending or already claimed)',
            );
        }
        // Server-side enforcement, not just a filtered list  an agent can never
        // claim a request from a player attributed to a DIFFERENT agent (or to
        // none), even by calling this endpoint directly with a known id.
        const requesterAgentId =
            withdrawal.user.referredByAgentId ??
            withdrawal.user.assignedAgentId ??
            null;
        if (requesterAgentId !== agentId) {
            throw new ConflictException(
                'This withdrawal is not from one of your users',
            );
        }

        withdrawal.status = 'claimed';
        withdrawal.agentId = agentId;
        withdrawal.claimedAt = new Date();
        const saved = await this.withdrawalRepository.save(withdrawal);
        await this.recordAgentAction({
            agentId,
            userId: withdrawal.userId,
            withdrawalId: withdrawal.id,
            amountMinor: withdrawal.amountMinor,
            actionType: 'withdrawal_claimed',
            metadata: { destinationAccount: withdrawal.destinationAccount },
        });
        return saved;
    }

    async releaseWithdrawal(
        withdrawalId: string,
        agentId: string,
    ): Promise<Withdrawal> {
        const withdrawal = await this.withdrawalRepository.findOneBy({
            id: withdrawalId,
            status: 'claimed',
            agentId,
        });
        if (!withdrawal) {
            throw new ConflictException(
                'Withdrawal not found or not assigned to you',
            );
        }

        withdrawal.status = 'pending';
        withdrawal.agentId = null as any;
        withdrawal.claimedAt = null as any;
        const saved = await this.withdrawalRepository.save(withdrawal);
        await this.recordAgentAction({
            agentId,
            userId: withdrawal.userId,
            withdrawalId: withdrawal.id,
            amountMinor: withdrawal.amountMinor,
            actionType: 'withdrawal_released',
            metadata: { destinationAccount: withdrawal.destinationAccount },
        });
        return saved;
    }

    /**
     * Step A of the agent withdrawal flow  the agent submits payout proof (FT
     * number + receipt file). This does NOT move any money: no fund-hold release,
     * no agent credit. It just records the proof and parks the withdrawal at
     * `awaiting_verification` for an admin to review. See `verifyAgentWithdrawal`
     * for the step that actually moves money.
     */
    async recordAgentWithdrawalProof(input: {
        withdrawalId: string;
        agentId: string;
        telebirrReference: string;
        paymentProvider?: 'telebirr' | 'mpesa';
        payoutVerification?: Record<string, unknown>;
        receiptFileUrl: string;
        transferCompletedAt: Date;
        feeMinor: number;
    }): Promise<Withdrawal> {
        return this.dataSource.transaction(async (manager) => {
            const withdrawalRepo = manager.getRepository(Withdrawal);

            const withdrawal = await withdrawalRepo.findOneBy({
                id: input.withdrawalId,
                status: 'claimed',
                agentId: input.agentId,
            });

            if (!withdrawal) {
                throw new ConflictException(
                    'Withdrawal not found or not assigned to you',
                );
            }

            // Dedupe the payout proof: the same receipt/confirmation code must not be
            // used for two withdrawals, whether the other one is still awaiting
            // verification or already completed. Checked inside the transaction so two
            // concurrent submissions can't both slip through.
            const reference = input.telebirrReference.trim();
            const reused = await withdrawalRepo.findOne({
                where: {
                    telebirrReference: reference,
                    status: In(['awaiting_verification', 'completed']),
                },
                select: { id: true },
            });
            if (reused && reused.id !== withdrawal.id) {
                throw new ConflictException(
                    'This payment proof has already been used for another withdrawal',
                );
            }

            // A single flat fee (from the matched WithdrawalFeeRange), 100% to the
            // processing agent  no platform split. Resolved and persisted NOW so a
            // fee-range edit between submission and admin verification can't change
            // what's owed later.
            const feeMinor = Math.max(0, Math.floor(input.feeMinor));
            const netAmountMinor = withdrawal.amountMinor - feeMinor;
            if (netAmountMinor <= 0) {
                throw new BadRequestException(
                    'The withdrawal fee would consume the entire withdrawal amount',
                );
            }

            withdrawal.status = 'awaiting_verification';
            withdrawal.serviceChargeMinor = feeMinor;
            withdrawal.netAmountMinor = netAmountMinor;
            withdrawal.telebirrReference = reference;
            withdrawal.paymentProvider = input.paymentProvider ?? null;
            withdrawal.payoutVerification = input.payoutVerification ?? null;
            withdrawal.receiptFileUrl = input.receiptFileUrl;
            withdrawal.transferCompletedAt = input.transferCompletedAt;
            withdrawal.processedAt = new Date();
            withdrawal.processedBy = input.agentId;
            return withdrawalRepo.save(withdrawal);
        });
    }

    /**
     * Credits the processing agent (payout custody) and the fee to whichever
     * account is entitled to it, then records the agent action / platform fee
     * stat. Shared by the two paths that can mark a withdrawal completed with an
     * agent attached: the normal agent-submits → admin-verifies flow
     * (`verifyAgentWithdrawal`, fee → the agent, unchanged) and an admin
     * completing it directly (`adminCompleteWithdrawal`, fee → the Master
     * Wallet  the admin is the one recording/authorizing the payout, not the
     * agent's own self-service submission, so the house keeps the cut instead).
     * The agent is credited the net payout custody either way  they still
     * physically paid the player  only the FEE recipient differs.
     */
    private async settleWithdrawalPayout(
        manager: EntityManager,
        withdrawal: Withdrawal,
        feeMinor: number,
        netAmountMinor: number,
        feeRecipientUserId: string,
    ): Promise<void> {
        await this.ensureDefaultWallet(withdrawal.agentId!, manager);
        await this.creditInSession(
            {
                userId: withdrawal.agentId!,
                amountMinor: netAmountMinor,
                entryType: 'agent_receipt',
                sourceType: 'withdrawal',
                sourceId: withdrawal.id,
                idempotencyKey: `agent-receipt:${withdrawal.id}`,
                metadata: {
                    withdrawalId: withdrawal.id,
                    userId: withdrawal.userId,
                    grossAmountMinor: withdrawal.amountMinor,
                    feeMinor,
                    kind: 'payout_custody',
                },
            },
            manager,
        );

        if (feeMinor > 0) {
            const feeToAgent = feeRecipientUserId === withdrawal.agentId;
            await this.ensureDefaultWallet(feeRecipientUserId, manager);
            await this.creditInSession(
                {
                    userId: feeRecipientUserId,
                    amountMinor: feeMinor,
                    // Master Wallet credits use 'adjustment' (matches every other
                    // Master-Wallet-facing ledger entry, e.g. AdminService.creditFromMasterWallet)
                    // so its history reads as house revenue, not a phantom agent payout.
                    entryType: feeToAgent ? 'agent_receipt' : 'adjustment',
                    sourceType: 'withdrawal',
                    sourceId: withdrawal.id,
                    idempotencyKey: `agent-withdrawal-fee:${withdrawal.id}`,
                    metadata: {
                        withdrawalId: withdrawal.id,
                        userId: withdrawal.userId,
                        grossAmountMinor: withdrawal.amountMinor,
                        kind: 'withdrawal_fee',
                        feeRecipient: feeToAgent ? 'agent' : 'house',
                    },
                },
                manager,
            );
        }

        await this.recordAgentAction(
            {
                agentId: withdrawal.agentId!,
                userId: withdrawal.userId,
                withdrawalId: withdrawal.id,
                amountMinor: withdrawal.amountMinor,
                ledgerEntryId: `agent-receipt:${withdrawal.id}`,
                actionType: 'withdrawal_completed',
                metadata: {
                    destinationAccount: withdrawal.destinationAccount,
                    netAmountMinor,
                    feeMinor,
                    telebirrReference: withdrawal.telebirrReference,
                },
            },
            manager,
        );

        if (feeMinor > 0) {
            await manager.query(
                `
        INSERT INTO platform_stats (\`key\`, totalServiceChargesMinor)
        VALUES ('global', ?)
        ON DUPLICATE KEY UPDATE totalServiceChargesMinor = totalServiceChargesMinor + ?
      `,
                [feeMinor, feeMinor],
            );
        }
    }

    /**
     * Step B  an admin reviews the agent-submitted FT number + receipt. THIS is
     * where money actually moves: approving releases the player's fund-hold and
     * credits the agent (custody + fee), using the amounts already resolved and
     * stored in Step A. Rejecting refunds the reservation back to the player's
     * available balance  a dispute-resolution call, since the agent may have
     * already paid the player in cash; any real-world discrepancy is resolved
     * with the agent manually, outside this flow.
     */
    async verifyAgentWithdrawal(
        withdrawalId: string,
        decision: 'approve' | 'reject',
        adminUserId: string,
        notes?: string,
    ): Promise<Withdrawal> {
        if (decision === 'reject' && (notes?.trim().length ?? 0) < 15) {
            throw new BadRequestException(
                'Rejection notes must be at least 15 characters',
            );
        }

        const settled = await this.dataSource.transaction(async (manager) => {
            const withdrawalRepo = manager.getRepository(Withdrawal);
            const walletRepo = manager.getRepository(Wallet);

            const withdrawal = await withdrawalRepo.findOneBy({
                id: withdrawalId,
                status: 'awaiting_verification',
            });
            if (!withdrawal) {
                throw new ConflictException(
                    'Withdrawal not found or not awaiting verification',
                );
            }

            const wallet = await walletRepo.findOne({
                where: { userId: withdrawal.userId, currencyCode: 'CREDIT' },
                lock: { mode: 'pessimistic_write' },
            });
            if (!wallet) throw new NotFoundException('Wallet not found');
            if (wallet.reservedMinor < withdrawal.amountMinor) {
                throw new ConflictException(
                    'Insufficient reserved balance on user wallet',
                );
            }

            if (decision === 'approve') {
                wallet.reservedMinor -= withdrawal.amountMinor;
                await walletRepo.save(wallet);

                const feeMinor = withdrawal.serviceChargeMinor;
                const netAmountMinor =
                    withdrawal.netAmountMinor ??
                    withdrawal.amountMinor - feeMinor;

                withdrawal.status = 'completed';
                withdrawal.verifiedBy = adminUserId;
                withdrawal.verifiedAt = new Date();
                await withdrawalRepo.save(withdrawal);

                // Agent's own self-service submission  fee stays with the agent, unchanged.
                await this.settleWithdrawalPayout(
                    manager,
                    withdrawal,
                    feeMinor,
                    netAmountMinor,
                    withdrawal.agentId!,
                );
            } else {
                wallet.reservedMinor -= withdrawal.amountMinor;
                wallet.availableMinor += withdrawal.amountMinor;
                await walletRepo.save(wallet);

                withdrawal.status = 'rejected';
                withdrawal.adminNotes = notes?.trim();
                withdrawal.verifiedBy = adminUserId;
                withdrawal.verifiedAt = new Date();
                await withdrawalRepo.save(withdrawal);

                await this.ledgerService.createEntry(
                    {
                        userId: withdrawal.userId,
                        walletId: wallet.id,
                        currencyCode: 'CREDIT',
                        amountMinor: withdrawal.amountMinor,
                        direction: 'credit',
                        entryType: 'refund',
                        sourceType: 'withdrawal',
                        sourceId: withdrawal.id,
                        balanceAfterMinor: wallet.availableMinor,
                        metadata: {
                            action: 'reject_agent_verification',
                            reason:
                                notes?.trim() ||
                                'Admin rejected agent verification',
                        },
                    },
                    manager,
                );

                await manager.query(
                    `
          INSERT INTO platform_stats (\`key\`, totalRefundsMinor)
          VALUES ('global', ?)
          ON DUPLICATE KEY UPDATE totalRefundsMinor = totalRefundsMinor + ?
        `,
                    [withdrawal.amountMinor, withdrawal.amountMinor],
                );
            }

            this.gameEventsGateway.emitWalletUpdated(
                withdrawal.userId,
                this.toWalletSummary(wallet),
            );
            return withdrawal;
        });

        await this.notifyWithdrawalSettled(settled, notes);
        return settled;
    }

    /**
     * Admin-direct completion: collapses the normal two-step agent flow (agent
     * submits proof → admin verifies) into one action, for when an admin is
     * recording a payout an agent already made outside the self-service claim
     * flow (e.g. relayed by phone) rather than leaving it as a bare "approve"
     * with no agent/fee/reference recorded at all. The fee is ALWAYS resolved
     * server-side from the active WithdrawalFeeRange table  never trusted from
     * the caller  so this can never silently diverge from the agent-submitted
     * path's accounting.
     *
     * Unlike the agent's own self-service submission, the fee here goes to the
     * Master Wallet, not the agent  an admin is recording/authorizing this
     * payout rather than the agent submitting it themselves, so the house keeps
     * the cut. The agent is still credited the net payout custody either way.
     */
    async adminCompleteWithdrawal(input: {
        withdrawalId: string;
        agentId: string;
        telebirrReference: string;
        receiptFileUrl: string;
        adminUserId: string;
        /** Resolved by the caller via AdminService.getOrCreateMasterWalletUserId(). */
        houseWalletUserId: string;
        transferCompletedAt?: Date;
    }): Promise<Withdrawal> {
        const settled = await this.dataSource.transaction(async (manager) => {
            const withdrawalRepo = manager.getRepository(Withdrawal);
            const walletRepo = manager.getRepository(Wallet);

            const withdrawal = await withdrawalRepo.findOneBy({
                id: input.withdrawalId,
            });
            if (!withdrawal) {
                throw new NotFoundException('Withdrawal request not found');
            }
            if (
                !(['pending', 'processing'] as WithdrawalStatus[]).includes(
                    withdrawal.status,
                )
            ) {
                throw new ConflictException(
                    `Withdrawal is already in '${withdrawal.status}' status`,
                );
            }

            // Same dedupe as the agent's own proof submission: one reference can't
            // fund two withdrawals.
            const reference = input.telebirrReference.trim();
            const reused = await withdrawalRepo.findOne({
                where: {
                    telebirrReference: reference,
                    status: In(['awaiting_verification', 'completed']),
                },
                select: { id: true },
            });
            if (reused && reused.id !== withdrawal.id) {
                throw new ConflictException(
                    'This payment reference has already been used for another withdrawal',
                );
            }

            const wallet = await walletRepo.findOne({
                where: { userId: withdrawal.userId, currencyCode: 'CREDIT' },
                lock: { mode: 'pessimistic_write' },
            });
            if (!wallet) throw new NotFoundException('Wallet not found');
            if (wallet.reservedMinor < withdrawal.amountMinor) {
                throw new ConflictException(
                    'Insufficient reserved balance in wallet',
                );
            }

            const activeRanges = await this.withdrawalFeeRangeRepository.find({
                where: { active: true },
            });
            const feeMinor = resolveWithdrawalFeeMinor(
                withdrawal.amountMinor,
                activeRanges,
            );
            const netAmountMinor = withdrawal.amountMinor - feeMinor;
            if (netAmountMinor <= 0) {
                throw new BadRequestException(
                    'The withdrawal fee would consume the entire withdrawal amount',
                );
            }

            wallet.reservedMinor -= withdrawal.amountMinor;
            await walletRepo.save(wallet);

            withdrawal.agentId = input.agentId;
            withdrawal.telebirrReference = reference;
            withdrawal.receiptFileUrl = input.receiptFileUrl;
            withdrawal.serviceChargeMinor = feeMinor;
            withdrawal.netAmountMinor = netAmountMinor;
            withdrawal.transferCompletedAt =
                input.transferCompletedAt ?? new Date();
            withdrawal.processedAt = new Date();
            withdrawal.processedBy = input.adminUserId;
            withdrawal.verifiedBy = input.adminUserId;
            withdrawal.verifiedAt = new Date();
            withdrawal.status = 'completed';
            await withdrawalRepo.save(withdrawal);

            await this.settleWithdrawalPayout(
                manager,
                withdrawal,
                feeMinor,
                netAmountMinor,
                input.houseWalletUserId,
            );

            this.gameEventsGateway.emitWalletUpdated(
                withdrawal.userId,
                this.toWalletSummary(wallet),
            );
            return withdrawal;
        });

        await this.notifyWithdrawalSettled(settled);
        return settled;
    }

    async rejectWithdrawalByAgent(
        withdrawalId: string,
        agentId: string,
        remarks: string,
    ): Promise<Withdrawal> {
        if (!remarks || remarks.trim().length < 15) {
            throw new BadRequestException(
                'Rejection remarks must be at least 15 characters',
            );
        }

        const withdrawal = await this.withdrawalRepository.findOneBy({
            id: withdrawalId,
            status: 'claimed',
            agentId,
        });

        if (!withdrawal) {
            throw new ConflictException(
                'Withdrawal not found or not assigned to you',
            );
        }

        withdrawal.status = 'rejected';
        withdrawal.adminNotes = remarks.trim();
        withdrawal.processedAt = new Date();
        withdrawal.processedBy = agentId;
        const saved = await this.withdrawalRepository.save(withdrawal);
        await this.recordAgentAction({
            agentId,
            userId: withdrawal.userId,
            withdrawalId: withdrawal.id,
            amountMinor: withdrawal.amountMinor,
            actionType: 'withdrawal_rejected',
            metadata: {
                destinationAccount: withdrawal.destinationAccount,
                remarks: withdrawal.adminNotes,
            },
        });
        await this.notifyWithdrawalSettled(saved, remarks);
        return saved;
    }

    async getWagerLimit(userId: string): Promise<WagerLimit | null> {
        return this.wagerLimitRepository.findOneBy({ userId });
    }

    async upsertWagerLimit(
        userId: string,
        dailyLimitMinor: number,
        weeklyLimitMinor: number,
    ): Promise<WagerLimit> {
        this.assertNonNegativeAmount(dailyLimitMinor, 'dailyLimitMinor');
        this.assertNonNegativeAmount(weeklyLimitMinor, 'weeklyLimitMinor');
        const now = new Date();
        const dailyReset = new Date(now);
        dailyReset.setUTCHours(24, 0, 0, 0);
        const weeklyReset = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

        let limit = await this.wagerLimitRepository.findOneBy({ userId });
        if (!limit) {
            limit = this.wagerLimitRepository.create({
                userId,
                dailyLimitMinor,
                weeklyLimitMinor,
                currentDailyWagerMinor: 0,
                currentWeeklyWagerMinor: 0,
                dailyResetAt: dailyReset,
                weeklyResetAt: weeklyReset,
            });
        } else {
            limit.dailyLimitMinor = dailyLimitMinor;
            limit.weeklyLimitMinor = weeklyLimitMinor;
        }

        return await this.wagerLimitRepository.save(limit);
    }

    async deleteWagerLimit(userId: string): Promise<void> {
        await this.wagerLimitRepository.delete({ userId });
    }

    /**
     * Credits the ONE shared house wallet (see AdminService.resolveHouseWalletOwnerId
     *  the designated Super-Admin), not the acting admin's own wallet. However many
     * admin accounts exist, they all read/write this single balance, so it's a real
     * source of truth rather than N separate personal floats. `actingAdminId` is
     * recorded in metadata purely for the audit trail.
     */
    async adminTopup(
        houseWalletOwnerId: string,
        amountMinor: number,
        idempotencyKey?: string,
        actingAdminId?: string,
    ): Promise<WalletMutationResult> {
        const key =
            idempotencyKey || `admin-topup:${houseWalletOwnerId}:${Date.now()}`;
        return this.dataSource.transaction(async (manager) => {
            await this.ensureDefaultWallet(houseWalletOwnerId, manager);
            return await this.creditInSession(
                {
                    userId: houseWalletOwnerId,
                    amountMinor,
                    entryType: 'deposit',
                    sourceType: 'admin_topup',
                    sourceId: 'admin_topup',
                    idempotencyKey: key,
                    metadata: {
                        houseWalletOwnerId,
                        toppedUpByAdminId: actingAdminId,
                    },
                },
                manager,
            );
        });
    }

    /** Debits the shared house wallet (see adminTopup) and credits the agent. */
    async transferAdminToAgent(
        houseWalletOwnerId: string,
        agentId: string,
        amountMinor: number,
        idempotencyKey?: string,
        actingAdminId?: string,
    ): Promise<{ adminWallet: WalletSummary; agentWallet: WalletSummary }> {
        const key =
            idempotencyKey ||
            `admin-to-agent:${houseWalletOwnerId}:${agentId}:${Date.now()}`;
        return this.dataSource.transaction(async (manager) => {
            // Ensure wallets exist
            await this.ensureDefaultWallet(houseWalletOwnerId, manager);
            await this.ensureDefaultWallet(agentId, manager);

            // Debit the house wallet
            const debitResult = await this.debitInSession(
                {
                    userId: houseWalletOwnerId,
                    amountMinor,
                    entryType: 'adjustment',
                    sourceType: 'admin_to_agent_transfer',
                    sourceId: agentId,
                    idempotencyKey: `${key}:debit`,
                    metadata: { agentId, actingAdminId },
                },
                manager,
            );

            // Credit agent
            const creditResult = await this.creditInSession(
                {
                    userId: agentId,
                    amountMinor,
                    entryType: 'deposit',
                    sourceType: 'admin_to_agent_transfer',
                    sourceId: houseWalletOwnerId,
                    idempotencyKey: `${key}:credit`,
                    metadata: { houseWalletOwnerId, actingAdminId },
                },
                manager,
            );

            await this.recordAgentAction(
                {
                    agentId,
                    userId: actingAdminId ?? houseWalletOwnerId,
                    amountMinor,
                    ledgerEntryId: creditResult.ledgerEntry.id,
                    actionType: 'admin_transfer_to_agent',
                    metadata: {
                        houseWalletOwnerId,
                        actingAdminId,
                        debitLedgerEntryId: debitResult.ledgerEntry.id,
                        creditLedgerEntryId: creditResult.ledgerEntry.id,
                    },
                },
                manager,
            );

            return {
                adminWallet: debitResult.wallet,
                agentWallet: creditResult.wallet,
            };
        });
    }

    async transferAgentToUser(
        agentUserId: string,
        userPhone: string,
        amountMinor: number,
        idempotencyKey?: string,
    ): Promise<{ agentWallet: WalletSummary; userWallet: WalletSummary }> {
        // users.phoneNumber is always stored normalized (+2519XXXXXXXX/+2517XXXXXXXX
        // every write path runs it through normalizeEthiopianPhone), so an
        // unnormalized "09…"/"07…" input here would silently never match a real row.
        const normalizedPhone = normalizeEthiopianPhone(userPhone);
        if (!normalizedPhone) {
            throw new BadRequestException(
                'Enter a valid Ethiopian phone number (e.g. 09XXXXXXXX)',
            );
        }

        const key =
            idempotencyKey ||
            `agent-to-user:${agentUserId}:${normalizedPhone}:${Date.now()}`;
        return this.dataSource.transaction(async (manager) => {
            // Find user by phone number
            const userRepo = manager.getRepository(User);
            const user = await userRepo.findOneBy({
                phoneNumber: normalizedPhone,
            });
            if (!user) {
                throw new NotFoundException(
                    `User with phone number ${userPhone} not found`,
                );
            }

            // Ensure wallets exist
            await this.ensureDefaultWallet(agentUserId, manager);
            await this.ensureDefaultWallet(user.id, manager);

            // Debit agent
            const debitResult = await this.debitInSession(
                {
                    userId: agentUserId,
                    amountMinor,
                    entryType: 'adjustment',
                    sourceType: 'agent_to_user_transfer',
                    sourceId: user.id,
                    idempotencyKey: `${key}:debit`,
                    metadata: { userPhone, userId: user.id },
                },
                manager,
            );

            // Credit user
            const creditResult = await this.creditInSession(
                {
                    userId: user.id,
                    amountMinor,
                    entryType: 'deposit',
                    sourceType: 'agent_to_user_transfer',
                    sourceId: agentUserId,
                    idempotencyKey: `${key}:credit`,
                    metadata: { agentUserId },
                },
                manager,
            );

            await this.recordAgentAction(
                {
                    agentId: agentUserId,
                    userId: user.id,
                    amountMinor,
                    ledgerEntryId: debitResult.ledgerEntry.id,
                    actionType: 'agent_transfer_to_user',
                    metadata: {
                        userPhone,
                        debitLedgerEntryId: debitResult.ledgerEntry.id,
                        creditLedgerEntryId: creditResult.ledgerEntry.id,
                    },
                },
                manager,
            );

            return {
                agentWallet: debitResult.wallet,
                userWallet: creditResult.wallet,
            };
        });
    }

    /**
     * Session-scoped sibling of `transferAgentToUser`  same agent-debit/user-credit
     * shape, but takes the CALLER's own `manager` instead of opening a new
     * transaction, so it can be composed inside an already-open transaction (e.g.
     * deposit crediting in `PaymentsService`), the same way `AdminService.
     * creditFromMasterWallet` is manager-scoped for the same reason. The credit
     * side uses the caller's `entryType`/`sourceType`/`sourceId`/`idempotencyKey`/
     * `metadata` unchanged, so the receiving wallet's ledger history reads
     * identically regardless of which wallet actually funded it. Throws (and lets
     * the caller decide what to do) if the agent's wallet can't cover the amount
     * `debitInSession` already throws `ConflictException` for that.
     */
    async fundUserCreditFromAgent(
        input: {
            agentId: string;
            targetUserId: string;
            amountMinor: number;
            entryType: LedgerEntryType;
            sourceType: string;
            sourceId: string;
            idempotencyKey: string;
            metadata?: Record<string, unknown>;
        },
        manager: EntityManager,
    ): Promise<WalletMutationResult> {
        await this.ensureDefaultWallet(input.agentId, manager);
        await this.ensureDefaultWallet(input.targetUserId, manager);

        await this.debitInSession(
            {
                userId: input.agentId,
                amountMinor: input.amountMinor,
                entryType: 'adjustment',
                sourceType: 'agent_deposit_funding',
                sourceId: input.sourceId,
                idempotencyKey: `${input.idempotencyKey}:agent-debit`,
                metadata: {
                    ...input.metadata,
                    targetUserId: input.targetUserId,
                    fundedSourceType: input.sourceType,
                },
            },
            manager,
        );

        return this.creditInSession(
            {
                userId: input.targetUserId,
                amountMinor: input.amountMinor,
                entryType: input.entryType,
                sourceType: input.sourceType,
                sourceId: input.sourceId,
                idempotencyKey: input.idempotencyKey,
                metadata: input.metadata,
            },
            manager,
        );
    }

    async recordAgentAction(
        input: {
            agentId: string;
            userId?: string;
            withdrawalId?: string;
            ledgerEntryId?: string;
            amountMinor?: number;
            actionType: AgentActionType;
            metadata?: Record<string, unknown>;
        },
        manager?: EntityManager,
    ): Promise<void> {
        const repo = manager
            ? manager.getRepository(AgentActionLog)
            : this.dataSource.getRepository(AgentActionLog);
        await repo.save(
            repo.create({
                agentId: input.agentId,
                userId: input.userId,
                withdrawalId: input.withdrawalId,
                ledgerEntryId: input.ledgerEntryId,
                amountMinor: input.amountMinor,
                actionType: input.actionType,
                metadata: input.metadata ?? {},
            }),
        );
    }

    private assertNonNegativeAmount(amount: number, field: string): void {
        if (!Number.isInteger(amount) || amount < 0) {
            throw new BadRequestException(
                `${field} must be a non-negative integer`,
            );
        }
    }
}
