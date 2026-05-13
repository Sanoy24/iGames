import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import {
  AuthIdentity,
  AuthIdentityDocument,
  AuthProvider
} from './schemas/auth-identity.schema';
import { User, UserDocument } from './schemas/user.schema';

export type TelegramIdentityInput = {
  telegramUserId: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  languageCode?: string;
  photoUrl?: string;
  isPremium?: boolean;
};

export type FindOrCreateUserResult = {
  user: UserDocument;
  identity: AuthIdentityDocument;
  created: boolean;
};

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(AuthIdentity.name)
    private readonly authIdentityModel: Model<AuthIdentity>
  ) {}

  async findById(userId: Types.ObjectId | string): Promise<UserDocument> {
    const user = await this.userModel.findById(userId).exec();
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  async findOrCreateTelegramUser(
    input: TelegramIdentityInput,
    session: ClientSession
  ): Promise<FindOrCreateUserResult> {
    const now = new Date();
    const provider: AuthProvider = 'telegram';
    const providerUserId = input.telegramUserId;

    const existingIdentity = await this.authIdentityModel
      .findOne({ provider, providerUserId })
      .session(session)
      .exec();

    if (existingIdentity) {
      existingIdentity.providerUsername = input.username?.toLowerCase();
      existingIdentity.profileSnapshot = this.toTelegramSnapshot(input);
      existingIdentity.lastAuthAt = now;
      await existingIdentity.save({ session });

      const existingUser = await this.findByIdInSession(existingIdentity.userId, session);
      existingUser.lastLoginAt = now;
      await existingUser.save({ session });

      return {
        user: existingUser,
        identity: existingIdentity,
        created: false
      };
    }

    const [user] = await this.userModel.create(
      [
        {
          displayName: this.getTelegramDisplayName(input),
          username: input.username?.toLowerCase(),
          roles: ['player'],
          status: 'active',
          lastLoginAt: now,
          productMetadata: {
            firstProvider: provider
          }
        }
      ],
      { session }
    );

    const [identity] = await this.authIdentityModel.create(
      [
        {
          userId: user._id,
          provider,
          providerUserId,
          providerUsername: input.username?.toLowerCase(),
          profileSnapshot: this.toTelegramSnapshot(input),
          linkedAt: now,
          lastAuthAt: now
        }
      ],
      { session }
    );

    return {
      user,
      identity,
      created: true
    };
  }

  private async findByIdInSession(
    userId: Types.ObjectId,
    session: ClientSession
  ): Promise<UserDocument> {
    const user = await this.userModel.findById(userId).session(session).exec();
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  private getTelegramDisplayName(input: TelegramIdentityInput): string {
    const name = [input.firstName, input.lastName].filter(Boolean).join(' ').trim();
    return name || input.username || `telegram_${input.telegramUserId}`;
  }

  private toTelegramSnapshot(input: TelegramIdentityInput): Record<string, unknown> {
    return {
      telegramUserId: input.telegramUserId,
      username: input.username,
      firstName: input.firstName,
      lastName: input.lastName,
      languageCode: input.languageCode,
      photoUrl: input.photoUrl,
      isPremium: input.isPremium
    };
  }
}
