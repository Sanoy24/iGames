import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type RefreshSessionDocument = HydratedDocument<RefreshSession>;

@Schema({ timestamps: true })
export class RefreshSession {
  @Prop({ type: String })
  _id: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ required: true, enum: ['telegram', 'password'] })
  provider: 'telegram' | 'password';

  @Prop({ required: true })
  refreshTokenHash: string;

  @Prop({ type: Date, required: true })
  expiresAt: Date;

  @Prop({ type: Date })
  revokedAt?: Date;

  @Prop({ type: Date })
  lastUsedAt?: Date;
}

export const RefreshSessionSchema = SchemaFactory.createForClass(RefreshSession);

RefreshSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
