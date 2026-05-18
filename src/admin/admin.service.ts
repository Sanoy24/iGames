import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { SystemConfig } from './schemas/system-config.schema';
import { WalletService } from '../wallet/wallet.service';

@Injectable()
export class AdminService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(SystemConfig.name) private readonly configModel: Model<SystemConfig>,
    private readonly walletService: WalletService
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

  async updateSystemConfig(update: Partial<SystemConfig>): Promise<SystemConfig> {
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
}
