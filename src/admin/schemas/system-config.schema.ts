import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type SystemConfigDocument = HydratedDocument<SystemConfig>;

@Schema({ timestamps: true })
export class SystemConfig {
  _id: Types.ObjectId;

  @Prop({ required: true, unique: true, default: 'global' })
  key: string;

  @Prop({ required: true, default: 100 })
  telebirrCreditMinorPerBirr: number;

  @Prop({ required: true, default: 0 })
  welcomeBonusMinor: number;

  // Percentage of withdrawal amount charged as a service fee (0–100). Applied when an agent settles a withdrawal.
  @Prop({ required: true, default: 0, min: 0, max: 100 })
  withdrawalServiceChargePct: number;

  // Minimum withdrawal in minor units. 0 = no minimum.
  @Prop({ required: true, default: 0, min: 0 })
  withdrawalMinAmountMinor: number;

  // Maximum withdrawal in minor units. 0 = no maximum.
  @Prop({ required: true, default: 0, min: 0 })
  withdrawalMaxAmountMinor: number;

  // How many pending/claimed withdrawals a user may have at once. 0 = unlimited.
  @Prop({ required: true, default: 1, min: 0 })
  maxPendingWithdrawalsPerUser: number;
}

export const SystemConfigSchema = SchemaFactory.createForClass(SystemConfig);
