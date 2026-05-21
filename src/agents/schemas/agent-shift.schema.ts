import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type AgentShiftDocument = HydratedDocument<AgentShift>;

@Schema({ timestamps: true })
export class AgentShift {
  _id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  agentId: Types.ObjectId;

  @Prop({ required: true, min: 0, max: 23 })
  startHour: number;

  @Prop({ required: true, min: 0, max: 59 })
  startMinute: number;

  @Prop({ required: true, min: 0, max: 23 })
  endHour: number;

  @Prop({ required: true, min: 0, max: 59 })
  endMinute: number;

  // 0=Sun 1=Mon … 6=Sat. Empty array means every day.
  @Prop({ type: [Number], default: [] })
  daysOfWeek: number[];

  @Prop({ default: true })
  isActive: boolean;

  @Prop({ trim: true })
  label?: string;
}

export const AgentShiftSchema = SchemaFactory.createForClass(AgentShift);

AgentShiftSchema.index({ agentId: 1, isActive: 1 });
