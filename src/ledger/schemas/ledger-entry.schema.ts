import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type LedgerEntryDocument = HydratedDocument<LedgerEntry>;
export type LedgerDirection = 'debit' | 'credit';
export type LedgerEntryType =
  | 'stake'
  | 'win'
  | 'refund'
  | 'adjustment'
  | 'bonus'
  | 'deposit'
  | 'reversal'
  | 'withdrawal'
  | 'agent_receipt';

@Schema({ timestamps: true })
export class LedgerEntry {
  _id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Wallet', required: true, index: true })
  walletId: Types.ObjectId;

  @Prop({ required: true, uppercase: true, trim: true })
  currencyCode: string;

  @Prop({ required: true, min: 1 })
  amountMinor: number;

  @Prop({ required: true, enum: ['debit', 'credit'] })
  direction: LedgerDirection;

  @Prop({
    required: true,
    enum: ['stake', 'win', 'refund', 'adjustment', 'bonus', 'deposit', 'reversal', 'withdrawal', 'agent_receipt']
  })
  entryType: LedgerEntryType;

  @Prop({ required: true, trim: true })
  sourceType: string;

  @Prop({ required: true, trim: true })
  sourceId: string;

  @Prop({ trim: true })
  idempotencyKey?: string;

  @Prop({ required: true, min: 0 })
  balanceAfterMinor: number;

  @Prop({ type: Object, default: {} })
  metadata: Record<string, unknown>;
}

export const LedgerEntrySchema = SchemaFactory.createForClass(LedgerEntry);

LedgerEntrySchema.index({ userId: 1, createdAt: -1 });
LedgerEntrySchema.index({ sourceType: 1, sourceId: 1 });
LedgerEntrySchema.index(
  { userId: 1, sourceType: 1, idempotencyKey: 1 },
  { unique: true, sparse: true }
);
