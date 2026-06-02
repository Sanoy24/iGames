import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type KenoConfigDocument = HydratedDocument<KenoConfig>;
export type KenoConfigStatus = 'active' | 'inactive';

@Schema({ _id: false })
export class KenoPaytableEntry {
  @Prop({ required: true, min: 1, max: 12 })
  spots: number;

  @Prop({ required: true, min: 0, max: 12 })
  matches: number;

  @Prop({ required: true, min: 0 })
  payoutMultiplier: number;
}

export const KenoPaytableEntrySchema = SchemaFactory.createForClass(KenoPaytableEntry);

@Schema({ timestamps: true })
export class KenoConfig {
  _id: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, min: 1 })
  version: number;

  @Prop({ required: true, enum: ['active', 'inactive'], default: 'inactive' })
  status: KenoConfigStatus;

  @Prop({ required: true, default: 1 })
  numberMin: number;

  @Prop({ required: true, default: 80 })
  numberMax: number;

  @Prop({ required: true, default: 20 })
  drawSize: number;

  @Prop({ type: [Number], required: true, default: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] })
  allowedSpots: number[];

  @Prop({ required: true, min: 1 })
  ticketPriceMinor: number;

  @Prop({ type: [KenoPaytableEntrySchema], required: true })
  paytable: KenoPaytableEntry[];

  @Prop({ required: true, default: 0, min: 0 })
  globalBotWinInterval: number;

  @Prop({ required: true, default: 3, min: 0 })
  autoScheduleIntervalMinutes: number;

  @Prop({ required: true, default: 40, min: 0 })
  autoScheduleIntervalSeconds: number;

  @Prop({ required: true, default: 0, min: 0 })
  maxWinnersPerDraw: number;
}

export const KenoConfigSchema = SchemaFactory.createForClass(KenoConfig);

KenoConfigSchema.index({ status: 1 });
KenoConfigSchema.index({ version: 1 }, { unique: true });
