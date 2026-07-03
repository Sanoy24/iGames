import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IdempotencyRecord } from './entities/idempotency-record.entity';
import { LedgerEntry } from './entities/ledger-entry.entity';
import { LedgerService } from './ledger.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([LedgerEntry, IdempotencyRecord])
  ],
  providers: [LedgerService],
  exports: [LedgerService, TypeOrmModule]
})
export class LedgerModule {}
