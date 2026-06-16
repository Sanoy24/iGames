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
import { LedgerEntryType } from '../ledger/entities/ledger-entry.entity';
import { GameEventsGateway } from '../events/game-events.gateway';
import { Wallet } from './entities/wallet.entity';
import { WagerLimit } from './entities/wager-limit.entity';
import { Withdrawal, WithdrawalStatus } from './entities/withdrawal.entity';

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
    private readonly ledgerService: LedgerService,
    private readonly gameEventsGateway: GameEventsGateway
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
      metadata: entry.metadata || {}
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
        metadata: ledgerEntry.metadata || {}
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
    return this.dataSource.transaction(async (manager) => {
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
      relations: ['user'],
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
      where: { agentId, status: In(['claimed', 'processing']) },
      relations: ['user'],
      order: { claimedAt: 'DESC' }
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

    return await this.withdrawalRepository.save(withdrawal);
  }

  async releaseWithdrawal(withdrawalId: string, agentId: string): Promise<Withdrawal> {
    const withdrawal = await this.withdrawalRepository.findOneBy({ id: withdrawalId, status: 'claimed', agentId });
    if (!withdrawal) {
      throw new ConflictException('Withdrawal not found or not assigned to you');
    }

    withdrawal.status = 'pending';
    withdrawal.agentId = null as any;
    withdrawal.claimedAt = null as any;

    return await this.withdrawalRepository.save(withdrawal);
  }

  async completeWithdrawalByAgent(input: {
    withdrawalId: string;
    agentId: string;
    telebirrReference: string;
    serviceChargePct: number;
  }): Promise<Withdrawal> {
    return this.dataSource.transaction(async (manager) => {
      const withdrawalRepo = manager.getRepository(Withdrawal);
      const walletRepo = manager.getRepository(Wallet);

      const withdrawal = await withdrawalRepo.findOneBy({
        id: input.withdrawalId,
        status: 'claimed',
        agentId: input.agentId
      });

      if (!withdrawal) {
        throw new ConflictException('Withdrawal not found or not assigned to you');
      }

      const serviceChargeMinor = Math.floor(withdrawal.amountMinor * input.serviceChargePct / 100);
      const netAmountMinor = withdrawal.amountMinor - serviceChargeMinor;

      if (netAmountMinor <= 0) {
        throw new BadRequestException('Service charge would consume the entire withdrawal amount');
      }

      // Settle the user's reservation
      const wallet = await walletRepo.findOne({
        where: { userId: withdrawal.userId, currencyCode: 'CREDIT' },
        lock: { mode: 'pessimistic_write' }
      });

      if (!wallet || wallet.reservedMinor < withdrawal.amountMinor) {
        throw new ConflictException('Insufficient reserved balance on user wallet');
      }

      wallet.reservedMinor -= withdrawal.amountMinor;
      await walletRepo.save(wallet);

      // Credit the agent's wallet (net of service charge)
      await this.ensureDefaultWallet(input.agentId, manager);
      await this.creditInSession(
        {
          userId: input.agentId,
          amountMinor: netAmountMinor,
          entryType: 'agent_receipt',
          sourceType: 'withdrawal',
          sourceId: withdrawal.id,
          idempotencyKey: `agent-receipt:${withdrawal.id}`,
          metadata: {
            withdrawalId: withdrawal.id,
            userId: withdrawal.userId,
            grossAmountMinor: withdrawal.amountMinor,
            serviceChargeMinor,
          },
        },
        manager,
      );

      withdrawal.status = 'completed';
      withdrawal.serviceChargeMinor = serviceChargeMinor;
      withdrawal.netAmountMinor = netAmountMinor;
      withdrawal.telebirrReference = input.telebirrReference.trim();
      withdrawal.processedAt = new Date();
      withdrawal.processedBy = input.agentId;
      await withdrawalRepo.save(withdrawal);

      if (serviceChargeMinor > 0) {
        await manager.query(`
          INSERT INTO platform_stats (\`key\`, totalServiceChargesMinor)
          VALUES ('global', ?)
          ON DUPLICATE KEY UPDATE totalServiceChargesMinor = totalServiceChargesMinor + ?
        `, [serviceChargeMinor, serviceChargeMinor]);
      }

      this.gameEventsGateway.emitWalletUpdated(withdrawal.userId, this.toWalletSummary(wallet));
      return withdrawal;
    });
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

  private assertNonNegativeAmount(amount: number, field: string): void {
    if (!Number.isInteger(amount) || amount < 0) {
      throw new BadRequestException(`${field} must be a non-negative integer`);
    }
  }
}
