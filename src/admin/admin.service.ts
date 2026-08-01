import { ConflictException, Injectable, Logger, NotFoundException, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager, In } from 'typeorm';
import { randomUUID } from 'crypto';
import { SystemConfig } from './entities/system-config.entity';
import { PlatformStats } from './entities/platform-stats.entity';
import { UpdateSystemConfigDto } from './dto/update-system-config.dto';
import { AgentsService } from '../agents/agents.service';
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
import { LedgerEntry, LedgerEntryType } from '../ledger/entities/ledger-entry.entity';
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
    private readonly walletService: WalletService,
    private readonly usersService: UsersService,
    private readonly agentsService: AgentsService,
    private readonly gameEventsGateway: GameEventsGateway,
    private readonly notificationsService: NotificationsService,
  ) {}

  /** Create the Master Wallet at boot, not lazily on first use — see below. */
  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.getOrCreateMasterWalletUserId();
    } catch (err) {
      this.logger.warn(`Master Wallet bootstrap skipped: ${err instanceof Error ? err.message : err}`);
    }
  }

  async getSystemConfig(): Promise<SystemConfig> {
    let config = await this.systemConfigRepository.findOneBy({ key: 'global' });
    if (!config) {
      config = this.systemConfigRepository.create({
        key: 'global',
        telebirrCreditMinorPerBirr: 1, // flat 1:1 — 1 Birr deposited = 1 ETB credited
        welcomeBonusMinor: 0
      });
      await this.systemConfigRepository.save(config);
    }
    return config;
  }

  async updateSystemConfig(update: UpdateSystemConfigDto): Promise<SystemConfig> {
    let config = await this.systemConfigRepository.findOneBy({ key: 'global' });
    if (!config) {
      config = this.systemConfigRepository.create({
        key: 'global',
        ...update
      });
    } else {
      Object.assign(config, update);
    }
    return await this.systemConfigRepository.save(config);
  }

  // ── Master Wallet (shared across every admin account) ───────────────
  //
  // With 2+ admin accounts, each admin's OWN wallet would otherwise be a
  // separate float — whoever tops up sees a different balance than everyone
  // else. Every ETB top-up/transfer-to-agent instead operates on ONE Master
  // Wallet: a dedicated internal "system" account (roles: ['system'], no
  // login/password/Telegram identity of its own — NOT any individual admin's
  // personal account). Created at boot (onApplicationBootstrap above), not
  // lazily on first use, and remembered via system_configs.masterWalletUserId;
  // every admin manages the same one from day one, with no setup step
  // required.
  //
  // It is also the ONLY place e-money is created (`adminTopup`, no receipt
  // required — the house directly injecting supply). Every OTHER credit
  // anywhere in the system — player Telebirr/M-Pesa deposits, agent deposit
  // commissions, admin "Adjust Wallet", the welcome bonus — routes through
  // `creditFromMasterWallet` below instead of minting independently, so the
  // Master Wallet balance always represents the real ETB still available to
  // back new credits. `debitToMasterWallet` is the reverse, for money being
  // reclaimed FROM a wallet rather than paid out elsewhere (e.g. a downward
  // admin adjustment) — it returns to the Master Wallet rather than vanishing,
  // so total system supply is always conserved.

  /** Returns the Master Wallet's owning user id, creating it if it somehow doesn't exist yet. */
  private async getOrCreateMasterWalletUserId(): Promise<string> {
    const config = await this.getSystemConfig();
    if (config.masterWalletUserId) return config.masterWalletUserId;

    const masterUser = await this.usersService.createSystemUser('Master Wallet');
    await this.walletService.ensureDefaultWallet(masterUser.id);
    config.masterWalletUserId = masterUser.id;
    await this.systemConfigRepository.save(config);
    return masterUser.id;
  }

  /** The Master Wallet's balance — what every admin's ETB Management tab should show. */
  async getHouseWallet() {
    const ownerId = await this.getOrCreateMasterWalletUserId();
    return this.walletService.getDefaultWalletSummary(ownerId);
  }

  async adminTopup(actingAdminId: string, amountMinor: number, idempotencyKey?: string) {
    const ownerId = await this.getOrCreateMasterWalletUserId();
    return this.walletService.adminTopup(ownerId, amountMinor, idempotencyKey, actingAdminId);
  }

  async transferAdminToAgent(actingAdminId: string, agentId: string, amountMinor: number, idempotencyKey?: string) {
    const ownerId = await this.getOrCreateMasterWalletUserId();
    return this.walletService.transferAdminToAgent(ownerId, agentId, amountMinor, idempotencyKey, actingAdminId);
  }

  /**
   * The single mechanism through which e-money enters ANY wallet other than the
   * Master Wallet itself: debits the Master Wallet and credits `targetUserId` by
   * the same amount, atomically, within the CALLER's own transaction (pass the
   * same `manager` the caller is already using, so this never opens a nested
   * transaction). `entryType`/`sourceType`/`sourceId`/`idempotencyKey`/`metadata`
   * describe the CREDIT side exactly as callers already recorded it before this
   * existed (e.g. entryType:'deposit', sourceType:'telebirr_receipt') — ledger
   * history for the receiving wallet is unchanged. The Master Wallet's own debit
   * side is always recorded as entryType:'adjustment', sourceType:
   * 'master_wallet_funding', so its own ledger stays legible as "who was this
   * funding."
   *
   * Throws — rolling back the caller's whole transaction — if the Master Wallet
   * can't cover it. This is deliberate: every credit anywhere must be backed by
   * real ETB the admin has already put into the Master Wallet via adminTopup, so
   * a shortfall blocks the credit rather than letting it happen for free. The
   * underlying "insufficient wallet balance" error is deliberately NOT surfaced
   * verbatim — callers (players, agents) should never see the words "Master
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
    await this.walletService.ensureDefaultWallet(input.targetUserId, manager);

    try {
      await this.walletService.debitInSession(
        {
          userId: ownerId,
          amountMinor: input.amountMinor,
          entryType: 'adjustment',
          sourceType: 'master_wallet_funding',
          sourceId: input.sourceId,
          idempotencyKey: `${input.idempotencyKey}:master-debit`,
          metadata: { ...input.metadata, targetUserId: input.targetUserId, fundedSourceType: input.sourceType },
        },
        manager,
      );
    } catch {
      throw new ConflictException('Unable to process this right now — please try again shortly or contact support.');
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
   * out elsewhere (e.g. a downward admin wallet adjustment) — keeps the Master
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
        metadata: { ...input.metadata, sourceUserId: input.sourceUserId, reclaimedSourceType: input.sourceType },
      },
      manager,
    );

    return debitResult;
  }

  // ── Game Transactions ────────────────────────────────────────────────

  async getGameTransactions(page: number, limit: number) {
    const skip = (page - 1) * limit;

    const [rooms, total] = await this.dataSource.getRepository(BingoRoom).findAndCount({
      where: { status: 'completed' },
      order: { scheduledStartAt: 'DESC' },
      skip,
      take: limit,
    });

    const transactions = await Promise.all(
      rooms.map(async (room) => {
        const tickets = await this.dataSource.getRepository(BingoTicket).find({
          where: { roomId: room.id },
          relations: ['user'],
        });

        const realPlayers = new Set<string>();
        const bots = new Set<string>();
        let ticketsByBot = 0;
        let botWonAmount = 0;
        const agentIds = new Set<string>();

        for (const ticket of tickets) {
          const isBot = !!(ticket.user?.productMetadata as any)?.botPolicy?.active;
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

        const realStake = (room.soldTickets - ticketsByBot) * room.ticketPriceMinor;
        const realWinnings = tickets
          .filter((t) => !(t.user?.productMetadata as any)?.botPolicy?.active)
          .reduce((sum, t) => sum + t.payoutMinor, 0);
        const realEmoneyEarned = realStake - realWinnings;

        let agentNames = '';
        if (agentIds.size > 0) {
          const agents = await this.dataSource.getRepository(User).find({
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

    return { data: transactions, total, page, limit };
  }

  /**
   * Paginated deposit history for one provider at a time (Telebirr or M-PESA),
   * covering credited AND rejected rows so admins can see exactly which agent
   * or the Master Wallet funded a deposit, or why it was rejected — the
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

    const repo = provider === 'telebirr'
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

  async getPlatformStats() {
    // 1. Total active liabilities (money in wallets)
    const walletStats = await this.dataSource.getRepository(Wallet)
      .createQueryBuilder('wallet')
      .select('SUM(wallet.availableMinor)', 'totalAvailable')
      .addSelect('SUM(wallet.reservedMinor)', 'totalReserved')
      .getRawOne();

    // 2. Keno Pending Tickets (liability)
    const kenoLiability = await this.dataSource.getRepository(KenoTicket)
      .createQueryBuilder('ticket')
      .select('SUM(ticket.stakeMinor)', 'totalStake')
      .where('ticket.settlementStatus = :status', { status: 'pending' })
      .getRawOne();

    // 3. Bingo Pending Tickets (liability)
    const bingoLiability = await this.dataSource.getRepository(BingoTicket)
      .createQueryBuilder('ticket')
      .select('SUM(ticket.stakeMinor)', 'totalStake')
      .where('ticket.settlementStatus = :status', { status: 'pending' })
      .getRawOne();

    // 4. Ledger Stats (Total Volume & GGR)
    const platformStatsDoc = await this.platformStatsRepository.findOneBy({ key: 'global' });
    const ticketPurchases = platformStatsDoc ? Number(platformStatsDoc.totalTicketVolumeMinor) : 0;
    const payouts = platformStatsDoc ? Number(platformStatsDoc.totalPayoutsMinor) : 0;
    const refunds = platformStatsDoc ? Number(platformStatsDoc.totalRefundsMinor) : 0;

    const totals = {
      walletAvailable: walletStats?.totalAvailable ? Number(walletStats.totalAvailable) : 0,
      walletReserved: walletStats?.totalReserved ? Number(walletStats.totalReserved) : 0,
      kenoPendingStakes: kenoLiability?.totalStake ? Number(kenoLiability.totalStake) : 0,
      bingoPendingStakes: bingoLiability?.totalStake ? Number(bingoLiability.totalStake) : 0,
      ticketPurchases,
      payouts,
      refunds,
    };

    const ggr = totals.ticketPurchases - totals.payouts - totals.refunds;
    const totalLiabilities = totals.walletAvailable + totals.walletReserved + totals.kenoPendingStakes + totals.bingoPendingStakes;

    // 5. User & engagement stats
    const userRepository = this.dataSource.getRepository(User);
    const [totalUsers, totalPlayers, totalAgents, totalAdmins] = await Promise.all([
      userRepository.count(),
      userRepository
        .createQueryBuilder('user')
        .where('JSON_CONTAINS(user.roles, :role)', { role: '"player"' })
        .getCount(),
      userRepository
        .createQueryBuilder('user')
        .where('JSON_CONTAINS(user.roles, :role)', { role: '"agent"' })
        .getCount(),
      userRepository
        .createQueryBuilder('user')
        .where('JSON_CONTAINS(user.roles, :role)', { role: '"admin"' })
        .getCount(),
    ]);

    // Active Keno players in open/locked draws
    const activeKenoDraws = await this.dataSource.getRepository(KenoDraw).find({
      where: { status: In(['open', 'locked']) }
    });
    let activeKenoPlayers = 0;
    if (activeKenoDraws.length > 0) {
      const drawIds = activeKenoDraws.map(d => d.id);
      const kenoResult = await this.dataSource.getRepository(KenoTicket)
        .createQueryBuilder('ticket')
        .select('COUNT(DISTINCT ticket.userId)', 'cnt')
        .where('ticket.drawId IN (:...drawIds)', { drawIds })
        .getRawOne();
      activeKenoPlayers = kenoResult?.cnt ? Number(kenoResult.cnt) : 0;
    }

    // Active Bingo players in open/running rooms
    const activeBingoRooms = await this.dataSource.getRepository(BingoRoom).find({
      where: { status: In(['open', 'running']) }
    });
    let activeBingoPlayers = 0;
    if (activeBingoRooms.length > 0) {
      const roomIds = activeBingoRooms.map(r => r.id);
      const bingoResult = await this.dataSource.getRepository(BingoTicket)
        .createQueryBuilder('ticket')
        .select('COUNT(DISTINCT ticket.userId)', 'cnt')
        .where('ticket.roomId IN (:...roomIds)', { roomIds })
        .getRawOne();
      activeBingoPlayers = bingoResult?.cnt ? Number(bingoResult.cnt) : 0;
    }

    // Online users count from socket gateway
    const liveCounts = this.gameEventsGateway.getLiveCounts();

    return {
      ggrMinor: ggr,
      totalVolumeMinor: totals.ticketPurchases,
      totalPayoutsMinor: totals.payouts,
      totalRefundsMinor: totals.refunds,
      totalLiabilitiesMinor: totalLiabilities,
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
      }
    };
  }

  async adjustUserWallet(userId: string, amountMinor: number, direction: 'credit' | 'debit', reason: string) {
    return this.dataSource.transaction(async (manager) => {
      const shared = {
        entryType: 'bonus' as const,
        sourceType: 'admin_adjustment',
        sourceId: randomUUID(),
        idempotencyKey: `admin-adj:${randomUUID()}`,
        metadata: { reason }
      };

      // Both directions are backed by the Master Wallet: a credit is funded FROM
      // it (see creditFromMasterWallet); a debit RETURNS the reclaimed amount to
      // it (see debitToMasterWallet) rather than letting it vanish — keeps total
      // system supply conserved either way.
      if (direction === 'credit') {
        return await this.creditFromMasterWallet({ targetUserId: userId, amountMinor, ...shared }, manager);
      } else {
        return await this.debitToMasterWallet({ sourceUserId: userId, amountMinor, ...shared }, manager);
      }
    }).then(async (result) => {
      const amount = amountMinor.toLocaleString();
      await this.notificationsService.safeCreate(
        direction === 'credit'
          ? {
              userId,
              type: 'bonus',
              title: 'Credit added',
              body: reason ? `You received ${amount} ETB: ${reason}` : `You received ${amount} ETB.`,
              data: { amountMinor, direction, reason },
            }
          : {
              userId,
              type: 'adjustment',
              title: 'Balance adjusted',
              body: reason ? `${amount} ETB was deducted: ${reason}` : `${amount} ETB was deducted from your balance.`,
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

  async listAgents(page: number, limit: number) {
    return this.usersService.listAgents(page, limit);
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

    const [ledger, withdrawals, deposits, gameStats] = await Promise.all([
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
    ]);

    return {
      user,
      ledger,
      withdrawals,
      deposits,
      gameStats,
      totals: {
        walletAvailableMinor: user.wallets?.[0]?.availableMinor ?? 0,
        walletReservedMinor: user.wallets?.[0]?.reservedMinor ?? 0,
        depositMinor: deposits
          .filter((deposit) => deposit.status === 'credited')
          .reduce((sum, deposit) => sum + Number(deposit.amountMinor), 0),
        completedWithdrawalMinor: withdrawals
          .filter((withdrawal) => withdrawal.status === 'completed')
          .reduce((sum, withdrawal) => sum + Number(withdrawal.amountMinor), 0),
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
    const agg = async (table: string, roundCol: string, extraWhere: string) => {
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
      totalStakedMinor: bingo.stakedMinor + keno.stakedMinor + crash.stakedMinor,
      totalWins: bingo.wins + keno.wins + crash.wins,
      totalWinMinor: bingo.winMinor + keno.winMinor + crash.winMinor,
    };
  }

  /**
   * Per-agent Bingo performance (Approach B): for each agent, the customers they
   * brought (first-deposit link) and the play in their rooms — tickets, distinct
   * players, total staked, total paid out, and GGR (house take = staked − payout).
   * Ranked by staked. Money is integer minor units. Bingo tickets carry the room
   * owner's agentId snapshot, so this is a straight group-by.
   */
  async getAgentPerformance(): Promise<
    Array<{
      agentId: string;
      displayName: string;
      customersBrought: number;
      tickets: number;
      players: number;
      stakedMinor: number;
      payoutMinor: number;
      ggrMinor: number;
      commissionEarnedMinor: number;
      depositCount: number;
      depositVolumeMinor: number;
      depositCommissionEarnedMinor: number;
    }>
  > {
    // Bots are excluded from tickets/players/GGR — bot stakes aren't real revenue.
    const rows: Array<{
      id: string;
      displayName: string;
      customers: string | number;
      tickets: string | number;
      players: string | number;
      staked: string | number;
      payout: string | number;
      commission: string | number;
      deposits: string | number;
      depositVolume: string | number;
      depositCommission: string | number;
    }> = await this.dataSource.query(
      `SELECT u.id, u.displayName,
              COALESCE(c.customers, 0) customers,
              COALESCE(t.tickets, 0) tickets,
              COALESCE(t.players, 0) players,
              COALESCE(t.staked, 0) staked,
              COALESCE(t.payout, 0) payout,
              COALESCE(cm.commission, 0) commission,
              COALESCE(d.deposits, 0) deposits,
              COALESCE(d.depositVolume, 0) depositVolume,
              COALESCE(dcm.commission, 0) depositCommission
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
           SELECT referredByAgentId, COUNT(*) customers
             FROM users
            WHERE referredByAgentId IS NOT NULL
            GROUP BY referredByAgentId
         ) c ON c.referredByAgentId = u.id
         LEFT JOIN (
           SELECT userId, SUM(amountMinor) commission
             FROM ledger_entries
            WHERE entryType = 'agent_receipt' AND sourceType = 'bingo_room_commission'
            GROUP BY userId
         ) cm ON cm.userId = u.id
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
        WHERE JSON_CONTAINS(u.roles, '"agent"')
        ORDER BY staked DESC`,
    );

    return rows.map((r) => {
      const stakedMinor = Number(r.staked ?? 0);
      const payoutMinor = Number(r.payout ?? 0);
      return {
        agentId: r.id,
        displayName: r.displayName,
        customersBrought: Number(r.customers ?? 0),
        tickets: Number(r.tickets ?? 0),
        players: Number(r.players ?? 0),
        stakedMinor,
        payoutMinor,
        ggrMinor: stakedMinor - payoutMinor,
        commissionEarnedMinor: Number(r.commission ?? 0),
        depositCount: Number(r.deposits ?? 0),
        depositVolumeMinor: Number(r.depositVolume ?? 0),
        depositCommissionEarnedMinor: Number(r.depositCommission ?? 0),
      };
    });
  }

  async getAgentActions(limit = 100) {
    const safeLimit = Math.min(Math.max(limit || 100, 1), 200);

    const [ledger, withdrawals, events, deposits] = await Promise.all([
      this.dataSource.getRepository(LedgerEntry)
        .createQueryBuilder('entry')
        .leftJoinAndSelect('entry.user', 'agent')
        .where('JSON_CONTAINS(agent.roles, :role)', { role: '"agent"' })
        .andWhere('entry.sourceType IN (:...sourceTypes)', {
          sourceTypes: ['admin_to_agent_transfer', 'agent_to_user_transfer', 'withdrawal']
        })
        .orderBy('entry.createdAt', 'DESC')
        .take(safeLimit)
        .getMany(),
      this.dataSource.getRepository(Withdrawal).find({
        where: {},
        relations: ['user', 'agent', 'processor'],
        order: { updatedAt: 'DESC' },
        take: safeLimit
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

    const summaryByAgent = new Map<string, {
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
    }>();

    const getSummary = (agentId?: string, agentName?: string) => {
      if (!agentId) return null;
      const existing = summaryByAgent.get(agentId);
      if (existing) {
        if (!existing.agentName && agentName) existing.agentName = agentName;
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
      if (entry.sourceType === 'withdrawal' && entry.entryType === 'agent_receipt') {
        summary.receiptCount += 1;
        summary.totalReceiptsMinor += Number(entry.amountMinor);
      }
    }

    for (const withdrawal of withdrawals) {
      const agentId = withdrawal.agentId || withdrawal.processedBy;
      const agentName = withdrawal.agent?.displayName || withdrawal.processor?.displayName;
      const summary = getSummary(agentId, agentName);
      if (!summary) continue;
      summary.withdrawalCount += 1;
      summary.totalWithdrawalsMinor += Number(withdrawal.amountMinor);
    }

    for (const deposit of deposits) {
      const summary = getSummary(deposit.agentId, deposit.agent?.displayName);
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
        createdAt: entry.createdAt
      })),
      withdrawals: withdrawals
        .filter((withdrawal) => withdrawal.agentId || withdrawal.processedBy)
        .map((withdrawal) => ({
          id: withdrawal.id,
          userId: withdrawal.userId,
          userName: withdrawal.user?.displayName,
          agentId: withdrawal.agentId || withdrawal.processedBy,
          agentName: withdrawal.agent?.displayName || withdrawal.processor?.displayName,
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
          createdAt: withdrawal.createdAt
        })),
      summaryByAgent: Array.from(summaryByAgent.values()).sort((left, right) => {
        return (
          right.eventCount - left.eventCount ||
          right.totalWithdrawalsMinor - left.totalWithdrawalsMinor ||
          right.totalDepositsMinor - left.totalDepositsMinor
        );
      }),
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
    const [data, total] = await this.dataSource.getRepository(RngAuditLog).findAndCount({
      where: filter,
      order: { createdAt: 'DESC' },
      skip,
      take: input.limit
    });

    return { data, total, page: input.page, limit: input.limit, totalPages: Math.ceil(total / input.limit) };
  }
}
