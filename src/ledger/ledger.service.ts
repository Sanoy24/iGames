import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager } from 'typeorm';
import { IdempotencyRecord, IdempotencyStatus } from './entities/idempotency-record.entity';
import { LedgerDirection, LedgerEntry, LedgerEntryType } from './entities/ledger-entry.entity';

export type CreateLedgerEntryInput = {
  userId: string;
  walletId: string;
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
    @InjectRepository(LedgerEntry)
    private readonly ledgerEntryRepository: Repository<LedgerEntry>,
    @InjectRepository(IdempotencyRecord)
    private readonly idempotencyRecordRepository: Repository<IdempotencyRecord>
  ) {}

  async createEntry(
    input: CreateLedgerEntryInput,
    manager?: EntityManager
  ): Promise<LedgerEntry> {
    const repo = manager ? manager.getRepository(LedgerEntry) : this.ledgerEntryRepository;
    const entry = repo.create({
      ...input,
      metadata: input.metadata ?? {}
    });
    return await repo.save(entry);
  }

  async findUserEntries(input: {
    userId: string;
    limit: number;
  }): Promise<LedgerEntry[]> {
    return this.ledgerEntryRepository.find({
      where: { userId: input.userId },
      order: { createdAt: 'DESC' },
      take: input.limit
    });
  }

  async findIdempotencyRecord(input: {
    key: string;
    userId: string;
    action: string;
    manager?: EntityManager;
  }): Promise<IdempotencyRecord | null> {
    const repo = input.manager ? input.manager.getRepository(IdempotencyRecord) : this.idempotencyRecordRepository;
    return repo.findOneBy({
      key: input.key,
      userId: input.userId,
      action: input.action
    });
  }

  async createPendingIdempotencyRecord(input: {
    key: string;
    userId: string;
    action: string;
    requestHash: string;
    manager?: EntityManager;
  }): Promise<IdempotencyRecord> {
    const repo = input.manager ? input.manager.getRepository(IdempotencyRecord) : this.idempotencyRecordRepository;
    const record = repo.create({
      key: input.key,
      userId: input.userId,
      action: input.action,
      requestHash: input.requestHash,
      status: 'pending',
      expiresAt: this.getDefaultExpiry()
    });
    return await repo.save(record);
  }

  assertIdempotentRequestMatches(
    record: IdempotencyRecord,
    requestHash: string
  ): void {
    if (record.requestHash !== requestHash) {
      throw new ConflictException('Idempotency key was reused with a different request');
    }
  }

  async completeIdempotencyRecord(input: {
    record: IdempotencyRecord;
    response: Record<string, unknown>;
    manager?: EntityManager;
  }): Promise<void> {
    const repo = input.manager ? input.manager.getRepository(IdempotencyRecord) : this.idempotencyRecordRepository;
    input.record.status = 'completed';
    input.record.response = input.response;
    await repo.save(input.record);
  }

  private getDefaultExpiry(): Date {
    return new Date(Date.now() + 24 * 60 * 60 * 1000);
  }
}
