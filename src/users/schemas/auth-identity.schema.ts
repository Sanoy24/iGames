import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type AuthIdentityDocument = HydratedDocument<AuthIdentity>;
export type AuthProvider = 'telegram' | 'password';

@Schema({ timestamps: true })
export class AuthIdentity {
  _id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ required: true, enum: ['telegram', 'password'], index: true })
  provider: AuthProvider;

  @Prop({ required: true, trim: true })
  providerUserId: string;

  @Prop({ trim: true, lowercase: true })
  providerUsername?: string;

  @Prop({ trim: true, lowercase: true })
  normalizedEmail?: string;

  @Prop({ select: false })
  passwordHash?: string;

  @Prop({ type: Object, default: {} })
  profileSnapshot: Record<string, unknown>;

  @Prop({ type: Date, required: true })
  linkedAt: Date;

  @Prop({ type: Date, required: true })
  lastAuthAt: Date;
}

export const AuthIdentitySchema = SchemaFactory.createForClass(AuthIdentity);

AuthIdentitySchema.index({ provider: 1, providerUserId: 1 }, { unique: true });
