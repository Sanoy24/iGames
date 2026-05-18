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
}
