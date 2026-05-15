import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type BingoRoomDocument = HydratedDocument<BingoRoom>;
export type BingoRoomStatus = 'open' | 'running' | 'completed' | 'cancelled';
export type BingoPrizeTier = 'one_line' | 'two_lines' | 'full_house';

@Schema({ _id: false })
export class BingoPrizeConfig {
  @Prop({ required: true, min: 0 })
  oneLineMinor: number;

  @Prop({ required: true, min: 0 })
  twoLinesMinor: number;

  @Prop({ required: true, min: 0 })
  fullHouseMinor: number;
}

export const BingoPrizeConfigSchema = SchemaFactory.createForClass(BingoPrizeConfig);

@Schema({ timestamps: true })
export class BingoRoom {
  _id: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, enum: ['open', 'running', 'completed', 'cancelled'], default: 'open', index: true })
  status: BingoRoomStatus;

  @Prop({ required: true, min: 1 })
  ticketPriceMinor: number;

  @Prop({ required: true, min: 1 })
  maxTickets: number;

  @Prop({ type: BingoPrizeConfigSchema, required: true })
  prizes: BingoPrizeConfig;

  @Prop({ type: Date, required: true, index: true })
  scheduledStartAt: Date;

  @Prop({ type: [Number], default: [] })
  drawnNumbers: number[];

  @Prop({ type: [String], default: [] })
  rngAuditLogIds: string[];

  @Prop({ type: [String], default: [] })
  settledTiers: BingoPrizeTier[];

  @Prop({ type: Object, default: {} })
  winnersByTier: Record<string, string[]>;

  @Prop({ type: Object, default: {} })
  settlementSummary: Record<string, unknown>;
}

export const BingoRoomSchema = SchemaFactory.createForClass(BingoRoom);

BingoRoomSchema.index({ status: 1, scheduledStartAt: 1 });
