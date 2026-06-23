import { Injectable } from '@nestjs/common';
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
import { LedgerEntry } from '../ledger/entities/ledger-entry.entity';
import { Withdrawal } from '../wallet/entities/withdrawal.entity';

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
  ) {}

  async getSystemConfig(): Promise<SystemConfig> {
    let config = await this.systemConfigRepository.findOneBy({ key: 'global' });
    if (!config) {
      config = this.systemConfigRepository.create({
        key: 'global',
        telebirrCreditMinorPerBirr: 100,
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
    // Total players (role includes player)
    const totalUsers = await this.dataSource.getRepository(User)
      .createQueryBuilder('user')
      .where('JSON_CONTAINS(user.roles, :role)', { role: '"player"' })
      .getCount();

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
        activeKenoPlayers,
        activeBingoPlayers,
        onlineUsers: liveCounts.totalOnline,
        kenoOnline: liveCounts.kenoOnline,
        bingoOnline: liveCounts.bingoOnline,
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

  async getAgentActions(limit = 100) {
    const safeLimit = Math.min(Math.max(limit || 100, 1), 200);

    const ledger = await this.dataSource.getRepository(LedgerEntry)
      .createQueryBuilder('entry')
      .leftJoinAndSelect('entry.user', 'agent')
      .where('JSON_CONTAINS(agent.roles, :role)', { role: '"agent"' })
      .andWhere('entry.sourceType IN (:...sourceTypes)', {
        sourceTypes: ['admin_to_agent_transfer', 'agent_to_user_transfer', 'withdrawal']
      })
      .orderBy('entry.createdAt', 'DESC')
      .take(safeLimit)
      .getMany();

    const withdrawals = await this.dataSource.getRepository(Withdrawal).find({
      where: {},
      relations: ['user', 'agent'],
      order: { updatedAt: 'DESC' },
      take: safeLimit
    });

    return {
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
          agentName: withdrawal.agent?.displayName,
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
        }))
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
