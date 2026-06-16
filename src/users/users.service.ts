import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import * as argon2 from 'argon2';
import { ClientSession, Model, Types } from 'mongoose';
import {
  AuthIdentity,
  AuthIdentityDocument,
  AuthProvider
} from './schemas/auth-identity.schema';
import { User, UserDocument } from './schemas/user.schema';
import { RefreshSession } from '../auth/schemas/refresh-session.schema';

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
    private readonly authIdentityModel: Model<AuthIdentity>,
    @InjectModel(RefreshSession.name)
    private readonly refreshSessionModel: Model<RefreshSession>,
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

  async listUsers(page: number, limit: number) {
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.userModel.find().sort({ createdAt: -1 }).skip(skip).limit(limit).exec(),
      this.userModel.countDocuments().exec()
    ]);
    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    };
  }

  async createAgentUser(input: {
    phoneNumber: string;
    displayName: string;
    password: string;
    workStartHour?: number;
    workStartMinute?: number;
    workEndHour?: number;
    workEndMinute?: number;
    agentPermissions?: { deposit: boolean; withdraw: boolean };
  }): Promise<UserDocument> {
    const normalizedPhone = input.phoneNumber.trim();
    if (!normalizedPhone) throw new BadRequestException('Phone number is required');

    const existing = await this.authIdentityModel
      .findOne({ provider: 'password', providerUserId: normalizedPhone })
      .exec();
    if (existing) {
      throw new ConflictException('An agent with that phone number already exists');
    }

    const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });

    const [user] = await this.userModel.create([
      {
        displayName: input.displayName.trim(),
        phoneNumber: normalizedPhone,
        roles: ['agent'],
        status: 'active',
        workStartHour: input.workStartHour,
        workStartMinute: input.workStartMinute,
        workEndHour: input.workEndHour,
        workEndMinute: input.workEndMinute,
        agentPermissions: input.agentPermissions ?? { deposit: true, withdraw: true },
      },
    ]);

    await this.authIdentityModel.create([
      {
        userId: user._id,
        provider: 'password',
        providerUserId: normalizedPhone,
        passwordHash,
        profileSnapshot: { phoneNumber: normalizedPhone },
        linkedAt: new Date(),
        lastAuthAt: new Date(),
      },
    ]);

    return user;
  }

  async updateAgentUser(
    agentId: string,
    update: {
      displayName?: string;
      phoneNumber?: string;
      password?: string;
      workStartHour?: number;
      workStartMinute?: number;
      workEndHour?: number;
      workEndMinute?: number;
      agentPermissions?: { deposit: boolean; withdraw: boolean };
      status?: 'active' | 'suspended' | 'closed';
    }
  ): Promise<UserDocument> {
    const user = await this.userModel.findById(agentId).exec();
    if (!user || !user.roles.includes('agent')) {
      throw new NotFoundException('Agent not found');
    }

    const setObj: Record<string, any> = {};
    if (update.displayName !== undefined) setObj.displayName = update.displayName.trim();
    if (update.status !== undefined) setObj.status = update.status;
    if (update.phoneNumber !== undefined) {
      const normalizedPhone = update.phoneNumber.trim();
      setObj.phoneNumber = normalizedPhone;
      await this.authIdentityModel.updateOne(
        { userId: user._id, provider: 'password' },
        { $set: { providerUserId: normalizedPhone, 'profileSnapshot.phoneNumber': normalizedPhone } }
      ).exec();
    }
    if (update.password !== undefined && update.password.trim() !== '') {
      const passwordHash = await argon2.hash(update.password, { type: argon2.argon2id });
      await this.authIdentityModel.updateOne(
        { userId: user._id, provider: 'password' },
        { $set: { passwordHash } }
      ).exec();
    }
    setObj.workStartHour = update.workStartHour;
    setObj.workStartMinute = update.workStartMinute;
    setObj.workEndHour = update.workEndHour;
    setObj.workEndMinute = update.workEndMinute;
    if (update.agentPermissions !== undefined) setObj.agentPermissions = update.agentPermissions;

    const updatedUser = await this.userModel.findByIdAndUpdate(
      agentId,
      { $set: setObj },
      { new: true }
    ).exec();

    if (!updatedUser) {
      throw new NotFoundException('Agent not found after update');
    }

    return updatedUser;
  }

  async findAgentByCredentials(
    phoneNumber: string,
    password: string,
  ): Promise<UserDocument> {
    const normalizedPhone = phoneNumber.trim();
    const identity = await this.authIdentityModel
      .findOne({ provider: 'password', providerUserId: normalizedPhone })
      .select('+passwordHash')
      .exec();

    if (!identity || !identity.passwordHash) {
      throw new BadRequestException('Invalid phone number or password');
    }

    const valid = await argon2.verify(identity.passwordHash, password);
    if (!valid) {
      throw new BadRequestException('Invalid phone number or password');
    }

    const user = await this.userModel.findById(identity.userId).exec();
    if (!user || user.status !== 'active') {
      throw new BadRequestException('Account is inactive');
    }

    identity.lastAuthAt = new Date();
    await identity.save();

    return user;
  }

  async listAgents(page: number, limit: number) {
    const skip = (page - 1) * limit;
    const filter = { roles: 'agent' };
    const [data, total] = await Promise.all([
      this.userModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).exec(),
      this.userModel.countDocuments(filter).exec(),
    ]);
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getProfile(userId: string): Promise<UserDocument> {
    return this.findById(userId);
  }

  async updateProfile(userId: string, update: { displayName?: string; phoneNumber?: string }): Promise<UserDocument> {
    const sanitized: Record<string, string> = {};
    if (update.displayName?.trim()) sanitized.displayName = update.displayName.trim();
    if (update.phoneNumber?.trim()) sanitized.phoneNumber = update.phoneNumber.trim();

    const user = await this.userModel.findByIdAndUpdate(userId, { $set: sanitized }, { new: true }).exec();
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async updatePhoneByTelegramId(telegramUserId: string, phoneNumber: string): Promise<void> {
    const identity = await this.authIdentityModel
      .findOne({ provider: 'telegram', providerUserId: telegramUserId })
      .exec();
    if (!identity) return;
    await this.userModel.findByIdAndUpdate(identity.userId, { $set: { phoneNumber } }).exec();
  }

  async updateStatus(userId: string, status: 'active' | 'suspended' | 'banned') {
    const user = await this.userModel.findByIdAndUpdate(userId, { status }, { new: true }).exec();
    if (!user) throw new NotFoundException('User not found');

    if (status === 'suspended' || status === 'banned') {
      await this.refreshSessionModel.updateMany(
        { userId: new Types.ObjectId(userId), revokedAt: { $exists: false } },
        { $set: { revokedAt: new Date() } }
      ).exec();
    }

    return user;
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
