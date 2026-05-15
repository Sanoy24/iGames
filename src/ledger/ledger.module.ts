import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  IdempotencyRecord,
  IdempotencyRecordSchema
} from './schemas/idempotency-record.schema';
import { LedgerEntry, LedgerEntrySchema } from './schemas/ledger-entry.schema';
import { LedgerService } from './ledger.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: LedgerEntry.name, schema: LedgerEntrySchema },
      { name: IdempotencyRecord.name, schema: IdempotencyRecordSchema }
    ])
  ],
  providers: [LedgerService],
  exports: [LedgerService, MongooseModule]
})
export class LedgerModule {}
