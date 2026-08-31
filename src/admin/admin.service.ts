import {
    BadRequestException,
    ConflictException,
    Injectable,
    Logger,
    NotFoundException,
    OnApplicationBootstrap,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager, In } from 'typeorm';
import { randomUUID } from 'crypto';
import { SystemConfig } from './entities/system-config.entity';
import { PlatformStats } from './entities/platform-stats.entity';
import {
    ConfigChangeLog,
    ConfigChangeType,
} from './entities/config-change-log.entity';
import { UpdateSystemConfigDto } from './dto/update-system-config.dto';
import { CreateWithdrawalFeeRangeDto } from './dto/create-withdrawal-fee-range.dto';
import { UpdateWithdrawalFeeRangeDto } from './dto/update-withdrawal-fee-range.dto';
import { UpdateAgentDto } from './dto/update-agent.dto';
import { WithdrawalFeeRange } from '../wallet/entities/withdrawal-fee-range.entity';
import {
    assertNoOverlap,
    computeCoverageGaps,
} from '../wallet/withdrawal-fee-range.util';
import {
    AgentsService,
    REFERRAL_COMMISSION_SOURCE_TYPES,
} from '../agents/agents.service';
import { CreateShiftDto } from '../agents/dto/create-shift.dto';
import { UsersService } from '../users/users.service';
import { WalletService } from '../wallet/wallet.service';
import { WalletMutationResult } from '../wallet/wallet.service';
import { CreateAgentDto } from './dto/create-agent.dto';
import { Wallet } from '../wallet/entities/wallet.entity';
import { KenoTicket } from '../keno/entities/keno-ticket.entity';
import { BingoTicket } from '../bingo/entities/bingo-ticket.entity';
import { RngAuditLog } from '../rng/entities/rng-audit-log.entity';
import { User } from '../users/entities/user.entity';
import { KenoDraw } from '../keno/entities/keno-draw.entity';
import { BingoRoom } from '../bingo/entities/bingo-room.entity';
import { GameEventsGateway } from '../events/game-events.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import {
    LedgerEntry,
    LedgerEntryType,
} from '../ledger/entities/ledger-entry.entity';
import { Withdrawal } from '../wallet/entities/withdrawal.entity';
import { TelebirrDeposit } from '../payments/entities/telebirr-deposit.entity';
import { MpesaDeposit } from '../payments/entities/mpesa-deposit.entity';
import { AgentActionLog } from '../agents/entities/agent-action-log.entity';

@Injectable()
export class AdminService implements OnApplicationBootstrap {
    private readonly logger = new Logger(AdminService.name);

    constructor(
        private readonly dataSource: DataSource,
        @InjectRepository(SystemConfig)
        private readonly systemConfigRepository: Repository<SystemConfig>,
        @InjectRepository(PlatformStats)
        private readonly platformStatsRepository: Repository<PlatformStats>,
        @InjectRepository(ConfigChangeLog)
        private readonly configChangeLogRepository: Repository<ConfigChangeLog>,
        @InjectRepository(WithdrawalFeeRange)
        private readonly withdrawalFeeRangeRepository: Repository<WithdrawalFeeRange>,
        private readonly walletService: WalletService,
        private readonly usersService: UsersService,
        private readonly agentsService: AgentsService,
        private readonly gameEventsGateway: GameEventsGateway,
        private readonly notificationsService: NotificationsService,
    ) {}

    /** Create the Master Wallet at boot, not lazily on first use  see below. */
    async onApplicationBootstrap(): Promise<void> {
        try {
            await this.getOrCreateMasterWalletUserId();
        } catch (err) {
            this.logger.warn(
                `Master Wallet bootstrap skipped: ${err instanceof Error ? err.message : err}`,
            );
        }
    }

    async getSystemConfig(): Promise<SystemConfig> {
        let config = await this.systemConfigRepository.findOneBy({
            key: 'global',
        });
        if (!config) {
            config = this.systemConfigRepository.create({
                key: 'global',
                telebirrCreditMinorPerBirr: 1, // flat 1:1  1 Birr deposited = 1 ETB credited
                welcomeBonusMinor: 20,
                welcomeBonusEnabled: false,
                depositCashbackEnabled: false,
                depositCashbackPct: 0,
            });
            await this.systemConfigRepository.save(config);
        }
        return config;
    }

    async updateSystemConfig(
        update: UpdateSystemConfigDto,
        adminUserId: string,
    ): Promise<SystemConfig> {
        let config = await this.systemConfigRepository.findOneBy({
            key: 'global',
        });
        const previousReferralPct = config?.referralCommissionPct ?? 0;
        const previousReferralPctByGame =
            config?.referralCommissionPctByGame ?? null;
        if (!config) {
            config = this.systemConfigRepository.create({
                key: 'global',
                ...update,
            });
        } else {
            Object.assign(config, update);
        }
        const saved = await this.systemConfigRepository.save(config);

        if (
            update.referralCommissionPct !== undefined &&
            update.referralCommissionPct !== previousReferralPct
        ) {
            await this.logConfigChange({
                configType: 'global_referral_commission',
                entityId: null,
                previousValue: previousReferralPct,
                newValue: saved.referralCommissionPct,
                changedByAdminId: adminUserId,
            });
        }
        if (
            update.referralCommissionPctByGame !== undefined &&
            JSON.stringify(update.referralCommissionPctByGame) !==
                JSON.stringify(previousReferralPctByGame)
        ) {
            await this.logConfigChange({
                configType: 'global_referral_commission_by_game',
                entityId: null,
                previousValue: previousReferralPctByGame,
                newValue: saved.referralCommissionPctByGame ?? null,
                changedByAdminId: adminUserId,
            });
        }

        return saved;
    }

    // ── Config change audit trail ────────────────────────────────────────

    private async logConfigChange(entry: {
        configType: ConfigChangeType;
        entityId: string | null;
        previousValue: unknown;
        newValue: unknown;
        changedByAdminId: string;
    }): Promise<void> {
        const log = this.configChangeLogRepository.create({
            configType: entry.configType,
            entityId: entry.entityId,
            previousValue:
                entry.previousValue === undefined
                    ? null
                    : JSON.stringify(entry.previousValue),
            newValue:
                entry.newValue === undefined
                    ? null
                    : JSON.stringify(entry.newValue),
            changedByAdminId: entry.changedByAdminId,
        });
        await this.configChangeLogRepository.save(log);
    }

    async listConfigChanges(
        configType: ConfigChangeType | undefined,
        entityId: string | undefined,
        page: number,
        limit: number,
    ): Promise<{
        data: ConfigChangeLog[];
        total: number;
        page: number;
        limit: number;
    }> {
        const [data, total] = await this.configChangeLogRepository.findAndCount(
            {
                where: {
                    ...(configType ? { configType } : {}),
                    ...(entityId ? { entityId } : {}),
                },
                order: { createdAt: 'DESC' },
                skip: (page - 1) * limit,
                take: limit,
            },
        );
        return { data, total, page, limit };
    }

    /** Updates an agent and, if their referral-commission override changed, logs it. */
    async updateAgentWithAudit(
        agentId: string,
        dto: UpdateAgentDto,
        adminUserId: string,
    ): Promise<User> {
        const before = await this.usersService.findById(agentId);
        const previousPct = before?.referralCommissionPct ?? null;
        const previousPctByGame = before?.referralCommissionPctByGame ?? null;
        const updated = await this.usersService.updateAgentUser(agentId, dto);
        if (
            dto.referralCommissionPct !== undefined &&
            dto.referralCommissionPct !== previousPct
        ) {
            await this.logConfigChange({
                configType: 'agent_referral_commission',
                entityId: agentId,
                previousValue: previousPct,
                newValue: updated.referralCommissionPct ?? null,
                changedByAdminId: adminUserId,
            });
        }
        if (
            dto.referralCommissionPctByGame !== undefined &&
            JSON.stringify(dto.referralCommissionPctByGame) !==
                JSON.stringify(previousPctByGame)
        ) {
            await this.logConfigChange({
                configType: 'agent_referral_commission_by_game',
                entityId: agentId,
                previousValue: previousPctByGame,
                newValue: updated.referralCommissionPctByGame ?? null,
                changedByAdminId: adminUserId,
            });
        }
        return updated;
    }

    // ── Withdrawal fee ranges ─────────────────────────────────────────────

    async listWithdrawalFeeRanges(): Promise<{
        ranges: WithdrawalFeeRange[];
        coverageGaps: ReturnType<typeof computeCoverageGaps>;
    }> {
        const ranges = await this.withdrawalFeeRangeRepository.find({
            order: { minAmountMinor: 'ASC' },
        });
        const active = ranges.filter((r) => r.active);
        return { ranges, coverageGaps: computeCoverageGaps(active, 1) };
    }

    async createWithdrawalFeeRange(
        dto: CreateWithdrawalFeeRangeDto,
        adminUserId: string,
    ): Promise<WithdrawalFeeRange> {
        if (
            dto.maxAmountMinor !== undefined &&
            dto.maxAmountMinor !== null &&
            dto.maxAmountMinor < dto.minAmountMinor
        ) {
            throw new BadRequestException(
                'maxAmountMinor must be greater than or equal to minAmountMinor',
            );
        }
        const active = dto.active ?? true;
        if (active) {
            const existingActive = await this.withdrawalFeeRangeRepository.find(
                { where: { active: true } },
            );
            assertNoOverlap(
                {
                    minAmountMinor: dto.minAmountMinor,
                    maxAmountMinor: dto.maxAmountMinor ?? null,
                },
                existingActive,
            );
        }

        const range = this.withdrawalFeeRangeRepository.create({
            minAmountMinor: dto.minAmountMinor,
            maxAmountMinor: dto.maxAmountMinor ?? null,
            feeMinor: dto.feeMinor,
            active,
        });
        const saved = await this.withdrawalFeeRangeRepository.save(range);

        await this.logConfigChange({
            configType: 'withdrawal_fee_range',
            entityId: saved.id,
            previousValue: null,
            newValue: saved,
            changedByAdminId: adminUserId,
        });
        return saved;
    }

    async updateWithdrawalFeeRange(
        id: string,
        dto: UpdateWithdrawalFeeRangeDto,
        adminUserId: string,
    ): Promise<WithdrawalFeeRange> {
        const range = await this.withdrawalFeeRangeRepository.findOneBy({ id });
        if (!range)
            throw new NotFoundException('Withdrawal fee range not found');
        const previousValue = { ...range };

        const nextMin = dto.minAmountMinor ?? range.minAmountMinor;
        const nextMax =
            dto.maxAmountMinor !== undefined
                ? dto.maxAmountMinor
                : range.maxAmountMinor;
        const nextActive = dto.active ?? range.active;
        if (nextMax !== null && nextMax < nextMin) {
            throw new BadRequestException(
                'maxAmountMinor must be greater than or equal to minAmountMinor',
            );
        }
        if (nextActive) {
            const otherActive = await this.withdrawalFeeRangeRepository.find({
                where: { active: true },
            });
            assertNoOverlap(
                {
                    id: range.id,
                    minAmountMinor: nextMin,
                    maxAmountMinor: nextMax,
                },
                otherActive,
                range.id,
            );
        }

        range.minAmountMinor = nextMin;
        range.maxAmountMinor = nextMax;
        if (dto.feeMinor !== undefined) range.feeMinor = dto.feeMinor;
        range.active = nextActive;
        const saved = await this.withdrawalFeeRangeRepository.save(range);

        await this.logConfigChange({
            configType: 'withdrawal_fee_range',
            entityId: saved.id,
            previousValue,
            newValue: saved,
            changedByAdminId: adminUserId,
        });
        return saved;
    }

    async deleteWithdrawalFeeRange(
        id: string,
        adminUserId: string,
    ): Promise<void> {
        const range = await this.withdrawalFeeRangeRepository.findOneBy({ id });
        if (!range)
            throw new NotFoundException('Withdrawal fee range not found');
        await this.withdrawalFeeRangeRepository.remove(range);
        await this.logConfigChange({
            configType: 'withdrawal_fee_range',
            entityId: id,
            previousValue: range,
            newValue: null,
            changedByAdminId: adminUserId,
        });
    }

    // ── Master Wallet (shared across every admin account) ───────────────
    //
    // With 2+ admin accounts, each admin's OWN wallet would otherwise be a
    // separate float  whoever tops up sees a different balance than everyone
    // else. Every ETB top-up/transfer-to-agent instead operates on ONE Master
    // Wallet: a dedicated internal "system" account (roles: ['system'], no
    // login/password/Telegram identity of its own  NOT any individual admin's
    // personal account). Created at boot (onApplicationBootstrap above), not
    // lazily on first use, and remembered via system_configs.masterWalletUserId;
    // every admin manages the same one from day one, with no setup step
    // required.
    //
    // It is also the ONLY place e-money is created (`adminTopup`, no receipt
    // required  the house directly injecting supply). Every OTHER credit
    // anywhere in the system  player Telebirr/M-Pesa deposits, agent deposit
    // commissions, admin "Adjust Wallet", the welcome bonus  routes through
    // `creditFromMasterWallet` below instead of minting independently, so the
    // Master Wallet balance always represents the real ETB still available to
    // back new credits. `debitToMasterWallet` is the reverse, for money being
    // reclaimed FROM a wallet rather than paid out elsewhere (e.g. a downward
    // admin adjustment)  it returns to the Master Wallet rather than vanishing,
    // so total system supply is always conserved.

    /** Returns the Master Wallet's owning user id, creating it if it somehow doesn't exist yet. */
    async getOrCreateMasterWalletUserId(): Promise<string> {
        const config = await this.getSystemConfig();
        if (config.masterWalletUserId) return config.masterWalletUserId;

        const masterUser =
            await this.usersService.createSystemUser('Master Wallet');
        await this.walletService.ensureDefaultWallet(masterUser.id);
        config.masterWalletUserId = masterUser.id;
        await this.systemConfigRepository.save(config);
        return masterUser.id;
    }

    /** The Master Wallet's balance  what every admin's ETB Management tab should show. */
    async getHouseWallet() {
        const ownerId = await this.getOrCreateMasterWalletUserId();
        return this.walletService.getDefaultWalletSummary(ownerId);
    }

    async adminTopup(
        actingAdminId: string,
        amountMinor: number,
        idempotencyKey?: string,
    ) {
        const ownerId = await this.getOrCreateMasterWalletUserId();
        return this.walletService.adminTopup(
            ownerId,
            amountMinor,
            idempotencyKey,
            actingAdminId,
        );
    }

    async transferAdminToAgent(
        actingAdminId: string,
        agentId: string,
        amountMinor: number,
        idempotencyKey?: string,
    ) {
        const ownerId = await this.getOrCreateMasterWalletUserId();
        return this.walletService.transferAdminToAgent(
            ownerId,
            agentId,
            amountMinor,
            idempotencyKey,
            actingAdminId,
        );
    }

    /**
     * The single mechanism through which e-money enters ANY wallet other than the
     * Master Wallet itself: debits the Master Wallet and credits `targetUserId` by
     * the same amount, atomically, within the CALLER's own transaction (pass the
     * same `manager` the caller is already using, so this never opens a nested
     * transaction). `entryType`/`sourceType`/`sourceId`/`idempotencyKey`/`metadata`
     * describe the CREDIT side exactly as callers already recorded it before this
     * existed (e.g. entryType:'deposit', sourceType:'telebirr_receipt')  ledger
     * history for the receiving wallet is unchanged. The Master Wallet's own debit
     * side is always recorded as entryType:'adjustment', sourceType:
     * 'master_wallet_funding', so its own ledger stays legible as "who was this
     * funding."
     *
     * Throws  rolling back the caller's whole transaction  if the Master Wallet
     * can't cover it. This is deliberate: every credit anywhere must be backed by
     * real ETB the admin has already put into the Master Wallet via adminTopup, so
     * a shortfall blocks the credit rather than letting it happen for free. The
     * underlying "insufficient wallet balance" error is deliberately NOT surfaced
     * verbatim  callers (players, agents) should never see the words "Master
     * Wallet"; they get a generic "try again / contact support" message instead.
     */
    async creditFromMasterWallet(
        input: {
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
        const ownerId = await this.getOrCreateMasterWalletUserId();
        await this.walletService.ensureDefaultWallet(ownerId, manager);
        await this.walletService.ensureDefaultWallet(
            input.targetUserId,
            manager,
        );

        try {
            await this.walletService.debitInSession(
                {
                    userId: ownerId,
                    amountMinor: input.amountMinor,
                    entryType: 'adjustment',
                    sourceType: 'master_wallet_funding',
                    sourceId: input.sourceId,
                    idempotencyKey: `${input.idempotencyKey}:master-debit`,
                    metadata: {
                        ...input.metadata,
                        targetUserId: input.targetUserId,
                        fundedSourceType: input.sourceType,
                    },
                },
                manager,
            );
        } catch {
            throw new ConflictException(
                'Unable to process this right now  please try again shortly or contact support.',
            );
        }

        return this.walletService.creditInSession(
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

    /**
     * The reverse of `creditFromMasterWallet`: debits `sourceUserId` and returns the
     * amount to the Master Wallet, atomically, within the caller's own transaction.
     * Used when e-money is being reclaimed/removed from a wallet rather than paid
     * out elsewhere (e.g. a downward admin wallet adjustment)  keeps the Master
     * Wallet meaning "real ETB currently backing something in the system" instead
     * of letting reclaimed money simply vanish from the ledger.
     */
    async debitToMasterWallet(
        input: {
            sourceUserId: string;
            amountMinor: number;
            entryType: LedgerEntryType;
            sourceType: string;
            sourceId: string;
            idempotencyKey: string;
            metadata?: Record<string, unknown>;
        },
        manager: EntityManager,
    ): Promise<WalletMutationResult> {
        const ownerId = await this.getOrCreateMasterWalletUserId();
        await this.walletService.ensureDefaultWallet(ownerId, manager);

        const debitResult = await this.walletService.debitInSession(
            {
                userId: input.sourceUserId,
                amountMinor: input.amountMinor,
                entryType: input.entryType,
                sourceType: input.sourceType,
                sourceId: input.sourceId,
                idempotencyKey: input.idempotencyKey,
                metadata: input.metadata,
            },
            manager,
        );

        await this.walletService.creditInSession(
            {
                userId: ownerId,
                amountMinor: input.amountMinor,
                entryType: 'adjustment',
                sourceType: 'master_wallet_reclaim',
                sourceId: input.sourceId,
                idempotencyKey: `${input.idempotencyKey}:master-credit`,
                metadata: {
                    ...input.metadata,
                    sourceUserId: input.sourceUserId,
                    reclaimedSourceType: input.sourceType,
                },
            },
            manager,
        );

        return debitResult;
    }

    // ── Game Transactions ────────────────────────────────────────────────

    async getGameTransactions(page: number, limit: number) {
        const skip = (page - 1) * limit;

        const [rooms, total, [botWinRow]] = await Promise.all([
            this.dataSource.getRepository(BingoRoom).find({
                where: { status: 'completed' },
                order: { scheduledStartAt: 'DESC' },
                skip,
                take: limit,
            }),
            this.dataSource
                .getRepository(BingoRoom)
                .count({ where: { status: 'completed' } }),
            // Lifetime total  across every completed room, not just this page
            // so "real money bot win" is visible as a single figure, not something
            // an admin has to page through and sum by hand.
            this.dataSource.query(
                `SELECT COALESCE(SUM(t.payoutMinor), 0) totalBotWin
                   FROM bingo_tickets t
                   JOIN users u ON u.id = t.userId
                  WHERE JSON_EXTRACT(u.productMetadata, '$.botPolicy') IS NOT NULL`,
            ),
        ]);

        const transactions = await Promise.all(
            rooms.map(async (room) => {
                const tickets = await this.dataSource
                    .getRepository(BingoTicket)
                    .find({
                        where: { roomId: room.id },
                        relations: ['user'],
                    });

                const realPlayers = new Set<string>();
                const bots = new Set<string>();
                let ticketsByBot = 0;
                let botWonAmount = 0;
                const agentIds = new Set<string>();

                for (const ticket of tickets) {
                    const isBot = !!(ticket.user?.productMetadata as any)
                        ?.botPolicy;
                    if (isBot) {
                        bots.add(ticket.userId);
                        ticketsByBot++;
                        botWonAmount += ticket.payoutMinor;
                    } else {
                        realPlayers.add(ticket.userId);
                        if (ticket.user?.referredByAgentId) {
                            agentIds.add(ticket.user.referredByAgentId);
                        }
                    }
                }

                const realStake =
                    (room.soldTickets - ticketsByBot) * room.ticketPriceMinor;
                const realWinnings = tickets
                    .filter((t) => !(t.user?.productMetadata as any)?.botPolicy)
                    .reduce((sum, t) => sum + t.payoutMinor, 0);
                const realEmoneyEarned = realStake - realWinnings;

                let agentNames = '';
                if (agentIds.size > 0) {
                    const agents = await this.dataSource
                        .getRepository(User)
                        .find({
                            where: { id: In(Array.from(agentIds)) },
                            select: ['displayName'],
                        });
                    agentNames = agents.map((a) => a.displayName).join(', ');
                }

                return {
                    id: room.id,
                    createdAt: room.createdAt,
                    gameType: 'Bingo',
                    ticketsSold: room.soldTickets,
                    singleStake: room.ticketPriceMinor,
                    numberOfPlayers: realPlayers.size,
                    numberOfBots: bots.size,
                    ticketsTakenByBot: ticketsByBot,
                    agents: agentNames,
                    amountBotWon: botWonAmount,
                    realEmoneyEarned,
                };
            }),
        );

        return {
            data: transactions,
            total,
            page,
            limit,
            totalBotWinMinor: Number(botWinRow?.totalBotWin ?? 0),
        };
    }

    /**
     * Dashboard aggregates for the Game Transactions page  all-time/recent
     * summaries, distinct from the paginated room-by-room table above. Scoped
     * to Bingo only (the only game this page covers). Every query is a single
     * grouped aggregate, not a per-room loop, so this stays cheap regardless of
     * how many rooms have completed.
     */
    async getGameTransactionsDashboard(): Promise<{
        winSplit: { botWinMinor: number; realWinMinor: number };
        botWinBySource: Array<{ source: string; amountMinor: number }>;
        ticketSplit: { botTickets: number; realTickets: number };
        roomParticipationTrend: Array<{
            roomId: string;
            createdAt: string;
            realPlayers: number;
            bots: number;
        }>;
        dailyTrend: Array<{
            day: string;
            realStakeMinor: number;
            realPayoutMinor: number;
            botPayoutMinor: number;
        }>;
        revenueByAgent: Array<{
            agentId: string;
            agentName: string;
            realStakeMinor: number;
            realPayoutMinor: number;
            realEmoneyEarnedMinor: number;
        }>;
    }> {
        const BOT_FILTER = "JSON_EXTRACT(u.productMetadata, '$.botPolicy')";

        const [
            [ticketWinRow],
            botWinBySourceRows,
            [ticketCountRow],
            roomParticipationRows,
            dailyTrendRows,
            revenueByAgentRows,
        ] = await Promise.all([
            // Ticket-settlement wins (natural + cartel-dual-redirected), split bot/real.
            this.dataSource.query(
                `SELECT
             COALESCE(SUM(CASE WHEN ${BOT_FILTER} IS NOT NULL THEN t.payoutMinor ELSE 0 END), 0) botTicketWin,
             COALESCE(SUM(CASE WHEN ${BOT_FILTER} IS NULL THEN t.payoutMinor ELSE 0 END), 0) realTicketWin
           FROM bingo_tickets t
           JOIN users u ON u.id = t.userId
          WHERE t.status <> 'cancelled'`,
            ),
            // Bot win credits grouped by source  separates the unconditional
            // "bot win bonus" faucet (bingo_bot_win_interval, no ticket/stake
            // behind it) from ticket-tied wins, so the two are never conflated.
            this.dataSource.query(
                `SELECT le.sourceType source, COALESCE(SUM(le.amountMinor), 0) amountMinor
               FROM ledger_entries le
               JOIN users u ON u.id = le.userId
              WHERE le.entryType = 'win' AND ${BOT_FILTER} IS NOT NULL
                AND le.sourceType IN ('bingo_ticket', 'bingo_bot_win_interval')
              GROUP BY le.sourceType`,
            ),
            this.dataSource.query(
                `SELECT
             COALESCE(SUM(CASE WHEN ${BOT_FILTER} IS NOT NULL THEN 1 ELSE 0 END), 0) botTickets,
             COALESCE(SUM(CASE WHEN ${BOT_FILTER} IS NULL THEN 1 ELSE 0 END), 0) realTickets
           FROM bingo_tickets t
           JOIN users u ON u.id = t.userId
          WHERE t.status <> 'cancelled'`,
            ),
            // Last 30 completed rooms: real-player vs bot participation, oldest first.
            this.dataSource.query(
                `SELECT * FROM (
             SELECT t.roomId, r.createdAt,
                    COUNT(DISTINCT CASE WHEN ${BOT_FILTER} IS NULL THEN t.userId END) realPlayers,
                    COUNT(DISTINCT CASE WHEN ${BOT_FILTER} IS NOT NULL THEN t.userId END) bots
               FROM bingo_tickets t
               JOIN users u ON u.id = t.userId
               JOIN bingo_rooms r ON r.id = t.roomId
              WHERE r.status = 'completed' AND t.status <> 'cancelled'
              GROUP BY t.roomId, r.createdAt
              ORDER BY r.createdAt DESC
              LIMIT 30
           ) recent ORDER BY createdAt ASC`,
            ),
            // Last 14 days: real stake/payout vs bot payout (ticket wins + bonus faucet).
            this.dataSource.query(
                `SELECT * FROM (
             SELECT DATE(r.createdAt) day,
                    COALESCE(SUM(CASE WHEN ${BOT_FILTER} IS NULL THEN t.stakeMinor ELSE 0 END), 0) realStakeMinor,
                    COALESCE(SUM(CASE WHEN ${BOT_FILTER} IS NULL THEN t.payoutMinor ELSE 0 END), 0) realPayoutMinor,
                    COALESCE(SUM(CASE WHEN ${BOT_FILTER} IS NOT NULL THEN t.payoutMinor ELSE 0 END), 0) botPayoutMinor
               FROM bingo_tickets t
               JOIN users u ON u.id = t.userId
               JOIN bingo_rooms r ON r.id = t.roomId
              WHERE r.status = 'completed' AND t.status <> 'cancelled'
              GROUP BY DATE(r.createdAt)
              ORDER BY day DESC
              LIMIT 14
           ) recent ORDER BY day ASC`,
            ),
            // Real-player-only revenue per agent (mirrors realEmoneyEarned per room above).
            this.dataSource.query(
                `SELECT t.agentId, a.displayName agentName,
                    COALESCE(SUM(t.stakeMinor), 0) realStakeMinor,
                    COALESCE(SUM(t.payoutMinor), 0) realPayoutMinor
               FROM bingo_tickets t
               JOIN users u ON u.id = t.userId
               JOIN users a ON a.id = t.agentId
              WHERE t.status <> 'cancelled' AND t.agentId IS NOT NULL AND ${BOT_FILTER} IS NULL
              GROUP BY t.agentId, a.displayName
              ORDER BY (SUM(t.stakeMinor) - SUM(t.payoutMinor)) DESC
              LIMIT 20`,
            ),
        ]);

        const botWinBySource = botWinBySourceRows.map(
            (r: { source: string; amountMinor: string }) => ({
                source: r.source,
                amountMinor: Number(r.amountMinor ?? 0),
            }),
        );
        // "Bot win" for the pie is TOTAL bot liability (ticket-tied wins + the
        // unconditional bonus faucet)  botWinBySource is what breaks that total
        // back down into its two components.
        const botFaucetMinor =
            botWinBySource.find(
                (s: { source: string }) => s.source === 'bingo_bot_win_interval',
            )?.amountMinor ?? 0;

        return {
            winSplit: {
                botWinMinor: Number(ticketWinRow?.botTicketWin ?? 0) + botFaucetMinor,
                realWinMinor: Number(ticketWinRow?.realTicketWin ?? 0),
            },
            botWinBySource,
            ticketSplit: {
                botTickets: Number(ticketCountRow?.botTickets ?? 0),
                realTickets: Number(ticketCountRow?.realTickets ?? 0),
            },
            roomParticipationTrend: roomParticipationRows.map((r: any) => ({
                roomId: r.roomId,
                createdAt: r.createdAt,
                realPlayers: Number(r.realPlayers ?? 0),
                bots: Number(r.bots ?? 0),
            })),
            dailyTrend: dailyTrendRows.map((r: any) => ({
                day:
                    r.day instanceof Date
                        ? r.day.toISOString().slice(0, 10)
                        : String(r.day),
                realStakeMinor: Number(r.realStakeMinor ?? 0),
                realPayoutMinor: Number(r.realPayoutMinor ?? 0),
                botPayoutMinor: Number(r.botPayoutMinor ?? 0),
            })),
            revenueByAgent: revenueByAgentRows.map((r: any) => ({
                agentId: r.agentId,
                agentName: r.agentName,
                realStakeMinor: Number(r.realStakeMinor ?? 0),
                realPayoutMinor: Number(r.realPayoutMinor ?? 0),
                realEmoneyEarnedMinor:
                    Number(r.realStakeMinor ?? 0) - Number(r.realPayoutMinor ?? 0),
            })),
        };
    }

    /**
     * Paginated deposit history for one provider at a time (Telebirr or M-PESA),
     * covering credited AND rejected rows so admins can see exactly which agent
     * or the Master Wallet funded a deposit, or why it was rejected  the
     * `fundedBy`/`fundingFallbackReason` columns and `verification.error` are
     * the traceability trail for this. Kept as two separately-paginated,
     * per-provider queries (rather than a merged UNION feed) since the two
     * providers are already treated as parallel-but-separate lists elsewhere
     * (see `getUserActivity`'s deposits.telebirr/deposits.mpesa split).
     */
    async listDeposits(
        provider: 'telebirr' | 'mpesa',
        page: number,
        limit: number,
        filters: { status?: 'credited' | 'rejected'; agentId?: string },
    ) {
        const skip = (page - 1) * limit;
        const where: Record<string, unknown> = {};
        if (filters.status) where.status = filters.status;
        if (filters.agentId) where.agentId = filters.agentId;

        const repo =
            provider === 'telebirr'
                ? this.dataSource.getRepository(TelebirrDeposit)
                : this.dataSource.getRepository(MpesaDeposit);

        const [data, total] = await repo.findAndCount({
            where,
            relations: ['user', 'agent'],
            order: { createdAt: 'DESC' },
            skip,
            take: limit,
        });

        return { data, total, page, limit };
    }

    /**
     * Admin sign-off on a deposit, independent of crediting  the deposit is
     * already credited (or rejected) by the time this runs, and this never
     * touches the wallet/ledger. Purely a manual audit record layered on top.
     */
    async verifyDeposit(
        provider: 'telebirr' | 'mpesa',
        id: string,
        verificationStatus: 'verified' | 'flagged',
        adminUserId: string,
    ): Promise<TelebirrDeposit | MpesaDeposit> {
        if (provider === 'telebirr') {
            const repo = this.dataSource.getRepository(TelebirrDeposit);
            const deposit = await repo.findOneBy({ id });
            if (!deposit) throw new NotFoundException('Deposit not found');
            deposit.verificationStatus = verificationStatus;
            deposit.verifiedBy = adminUserId;
            deposit.verifiedAt = new Date();
            return repo.save(deposit);
        }

        const repo = this.dataSource.getRepository(MpesaDeposit);
        const deposit = await repo.findOneBy({ id });
        if (!deposit) throw new NotFoundException('Deposit not found');
        deposit.verificationStatus = verificationStatus;
        deposit.verifiedBy = adminUserId;
        deposit.verifiedAt = new Date();
        return repo.save(deposit);
    }

    // ══════════════════════════════════════════════════════════════════
    // Transactions (admin-wide money-movement feed)
    // ══════════════════════════════════════════════════════════════════

    /**
     * entryTypes that represent real MONEY MOVEMENT an admin would want to audit
     * - deposits, admin/agent transfers, adjustments, withdrawals, agent
     * commission payouts, reversals. Deliberately excludes 'stake'/'win'/
     * 'refund': those are gameplay noise (every bet and every win), and on a
     * live platform would bury the transactions an admin actually cares about
     * under a firehose of ticket purchases. A player's own full history
     * (including gameplay) is still available via GET /wallet/ledger and the
     * per-user admin activity view  this feed is deliberately narrower.
     */
    private static readonly MONEY_MOVEMENT_ENTRY_TYPES: LedgerEntryType[] = [
        'deposit',
        'adjustment',
        'bonus',
        'withdrawal',
        'agent_receipt',
        'reversal',
    ];

    /** Shared WHERE-building for getTransactions/exportTransactionsCsv, so the
     * two can never silently drift into counting different rows. */
    private buildTransactionsQuery(filters: {
        userId?: string;
        search?: string;
        entryType?: string;
        sourceType?: string;
        direction?: 'credit' | 'debit';
        dateFrom?: string;
        dateTo?: string;
    }) {
        const requestedTypes = filters.entryType
            ?.split(',')
            .map((t) => t.trim())
            .filter((t): t is LedgerEntryType =>
                AdminService.MONEY_MOVEMENT_ENTRY_TYPES.includes(
                    t as LedgerEntryType,
                ),
            );
        // An entryType filter that named only gameplay types (or nothing valid at
        // all) is treated as "no filter", not "match nothing"  IN () is invalid
        // SQL, and silently returning zero rows for a bad filter would look like
        // a bug rather than an ignored param.
        const types =
            requestedTypes && requestedTypes.length > 0
                ? requestedTypes
                : AdminService.MONEY_MOVEMENT_ENTRY_TYPES;

        const qb = this.dataSource
            .getRepository(LedgerEntry)
            .createQueryBuilder('le')
            .leftJoinAndSelect('le.user', 'user')
            .where('le.entryType IN (:...types)', { types });

        if (filters.userId) {
            qb.andWhere('le.userId = :userId', { userId: filters.userId });
        }
        if (filters.search?.trim()) {
            qb.andWhere(
                '(user.displayName LIKE :search OR user.phoneNumber LIKE :search)',
                { search: `%${filters.search.trim()}%` },
            );
        }
        if (filters.sourceType?.trim()) {
            qb.andWhere('le.sourceType = :sourceType', {
                sourceType: filters.sourceType.trim(),
            });
        }
        if (filters.direction) {
            qb.andWhere('le.direction = :direction', {
                direction: filters.direction,
            });
        }
        if (filters.dateFrom) {
            qb.andWhere('le.createdAt >= :dateFrom', {
                dateFrom: filters.dateFrom,
            });
        }
        if (filters.dateTo) {
            qb.andWhere('le.createdAt <= :dateTo', { dateTo: filters.dateTo });
        }
        return qb;
    }

    async getTransactions(filters: {
        page: number;
        limit: number;
        userId?: string;
        search?: string;
        entryType?: string;
        sourceType?: string;
        direction?: 'credit' | 'debit';
        dateFrom?: string;
        dateTo?: string;
    }) {
        const skip = (filters.page - 1) * filters.limit;
        const [data, total] = await this.buildTransactionsQuery(filters)
            .orderBy('le.createdAt', 'DESC')
            .skip(skip)
            .take(filters.limit)
            .getManyAndCount();

        return {
            data,
            total,
            page: filters.page,
            limit: filters.limit,
            totalPages: Math.ceil(total / filters.limit),
        };
    }

    /**
     * Same filters as getTransactions, no pagination  capped instead, so a
     * broad/unfiltered export can't run away on a large ledger. An admin who
     * genuinely needs more than this in one file should narrow the date range.
     */
    private static readonly CSV_EXPORT_ROW_CAP = 20_000;

    async exportTransactionsCsv(filters: {
        userId?: string;
        search?: string;
        entryType?: string;
        sourceType?: string;
        direction?: 'credit' | 'debit';
        dateFrom?: string;
        dateTo?: string;
    }): Promise<string> {
        const rows = await this.buildTransactionsQuery(filters)
            .orderBy('le.createdAt', 'DESC')
            .take(AdminService.CSV_EXPORT_ROW_CAP)
            .getMany();

        const escape = (value: unknown): string => {
            const s = value === null || value === undefined ? '' : String(value);
            return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        };

        const header = [
            'Date',
            'User',
            'Phone',
            'Direction',
            'Type',
            'Source',
            'AmountETB',
            'BalanceAfterETB',
            'SourceId',
        ];
        const lines = [header.join(',')];
        for (const row of rows) {
            lines.push(
                [
                    row.createdAt?.toISOString(),
                    row.user?.displayName,
                    row.user?.phoneNumber,
                    row.direction,
                    row.entryType,
                    row.sourceType,
                    row.amountMinor,
                    row.balanceAfterMinor,
                    row.sourceId,
                ]
                    .map(escape)
                    .join(','),
            );
        }
        return lines.join('\n');
    }

    /**
     * Detail behind a deposit-sourced transaction row (sourceType telebirr_receipt
     * / mpesa_receipt): the receipt itself  payer info, verification status,
     * which agent (if any) funded it. `sourceId` is the ledger entry's own
     * sourceId, which for these two sourceTypes IS the deposit's receiptNo/
     * confirmationCode (see PaymentsService.submitTelebirrReceipt et al).
     */
    async getDepositDetailForTransaction(
        provider: 'telebirr' | 'mpesa',
        sourceId: string,
    ): Promise<TelebirrDeposit | MpesaDeposit> {
        const deposit =
            provider === 'telebirr'
                ? await this.dataSource.getRepository(TelebirrDeposit).findOne({
                      where: { receiptNo: sourceId },
                      relations: ['user', 'agent'],
                  })
                : await this.dataSource.getRepository(MpesaDeposit).findOne({
                      where: { confirmationCode: sourceId },
                      relations: ['user', 'agent'],
                  });
        if (!deposit) throw new NotFoundException('Deposit not found');
        return deposit;
    }

    /**
     * Detail behind a withdrawal-sourced transaction row (sourceType
     * 'withdrawal'). `sourceId` is the ledger entry's sourceId, which for this
     * sourceType IS the withdrawal's own id (see WalletService's withdrawal
     * ledger entries).
     */
    async getWithdrawalDetailForTransaction(
        withdrawalId: string,
    ): Promise<Withdrawal> {
        const withdrawal = await this.dataSource
            .getRepository(Withdrawal)
            .findOne({
                where: { id: withdrawalId },
                relations: ['user', 'agent', 'processor'],
            });
        if (!withdrawal) throw new NotFoundException('Withdrawal not found');
        return withdrawal;
    }

    async getPlatformStats() {
        // 1. Total active liabilities (money in wallets)
        const walletStats = await this.dataSource
            .getRepository(Wallet)
            .createQueryBuilder('wallet')
            .select('SUM(wallet.availableMinor)', 'totalAvailable')
            .addSelect('SUM(wallet.reservedMinor)', 'totalReserved')
            .getRawOne();

        // 2. Keno Pending Tickets (liability)
        const kenoLiability = await this.dataSource
            .getRepository(KenoTicket)
            .createQueryBuilder('ticket')
            .select('SUM(ticket.stakeMinor)', 'totalStake')
            .where('ticket.settlementStatus = :status', { status: 'pending' })
            .getRawOne();

        // 3. Bingo Pending Tickets (liability)
        const bingoLiability = await this.dataSource
            .getRepository(BingoTicket)
            .createQueryBuilder('ticket')
            .select('SUM(ticket.stakeMinor)', 'totalStake')
            .where('ticket.settlementStatus = :status', { status: 'pending' })
            .getRawOne();

        // 4. Ledger Stats (Total Volume & GGR)
        const platformStatsDoc = await this.platformStatsRepository.findOneBy({
            key: 'global',
        });
        const ticketPurchases = platformStatsDoc
            ? Number(platformStatsDoc.totalTicketVolumeMinor)
            : 0;
        const payouts = platformStatsDoc
            ? Number(platformStatsDoc.totalPayoutsMinor)
            : 0;
        const refunds = platformStatsDoc
            ? Number(platformStatsDoc.totalRefundsMinor)
            : 0;

        const totals = {
            walletAvailable: walletStats?.totalAvailable
                ? Number(walletStats.totalAvailable)
                : 0,
            walletReserved: walletStats?.totalReserved
                ? Number(walletStats.totalReserved)
                : 0,
            kenoPendingStakes: kenoLiability?.totalStake
                ? Number(kenoLiability.totalStake)
                : 0,
            bingoPendingStakes: bingoLiability?.totalStake
                ? Number(bingoLiability.totalStake)
                : 0,
            ticketPurchases,
            payouts,
            refunds,
        };

        const ggr = totals.ticketPurchases - totals.payouts - totals.refunds;
        const totalLiabilities =
            totals.walletAvailable +
            totals.walletReserved +
            totals.kenoPendingStakes +
            totals.bingoPendingStakes;

        // 5. User & engagement stats
        const userRepository = this.dataSource.getRepository(User);
        const [totalUsers, totalPlayers, totalAgents, totalAdmins] =
            await Promise.all([
                userRepository.count(),
                userRepository
                    .createQueryBuilder('user')
                    .where('JSON_CONTAINS(user.roles, :role)', {
                        role: '"player"',
                    })
                    .getCount(),
                userRepository
                    .createQueryBuilder('user')
                    .where('JSON_CONTAINS(user.roles, :role)', {
                        role: '"agent"',
                    })
                    .getCount(),
                userRepository
                    .createQueryBuilder('user')
                    .where('JSON_CONTAINS(user.roles, :role)', {
                        role: '"admin"',
                    })
                    .getCount(),
            ]);

        // Active Keno players in open/locked draws
        const activeKenoDraws = await this.dataSource
            .getRepository(KenoDraw)
            .find({
                where: { status: In(['open', 'locked']) },
            });
        let activeKenoPlayers = 0;
        if (activeKenoDraws.length > 0) {
            const drawIds = activeKenoDraws.map((d) => d.id);
            const kenoResult = await this.dataSource
                .getRepository(KenoTicket)
                .createQueryBuilder('ticket')
                .select('COUNT(DISTINCT ticket.userId)', 'cnt')
                .where('ticket.drawId IN (:...drawIds)', { drawIds })
                .getRawOne();
            activeKenoPlayers = kenoResult?.cnt ? Number(kenoResult.cnt) : 0;
        }

        // Active Bingo players in open/running rooms
        const activeBingoRooms = await this.dataSource
            .getRepository(BingoRoom)
            .find({
                where: { status: In(['open', 'running']) },
            });
        let activeBingoPlayers = 0;
        if (activeBingoRooms.length > 0) {
            const roomIds = activeBingoRooms.map((r) => r.id);
            const bingoResult = await this.dataSource
                .getRepository(BingoTicket)
                .createQueryBuilder('ticket')
                .select('COUNT(DISTINCT ticket.userId)', 'cnt')
                .where('ticket.roomId IN (:...roomIds)', { roomIds })
                .getRawOne();
            activeBingoPlayers = bingoResult?.cnt ? Number(bingoResult.cnt) : 0;
        }

        // Online users count from socket gateway
        const liveCounts = this.gameEventsGateway.getLiveCounts();

        // Every ledger-side money-flow total the dashboard needs, in one pass:
        // real vs bot payouts (a slice of totalPayoutsMinor above, broken out so
        // it's visible that this liability is real, not cosmetic), total deposits
        // credited, total agent referral commission earned, and total balance an
        // admin has manually loaded onto player wallets (adjustUserWallet credits).
        const masterWalletUserId = await this.getOrCreateMasterWalletUserId();
        const BOT_FILTER = "JSON_EXTRACT(u.productMetadata, '$.botPolicy')";
        const [moneyFlowRow] = await this.dataSource.query(
            `SELECT
                COALESCE(SUM(CASE WHEN le.entryType = 'win' AND le.direction = 'credit' AND ${BOT_FILTER} IS NOT NULL THEN le.amountMinor ELSE 0 END), 0) totalBotWin,
                COALESCE(SUM(CASE WHEN le.entryType = 'win' AND le.direction = 'credit' AND ${BOT_FILTER} IS NULL THEN le.amountMinor ELSE 0 END), 0) totalPlayerWin,
                COALESCE(SUM(CASE WHEN le.entryType = 'deposit' AND le.direction = 'credit' AND le.sourceType = 'telebirr_receipt' THEN le.amountMinor ELSE 0 END), 0) totalTelebirrDeposits,
                COALESCE(SUM(CASE WHEN le.entryType = 'deposit' AND le.direction = 'credit' AND le.sourceType = 'mpesa_receipt' THEN le.amountMinor ELSE 0 END), 0) totalMpesaDeposits,
                COALESCE(SUM(CASE WHEN le.entryType = 'agent_receipt' AND le.direction = 'credit' THEN le.amountMinor ELSE 0 END), 0) totalAgentCommission,
                COALESCE(SUM(CASE WHEN le.sourceType = 'admin_adjustment' AND le.direction = 'credit' THEN le.amountMinor ELSE 0 END), 0) totalAdminLoad
               FROM ledger_entries le
               JOIN users u ON u.id = le.userId`,
        );
        const totalBotWinningsMinor = Number(moneyFlowRow?.totalBotWin ?? 0);
        const totalPlayerWinningsMinor = Number(
            moneyFlowRow?.totalPlayerWin ?? 0,
        );
        // Player deposits only  entryType='deposit' also covers admin_topup
        // (admin funding the Master Wallet itself) and admin_to_agent_transfer
        // (admin funding an agent's own working capital), neither of which is
        // money a PLAYER deposited, so those are deliberately excluded by
        // filtering on the two real payment-provider sourceTypes instead.
        const totalTelebirrDepositsMinor = Number(
            moneyFlowRow?.totalTelebirrDeposits ?? 0,
        );
        const totalMpesaDepositsMinor = Number(
            moneyFlowRow?.totalMpesaDeposits ?? 0,
        );
        const totalDepositsMinor =
            totalTelebirrDepositsMinor + totalMpesaDepositsMinor;
        const totalAgentCommissionMinor = Number(
            moneyFlowRow?.totalAgentCommission ?? 0,
        );
        const totalAdminLoadMinor = Number(moneyFlowRow?.totalAdminLoad ?? 0);

        // Current wallet balances split real vs bot (the Master Wallet itself is
        // neither  it's the platform's own float  so it's excluded from both).
        const [walletSplitRow] = await this.dataSource.query(
            `SELECT
                COALESCE(SUM(CASE WHEN ${BOT_FILTER} IS NOT NULL THEN w.availableMinor ELSE 0 END), 0) botWallet,
                COALESCE(SUM(CASE WHEN ${BOT_FILTER} IS NULL THEN w.availableMinor ELSE 0 END), 0) realWallet
               FROM wallets w
               JOIN users u ON u.id = w.userId
              WHERE u.id != ?`,
            [masterWalletUserId],
        );
        const totalBotPlayerWalletMinor = Number(
            walletSplitRow?.botWallet ?? 0,
        );
        const totalNormalPlayerWalletMinor = Number(
            walletSplitRow?.realWallet ?? 0,
        );

        return {
            ggrMinor: ggr,
            totalVolumeMinor: totals.ticketPurchases,
            totalPayoutsMinor: totals.payouts,
            totalRefundsMinor: totals.refunds,
            totalLiabilitiesMinor: totalLiabilities,
            totalBotWinningsMinor,
            totalPlayerWinningsMinor,
            totalDepositsMinor,
            totalTelebirrDepositsMinor,
            totalMpesaDepositsMinor,
            totalAgentCommissionMinor,
            totalAdminLoadMinor,
            totalNormalPlayerWalletMinor,
            totalBotPlayerWalletMinor,
            breakdown: {
                ...totals,
                totalUsers,
                totalPlayers,
                totalAgents,
                totalAdmins,
                totalBackofficeUsers: totalAgents + totalAdmins,
                activeKenoPlayers,
                activeBingoPlayers,
                onlineUsers: liveCounts.totalOnline,
                kenoOnline: liveCounts.kenoOnline,
                bingoOnline: liveCounts.bingoOnline,
                totalPlayingUsers: liveCounts.totalPlaying,
                totalConnections: liveCounts.totalConnections,
            },
        };
    }

    /**
     * Master Wallet liquidity health: current float balance, how it's trended
     * over the last 14 days (its OWN ledger entries  admin_topup/master_wallet_
     * reclaim credit it, master_wallet_funding/admin_to_agent_transfer debit
     * it  so this is the wallet's real inflow/outflow, not a proxy), player
     * deposits split by payment provider, and the outstanding withdrawal
     * liability it will need to cover.
     */
    async getLiquidityDashboard(): Promise<{
        masterWallet: { availableMinor: number; reservedMinor: number };
        depositsByProvider: {
            telebirrMinor: number;
            mpesaMinor: number;
            totalMinor: number;
        };
        pendingWithdrawals: { count: number; totalMinor: number };
        dailyFlow: Array<{
            day: string;
            inflowMinor: number;
            outflowMinor: number;
            netMinor: number;
        }>;
    }> {
        const masterWalletUserId = await this.getOrCreateMasterWalletUserId();

        const [masterWallet, depositRow, withdrawalRow, dailyFlowRows] =
            await Promise.all([
                this.walletService.getDefaultWalletSummary(masterWalletUserId),
                this.dataSource.query(
                    `SELECT
                        COALESCE(SUM(CASE WHEN sourceType = 'telebirr_receipt' THEN amountMinor ELSE 0 END), 0) telebirrMinor,
                        COALESCE(SUM(CASE WHEN sourceType = 'mpesa_receipt' THEN amountMinor ELSE 0 END), 0) mpesaMinor
                       FROM ledger_entries
                      WHERE entryType = 'deposit' AND direction = 'credit'
                        AND sourceType IN ('telebirr_receipt', 'mpesa_receipt')`,
                ),
                this.dataSource.query(
                    `SELECT COUNT(*) cnt, COALESCE(SUM(amountMinor), 0) totalMinor
                       FROM withdrawals
                      WHERE status IN ('pending', 'claimed', 'processing', 'awaiting_verification')`,
                ),
                this.dataSource.query(
                    `SELECT DATE(createdAt) day,
                        COALESCE(SUM(CASE WHEN direction = 'credit' THEN amountMinor ELSE 0 END), 0) inflowMinor,
                        COALESCE(SUM(CASE WHEN direction = 'debit' THEN amountMinor ELSE 0 END), 0) outflowMinor
                       FROM ledger_entries
                      WHERE userId = ?
                        AND createdAt >= DATE_SUB(CURDATE(), INTERVAL 13 DAY)
                      GROUP BY DATE(createdAt)
                      ORDER BY day ASC`,
                    [masterWalletUserId],
                ),
            ]);

        const [depositTotals] = depositRow;
        const [withdrawalTotals] = withdrawalRow;

        return {
            masterWallet: {
                availableMinor: masterWallet.availableMinor,
                reservedMinor: masterWallet.reservedMinor,
            },
            depositsByProvider: {
                telebirrMinor: Number(depositTotals?.telebirrMinor ?? 0),
                mpesaMinor: Number(depositTotals?.mpesaMinor ?? 0),
                totalMinor:
                    Number(depositTotals?.telebirrMinor ?? 0) +
                    Number(depositTotals?.mpesaMinor ?? 0),
            },
            pendingWithdrawals: {
                count: Number(withdrawalTotals?.cnt ?? 0),
                totalMinor: Number(withdrawalTotals?.totalMinor ?? 0),
            },
            dailyFlow: dailyFlowRows.map((row: Record<string, unknown>) => {
                const inflowMinor = Number(row.inflowMinor ?? 0);
                const outflowMinor = Number(row.outflowMinor ?? 0);
                return {
                    day:
                        row.day instanceof Date
                            ? row.day.toISOString().slice(0, 10)
                            : String(row.day),
                    inflowMinor,
                    outflowMinor,
                    netMinor: inflowMinor - outflowMinor,
                };
            }),
        };
    }

    async adjustUserWallet(
        userId: string,
        amountMinor: number,
        direction: 'credit' | 'debit',
        reason: string,
        actingAdminId: string,
    ) {
        return this.dataSource
            .transaction(async (manager) => {
                const shared = {
                    entryType: 'bonus' as const,
                    sourceType: 'admin_adjustment',
                    sourceId: randomUUID(),
                    idempotencyKey: `admin-adj:${randomUUID()}`,
                    metadata: { reason, actingAdminId },
                };

                // Both directions are backed by the Master Wallet: a credit is funded FROM
                // it (see creditFromMasterWallet); a debit RETURNS the reclaimed amount to
                // it (see debitToMasterWallet) rather than letting it vanish  keeps total
                // system supply conserved either way.
                if (direction === 'credit') {
                    return await this.creditFromMasterWallet(
                        { targetUserId: userId, amountMinor, ...shared },
                        manager,
                    );
                } else {
                    return await this.debitToMasterWallet(
                        { sourceUserId: userId, amountMinor, ...shared },
                        manager,
                    );
                }
            })
            .then(async (result) => {
                const amount = amountMinor.toLocaleString();
                await this.notificationsService.safeCreate(
                    direction === 'credit'
                        ? {
                              userId,
                              type: 'bonus',
                              title: 'Credit added',
                              body: reason
                                  ? `You received ${amount} ETB: ${reason}`
                                  : `You received ${amount} ETB.`,
                              data: { amountMinor, direction, reason },
                          }
                        : {
                              userId,
                              type: 'adjustment',
                              title: 'Balance adjusted',
                              body: reason
                                  ? `${amount} ETB was deducted: ${reason}`
                                  : `${amount} ETB was deducted from your balance.`,
                              data: { amountMinor, direction, reason },
                          },
                );
                return result;
            });
    }

    // ── Agent Shifts ──────────────────────────────────────────────────

    createShift(dto: CreateShiftDto) {
        return this.agentsService.createShift(dto);
    }

    listShifts() {
        return this.agentsService.listShifts();
    }

    updateShift(shiftId: string, dto: Partial<CreateShiftDto>) {
        return this.agentsService.updateShift(shiftId, dto);
    }

    deleteShift(shiftId: string) {
        return this.agentsService.deleteShift(shiftId);
    }

    getActiveShift() {
        return this.agentsService.getActiveShift();
    }

    // ── Agent Users ───────────────────────────────────────────────────

    async createAgent(input: CreateAgentDto) {
        return this.usersService.createAgentUser(input);
    }

    /**
     * Agent list, enriched with their live wallet balance and deposit-float
     * remaining  neither is visible anywhere else on the Agent Accounts screen,
     * which is exactly what made a depleted float invisible until a player
     * reported "no agent available for deposits" and it took a direct DB query
     * to explain why. Batched (one query per field, not one per agent) so this
     * stays cheap regardless of page size.
     */
    async listAgents(page: number, limit: number) {
        const result = await this.usersService.listAgents(page, limit);
        const agentIds = result.data.map((a) => a.id);
        const [balances, floatRemaining] = await Promise.all([
            this.walletService.getAvailableBalances(agentIds),
            this.walletService.getAgentFloatRemaining(agentIds),
        ]);
        return {
            ...result,
            data: result.data.map((a) => ({
                ...a,
                walletAvailableMinor: balances.get(a.id) ?? 0,
                depositFloatRemainingMinor: floatRemaining.get(a.id) ?? 0,
            })),
        };
    }

    async getUserActivity(userId: string, limit = 20) {
        const safeLimit = Math.min(Math.max(limit || 20, 1), 100);
        const user = await this.dataSource.getRepository(User).findOne({
            where: { id: userId },
            relations: ['wallets'],
        });

        if (!user) {
            throw new NotFoundException('User not found');
        }

        const [
            ledger,
            withdrawals,
            deposits,
            gameStats,
            adminAdjustmentEntries,
            adminTopupRows,
        ] = await Promise.all([
            this.dataSource.getRepository(LedgerEntry).find({
                where: { userId },
                order: { createdAt: 'DESC' },
                take: safeLimit,
            }),
            this.dataSource.getRepository(Withdrawal).find({
                where: { userId },
                relations: ['agent'],
                order: { createdAt: 'DESC' },
                take: safeLimit,
            }),
            this.dataSource.getRepository(TelebirrDeposit).find({
                where: { userId },
                relations: ['agent'],
                order: { createdAt: 'DESC' },
                take: safeLimit,
            }),
            this.getUserGameStats(userId),
            // Admin "Adjust Wallet Balance" entries  fetched separately (not just
            // sliced out of `ledger` above) since that feed is capped at safeLimit
            // across ALL activity and could crowd out older adjustments.
            this.dataSource.getRepository(LedgerEntry).find({
                where: {
                    userId,
                    entryType: 'bonus' as LedgerEntryType,
                    sourceType: 'admin_adjustment',
                },
                order: { createdAt: 'DESC' },
                take: safeLimit,
            }),
            // All-time sum (not capped) so the KPI is accurate even when the display
            // list above is truncated. Credit-only  "topped up" means money added;
            // debits still show in the list but don't count toward this total.
            this.dataSource.getRepository(LedgerEntry).query(
                `SELECT COALESCE(SUM(amountMinor),0) AS total FROM ledger_entries
          WHERE userId = ? AND entryType = 'bonus' AND sourceType = 'admin_adjustment' AND direction = 'credit'`,
                [userId],
            ),
        ]);

        // Resolve which admin performed each adjustment. actingAdminId only exists
        // on entries created after this feature shipped  older ones have no
        // recoverable attribution and resolve to null ("Unknown" in the UI).
        const adminIds = [
            ...new Set(
                adminAdjustmentEntries
                    .map(
                        (e) =>
                            (e.metadata?.actingAdminId as string | undefined) ??
                            null,
                    )
                    .filter((id): id is string => !!id),
            ),
        ];
        const admins = adminIds.length
            ? await this.dataSource
                  .getRepository(User)
                  .findBy({ id: In(adminIds) })
            : [];
        const adminNameById = new Map(admins.map((a) => [a.id, a.displayName]));
        const telebirrDepositMinor = deposits.reduce(
            (sum, deposit) => sum + Number(deposit.amountMinor),
            0,
        );
        const adminTopupMinor = Number(adminTopupRows[0]?.total ?? 0);

        const adminAdjustments = adminAdjustmentEntries.map((e) => {
            const performedByAdminId =
                (e.metadata?.actingAdminId as string | undefined) ?? null;
            return {
                id: e.id,
                createdAt: e.createdAt,
                amountMinor: Number(e.amountMinor),
                direction: e.direction,
                reason: (e.metadata?.reason as string | undefined) ?? null,
                performedByAdminId,
                performedByAdminName: performedByAdminId
                    ? (adminNameById.get(performedByAdminId) ?? null)
                    : null,
            };
        });

        return {
            user,
            ledger,
            withdrawals,
            deposits,
            gameStats,
            adminAdjustments,
            totals: {
                walletAvailableMinor: user.wallets?.[0]?.availableMinor ?? 0,
                walletReservedMinor: user.wallets?.[0]?.reservedMinor ?? 0,
                // "Deposits (Credited)" = all money that entered the wallet from
                // outside the player  agent-credited Telebirr receipts AND admin
                // top-ups. adminTopupMinor is also returned on its own below so the
                // dedicated Admin Top-ups card can show that portion by itself.
                depositMinor: telebirrDepositMinor + adminTopupMinor,
                completedWithdrawalMinor: withdrawals
                    .filter((withdrawal) => withdrawal.status === 'completed')
                    .reduce(
                        (sum, withdrawal) =>
                            sum + Number(withdrawal.amountMinor),
                        0,
                    ),
                adminTopupMinor,
            },
        };
    }

    /**
     * Per-game play summary for one player: tickets/bets bought, distinct rounds
     * played, total staked, wins (a win = positive payout, robust across all three
     * games' status enums), and total won. Cancelled/refunded rows are excluded so
     * "games played" reflects real participation. All money is integer minor units.
     */
    async getUserGameStats(userId: string) {
        const agg = async (
            table: string,
            roundCol: string,
            extraWhere: string,
        ) => {
            const rows: Array<{
                tickets: string | number;
                rounds: string | number;
                staked: string | number;
                wins: string | number;
                winMinor: string | number;
            }> = await this.dataSource.query(
                `SELECT COUNT(*) tickets,
                COUNT(DISTINCT ${roundCol}) rounds,
                COALESCE(SUM(stakeMinor),0) staked,
                COALESCE(SUM(CASE WHEN payoutMinor > 0 THEN 1 ELSE 0 END),0) wins,
                COALESCE(SUM(payoutMinor),0) winMinor
           FROM ${table}
          WHERE userId = ?${extraWhere}`,
                [userId],
            );
            const r = rows[0] ?? {};
            return {
                tickets: Number(r.tickets ?? 0),
                rounds: Number(r.rounds ?? 0),
                stakedMinor: Number(r.staked ?? 0),
                wins: Number(r.wins ?? 0),
                winMinor: Number(r.winMinor ?? 0),
            };
        };

        const [bingo, keno, crash] = await Promise.all([
            agg('bingo_tickets', 'roomId', ` AND status <> 'cancelled'`),
            agg('keno_tickets', 'drawId', ` AND status <> 'cancelled'`),
            agg('crash_bets', 'roundId', ''),
        ]);

        return {
            bingo,
            keno,
            crash,
            totalGamesPlayed: bingo.tickets + keno.tickets + crash.tickets,
            totalRoundsPlayed: bingo.rounds + keno.rounds + crash.rounds,
            totalStakedMinor:
                bingo.stakedMinor + keno.stakedMinor + crash.stakedMinor,
            totalWins: bingo.wins + keno.wins + crash.wins,
            totalWinMinor: bingo.winMinor + keno.winMinor + crash.winMinor,
        };
    }

    /**
     * Per-agent Bingo performance (Approach B): for each agent, the customers they
     * brought (first-deposit link) and the play in their rooms  tickets, distinct
     * players, total staked, total paid out, and GGR (house take = staked − payout).
     * Ranked by staked. Money is integer minor units. Bingo tickets carry the room
     * owner's agentId snapshot, so this is a straight group-by.
     */
    async getAgentPerformance(): Promise<
        Array<{
            agentId: string;
            displayName: string;
            customersBrought: number;
            referralClicks: number;
            tickets: number;
            players: number;
            stakedMinor: number;
            payoutMinor: number;
            ggrMinor: number;
            commissionEarnedMinor: number;
            commissionEarnedCount: number;
            withdrawalFeesEarnedMinor: number;
            depositCount: number;
            depositVolumeMinor: number;
            depositCommissionEarnedMinor: number;
            totalEarningsMinor: number;
            totalSettledMinor: number;
            remainingMinor: number;
            pendingWithdrawalRequests: number;
        }>
    > {
        // Bots are excluded from tickets/players/GGR  bot stakes aren't real revenue.
        // "Commission" is referral commission across every game that pays it (see
        // REFERRAL_COMMISSION_SOURCE_TYPES  Bingo, Keno, Crash, Pool, Werk), and
        // ONLY that  it deliberately excludes the removed `bingo_room_commission`
        // source (paid whenever an agent owned the Bingo room, independent of
        // referrals; nothing writes it anymore). Any pre-existing such rows are
        // historical revenue the agent really earned, but folding them into this
        // column made an agent with 0 referred players/GGR show a nonzero
        // "Commission" here, which read as a bug. Withdrawal fees are tracked
        // separately  payout_custody is deliberately excluded everywhere below,
        // it reimburses cash already paid out, not earnings.
        //
        // "Referred Players" (customersBrought) counts COALESCE(referredByAgentId,
        // assignedAgentId)  the SAME population every settleReferralCommission
        // (Bingo/Keno/Crash/Pool/Werk) pays commission from. Counting only
        // referredByAgentId undercounted it: a player connected via GPS match or
        // manual pick (assignedAgentId set, no referral code) still generates
        // commission for that agent, so excluding them made "Commission" nonzero
        // while "Referred Players" showed 0, which read as a bug.
        //
        // "Withdrawal Requests" (pendingWithdrawalRequests) counts PENDING
        // withdrawals from this SAME COALESCE(referredByAgentId, assignedAgentId)
        // population, regardless of whether agentWithdrawalRoutingEnabled is on
        // (routed to the agent) or off (admin-only)  it's "requests belonging to
        // this agent's users that need handling," not "requests this agent can
        // currently see." Click-through detail is GET /admin/agents/:id/withdrawals
        // (WalletService.getWithdrawalsByUsersAgent).
        const referralSourceTypesSql = REFERRAL_COMMISSION_SOURCE_TYPES.map(
            (t) => `'${t}'`,
        ).join(', ');
        const rows: Array<{
            id: string;
            displayName: string;
            customers: string | number;
            referralClicks: string | number;
            tickets: string | number;
            players: string | number;
            staked: string | number;
            payout: string | number;
            commission: string | number;
            commissionCount: string | number;
            withdrawalFees: string | number;
            deposits: string | number;
            depositVolume: string | number;
            depositCommission: string | number;
            settledMinor: string | number;
            claimedMinor: string | number;
            pendingWithdrawals: string | number;
        }> = await this.dataSource.query(
            `SELECT u.id, u.displayName, u.referralClickCount referralClicks,
              COALESCE(c.customers, 0) customers,
              COALESCE(t.tickets, 0) tickets,
              COALESCE(t.players, 0) players,
              COALESCE(t.staked, 0) staked,
              COALESCE(t.payout, 0) payout,
              COALESCE(cm.commission, 0) commission,
              COALESCE(cm.commissionCount, 0) commissionCount,
              COALESCE(wf.withdrawalFees, 0) withdrawalFees,
              COALESCE(d.deposits, 0) deposits,
              COALESCE(d.depositVolume, 0) depositVolume,
              COALESCE(dcm.commission, 0) depositCommission,
              COALESCE(st.settledMinor, 0) settledMinor,
              COALESCE(st.claimedMinor, 0) claimedMinor,
              COALESCE(pw.pendingWithdrawals, 0) pendingWithdrawals
         FROM users u
         LEFT JOIN (
           SELECT t.agentId, COUNT(*) tickets, COUNT(DISTINCT t.userId) players,
                  SUM(t.stakeMinor) staked, SUM(t.payoutMinor) payout
             FROM bingo_tickets t
             JOIN users pu ON pu.id = t.userId
            WHERE t.agentId IS NOT NULL AND t.status <> 'cancelled'
              AND JSON_EXTRACT(pu.productMetadata, '$.botPolicy') IS NULL
            GROUP BY t.agentId
         ) t ON t.agentId = u.id
         LEFT JOIN (
           SELECT COALESCE(referredByAgentId, assignedAgentId) AS agentId, COUNT(*) customers
             FROM users
            WHERE COALESCE(referredByAgentId, assignedAgentId) IS NOT NULL
            GROUP BY COALESCE(referredByAgentId, assignedAgentId)
         ) c ON c.agentId = u.id
         LEFT JOIN (
           SELECT userId, SUM(amountMinor) commission, COUNT(*) commissionCount
             FROM ledger_entries
            WHERE entryType = 'agent_receipt' AND sourceType IN (${referralSourceTypesSql})
            GROUP BY userId
         ) cm ON cm.userId = u.id
         LEFT JOIN (
           SELECT userId, SUM(amountMinor) withdrawalFees
             FROM ledger_entries
            WHERE entryType = 'agent_receipt' AND sourceType = 'withdrawal'
              AND JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.kind')) = 'withdrawal_fee'
            GROUP BY userId
         ) wf ON wf.userId = u.id
         LEFT JOIN (
           SELECT agentId, COUNT(*) deposits, SUM(amountMinor) depositVolume
             FROM agent_action_logs
            WHERE actionType IN ('telebirr_deposit_receipt','mpesa_deposit_receipt')
            GROUP BY agentId
         ) d ON d.agentId = u.id
         LEFT JOIN (
           SELECT userId, SUM(amountMinor) commission
             FROM ledger_entries
            WHERE entryType = 'agent_receipt' AND sourceType = 'deposit_commission'
            GROUP BY userId
         ) dcm ON dcm.userId = u.id
         LEFT JOIN (
           SELECT agentId,
                  SUM(CASE WHEN status = 'paid' THEN amountPaidMinor ELSE 0 END) settledMinor,
                  SUM(CASE WHEN status IN ('paid', 'pending', 'approved') THEN amountPaidMinor ELSE 0 END) claimedMinor
             FROM agent_settlements
            GROUP BY agentId
         ) st ON st.agentId = u.id
         LEFT JOIN (
           SELECT COALESCE(pu.referredByAgentId, pu.assignedAgentId) AS agentId, COUNT(*) pendingWithdrawals
             FROM withdrawals w
             JOIN users pu ON pu.id = w.userId
            WHERE w.status = 'pending'
              AND COALESCE(pu.referredByAgentId, pu.assignedAgentId) IS NOT NULL
            GROUP BY COALESCE(pu.referredByAgentId, pu.assignedAgentId)
         ) pw ON pw.agentId = u.id
        WHERE JSON_CONTAINS(u.roles, '"agent"')
        ORDER BY staked DESC`,
        );

        return rows.map((r) => {
            const stakedMinor = Number(r.staked ?? 0);
            const payoutMinor = Number(r.payout ?? 0);
            // Total earnings here matches AgentsService.computeAgentEarnings exactly
            // (referral commission + withdrawal fees)  `commission` is now
            // referral-only too (see the comment above), so it lines up with what
            // settlements (agent_settlements, computed from that same source)
            // actually claim against.
            const withdrawalFeesEarnedMinor = Number(r.withdrawalFees ?? 0);
            const totalEarningsMinor =
                Number(r.commission ?? 0) + withdrawalFeesEarnedMinor;
            const claimedMinor = Number(r.claimedMinor ?? 0);
            return {
                agentId: r.id,
                displayName: r.displayName,
                customersBrought: Number(r.customers ?? 0),
                referralClicks: Number(r.referralClicks ?? 0),
                tickets: Number(r.tickets ?? 0),
                players: Number(r.players ?? 0),
                stakedMinor,
                payoutMinor,
                ggrMinor: stakedMinor - payoutMinor,
                commissionEarnedMinor: Number(r.commission ?? 0),
                commissionEarnedCount: Number(r.commissionCount ?? 0),
                withdrawalFeesEarnedMinor,
                depositCount: Number(r.deposits ?? 0),
                depositVolumeMinor: Number(r.depositVolume ?? 0),
                depositCommissionEarnedMinor: Number(r.depositCommission ?? 0),
                totalEarningsMinor,
                totalSettledMinor: Number(r.settledMinor ?? 0),
                remainingMinor: Math.max(0, totalEarningsMinor - claimedMinor),
                pendingWithdrawalRequests: Number(r.pendingWithdrawals ?? 0),
            };
        });
    }

    async getAgentActions(limit = 100) {
        const safeLimit = Math.min(Math.max(limit || 100, 1), 200);

        const [ledger, withdrawals, events, deposits] = await Promise.all([
            this.dataSource
                .getRepository(LedgerEntry)
                .createQueryBuilder('entry')
                .leftJoinAndSelect('entry.user', 'agent')
                .where('JSON_CONTAINS(agent.roles, :role)', { role: '"agent"' })
                .andWhere('entry.sourceType IN (:...sourceTypes)', {
                    sourceTypes: [
                        'admin_to_agent_transfer',
                        'agent_to_user_transfer',
                        'withdrawal',
                    ],
                })
                .orderBy('entry.createdAt', 'DESC')
                .take(safeLimit)
                .getMany(),
            this.dataSource.getRepository(Withdrawal).find({
                where: {},
                relations: ['user', 'agent', 'processor'],
                order: { updatedAt: 'DESC' },
                take: safeLimit,
            }),
            this.dataSource.getRepository(AgentActionLog).find({
                relations: ['agent', 'user'],
                order: { createdAt: 'DESC' },
                take: safeLimit,
            }),
            this.dataSource.getRepository(TelebirrDeposit).find({
                where: {},
                relations: ['user', 'agent'],
                order: { createdAt: 'DESC' },
                take: safeLimit,
            }),
        ]);

        const summaryByAgent = new Map<
            string,
            {
                agentId: string;
                agentName?: string;
                totalDepositsMinor: number;
                depositCount: number;
                totalTransfersToUsersMinor: number;
                transferCount: number;
                totalWithdrawalsMinor: number;
                withdrawalCount: number;
                totalReceiptsMinor: number;
                receiptCount: number;
                eventCount: number;
            }
        >();

        const getSummary = (agentId?: string, agentName?: string) => {
            if (!agentId) return null;
            const existing = summaryByAgent.get(agentId);
            if (existing) {
                if (!existing.agentName && agentName)
                    existing.agentName = agentName;
                return existing;
            }
            const created = {
                agentId,
                agentName,
                totalDepositsMinor: 0,
                depositCount: 0,
                totalTransfersToUsersMinor: 0,
                transferCount: 0,
                totalWithdrawalsMinor: 0,
                withdrawalCount: 0,
                totalReceiptsMinor: 0,
                receiptCount: 0,
                eventCount: 0,
            };
            summaryByAgent.set(agentId, created);
            return created;
        };

        for (const entry of ledger) {
            const summary = getSummary(entry.userId, entry.user?.displayName);
            if (!summary) continue;
            if (entry.sourceType === 'agent_to_user_transfer') {
                summary.transferCount += 1;
                summary.totalTransfersToUsersMinor += Number(entry.amountMinor);
            }
            if (
                entry.sourceType === 'withdrawal' &&
                entry.entryType === 'agent_receipt'
            ) {
                summary.receiptCount += 1;
                summary.totalReceiptsMinor += Number(entry.amountMinor);
            }
        }

        for (const withdrawal of withdrawals) {
            const agentId = withdrawal.agentId || withdrawal.processedBy;
            const agentName =
                withdrawal.agent?.displayName ||
                withdrawal.processor?.displayName;
            const summary = getSummary(agentId, agentName);
            if (!summary) continue;
            summary.withdrawalCount += 1;
            summary.totalWithdrawalsMinor += Number(withdrawal.amountMinor);
        }

        for (const deposit of deposits) {
            const summary = getSummary(
                deposit.agentId,
                deposit.agent?.displayName,
            );
            if (!summary) continue;
            summary.depositCount += 1;
            summary.totalDepositsMinor += Number(deposit.amountMinor);
        }

        for (const event of events) {
            const summary = getSummary(event.agentId, event.agent?.displayName);
            if (!summary) continue;
            summary.eventCount += 1;
        }

        return {
            events: events.map((event) => ({
                id: event.id,
                agentId: event.agentId,
                agentName: event.agent?.displayName,
                userId: event.userId,
                userName: event.user?.displayName,
                withdrawalId: event.withdrawalId,
                ledgerEntryId: event.ledgerEntryId,
                actionType: event.actionType,
                amountMinor: event.amountMinor,
                metadata: event.metadata || {},
                createdAt: event.createdAt,
            })),
            deposits: deposits
                .filter((deposit) => deposit.agentId)
                .map((deposit) => ({
                    id: deposit.id,
                    agentId: deposit.agentId,
                    agentName: deposit.agent?.displayName,
                    userId: deposit.userId,
                    userName: deposit.user?.displayName,
                    receiptNo: deposit.receiptNo,
                    amountMinor: deposit.amountMinor,
                    status: deposit.status,
                    payerPhone: deposit.payerPhone,
                    creditedPartyAccount: deposit.creditedPartyAccount,
                    createdAt: deposit.createdAt,
                })),
            ledger: ledger.map((entry) => ({
                id: entry.id,
                agentId: entry.userId,
                agentName: entry.user?.displayName,
                amountMinor: entry.amountMinor,
                direction: entry.direction,
                entryType: entry.entryType,
                sourceType: entry.sourceType,
                sourceId: entry.sourceId,
                balanceAfterMinor: entry.balanceAfterMinor,
                metadata: entry.metadata || {},
                createdAt: entry.createdAt,
            })),
            withdrawals: withdrawals
                .filter(
                    (withdrawal) =>
                        withdrawal.agentId || withdrawal.processedBy,
                )
                .map((withdrawal) => ({
                    id: withdrawal.id,
                    userId: withdrawal.userId,
                    userName: withdrawal.user?.displayName,
                    agentId: withdrawal.agentId || withdrawal.processedBy,
                    agentName:
                        withdrawal.agent?.displayName ||
                        withdrawal.processor?.displayName,
                    amountMinor: withdrawal.amountMinor,
                    status: withdrawal.status,
                    destinationAccount: withdrawal.destinationAccount,
                    serviceChargeMinor: withdrawal.serviceChargeMinor,
                    netAmountMinor: withdrawal.netAmountMinor,
                    telebirrReference: withdrawal.telebirrReference,
                    adminNotes: withdrawal.adminNotes,
                    claimedAt: withdrawal.claimedAt,
                    processedAt: withdrawal.processedAt,
                    updatedAt: withdrawal.updatedAt,
                    createdAt: withdrawal.createdAt,
                })),
            summaryByAgent: Array.from(summaryByAgent.values()).sort(
                (left, right) => {
                    return (
                        right.eventCount - left.eventCount ||
                        right.totalWithdrawalsMinor -
                            left.totalWithdrawalsMinor ||
                        right.totalDepositsMinor - left.totalDepositsMinor
                    );
                },
            ),
        };
    }

    async getRngAuditLogs(input: {
        gameType?: string;
        gameReference?: string;
        page: number;
        limit: number;
    }) {
        const filter: Record<string, any> = {};
        if (input.gameType) filter.gameType = input.gameType;
        if (input.gameReference) filter.gameReference = input.gameReference;

        const skip = (input.page - 1) * input.limit;
        const [data, total] = await this.dataSource
            .getRepository(RngAuditLog)
            .findAndCount({
                where: filter,
                order: { createdAt: 'DESC' },
                skip,
                take: input.limit,
            });

        return {
            data,
            total,
            page: input.page,
            limit: input.limit,
            totalPages: Math.ceil(total / input.limit),
        };
    }
}
