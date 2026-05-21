import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { InjectConnection } from '@nestjs/mongoose';
import { createHash } from 'crypto';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { LedgerService } from '../ledger/ledger.service';
import { LedgerEntryType } from '../ledger/schemas/ledger-entry.schema';
import { GameEventsGateway } from '../events/game-events.gateway';
import { Wallet, WalletDocument } from './schemas/wallet.schema';
import { WagerLimit } from './schemas/wager-limit.schema';
import { Withdrawal, WithdrawalDocument, WithdrawalStatus } from './schemas/withdrawal.schema';

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
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(Wallet.name) private readonly walletModel: Model<Wallet>,
    @InjectModel(WagerLimit.name) private readonly wagerLimitModel: Model<WagerLimit>,
    @InjectModel(Withdrawal.name) private readonly withdrawalModel: Model<Withdrawal>,
    private readonly ledgerService: LedgerService,
    private readonly gameEventsGateway: GameEventsGateway
  ) {}

  async ensureDefaultWallet(
    userId: Types.ObjectId,
    session: ClientSession
  ): Promise<WalletDocument> {
    const existingWallet = await this.walletModel
      .findOne({ userId, currencyCode: 'CREDIT' })
      .session(session)
      .exec();

    if (existingWallet) {
      return existingWallet;
    }

    const [wallet] = await this.walletModel.create(
      [
        {
          userId,
          currencyCode: 'CREDIT',
          availableMinor: 0,
          reservedMinor: 0,
          status: 'active'
        }
      ],
      { session }
    );

    return wallet;
  }

  async getDefaultWalletSummary(userId: string): Promise<WalletSummary> {
    const objectUserId = this.toObjectId(userId, 'userId');
    const wallet = await this.walletModel
      .findOne({ userId: objectUserId, currencyCode: 'CREDIT' })
      .exec();

    if (!wallet) {
      throw new NotFoundException('Wallet not found');
    }

    return this.toWalletSummary(wallet);
  }

  async getLedgerEntries(input: {
    userId: string;
    limit: number;
  }): Promise<LedgerEntrySummary[]> {
    const userId = this.toObjectId(input.userId, 'userId');
    const limit = Math.min(Math.max(input.limit || 50, 1), 100);
    const entries = await this.ledgerService.findUserEntries({ userId, limit });

    return entries.map((entry) => ({
      id: entry._id.toString(),
      walletId: entry.walletId.toString(),
      currencyCode: entry.currencyCode,
      amountMinor: entry.amountMinor,
      direction: entry.direction,
      entryType: entry.entryType,
      sourceType: entry.sourceType,
      sourceId: entry.sourceId,
      idempotencyKey: entry.idempotencyKey,
      balanceAfterMinor: entry.balanceAfterMinor,
      metadata: entry.metadata
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
    session: ClientSession
  ): Promise<WalletMutationResult> {
    return this.mutateWalletInSession(
      {
        ...input,
        direction: 'debit'
      },
      session
    );
  }

  creditInSession(
    input: WalletMutationInput,
    session: ClientSession
  ): Promise<WalletMutationResult> {
    return this.mutateWalletInSession(
      {
        ...input,
        direction: 'credit'
      },
      session
    );
  }

  private async mutateWalletInOwnTransaction(
    input: WalletMutationInput & { direction: 'debit' | 'credit' }
  ): Promise<WalletMutationResult> {
    const session = await this.connection.startSession();

    try {
      let result: WalletMutationResult | undefined;

      await session.withTransaction(async () => {
        result = await this.mutateWalletInSession(input, session);
      });

      if (!result) {
        throw new Error('Wallet mutation transaction did not complete');
      }

      return result;
    } finally {
      await session.endSession();
    }
  }

  private async mutateWalletInSession(
    input: WalletMutationInput & { direction: 'debit' | 'credit' },
    session: ClientSession
  ): Promise<WalletMutationResult> {
    this.assertPositiveAmount(input.amountMinor);

    const userId = this.toObjectId(input.userId, 'userId');
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
      userId,
      action,
      session
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
      userId,
      action,
      requestHash,
      session
    });

    const wallet = await this.walletModel
      .findOne({ userId, currencyCode })
      .session(session)
      .exec();

    if (!wallet) {
      throw new NotFoundException('Wallet not found');
    }

    if (wallet.status !== 'active') {
      throw new ConflictException('Wallet is not active');
    }

    if (input.entryType === 'stake') {
      await this.enforceWagerLimit(userId, input.amountMinor, session);
    }

    const incAmount = input.direction === 'credit' ? input.amountMinor : -input.amountMinor;

    const updatedWallet = await this.walletModel.findOneAndUpdate(
      { _id: wallet._id, availableMinor: { $gte: input.direction === 'debit' ? input.amountMinor : 0 } },
      { $inc: { availableMinor: incAmount } },
      { new: true, session }
    ).exec();

    if (!updatedWallet) {
      throw new ConflictException('Insufficient wallet balance or concurrent update failed');
    }

    const ledgerEntry = await this.ledgerService.createEntry(
      {
        userId,
        walletId: updatedWallet._id,
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
      session
    );

    if (input.entryType === 'stake') {
      await this.connection.collection('platformstats').updateOne({ key: 'global' }, { $inc: { totalTicketVolumeMinor: input.amountMinor } }, { upsert: true, session });
    } else if (input.entryType === 'win') {
      await this.connection.collection('platformstats').updateOne({ key: 'global' }, { $inc: { totalPayoutsMinor: input.amountMinor } }, { upsert: true, session });
    } else if (input.entryType === 'refund') {
      await this.connection.collection('platformstats').updateOne({ key: 'global' }, { $inc: { totalRefundsMinor: input.amountMinor } }, { upsert: true, session });
    }

    const result: WalletMutationResult = {
      wallet: this.toWalletSummary(updatedWallet),
      ledgerEntry: {
        id: ledgerEntry._id.toString(),
        walletId: ledgerEntry.walletId.toString(),
        currencyCode: ledgerEntry.currencyCode,
        amountMinor: ledgerEntry.amountMinor,
        direction: ledgerEntry.direction,
        entryType: ledgerEntry.entryType,
        sourceType: ledgerEntry.sourceType,
        sourceId: ledgerEntry.sourceId,
        idempotencyKey: ledgerEntry.idempotencyKey,
        balanceAfterMinor: ledgerEntry.balanceAfterMinor,
        metadata: ledgerEntry.metadata
      },
      idempotent: false
    };

    await this.ledgerService.completeIdempotencyRecord({
      record: idempotencyRecord,
      response: result,
      session
    });

    this.gameEventsGateway.emitWalletUpdated(userId.toString(), result.wallet);

    return result;
  }

  private toWalletSummary(wallet: WalletDocument): WalletSummary {
    return {
      id: wallet._id.toString(),
      userId: wallet.userId.toString(),
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

  private toObjectId(value: string, name: string): Types.ObjectId {
    if (!Types.ObjectId.isValid(value)) {
      throw new BadRequestException(`${name} must be a valid ObjectId`);
    }
    return new Types.ObjectId(value);
  }

  private async enforceWagerLimit(userId: Types.ObjectId, amountMinor: number, session: ClientSession): Promise<void> {
    const now = new Date();
    
    let wagerLimit = await this.wagerLimitModel.findOne({ userId }).session(session).exec();
    
    if (!wagerLimit) {
      const tomorrow = new Date(now);
      tomorrow.setUTCHours(24, 0, 0, 0);
      const nextWeek = new Date(tomorrow);
      nextWeek.setDate(nextWeek.getDate() + 7);
      
      const [newLimit] = await this.wagerLimitModel.create([{
        userId,
        dailyLimitMinor: 0,
        weeklyLimitMinor: 0,
        currentDailyWagerMinor: 0,
        currentWeeklyWagerMinor: 0,
        dailyResetAt: tomorrow,
        weeklyResetAt: nextWeek
      }], { session });
      wagerLimit = newLimit;
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
    await wagerLimit.save({ session });
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

    // Enforce admin-configured withdrawal limits
    const config = await this.connection
      .collection('systemconfigs')
      .findOne({ key: 'global' });
    const minAmount = (config?.withdrawalMinAmountMinor as number) ?? 0;
    const maxAmount = (config?.withdrawalMaxAmountMinor as number) ?? 0;
    const maxPending = (config?.maxPendingWithdrawalsPerUser as number) ?? 1;

    if (minAmount > 0 && amountMinor < minAmount) {
      throw new BadRequestException(`Minimum withdrawal is ${minAmount} credits`);
    }
    if (maxAmount > 0 && amountMinor > maxAmount) {
      throw new BadRequestException(`Maximum withdrawal is ${maxAmount} credits`);
    }

    const objectUserId = this.toObjectId(userId, 'userId');
    const session = await this.connection.startSession();

    try {
      let createdWithdrawal: Withdrawal | undefined;

      await session.withTransaction(async () => {
        // Enforce max pending withdrawals per user
        if (maxPending > 0) {
          const pendingCount = await this.withdrawalModel
            .countDocuments({ userId: objectUserId, status: { $in: ['pending', 'claimed', 'processing'] } })
            .session(session)
            .exec();
          if (pendingCount >= maxPending) {
            throw new ConflictException(`You already have ${pendingCount} pending withdrawal(s). Wait for them to complete before requesting another.`);
          }
        }

        // Find user wallet
        const wallet = await this.walletModel
          .findOne({ userId: objectUserId, currencyCode: 'CREDIT' })
          .session(session)
          .exec();

        if (!wallet) {
          throw new NotFoundException('Wallet not found');
        }

        if (wallet.status !== 'active') {
          throw new ConflictException('Wallet is not active');
        }

        if (wallet.availableMinor < amountMinor) {
          throw new ConflictException('Insufficient available balance');
        }

        // Deduct from available and add to reserved
        const updatedWallet = await this.walletModel.findOneAndUpdate(
          { _id: wallet._id, availableMinor: { $gte: amountMinor } },
          { $inc: { availableMinor: -amountMinor, reservedMinor: amountMinor } },
          { new: true, session }
        ).exec();

        if (!updatedWallet) {
          throw new ConflictException('Insufficient wallet balance or concurrent update failed');
        }

        // Create Withdrawal document
        const [withdrawal] = await this.withdrawalModel.create(
          [
            {
              userId: objectUserId,
              amountMinor,
              status: 'pending',
              destinationAccount: destinationAccount.trim(),
            }
          ],
          { session }
        );

        createdWithdrawal = withdrawal;

        // Create ledger entry for the debit
        await this.ledgerService.createEntry(
          {
            userId: objectUserId,
            walletId: updatedWallet._id,
            currencyCode: 'CREDIT',
            amountMinor,
            direction: 'debit',
            entryType: 'withdrawal',
            sourceType: 'withdrawal',
            sourceId: withdrawal._id.toString(),
            balanceAfterMinor: updatedWallet.availableMinor,
            metadata: { destinationAccount: destinationAccount.trim() }
          },
          session
        );

        // Notify the requesting user
        this.gameEventsGateway.emitWalletUpdated(userId, this.toWalletSummary(updatedWallet));
        // Notify all connected agents so the on-duty agent can claim it immediately
        this.gameEventsGateway.emitWithdrawalPending({
          withdrawalId: withdrawal._id.toString(),
          userId,
          amountMinor: withdrawal.amountMinor,
          destinationAccount: withdrawal.destinationAccount,
        });
      });

      if (!createdWithdrawal) {
        throw new Error('Withdrawal request transaction did not complete');
      }

      return createdWithdrawal;
    } finally {
      await session.endSession();
    }
  }

  async processWithdrawal(
    withdrawalId: string,
    action: 'approve' | 'reject',
    adminNotes?: string,
    adminUserId?: string
  ): Promise<Withdrawal> {
    const objectWithdrawalId = this.toObjectId(withdrawalId, 'withdrawalId');
    const objectAdminId = adminUserId ? this.toObjectId(adminUserId, 'adminUserId') : undefined;
    const session = await this.connection.startSession();

    try {
      let updatedWithdrawal: WithdrawalDocument | null = null;

      await session.withTransaction(async () => {
        const withdrawal = await this.withdrawalModel
          .findById(objectWithdrawalId)
          .session(session)
          .exec();

        if (!withdrawal) {
          throw new NotFoundException('Withdrawal request not found');
        }

        const settleable: WithdrawalStatus[] = action === 'approve'
          ? ['pending', 'processing']
          : ['pending', 'claimed', 'processing'];
        if (!settleable.includes(withdrawal.status)) {
          throw new ConflictException(`Withdrawal is already in '${withdrawal.status}' status`);
        }

        const wallet = await this.walletModel
          .findOne({ userId: withdrawal.userId, currencyCode: 'CREDIT' })
          .session(session)
          .exec();

        if (!wallet) {
          throw new NotFoundException('Wallet not found');
        }

        if (action === 'approve') {
          // Finalize: Deduct from reserved balance
          if (wallet.reservedMinor < withdrawal.amountMinor) {
            throw new ConflictException('Insufficient reserved balance in wallet');
          }

          const updatedWallet = await this.walletModel.findOneAndUpdate(
            { _id: wallet._id, reservedMinor: { $gte: withdrawal.amountMinor } },
            { $inc: { reservedMinor: -withdrawal.amountMinor } },
            { new: true, session }
          ).exec();

          if (!updatedWallet) {
            throw new ConflictException('Failed to deduct reserved balance');
          }

          // Update withdrawal status
          withdrawal.status = 'completed';
          withdrawal.adminNotes = adminNotes;
          withdrawal.processedAt = new Date();
          withdrawal.processedBy = objectAdminId;
          await withdrawal.save({ session });
          updatedWithdrawal = withdrawal;

          // Notify client via websocket
          this.gameEventsGateway.emitWalletUpdated(withdrawal.userId.toString(), this.toWalletSummary(updatedWallet));
        } else {
          // Reject: Refund from reserved back to available
          if (wallet.reservedMinor < withdrawal.amountMinor) {
            throw new ConflictException('Insufficient reserved balance in wallet to refund');
          }

          const updatedWallet = await this.walletModel.findOneAndUpdate(
            { _id: wallet._id, reservedMinor: { $gte: withdrawal.amountMinor } },
            { $inc: { reservedMinor: -withdrawal.amountMinor, availableMinor: withdrawal.amountMinor } },
            { new: true, session }
          ).exec();

          if (!updatedWallet) {
            throw new ConflictException('Failed to refund reserved balance');
          }

          // Update withdrawal status
          withdrawal.status = 'rejected';
          withdrawal.adminNotes = adminNotes;
          withdrawal.processedAt = new Date();
          withdrawal.processedBy = objectAdminId;
          await withdrawal.save({ session });
          updatedWithdrawal = withdrawal;

          // Create ledger entry for refund
          await this.ledgerService.createEntry(
            {
              userId: withdrawal.userId,
              walletId: updatedWallet._id,
              currencyCode: 'CREDIT',
              amountMinor: withdrawal.amountMinor,
              direction: 'credit',
              entryType: 'refund',
              sourceType: 'withdrawal',
              sourceId: withdrawal._id.toString(),
              balanceAfterMinor: updatedWallet.availableMinor,
              metadata: { action: 'reject', reason: adminNotes || 'Admin rejection' }
            },
            session
          );

          // Update stats for refund
          await this.connection.collection('platformstats').updateOne(
            { key: 'global' },
            { $inc: { totalRefundsMinor: withdrawal.amountMinor } },
            { upsert: true, session }
          );

          // Notify client via websocket
          this.gameEventsGateway.emitWalletUpdated(withdrawal.userId.toString(), this.toWalletSummary(updatedWallet));
        }
      });

      if (!updatedWithdrawal) {
        throw new Error('Processing withdrawal transaction did not complete');
      }

      return updatedWithdrawal;
    } finally {
      await session.endSession();
    }
  }

  async getPlayerWithdrawals(userId: string): Promise<Withdrawal[]> {
    const objectUserId = this.toObjectId(userId, 'userId');
    return this.withdrawalModel
      .find({ userId: objectUserId })
      .sort({ createdAt: -1 })
      .exec();
  }

  async getPendingWithdrawals(): Promise<Withdrawal[]> {
    return this.withdrawalModel
      .find({ status: 'pending' })
      .populate('userId', 'displayName email username')
      .sort({ createdAt: 1 })
      .exec();
  }

  async getAllWithdrawals(): Promise<Withdrawal[]> {
    return this.withdrawalModel
      .find()
      .populate('userId', 'displayName email username')
      .sort({ createdAt: -1 })
      .exec();
  }

  async getAvailableWithdrawals(): Promise<Withdrawal[]> {
    return this.withdrawalModel
      .find({ status: 'pending' })
      .populate('userId', 'displayName username')
      .sort({ createdAt: 1 })
      .exec();
  }

  async getAgentWithdrawals(agentId: string): Promise<Withdrawal[]> {
    const objectAgentId = this.toObjectId(agentId, 'agentId');
    return this.withdrawalModel
      .find({ agentId: objectAgentId, status: { $in: ['claimed', 'processing'] } })
      .populate('userId', 'displayName username')
      .sort({ claimedAt: -1 })
      .exec();
  }

  async claimWithdrawal(withdrawalId: string, agentId: string): Promise<Withdrawal> {
    const objectWithdrawalId = this.toObjectId(withdrawalId, 'withdrawalId');
    const objectAgentId = this.toObjectId(agentId, 'agentId');

    const withdrawal = await this.withdrawalModel.findOneAndUpdate(
      { _id: objectWithdrawalId, status: 'pending' },
      { $set: { status: 'claimed', agentId: objectAgentId, claimedAt: new Date() } },
      { new: true },
    ).exec();

    if (!withdrawal) {
      throw new ConflictException('Withdrawal is not available to claim (not pending or already claimed)');
    }
    return withdrawal;
  }

  async releaseWithdrawal(withdrawalId: string, agentId: string): Promise<Withdrawal> {
    const objectWithdrawalId = this.toObjectId(withdrawalId, 'withdrawalId');
    const objectAgentId = this.toObjectId(agentId, 'agentId');

    const withdrawal = await this.withdrawalModel.findOneAndUpdate(
      { _id: objectWithdrawalId, status: 'claimed', agentId: objectAgentId },
      { $set: { status: 'pending' }, $unset: { agentId: 1, claimedAt: 1 } },
      { new: true },
    ).exec();

    if (!withdrawal) {
      throw new ConflictException('Withdrawal not found or not assigned to you');
    }
    return withdrawal;
  }

  async completeWithdrawalByAgent(input: {
    withdrawalId: string;
    agentId: string;
    telebirrReference: string;
    serviceChargePct: number;
  }): Promise<Withdrawal> {
    const objectWithdrawalId = this.toObjectId(input.withdrawalId, 'withdrawalId');
    const objectAgentId = this.toObjectId(input.agentId, 'agentId');
    const session = await this.connection.startSession();

    try {
      let completed: WithdrawalDocument | null = null;

      await session.withTransaction(async () => {
        const withdrawal = await this.withdrawalModel
          .findOne({ _id: objectWithdrawalId, status: 'claimed', agentId: objectAgentId })
          .session(session)
          .exec();

        if (!withdrawal) {
          throw new ConflictException('Withdrawal not found or not assigned to you');
        }

        const serviceChargeMinor = Math.floor(withdrawal.amountMinor * input.serviceChargePct / 100);
        const netAmountMinor = withdrawal.amountMinor - serviceChargeMinor;

        if (netAmountMinor <= 0) {
          throw new BadRequestException('Service charge would consume the entire withdrawal amount');
        }

        // Settle the user's reservation
        const wallet = await this.walletModel
          .findOneAndUpdate(
            { userId: withdrawal.userId, currencyCode: 'CREDIT', reservedMinor: { $gte: withdrawal.amountMinor } },
            { $inc: { reservedMinor: -withdrawal.amountMinor } },
            { new: true, session },
          )
          .exec();

        if (!wallet) {
          throw new ConflictException('Insufficient reserved balance on user wallet');
        }

        // Credit the agent's wallet (net of service charge)
        await this.ensureDefaultWallet(objectAgentId, session);
        await this.creditInSession(
          {
            userId: input.agentId,
            amountMinor: netAmountMinor,
            entryType: 'agent_receipt',
            sourceType: 'withdrawal',
            sourceId: withdrawal._id.toString(),
            idempotencyKey: `agent-receipt:${withdrawal._id}`,
            metadata: {
              withdrawalId: withdrawal._id.toString(),
              userId: withdrawal.userId.toString(),
              grossAmountMinor: withdrawal.amountMinor,
              serviceChargeMinor,
            },
          },
          session,
        );

        withdrawal.status = 'completed';
        withdrawal.serviceChargeMinor = serviceChargeMinor;
        withdrawal.netAmountMinor = netAmountMinor;
        withdrawal.telebirrReference = input.telebirrReference.trim();
        withdrawal.processedAt = new Date();
        withdrawal.processedBy = objectAgentId;
        await withdrawal.save({ session });
        completed = withdrawal;

        if (serviceChargeMinor > 0) {
          await this.connection.collection('platformstats').updateOne(
            { key: 'global' },
            { $inc: { totalServiceChargesMinor: serviceChargeMinor } },
            { upsert: true, session },
          );
        }

        this.gameEventsGateway.emitWalletUpdated(withdrawal.userId.toString(), this.toWalletSummary(wallet));
      });

      if (!completed) {
        throw new Error('Agent withdrawal completion transaction did not complete');
      }
      return completed;
    } finally {
      await session.endSession();
    }
  }

  async getWagerLimit(userId: string): Promise<WagerLimit | null> {
    const objectUserId = this.toObjectId(userId, 'userId');
    return this.wagerLimitModel.findOne({ userId: objectUserId }).exec();
  }

  async upsertWagerLimit(
    userId: string,
    dailyLimitMinor: number,
    weeklyLimitMinor: number,
  ): Promise<WagerLimit> {
    this.assertNonNegativeAmount(dailyLimitMinor, 'dailyLimitMinor');
    this.assertNonNegativeAmount(weeklyLimitMinor, 'weeklyLimitMinor');
    const objectUserId = this.toObjectId(userId, 'userId');
    const now = new Date();
    const dailyReset = new Date(now);
    dailyReset.setUTCHours(24, 0, 0, 0);
    const weeklyReset = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const limit = await this.wagerLimitModel.findOneAndUpdate(
      { userId: objectUserId },
      {
        $set: { dailyLimitMinor, weeklyLimitMinor },
        $setOnInsert: {
          currentDailyWagerMinor: 0,
          currentWeeklyWagerMinor: 0,
          dailyResetAt: dailyReset,
          weeklyResetAt: weeklyReset,
        },
      },
      { new: true, upsert: true },
    ).exec();

    return limit!;
  }

  async deleteWagerLimit(userId: string): Promise<void> {
    const objectUserId = this.toObjectId(userId, 'userId');
    await this.wagerLimitModel.deleteOne({ userId: objectUserId }).exec();
  }

  private assertNonNegativeAmount(amount: number, field: string): void {
    if (!Number.isInteger(amount) || amount < 0) {
      throw new BadRequestException(`${field} must be a non-negative integer`);
    }
  }
}
