import { ConflictException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import {
  IdempotencyRecord,
  IdempotencyRecordDocument
} from './schemas/idempotency-record.schema';
import {
  LedgerDirection,
  LedgerEntry,
  LedgerEntryDocument,
  LedgerEntryType
} from './schemas/ledger-entry.schema';

export type CreateLedgerEntryInput = {
  userId: Types.ObjectId;
  walletId: Types.ObjectId;
  currencyCode: string;
  amountMinor: number;
  direction: LedgerDirection;
  entryType: LedgerEntryType;
  sourceType: string;
  sourceId: string;
  idempotencyKey?: string;
  balanceAfterMinor: number;
  metadata?: Record<string, unknown>;
};

@Injectable()
export class LedgerService {
  constructor(
    @InjectModel(LedgerEntry.name)
    private readonly ledgerEntryModel: Model<LedgerEntry>,
    @InjectModel(IdempotencyRecord.name)
    private readonly idempotencyRecordModel: Model<IdempotencyRecord>
  ) {}

  async createEntry(
    input: CreateLedgerEntryInput,
    session: ClientSession
  ): Promise<LedgerEntryDocument> {
    const [entry] = await this.ledgerEntryModel.create(
      [
        {
          ...input,
          metadata: input.metadata ?? {}
        }
      ],
      { session }
    );

    return entry;
  }

  async findUserEntries(input: {
    userId: Types.ObjectId;
    limit: number;
  }): Promise<LedgerEntryDocument[]> {
    return this.ledgerEntryModel
      .find({ userId: input.userId })
      .sort({ createdAt: -1 })
      .limit(input.limit)
      .exec();
  }

  async findIdempotencyRecord(input: {
    key: string;
    userId: Types.ObjectId;
    action: string;
    session: ClientSession;
  }): Promise<IdempotencyRecordDocument | null> {
    return this.idempotencyRecordModel
      .findOne({
        key: input.key,
        userId: input.userId,
        action: input.action
      })
      .session(input.session)
      .exec();
  }

  async createPendingIdempotencyRecord(input: {
    key: string;
    userId: Types.ObjectId;
    action: string;
    requestHash: string;
    session: ClientSession;
  }): Promise<IdempotencyRecordDocument> {
    const [record] = await this.idempotencyRecordModel.create(
      [
        {
          key: input.key,
          userId: input.userId,
          action: input.action,
          requestHash: input.requestHash,
          status: 'pending',
          expiresAt: this.getDefaultExpiry()
        }
      ],
      { session: input.session }
    );

    return record;
  }

  assertIdempotentRequestMatches(
    record: IdempotencyRecordDocument,
    requestHash: string
  ): void {
    if (record.requestHash !== requestHash) {
      throw new ConflictException('Idempotency key was reused with a different request');
    }
  }

  async completeIdempotencyRecord(input: {
    record: IdempotencyRecordDocument;
    response: Record<string, unknown>;
    session: ClientSession;
  }): Promise<void> {
    input.record.status = 'completed';
    input.record.response = input.response;
    await input.record.save({ session: input.session });
  }

  private getDefaultExpiry(): Date {
    return new Date(Date.now() + 24 * 60 * 60 * 1000);
  }
}
