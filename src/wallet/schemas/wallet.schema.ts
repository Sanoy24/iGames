import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type WalletDocument = HydratedDocument<Wallet>;
export type WalletStatus = 'active' | 'locked' | 'closed';

@Schema({ timestamps: true })
export class Wallet {
  _id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ required: true, default: 'CREDIT', uppercase: true, trim: true })
  currencyCode: string;

  @Prop({ required: true, default: 0, min: 0 })
  availableMinor: number;

  @Prop({ required: true, default: 0, min: 0 })
  reservedMinor: number;

  @Prop({ required: true, enum: ['active', 'locked', 'closed'], default: 'active' })
  status: WalletStatus;
}

export const WalletSchema = SchemaFactory.createForClass(Wallet);

WalletSchema.index({ userId: 1, currencyCode: 1 }, { unique: true });
