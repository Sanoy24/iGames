import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type UserDocument = HydratedDocument<User>;
export type UserRole = 'player' | 'admin' | 'agent' | 'system';
export type UserStatus = 'active' | 'suspended' | 'closed';

@Schema({ timestamps: true })
export class User {
  _id: Types.ObjectId;

  @Prop({ required: true, trim: true })
  displayName: string;

  @Prop({ trim: true, lowercase: true, sparse: true, unique: true })
  email?: string;

  @Prop({ trim: true, lowercase: true, sparse: true, unique: true })
  username?: string;

  @Prop({ type: [String], default: ['player'] })
  roles: UserRole[];

  @Prop({ required: true, enum: ['active', 'suspended', 'closed'], default: 'active' })
  status: UserStatus;

  @Prop({ type: Date })
  lastLoginAt?: Date;

  @Prop({ type: Object, default: {} })
  responsibleGamingFlags: Record<string, unknown>;

  @Prop({ type: Object, default: {} })
  productMetadata: Record<string, unknown>;
}

export const UserSchema = SchemaFactory.createForClass(User);
