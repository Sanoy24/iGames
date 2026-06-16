import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { SystemConfig } from './schemas/system-config.schema';
import { UpdateSystemConfigDto } from './dto/update-system-config.dto';
import { AgentsService } from '../agents/agents.service';
import { CreateShiftDto } from '../agents/dto/create-shift.dto';
import { UsersService } from '../users/users.service';
import { WalletService } from '../wallet/wallet.service';
import { CreateAgentDto } from './dto/create-agent.dto';

@Injectable()
export class AdminService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(SystemConfig.name) private readonly configModel: Model<SystemConfig>,
    private readonly walletService: WalletService,
    private readonly usersService: UsersService,
    private readonly agentsService: AgentsService,
  ) {}

  async getSystemConfig(): Promise<SystemConfig> {
    const config = await this.configModel.findOne({ key: 'global' }).exec();
    if (!config) {
      return this.configModel.create({
        key: 'global',
        telebirrCreditMinorPerBirr: 100,
        welcomeBonusMinor: 0
      });
    }
    return config;
  }

  async updateSystemConfig(update: UpdateSystemConfigDto): Promise<SystemConfig> {
    const config = await this.configModel.findOneAndUpdate(
      { key: 'global' },
      { $set: update },
      { new: true, upsert: true }
    ).exec();
    return config;
  }

  async getPlatformStats() {
    // 1. Total active liabilities (money in wallets)
    const walletStats = await this.connection.collection('wallets').aggregate([
      {
        $group: {
          _id: null,
          totalAvailable: { $sum: '$availableMinor' },
          totalReserved: { $sum: '$reservedMinor' }
        }
      }
    ]).toArray();

    // 2. Keno Pending Tickets (liability)
    const kenoLiability = await this.connection.collection('kenotickets').aggregate([
      { $match: { settlementStatus: 'pending' } },
      { $group: { _id: null, totalStake: { $sum: '$stakeMinor' } } }
    ]).toArray();

    // 3. Bingo Pending Tickets (liability)
    const bingoLiability = await this.connection.collection('bingotickets').aggregate([
      { $match: { settlementStatus: 'pending' } },
      { $group: { _id: null, totalStake: { $sum: '$stakeMinor' } } }
    ]).toArray();

    // 4. Ledger Stats (Total Volume & GGR)
    const platformStatsDoc = await this.connection.collection('platformstats').findOne({ key: 'global' });
    const ticketPurchases = platformStatsDoc?.totalTicketVolumeMinor || 0;
    const payouts = platformStatsDoc?.totalPayoutsMinor || 0;
    const refunds = platformStatsDoc?.totalRefundsMinor || 0;

    const totals = {
      walletAvailable: walletStats[0]?.totalAvailable || 0,
      walletReserved: walletStats[0]?.totalReserved || 0,
      kenoPendingStakes: kenoLiability[0]?.totalStake || 0,
      bingoPendingStakes: bingoLiability[0]?.totalStake || 0,
      ticketPurchases,
      payouts,
      refunds,
    };

    const ggr = totals.ticketPurchases - totals.payouts - totals.refunds;
    const totalLiabilities = totals.walletAvailable + totals.walletReserved + totals.kenoPendingStakes + totals.bingoPendingStakes;

    return {
      ggrMinor: ggr,
      totalVolumeMinor: totals.ticketPurchases,
      totalPayoutsMinor: totals.payouts,
      totalRefundsMinor: totals.refunds,
      totalLiabilitiesMinor: totalLiabilities,
      breakdown: totals
    };
  }

  async adjustUserWallet(userId: string, amountMinor: number, direction: 'credit' | 'debit', reason: string) {
    const session = await this.connection.startSession();
    try {
      let result;
      await session.withTransaction(async () => {
        const payload = {
          userId,
          amountMinor,
          direction,
          entryType: 'bonus' as const,
          sourceType: 'admin_adjustment',
          sourceId: new Types.ObjectId().toString(),
          idempotencyKey: `admin-adj:${new Types.ObjectId().toString()}`,
          metadata: { reason }
        };
        
        if (direction === 'credit') {
          result = await this.walletService.creditInSession(payload, session);
        } else {
          result = await this.walletService.debitInSession(payload, session);
        }
      });
      return result;
    } finally {
      await session.endSession();
    }
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

  async getRngAuditLogs(input: {
    gameType?: string;
    gameReference?: string;
    page: number;
    limit: number;
  }) {
    const filter: Record<string, unknown> = {};
    if (input.gameType) filter.gameType = input.gameType;
    if (input.gameReference) filter.gameReference = input.gameReference;

    const skip = (input.page - 1) * input.limit;
    const [data, total] = await Promise.all([
      this.connection
        .collection('rngauditlogs')
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(input.limit)
        .toArray(),
      this.connection.collection('rngauditlogs').countDocuments(filter),
    ]);

    return { data, total, page: input.page, limit: input.limit, totalPages: Math.ceil(total / input.limit) };
  }
}
