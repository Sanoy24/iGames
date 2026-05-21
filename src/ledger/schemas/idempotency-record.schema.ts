import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type IdempotencyRecordDocument = HydratedDocument<IdempotencyRecord>;
export type IdempotencyStatus = 'pending' | 'completed' | 'failed';

@Schema({ timestamps: true })
export class IdempotencyRecord {
  _id: Types.ObjectId;

  @Prop({ required: true, trim: true })
  key: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  action: string;

  @Prop({ required: true, trim: true })
  requestHash: string;

  @Prop({ required: true, enum: ['pending', 'completed', 'failed'], default: 'pending' })
  status: IdempotencyStatus;

  @Prop({ type: Object })
  response?: Record<string, unknown>;

  @Prop({ type: Date, required: true })
  expiresAt: Date;
}

export const IdempotencyRecordSchema = SchemaFactory.createForClass(IdempotencyRecord);

IdempotencyRecordSchema.index({ key: 1, userId: 1, action: 1 }, { unique: true });
IdempotencyRecordSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
