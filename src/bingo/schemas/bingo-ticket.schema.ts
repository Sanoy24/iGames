import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { BingoPrizeTier } from './bingo-room.schema';

export type BingoTicketDocument = HydratedDocument<BingoTicket>;
export type BingoTicketStatus = 'active' | 'won' | 'lost' | 'cancelled';
export type BingoSettlementStatus = 'pending' | 'settled';
export type BingoGrid = Array<Array<number | null>>;

@Schema({ timestamps: true })
export class BingoTicket {
  _id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'BingoRoom', required: true, index: true })
  roomId: Types.ObjectId;

  @Prop({ type: [[Number]], required: true })
  grid: BingoGrid;

  @Prop({ type: [Number], default: [] })
  markedNumbers: number[];

  @Prop({ type: [Number], default: [] })
  completedLines: number[];

  @Prop({ type: [String], default: [] })
  wonTiers: BingoPrizeTier[];

  @Prop({ required: true, min: 1 })
  stakeMinor: number;

  @Prop({ required: true, min: 0, default: 0 })
  payoutMinor: number;

  @Prop({ required: true, enum: ['active', 'won', 'lost', 'cancelled'], default: 'active', index: true })
  status: BingoTicketStatus;

  @Prop({ required: true, enum: ['pending', 'settled'], default: 'pending', index: true })
  settlementStatus: BingoSettlementStatus;

  @Prop({ required: true, trim: true })
  purchaseIdempotencyKey: string;

  @Prop({ type: Object })
  walletDebit?: Record<string, unknown>;

  @Prop({ type: [Object], default: [] })
  walletCredits: Array<Record<string, unknown>>;
}

export const BingoTicketSchema = SchemaFactory.createForClass(BingoTicket);

BingoTicketSchema.index({ userId: 1, createdAt: -1 });
BingoTicketSchema.index({ roomId: 1, userId: 1, purchaseIdempotencyKey: 1 });
BingoTicketSchema.index({ roomId: 1, settlementStatus: 1 });
