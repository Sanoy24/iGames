import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model } from 'mongoose';
import { SystemConfig } from './schemas/system-config.schema';

@Injectable()
export class AdminService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(SystemConfig.name) private readonly configModel: Model<SystemConfig>
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
    // ticket_purchase is money IN. payout is money OUT. refund is money OUT.
    const ledgerStats = await this.connection.collection('ledgerentries').aggregate([
      {
        $group: {
          _id: '$entryType',
          totalAmount: { $sum: '$amountMinor' }
        }
      }
    ]).toArray();

    const totals = {
      walletAvailable: walletStats[0]?.totalAvailable || 0,
      walletReserved: walletStats[0]?.totalReserved || 0,
      kenoPendingStakes: kenoLiability[0]?.totalStake || 0,
      bingoPendingStakes: bingoLiability[0]?.totalStake || 0,
      ticketPurchases: 0,
      payouts: 0,
      refunds: 0,
    };

    ledgerStats.forEach(stat => {
      if (stat._id === 'ticket_purchase') totals.ticketPurchases = stat.totalAmount;
      if (stat._id === 'payout') totals.payouts = stat.totalAmount;
      if (stat._id === 'refund') totals.refunds = stat.totalAmount;
    });

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
}
