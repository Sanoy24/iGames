import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type KenoDrawDocument = HydratedDocument<KenoDraw>;
export type KenoDrawStatus = 'open' | 'locked' | 'drawn' | 'settled' | 'cancelled';

@Schema({ timestamps: true })
export class KenoDraw {
  _id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'KenoConfig', required: true, index: true })
  configId: Types.ObjectId;

  @Prop({ required: true })
  configVersion: number;

  @Prop({ required: true, enum: ['open', 'locked', 'drawn', 'settled', 'cancelled'], default: 'open', index: true })
  status: KenoDrawStatus;

  @Prop({ type: Date, required: true, index: true })
  scheduledAt: Date;

  @Prop({ type: [Number], default: [] })
  drawnNumbers: number[];

  @Prop({ trim: true })
  rngAuditLogId?: string;

  @Prop({ type: Date })
  executedAt?: Date;

  @Prop({ type: Date })
  settledAt?: Date;

  @Prop({ type: Object, default: {} })
  settlementSummary: Record<string, unknown>;
}

export const KenoDrawSchema = SchemaFactory.createForClass(KenoDraw);

KenoDrawSchema.index({ status: 1, scheduledAt: 1 });
