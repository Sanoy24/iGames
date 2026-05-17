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
}

export const SystemConfigSchema = SchemaFactory.createForClass(SystemConfig);
