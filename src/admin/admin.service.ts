import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, In } from 'typeorm';
import { randomUUID } from 'crypto';
import { SystemConfig } from './entities/system-config.entity';
import { PlatformStats } from './entities/platform-stats.entity';
import { UpdateSystemConfigDto } from './dto/update-system-config.dto';
import { AgentsService } from '../agents/agents.service';
import { CreateShiftDto } from '../agents/dto/create-shift.dto';
import { UsersService } from '../users/users.service';
import { WalletService } from '../wallet/wallet.service';
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
import { LedgerEntry } from '../ledger/entities/ledger-entry.entity';
import { Withdrawal } from '../wallet/entities/withdrawal.entity';
import { TelebirrDeposit } from '../payments/entities/telebirr-deposit.entity';
import { AgentActionLog } from '../agents/entities/agent-action-log.entity';

@Injectable()
export class AdminService {
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
      const payload = {
        userId,
        amountMinor,
        direction,
        entryType: 'bonus' as const,
        sourceType: 'admin_adjustment',
        sourceId: randomUUID(),
        idempotencyKey: `admin-adj:${randomUUID()}`,
        metadata: { reason }
      };
      
      if (direction === 'credit') {
        return await this.walletService.creditInSession(payload, manager);
      } else {
        return await this.walletService.debitInSession(payload, manager);
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
