import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { UsersService } from '../users/users.service';

@Injectable()
export class ReconciliationScheduler {
  private readonly logger = new Logger(ReconciliationScheduler.name);

  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly usersService: UsersService
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async reconcileLedgers(): Promise<void> {
    this.logger.log('Starting global ledger reconciliation...');
    const users = await this.connection.collection('users').find({ status: 'active' }).toArray();

    let anomaliesFound = 0;
    for (const user of users) {
      try {
        const wallet = await this.connection.collection('wallets').findOne({ userId: user._id, currencyCode: 'CREDIT' });
        if (!wallet) continue;

        const ledgerSum = await this.connection.collection('ledgerentries').aggregate([
          { $match: { walletId: wallet._id } },
          { $group: {
              _id: null,
              totalCredit: {
                $sum: { $cond: [{ $eq: ['$direction', 'credit'] }, '$amountMinor', 0] }
              },
              totalDebit: {
                $sum: { $cond: [{ $eq: ['$direction', 'debit'] }, '$amountMinor', 0] }
              }
            }
          }
        ]).toArray();

        const expectedBalance = ledgerSum.length > 0 ? ledgerSum[0].totalCredit - ledgerSum[0].totalDebit : 0;
        const actualBalance = wallet.availableMinor + wallet.reservedMinor;

        if (expectedBalance !== actualBalance) {
          anomaliesFound++;
          this.logger.error(`[URGENT] Wallet anomaly detected for user ${user._id}! Expected: ${expectedBalance}, Actual: ${actualBalance}`);
          
          // Suspend user instantly to prevent damage
          await this.usersService.updateStatus(user._id.toString(), 'suspended');
          this.logger.warn(`User ${user._id} suspended automatically due to ledger mismatch.`);
        }
      } catch (err) {
        this.logger.error(`Error reconciling user ${user._id}`, err instanceof Error ? err.stack : err);
      }
    }
    
    this.logger.log(`Ledger reconciliation completed. Anomalies found: ${anomaliesFound}`);
  }
}
