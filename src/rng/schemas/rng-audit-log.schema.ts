import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type RngAuditLogDocument = HydratedDocument<RngAuditLog>;
export type RngGameType = 'keno' | 'bingo';

@Schema({ timestamps: true })
export class RngAuditLog {
  _id: Types.ObjectId;

  @Prop({ required: true, enum: ['keno', 'bingo'], index: true })
  gameType: RngGameType;

  @Prop({ required: true, trim: true, index: true })
  gameReference: string;

  @Prop({ required: true, trim: true })
  algorithmVersion: string;

  @Prop({ required: true, trim: true })
  inputHash: string;

  @Prop({ required: true, trim: true })
  randomnessMaterialHash: string;

  @Prop({ type: [Number], required: true })
  outputNumbers: number[];

  @Prop({ required: true, min: 1 })
  min: number;

  @Prop({ required: true, min: 1 })
  max: number;

  @Prop({ required: true, min: 1 })
  count: number;

  @Prop({ type: Object, default: {} })
  metadata: Record<string, unknown>;
}

export const RngAuditLogSchema = SchemaFactory.createForClass(RngAuditLog);

RngAuditLogSchema.index({ gameType: 1, gameReference: 1 });
RngAuditLogSchema.index({ createdAt: -1 });
