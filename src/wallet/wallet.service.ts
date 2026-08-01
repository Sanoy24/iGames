import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager, In } from 'typeorm';
import { createHash } from 'crypto';
import { LedgerService } from '../ledger/ledger.service';
import { LedgerEntry, LedgerEntryType } from '../ledger/entities/ledger-entry.entity';
import { GameEventsGateway } from '../events/game-events.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import { AgentActionLog, AgentActionType } from '../agents/entities/agent-action-log.entity';
import { Wallet } from './entities/wallet.entity';
import { WagerLimit } from './entities/wager-limit.entity';
import { Withdrawal, WithdrawalStatus } from './entities/withdrawal.entity';
import { WithdrawalFeeRange } from './entities/withdrawal-fee-range.entity';
import { User } from '../users/entities/user.entity';
import { SystemConfig } from '../admin/entities/system-config.entity';
import { normalizeEthiopianPhone } from '../common/phone.util';

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
    private readonly notificationsService: NotificationsService
  ) {}

  async ensureDefaultWallet(
    userId: string,
    manager?: EntityManager
  ): Promise<Wallet> {
    const repo = manager ? manager.getRepository(Wallet) : this.walletRepository;
    const existingWallet = await repo.findOneBy({ userId, currencyCode: 'CREDIT' });

    if (existingWallet) {
      return existingWallet;
    }

    const wallet = repo.create({
      userId,
      currencyCode: 'CREDIT',
      availableMinor: 0,
      reservedMinor: 0,
      status: 'active'
    });

    return await repo.save(wallet);
  }

  async getDefaultWalletSummary(userId: string): Promise<WalletSummary> {
    const wallet = await this.walletRepository.findOneBy({ userId, currencyCode: 'CREDIT' });

    if (!wallet) {
      throw new NotFoundException('Wallet not found');
    }

    return this.toWalletSummary(wallet);
  }

  /**
   * Bulk `availableMinor` lookup — a user with no wallet row yet is simply
   * absent from the map (callers should treat that as 0). Used where an N+1
   * per-user lookup would be wasteful, e.g. filtering an agent list by balance.
   */
  async getAvailableBalances(userIds: string[]): Promise<Map<string, number>> {
    if (userIds.length === 0) return new Map();
    const wallets = await this.walletRepository.find({
      where: { userId: In(userIds), currencyCode: 'CREDIT' },
    });
    return new Map(wallets.map((w) => [w.userId, w.availableMinor]));
  }

  async getLedgerEntries(input: {
    userId: string;
    limit: number;
  }): Promise<LedgerEntrySummary[]> {
    const limit = Math.min(Math.max(input.limit || 50, 1), 100);
    const entries = await this.ledgerService.findUserEntries({ userId: input.userId, limit });

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
      createdAt: entry.createdAt
    }));
  }

  async getRecentPlatformWins(limit: number): Promise<Array<{
    displayName: string;
    amountMinor: number;
    game: string;
    timestamp: string;
  }>> {
    const safeLimit = Math.min(Math.max(limit || 20, 1), 50);
    const rows = await this.dataSource
      .getRepository(LedgerEntry)
      .createQueryBuilder('le')
      .innerJoin('le.user', 'u')
      .select([
        'u.displayName AS displayName',
        'le.amountMinor AS amountMinor',
        'le.sourceType AS sourceType',
        'le.createdAt AS createdAt',
      ])
      .where('le.entryType = :type', { type: 'win' })
      .andWhere('le.direction = :dir', { dir: 'credit' })
      .andWhere('le.amountMinor > 0')
      .orderBy('le.createdAt', 'DESC')
      .limit(safeLimit)
      .getRawMany<{ displayName: string; amountMinor: string; sourceType: string; createdAt: Date | string }>();

    return rows.map((row) => ({
      displayName: row.displayName ?? 'Player',
      amountMinor: Number(row.amountMinor ?? 0),
      game: String(row.sourceType ?? '').toLowerCase().includes('keno') ? 'Keno' : 'Bingo',
      timestamp: row.createdAt instanceof Date
        ? row.createdAt.toISOString()
        : String(row.createdAt),
    }));
  }

  async getLeaderboard(input: { period?: string; limit: number }): Promise<Array<{
    rank: number;
    displayName: string;
    totalWinMinor: number;
    winCount: number;
  }>> {
    const safeLimit = Math.min(Math.max(input.limit || 10, 1), 50);
    let since: Date | undefined;
    if (input.period === 'weekly')  since = new Date(Date.now() - 7  * 86400 * 1000);
    if (input.period === 'monthly') since = new Date(Date.now() - 30 * 86400 * 1000);

    const qb = this.dataSource
      .getRepository(LedgerEntry)
      .createQueryBuilder('le')
      .innerJoin('le.user', 'u')
      .select('u.displayName', 'displayName')
      .addSelect('SUM(le.amountMinor)', 'totalWinMinor')
      .addSelect('COUNT(le.id)', 'winCount')
      .where('le.entryType = :type', { type: 'win' })
      .andWhere('le.direction = :dir', { dir: 'credit' })
      .andWhere('le.amountMinor > 0');

    if (since) qb.andWhere('le.createdAt >= :since', { since });

    const rows = await qb
      .groupBy('u.id')
      .addGroupBy('u.displayName')
      .orderBy('totalWinMinor', 'DESC')
      .limit(safeLimit)
      .getRawMany<{ displayName: string; totalWinMinor: string; winCount: string }>();

    return rows.map((row, i) => ({
      rank: i + 1,
      displayName: row.displayName ?? 'Player',
      totalWinMinor: Number(row.totalWinMinor ?? 0),
      winCount: Number(row.winCount ?? 0),
    }));
  }

  debit(input: WalletMutationInput): Promise<WalletMutationResult> {
    return this.mutateWalletInOwnTransaction({
      ...input,
      direction: 'debit'
    });
  }

  credit(input: WalletMutationInput): Promise<WalletMutationResult> {
    return this.mutateWalletInOwnTransaction({
      ...input,
      direction: 'credit'
    });
  }

  debitInSession(
    input: WalletMutationInput,
    manager: EntityManager
  ): Promise<WalletMutationResult> {
    return this.mutateWalletInSession(
      {
        ...input,
        direction: 'debit'
      },
      manager
    );
  }

  creditInSession(
    input: WalletMutationInput,
    manager: EntityManager
  ): Promise<WalletMutationResult> {
    return this.mutateWalletInSession(
      {
        ...input,
        direction: 'credit'
      },
      manager
    );
  }

  private async mutateWalletInOwnTransaction(
    input: WalletMutationInput & { direction: 'debit' | 'credit' }
  ): Promise<WalletMutationResult> {
    return this.dataSource.transaction(async (manager) => {
      return await this.mutateWalletInSession(input, manager);
    });
  }

  private async mutateWalletInSession(
    input: WalletMutationInput & { direction: 'debit' | 'credit' },
    manager: EntityManager
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
      metadata: input.metadata ?? {}
    });

    let idempotencyRecord = await this.ledgerService.findIdempotencyRecord({
      key: input.idempotencyKey,
      userId: input.userId,
      action,
      manager
    });

    if (idempotencyRecord) {
      this.ledgerService.assertIdempotentRequestMatches(
        idempotencyRecord,
        requestHash
      );

      if (idempotencyRecord.status === 'completed' && idempotencyRecord.response) {
        return {
          ...(idempotencyRecord.response as WalletMutationResult),
          idempotent: true
        };
      }

      throw new ConflictException('Idempotent wallet mutation is already in progress');
    }

    idempotencyRecord = await this.ledgerService.createPendingIdempotencyRecord({
      key: input.idempotencyKey,
      userId: input.userId,
      action,
      requestHash,
      manager
    });

    // LOCK user wallet row
    const wallet = await manager.getRepository(Wallet).findOne({
      where: { userId: input.userId, currencyCode },
      lock: { mode: 'pessimistic_write' }
    });

    if (!wallet) {
      throw new NotFoundException('Wallet not found');
    }

    if (wallet.status !== 'active') {
      throw new ConflictException('Wallet is not active');
    }

    if (input.entryType === 'stake') {
      await this.enforceWagerLimit(input.userId, input.amountMinor, manager);
    }

    const incAmount = input.direction === 'credit' ? input.amountMinor : -input.amountMinor;

    if (input.direction === 'debit' && wallet.availableMinor < input.amountMinor) {
      throw new ConflictException('Insufficient wallet balance or concurrent update failed');
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
        metadata: input.metadata
      },
      manager
    );

    // Update global platform stats using MySQL native UPSERT
    if (input.entryType === 'stake') {
      await manager.query(`
        INSERT INTO platform_stats (\`key\`, totalTicketVolumeMinor)
        VALUES ('global', ?)
        ON DUPLICATE KEY UPDATE totalTicketVolumeMinor = totalTicketVolumeMinor + ?
      `, [input.amountMinor, input.amountMinor]);
    } else if (input.entryType === 'win') {
      await manager.query(`
        INSERT INTO platform_stats (\`key\`, totalPayoutsMinor)
        VALUES ('global', ?)
        ON DUPLICATE KEY UPDATE totalPayoutsMinor = totalPayoutsMinor + ?
      `, [input.amountMinor, input.amountMinor]);
    } else if (input.entryType === 'refund') {
      await manager.query(`
        INSERT INTO platform_stats (\`key\`, totalRefundsMinor)
        VALUES ('global', ?)
        ON DUPLICATE KEY UPDATE totalRefundsMinor = totalRefundsMinor + ?
      `, [input.amountMinor, input.amountMinor]);
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
        createdAt: ledgerEntry.createdAt
      },
      idempotent: false
    };

    await this.ledgerService.completeIdempotencyRecord({
      record: idempotencyRecord,
      response: result,
      manager
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
      status: wallet.status
    };
  }

  private assertPositiveAmount(amountMinor: number): void {
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
      throw new BadRequestException('amountMinor must be a positive integer');
    }
  }

  private async enforceWagerLimit(userId: string, amountMinor: number, manager: EntityManager): Promise<void> {
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
        weeklyResetAt: nextWeek
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

    if (wagerLimit.dailyLimitMinor > 0 && wagerLimit.currentDailyWagerMinor + amountMinor > wagerLimit.dailyLimitMinor) {
      throw new ConflictException('Daily wagering limit exceeded');
    }
    if (wagerLimit.weeklyLimitMinor > 0 && wagerLimit.currentWeeklyWagerMinor + amountMinor > wagerLimit.weeklyLimitMinor) {
      throw new ConflictException('Weekly wagering limit exceeded');
    }

    wagerLimit.currentDailyWagerMinor += amountMinor;
    wagerLimit.currentWeeklyWagerMinor += amountMinor;
    await wagerLimitRepo.save(wagerLimit);
  }

  private hashRequest(value: Record<string, unknown>): string {
    return createHash('sha256').update(this.stableStringify(value)).digest('hex');
  }

  private stableStringify(value: unknown): string {
    if (Array.isArray(value)) {
      return `[${value.map((item) => this.stableStringify(item)).join(',')}]`;
    }

    if (value && typeof value === 'object') {
      return `{${Object.entries(value)
        .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
        .map(([key, nestedValue]) => `${JSON.stringify(key)}:${this.stableStringify(nestedValue)}`)
        .join(',')}}`;
    }

    return JSON.stringify(value);
  }

  /** Player-facing withdrawal fee config, so the withdraw form can show a fee
   * estimate before submission without requiring the agent role. */
  async getWithdrawalFeeConfig(): Promise<{
    withdrawalFeeRanges: Array<{ minAmountMinor: number; maxAmountMinor: number | null; feeMinor: number }>;
  }> {
    const ranges = await this.withdrawalFeeRangeRepository.find({
      where: { active: true },
      order: { minAmountMinor: 'ASC' },
    });
    return {
      withdrawalFeeRanges: ranges.map((r) => ({
        minAmountMinor: r.minAmountMinor,
        maxAmountMinor: r.maxAmountMinor,
        feeMinor: r.feeMinor,
      })),
    };
  }

  async requestWithdrawal(
    userId: string,
    amountMinor: number,
    destinationAccount: string
  ): Promise<Withdrawal> {
    this.assertPositiveAmount(amountMinor);
    if (!destinationAccount || destinationAccount.trim() === '') {
      throw new BadRequestException('Destination account is required');
    }

    return this.dataSource.transaction(async (manager) => {
      const config = await manager.query(`SELECT * FROM system_configs WHERE \`key\` = 'global' LIMIT 1`);
      const systemConfig = config?.[0];
      const minAmount = (systemConfig?.withdrawalMinAmountMinor as number) ?? 0;
      const maxAmount = (systemConfig?.withdrawalMaxAmountMinor as number) ?? 0;
      const maxPending = (systemConfig?.maxPendingWithdrawalsPerUser as number) ?? 1;

      if (minAmount > 0 && amountMinor < minAmount) {
        throw new BadRequestException(`Minimum withdrawal is ${minAmount} credits`);
      }
      if (maxAmount > 0 && amountMinor > maxAmount) {
        throw new BadRequestException(`Maximum withdrawal is ${maxAmount} credits`);
      }

      const withdrawalRepo = manager.getRepository(Withdrawal);
      const walletRepo = manager.getRepository(Wallet);

      if (maxPending > 0) {
        const pendingCount = await withdrawalRepo.countBy({
          userId,
          status: In(['pending', 'claimed', 'processing'])
        });
        if (pendingCount >= maxPending) {
          throw new ConflictException(`You already have ${pendingCount} pending withdrawal(s). Wait for them to complete before requesting another.`);
        }
      }

      // Lock user wallet row
      const wallet = await walletRepo.findOne({
        where: { userId, currencyCode: 'CREDIT' },
        lock: { mode: 'pessimistic_write' }
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
          metadata: { destinationAccount: destinationAccount.trim() }
        },
        manager
      );

      this.gameEventsGateway.emitWalletUpdated(userId, this.toWalletSummary(wallet));
      this.gameEventsGateway.emitWithdrawalPending({
        withdrawalId: withdrawal.id,
        userId,
        amountMinor: withdrawal.amountMinor,
        destinationAccount: withdrawal.destinationAccount,
      });

      return withdrawal;
    });
  }

  async processWithdrawal(
    withdrawalId: string,
    action: 'approve' | 'reject',
    adminNotes?: string,
    adminUserId?: string
  ): Promise<Withdrawal> {
    if (action === 'reject' && (adminNotes?.trim().length ?? 0) < 15) {
      throw new BadRequestException('Rejection remark must be at least 15 characters');
    }

    const settled = await this.dataSource.transaction(async (manager) => {
      const withdrawalRepo = manager.getRepository(Withdrawal);
      const walletRepo = manager.getRepository(Wallet);

      const withdrawal = await withdrawalRepo.findOneBy({ id: withdrawalId });

      if (!withdrawal) {
        throw new NotFoundException('Withdrawal request not found');
      }

      const settleable: WithdrawalStatus[] = action === 'approve'
        ? ['pending', 'processing']
        : ['pending', 'claimed', 'processing'];
      if (!settleable.includes(withdrawal.status)) {
        throw new ConflictException(`Withdrawal is already in '${withdrawal.status}' status`);
      }

      // Lock user wallet row
      const wallet = await walletRepo.findOne({
        where: { userId: withdrawal.userId, currencyCode: 'CREDIT' },
        lock: { mode: 'pessimistic_write' }
      });

      if (!wallet) {
        throw new NotFoundException('Wallet not found');
      }

      if (action === 'approve') {
        if (wallet.reservedMinor < withdrawal.amountMinor) {
          throw new ConflictException('Insufficient reserved balance in wallet');
        }

        wallet.reservedMinor -= withdrawal.amountMinor;
        await walletRepo.save(wallet);

        withdrawal.status = 'completed';
        withdrawal.adminNotes = adminNotes;
        withdrawal.processedAt = new Date();
        withdrawal.processedBy = adminUserId;
        await withdrawalRepo.save(withdrawal);

        this.gameEventsGateway.emitWalletUpdated(withdrawal.userId, this.toWalletSummary(wallet));
      } else {
        if (wallet.reservedMinor < withdrawal.amountMinor) {
          throw new ConflictException('Insufficient reserved balance in wallet to refund');
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
            metadata: { action: 'reject', reason: adminNotes || 'Admin rejection' }
          },
          manager
        );

        await manager.query(`
          INSERT INTO platform_stats (\`key\`, totalRefundsMinor)
          VALUES ('global', ?)
          ON DUPLICATE KEY UPDATE totalRefundsMinor = totalRefundsMinor + ?
        `, [withdrawal.amountMinor, withdrawal.amountMinor]);

        this.gameEventsGateway.emitWalletUpdated(withdrawal.userId, this.toWalletSummary(wallet));
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
  private async notifyWithdrawalSettled(withdrawal: Withdrawal, remark?: string): Promise<void> {
    const amount = withdrawal.amountMinor.toLocaleString();
    if (withdrawal.status === 'completed') {
      await this.notificationsService.safeCreate({
        userId: withdrawal.userId,
        type: 'withdrawal',
        title: 'Withdrawal approved',
        body: `Your ${amount} ETB payout has been approved and sent.`,
        data: { withdrawalId: withdrawal.id, amountMinor: withdrawal.amountMinor, status: 'completed' },
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
        data: { withdrawalId: withdrawal.id, amountMinor: withdrawal.amountMinor, status: 'rejected', reason: reason ?? null },
      });
    }
  }

  async getPlayerWithdrawals(userId: string): Promise<Withdrawal[]> {
    return this.withdrawalRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' }
    });
  }

  async getPendingWithdrawals(): Promise<Withdrawal[]> {
    return this.withdrawalRepository.find({
      where: { status: 'pending' },
      relations: ['user'],
      order: { createdAt: 'ASC' }
    });
  }

  async getAllWithdrawals(): Promise<Withdrawal[]> {
    return this.withdrawalRepository.find({
      relations: ['user', 'agent'],
      order: { createdAt: 'DESC' }
    });
  }

  async getAvailableWithdrawals(): Promise<Withdrawal[]> {
    return this.withdrawalRepository.find({
      where: { status: 'pending' },
      relations: ['user'],
      order: { createdAt: 'ASC' }
    });
  }

  async getAgentWithdrawals(agentId: string): Promise<Withdrawal[]> {
    return this.withdrawalRepository.find({
      // Include awaiting_verification so a submitted-but-not-yet-verified payout
      // stays visible to the agent (status badge only — no action left for them).
      where: { agentId, status: In(['claimed', 'processing', 'awaiting_verification']) },
      relations: ['user'],
      order: { claimedAt: 'DESC' }
    });
  }

  /** A withdrawal that is currently claimed by this agent, or throw. */
  async getClaimedWithdrawalForAgent(withdrawalId: string, agentId: string): Promise<Withdrawal> {
    const withdrawal = await this.withdrawalRepository.findOneBy({
      id: withdrawalId,
      status: 'claimed',
      agentId,
    });
    if (!withdrawal) {
      throw new ConflictException('Withdrawal not found or not assigned to you');
    }
    return withdrawal;
  }

  async getAgentWithdrawalHistory(agentId: string): Promise<Withdrawal[]> {
    return this.withdrawalRepository.find({
      where: { agentId },
      relations: ['user'],
      order: { updatedAt: 'DESC' },
      take: 100
    });
  }

  async claimWithdrawal(withdrawalId: string, agentId: string): Promise<Withdrawal> {
    const withdrawal = await this.withdrawalRepository.findOneBy({ id: withdrawalId, status: 'pending' });
    if (!withdrawal) {
      throw new ConflictException('Withdrawal is not available to claim (not pending or already claimed)');
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

  async releaseWithdrawal(withdrawalId: string, agentId: string): Promise<Withdrawal> {
    const withdrawal = await this.withdrawalRepository.findOneBy({ id: withdrawalId, status: 'claimed', agentId });
    if (!withdrawal) {
      throw new ConflictException('Withdrawal not found or not assigned to you');
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
   * Step A of the agent withdrawal flow — the agent submits payout proof (FT
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
        throw new ConflictException('Withdrawal not found or not assigned to you');
      }

      // Dedupe the payout proof: the same receipt/confirmation code must not be
      // used for two withdrawals, whether the other one is still awaiting
      // verification or already completed. Checked inside the transaction so two
      // concurrent submissions can't both slip through.
      const reference = input.telebirrReference.trim();
      const reused = await withdrawalRepo.findOne({
        where: { telebirrReference: reference, status: In(['awaiting_verification', 'completed']) },
        select: { id: true },
      });
      if (reused && reused.id !== withdrawal.id) {
        throw new ConflictException('This payment proof has already been used for another withdrawal');
      }

      // A single flat fee (from the matched WithdrawalFeeRange), 100% to the
      // processing agent — no platform split. Resolved and persisted NOW so a
      // fee-range edit between submission and admin verification can't change
      // what's owed later.
      const feeMinor = Math.max(0, Math.floor(input.feeMinor));
      const netAmountMinor = withdrawal.amountMinor - feeMinor;
      if (netAmountMinor <= 0) {
        throw new BadRequestException('The withdrawal fee would consume the entire withdrawal amount');
      }

      withdrawal.status = 'awaiting_verification';
      withdrawal.serviceChargeMinor = feeMinor;
      withdrawal.netAmountMinor = netAmountMinor;
      withdrawal.telebirrReference = reference;
      withdrawal.paymentProvider = input.paymentProvider ?? null;
      withdrawal.payoutVerification = input.payoutVerification ?? null;
      withdrawal.receiptFileUrl = input.receiptFileUrl;
      withdrawal.processedAt = new Date();
      withdrawal.processedBy = input.agentId;
      return withdrawalRepo.save(withdrawal);
    });
  }

  /**
   * Step B — an admin reviews the agent-submitted FT number + receipt. THIS is
   * where money actually moves: approving releases the player's fund-hold and
   * credits the agent (custody + fee), using the amounts already resolved and
   * stored in Step A. Rejecting refunds the reservation back to the player's
   * available balance — a dispute-resolution call, since the agent may have
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
      throw new BadRequestException('Rejection notes must be at least 15 characters');
    }

    const settled = await this.dataSource.transaction(async (manager) => {
      const withdrawalRepo = manager.getRepository(Withdrawal);
      const walletRepo = manager.getRepository(Wallet);

      const withdrawal = await withdrawalRepo.findOneBy({ id: withdrawalId, status: 'awaiting_verification' });
      if (!withdrawal) {
        throw new ConflictException('Withdrawal not found or not awaiting verification');
      }

      const wallet = await walletRepo.findOne({
        where: { userId: withdrawal.userId, currencyCode: 'CREDIT' },
        lock: { mode: 'pessimistic_write' },
      });
      if (!wallet) throw new NotFoundException('Wallet not found');
      if (wallet.reservedMinor < withdrawal.amountMinor) {
        throw new ConflictException('Insufficient reserved balance on user wallet');
      }

      if (decision === 'approve') {
        wallet.reservedMinor -= withdrawal.amountMinor;
        await walletRepo.save(wallet);

        const feeMinor = withdrawal.serviceChargeMinor;
        const netAmountMinor = withdrawal.netAmountMinor ?? withdrawal.amountMinor - feeMinor;

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
          await this.creditInSession(
            {
              userId: withdrawal.agentId!,
              amountMinor: feeMinor,
              entryType: 'agent_receipt',
              sourceType: 'withdrawal',
              sourceId: withdrawal.id,
              idempotencyKey: `agent-withdrawal-fee:${withdrawal.id}`,
              metadata: {
                withdrawalId: withdrawal.id,
                userId: withdrawal.userId,
                grossAmountMinor: withdrawal.amountMinor,
                kind: 'withdrawal_fee',
              },
            },
            manager,
          );
        }

        withdrawal.status = 'completed';
        withdrawal.verifiedBy = adminUserId;
        withdrawal.verifiedAt = new Date();
        await withdrawalRepo.save(withdrawal);

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
          await manager.query(`
            INSERT INTO platform_stats (\`key\`, totalServiceChargesMinor)
            VALUES ('global', ?)
            ON DUPLICATE KEY UPDATE totalServiceChargesMinor = totalServiceChargesMinor + ?
          `, [feeMinor, feeMinor]);
        }
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
            metadata: { action: 'reject_agent_verification', reason: notes?.trim() || 'Admin rejected agent verification' },
          },
          manager,
        );

        await manager.query(`
          INSERT INTO platform_stats (\`key\`, totalRefundsMinor)
          VALUES ('global', ?)
          ON DUPLICATE KEY UPDATE totalRefundsMinor = totalRefundsMinor + ?
        `, [withdrawal.amountMinor, withdrawal.amountMinor]);
      }

      this.gameEventsGateway.emitWalletUpdated(withdrawal.userId, this.toWalletSummary(wallet));
      return withdrawal;
    });

    await this.notifyWithdrawalSettled(settled, notes);
    return settled;
  }

  async rejectWithdrawalByAgent(withdrawalId: string, agentId: string, remarks: string): Promise<Withdrawal> {
    if (!remarks || remarks.trim().length < 15) {
      throw new BadRequestException('Rejection remarks must be at least 15 characters');
    }

    const withdrawal = await this.withdrawalRepository.findOneBy({
      id: withdrawalId,
      status: 'claimed',
      agentId,
    });

    if (!withdrawal) {
      throw new ConflictException('Withdrawal not found or not assigned to you');
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
        weeklyResetAt: weeklyReset
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
   * — the designated Super-Admin), not the acting admin's own wallet. However many
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
    const key = idempotencyKey || `admin-topup:${houseWalletOwnerId}:${Date.now()}`;
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
          metadata: { houseWalletOwnerId, toppedUpByAdminId: actingAdminId }
        },
        manager
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
    const key = idempotencyKey || `admin-to-agent:${houseWalletOwnerId}:${agentId}:${Date.now()}`;
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
          metadata: { agentId, actingAdminId }
        },
        manager
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
          metadata: { houseWalletOwnerId, actingAdminId }
        },
        manager
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
        agentWallet: creditResult.wallet
      };
    });
  }

  async transferAgentToUser(
    agentUserId: string,
    userPhone: string,
    amountMinor: number,
    idempotencyKey?: string
  ): Promise<{ agentWallet: WalletSummary; userWallet: WalletSummary }> {
    // users.phoneNumber is always stored normalized (+2519XXXXXXXX/+2517XXXXXXXX —
    // every write path runs it through normalizeEthiopianPhone), so an
    // unnormalized "09…"/"07…" input here would silently never match a real row.
    const normalizedPhone = normalizeEthiopianPhone(userPhone);
    if (!normalizedPhone) {
      throw new BadRequestException('Enter a valid Ethiopian phone number (e.g. 09XXXXXXXX)');
    }

    const key = idempotencyKey || `agent-to-user:${agentUserId}:${normalizedPhone}:${Date.now()}`;
    return this.dataSource.transaction(async (manager) => {
      // Find user by phone number
      const userRepo = manager.getRepository(User);
      const user = await userRepo.findOneBy({ phoneNumber: normalizedPhone });
      if (!user) {
        throw new NotFoundException(`User with phone number ${userPhone} not found`);
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
          metadata: { userPhone, userId: user.id }
        },
        manager
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
          metadata: { agentUserId }
        },
        manager
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
        userWallet: creditResult.wallet
      };
    });
  }

  /**
   * Session-scoped sibling of `transferAgentToUser` — same agent-debit/user-credit
   * shape, but takes the CALLER's own `manager` instead of opening a new
   * transaction, so it can be composed inside an already-open transaction (e.g.
   * deposit crediting in `PaymentsService`), the same way `AdminService.
   * creditFromMasterWallet` is manager-scoped for the same reason. The credit
   * side uses the caller's `entryType`/`sourceType`/`sourceId`/`idempotencyKey`/
   * `metadata` unchanged, so the receiving wallet's ledger history reads
   * identically regardless of which wallet actually funded it. Throws (and lets
   * the caller decide what to do) if the agent's wallet can't cover the amount —
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
        metadata: { ...input.metadata, targetUserId: input.targetUserId, fundedSourceType: input.sourceType },
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

  private async recordAgentAction(
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
    const repo = manager ? manager.getRepository(AgentActionLog) : this.dataSource.getRepository(AgentActionLog);
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
      throw new BadRequestException(`${field} must be a non-negative integer`);
    }
  }
}
