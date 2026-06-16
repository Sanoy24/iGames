import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { ParsedTelebirrReceipt } from '../types/telebirr-receipt';

export type TelebirrDepositDocument = HydratedDocument<TelebirrDeposit>;
export type TelebirrDepositStatus = 'credited' | 'rejected';

@Schema({ timestamps: true })
export class TelebirrDeposit {
  _id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', index: true })
  agentId?: Types.ObjectId;

  @Prop({ required: true, trim: true, unique: true })
  receiptNo: string;

  @Prop({ required: true, min: 1 })
  amountMinor: number;

  @Prop({ required: true, default: 'CREDIT', uppercase: true, trim: true })
  currencyCode: string;

  @Prop({ required: true, enum: ['credited', 'rejected'] })
  status: TelebirrDepositStatus;

  @Prop({ trim: true })
  payerName?: string;

  @Prop({ trim: true })
  payerPhone?: string;

  @Prop({ trim: true })
  creditedPartyName?: string;

  @Prop({ trim: true })
  creditedPartyAccount?: string;

  @Prop({ trim: true })
  transactionStatus?: string;

  @Prop({ type: Object, required: true })
  parsedReceipt: ParsedTelebirrReceipt;

  @Prop({ type: Object, default: {} })
  verification: Record<string, unknown>;

  @Prop({ type: Object })
  walletCredit?: Record<string, unknown>;
}

export const TelebirrDepositSchema = SchemaFactory.createForClass(TelebirrDeposit);

TelebirrDepositSchema.index({ userId: 1, createdAt: -1 });
