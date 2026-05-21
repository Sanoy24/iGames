import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type WithdrawalDocument = HydratedDocument<Withdrawal>;
export type WithdrawalStatus = 'pending' | 'claimed' | 'processing' | 'completed' | 'rejected';

@Schema({ timestamps: true })
export class Withdrawal {
  _id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ required: true, min: 1 })
  amountMinor: number;

  @Prop({
    required: true,
    enum: ['pending', 'claimed', 'processing', 'completed', 'rejected'],
    default: 'pending',
    index: true,
  })
  status: WithdrawalStatus;

  @Prop({ required: true, trim: true })
  destinationAccount: string;

  // Agent fields
  @Prop({ type: Types.ObjectId, ref: 'User', index: true })
  agentId?: Types.ObjectId;

  @Prop({ type: Date })
  claimedAt?: Date;

  // Populated when the agent completes the withdrawal
  @Prop({ default: 0, min: 0 })
  serviceChargeMinor: number;

  @Prop({ min: 0 })
  netAmountMinor?: number;

  @Prop({ trim: true })
  telebirrReference?: string;

  @Prop({ trim: true })
  adminNotes?: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  processedBy?: Types.ObjectId;

  @Prop({ type: Date })
  processedAt?: Date;
}

export const WithdrawalSchema = SchemaFactory.createForClass(Withdrawal);

WithdrawalSchema.index({ agentId: 1, status: 1 });
