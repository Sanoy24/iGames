import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type WagerLimitDocument = HydratedDocument<WagerLimit>;

@Schema({ timestamps: true })
export class WagerLimit {
  _id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, unique: true })
  userId: Types.ObjectId;

  @Prop({ required: true, default: 0 })
  dailyLimitMinor: number; // 0 means unlimited

  @Prop({ required: true, default: 0 })
  weeklyLimitMinor: number; // 0 means unlimited

  @Prop({ required: true, default: 0 })
  currentDailyWagerMinor: number;

  @Prop({ required: true, default: 0 })
  currentWeeklyWagerMinor: number;

  @Prop({ type: Date, required: true })
  dailyResetAt: Date;

  @Prop({ type: Date, required: true })
  weeklyResetAt: Date;
}

export const WagerLimitSchema = SchemaFactory.createForClass(WagerLimit);
