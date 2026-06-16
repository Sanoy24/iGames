import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { UsersService } from '../users/users.service';
import { RedisLockService } from '../redis/redis-lock.service';
import { User } from '../users/entities/user.entity';
import { Wallet } from '../wallet/entities/wallet.entity';
import { LedgerEntry } from '../ledger/entities/ledger-entry.entity';

const RECONCILIATION_LOCK_KEY = 'igames:reconciliation:lock';
const RECONCILIATION_LOCK_TTL_MS = 10 * 60 * 1000; // 10 minutes

@Injectable()
export class ReconciliationScheduler {
  private readonly logger = new Logger(ReconciliationScheduler.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly usersService: UsersService,
    private readonly lockService: RedisLockService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async reconcileLedgers(): Promise<void> {
    const lock = await this.lockService.acquireLock(RECONCILIATION_LOCK_KEY, RECONCILIATION_LOCK_TTL_MS);
    if (!lock) return;

    try {
      this.logger.log('Starting global ledger reconciliation...');
      const users = await this.dataSource.getRepository(User).findBy({ status: 'active' });

      let anomaliesFound = 0;
      for (const user of users) {
        try {
          const wallet = await this.dataSource.getRepository(Wallet).findOneBy({ userId: user.id, currencyCode: 'CREDIT' });
          if (!wallet) continue;

          const ledgerSum = await this.dataSource.getRepository(LedgerEntry)
            .createQueryBuilder('entry')
            .select('SUM(CASE WHEN entry.direction = :credit THEN entry.amountMinor ELSE 0 END)', 'totalCredit')
            .addSelect('SUM(CASE WHEN entry.direction = :debit THEN entry.amountMinor ELSE 0 END)', 'totalDebit')
            .where('entry.walletId = :walletId', { walletId: wallet.id, credit: 'credit', debit: 'debit' })
            .getRawOne();

          const expectedBalance = ledgerSum ? Number(ledgerSum.totalCredit || 0) - Number(ledgerSum.totalDebit || 0) : 0;
          // reservedMinor is already debited from the ledger (pending withdrawal escrow),
          // so the ledger balance maps to availableMinor only.
          const actualBalance = wallet.availableMinor;

          if (expectedBalance !== actualBalance) {
            anomaliesFound++;
            this.logger.error(`[URGENT] Wallet anomaly detected for user ${user.id}! Expected: ${expectedBalance}, Actual: ${actualBalance}`);
            
            // Suspend user instantly to prevent damage
            await this.usersService.updateStatus(user.id, 'suspended');
            this.logger.warn(`User ${user.id} suspended automatically due to ledger mismatch.`);
          }
        } catch (err) {
          this.logger.error(`Error reconciling user ${user.id}`, err instanceof Error ? err.stack : err);
        }
      }
      
      this.logger.log(`Ledger reconciliation completed. Anomalies found: ${anomaliesFound}`);
    } finally {
      await this.lockService.releaseLock(lock);
    }
  }
}
