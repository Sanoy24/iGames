import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type KenoTicketDocument = HydratedDocument<KenoTicket>;
export type KenoTicketStatus = 'pending' | 'lost' | 'won' | 'cancelled';
export type KenoSettlementStatus = 'pending' | 'settled';

@Schema({ timestamps: true })
export class KenoTicket {
  _id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'KenoDraw', required: true, index: true })
  drawId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'KenoConfig', required: true })
  configId: Types.ObjectId;

  @Prop({ required: true })
  configVersion: number;

  @Prop({ type: [Number], required: true })
  selectedNumbers: number[];

  @Prop({ required: true, min: 1 })
  stakeMinor: number;

  @Prop({ required: true, min: 0, default: 0 })
  matches: number;

  @Prop({ required: true, min: 0, default: 0 })
  payoutMinor: number;

  @Prop({ required: true, enum: ['pending', 'lost', 'won', 'cancelled'], default: 'pending', index: true })
  status: KenoTicketStatus;

  @Prop({ required: true, enum: ['pending', 'settled'], default: 'pending', index: true })
  settlementStatus: KenoSettlementStatus;

  @Prop({ required: true, trim: true })
  idempotencyKey: string;

  @Prop({ type: Boolean, default: false })
  isForcedWin?: boolean;

  @Prop({ type: Object })
  walletDebit?: Record<string, unknown>;

  @Prop({ type: Object })
  walletCredit?: Record<string, unknown>;
}

export const KenoTicketSchema = SchemaFactory.createForClass(KenoTicket);

KenoTicketSchema.index({ userId: 1, createdAt: -1 });
KenoTicketSchema.index({ drawId: 1, settlementStatus: 1 });
KenoTicketSchema.index({ userId: 1, idempotencyKey: 1 }, { unique: true });
