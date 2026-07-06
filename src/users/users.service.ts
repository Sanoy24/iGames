import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import { Repository, EntityManager, DataSource, IsNull, In } from 'typeorm';
import { User } from './entities/user.entity';
import { AuthIdentity } from './entities/auth-identity.entity';
import { RefreshSession } from '../auth/entities/refresh-session.entity';
import { normalizeEthiopianPhone } from '../common/phone.util';

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
  user: User;
  identity: AuthIdentity;
  created: boolean;
};

@Injectable()
export class UsersService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(AuthIdentity)
    private readonly authIdentityRepository: Repository<AuthIdentity>,
    @InjectRepository(RefreshSession)
    private readonly refreshSessionRepository: Repository<RefreshSession>,
  ) {}

  async findById(userId: string): Promise<User> {
    const user = await this.userRepository.findOneBy({ id: userId });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  async findOrCreateTelegramUser(
    input: TelegramIdentityInput,
    manager?: EntityManager
  ): Promise<FindOrCreateUserResult> {
    const now = new Date();
    const provider = 'telegram';
    const providerUserId = input.telegramUserId;

    const authRepo = manager ? manager.getRepository(AuthIdentity) : this.authIdentityRepository;
    const userRepo = manager ? manager.getRepository(User) : this.userRepository;

    const existingIdentity = await authRepo.findOneBy({ provider, providerUserId });

    if (existingIdentity) {
      existingIdentity.providerUsername = input.username?.toLowerCase();
      existingIdentity.profileSnapshot = this.toTelegramSnapshot(input);
      existingIdentity.lastAuthAt = now;
      await authRepo.save(existingIdentity);

      const existingUser = await userRepo.findOneBy({ id: existingIdentity.userId });
      if (!existingUser) {
        throw new NotFoundException('User not found');
      }
      existingUser.lastLoginAt = now;
      await userRepo.save(existingUser);

      return {
        user: existingUser,
        identity: existingIdentity,
        created: false
      };
    }

    const newUser = userRepo.create({
      displayName: this.getTelegramDisplayName(input),
      username: input.username?.toLowerCase(),
      roles: ['player'],
      status: 'active',
      lastLoginAt: now,
      productMetadata: {
        firstProvider: provider
      }
    });
    await userRepo.save(newUser);

    const newIdentity = authRepo.create({
      userId: newUser.id,
      provider,
      providerUserId,
      providerUsername: input.username?.toLowerCase(),
      profileSnapshot: this.toTelegramSnapshot(input),
      linkedAt: now,
      lastAuthAt: now
    });
    await authRepo.save(newIdentity);

    return {
      user: newUser,
      identity: newIdentity,
      created: true
    };
  }

  /**
   * Persist a Telegram user's shared phone number. Ensures the internal user +
   * identity exist first (the contact is usually shared on /start, BEFORE the
   * Mini App has ever opened, so the user row may not exist yet), then stores
   * the normalized `+2519XXXXXXXX` phone. Returns the normalized phone, or null
   * when the shared number is not a valid Ethiopian mobile number.
   */
  async setTelegramPhone(input: TelegramIdentityInput & { phoneNumber: string }): Promise<string | null> {
    const normalized = normalizeEthiopianPhone(input.phoneNumber);
    if (!normalized) return null;

    const { user } = await this.findOrCreateTelegramUser(input);
    await this.userRepository.update(user.id, { phoneNumber: normalized });
    return normalized;
  }

  async listUsers(page: number, limit: number, role?: string, search?: string) {
    const skip = (page - 1) * limit;
    const queryBuilder = this.userRepository.createQueryBuilder('user')
      .leftJoinAndSelect('user.wallets', 'wallet')
      .orderBy('user.createdAt', 'DESC')
      .skip(skip)
      .take(limit);

    if (role) {
      queryBuilder.andWhere('JSON_CONTAINS(user.roles, :role)', { role: `"${role}"` });
    }

    if (search) {
      queryBuilder.andWhere(
        '(user.displayName LIKE :search OR user.phoneNumber LIKE :search OR user.username LIKE :search)',
        { search: `%${search}%` }
      );
    }

    const [data, total] = await queryBuilder.getManyAndCount();

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
  }): Promise<User> {
    const normalizedPhone = normalizeEthiopianPhone(input.phoneNumber);
    if (!normalizedPhone) throw new BadRequestException('Enter a valid Ethiopian phone number (e.g. 09XXXXXXXX)');

    return this.dataSource.transaction(async (manager) => {
      const authRepo = manager.getRepository(AuthIdentity);
      const userRepo = manager.getRepository(User);

      const existing = await authRepo.findOneBy({ provider: 'password', providerUserId: normalizedPhone });
      if (existing) {
        throw new ConflictException('An agent with that phone number already exists');
      }

      const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });

      const user = userRepo.create({
        displayName: input.displayName.trim(),
        phoneNumber: normalizedPhone,
        roles: ['agent'],
        status: 'active',
        workStartHour: input.workStartHour,
        workStartMinute: input.workStartMinute,
        workEndHour: input.workEndHour,
        workEndMinute: input.workEndMinute,
        agentPermissions: input.agentPermissions ?? { deposit: true, withdraw: true },
      });
      await userRepo.save(user);

      const identity = authRepo.create({
        userId: user.id,
        provider: 'password',
        providerUserId: normalizedPhone,
        passwordHash,
        profileSnapshot: { phoneNumber: normalizedPhone },
        linkedAt: new Date(),
        lastAuthAt: new Date(),
      });
      await authRepo.save(identity);

      return user;
    });
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
  ): Promise<User> {
    const user = await this.userRepository.findOneBy({ id: agentId });
    if (!user || !user.roles.includes('agent')) {
      throw new NotFoundException('Agent not found');
    }

    if (update.displayName !== undefined) user.displayName = update.displayName.trim();
    if (update.status !== undefined) user.status = update.status as any;
    if (update.phoneNumber !== undefined) {
      const normalizedPhone = normalizeEthiopianPhone(update.phoneNumber);
      if (!normalizedPhone) throw new BadRequestException('Enter a valid Ethiopian phone number (e.g. 09XXXXXXXX)');
      user.phoneNumber = normalizedPhone;
      await this.authIdentityRepository.update(
        { userId: user.id, provider: 'password' },
        { providerUserId: normalizedPhone, profileSnapshot: { phoneNumber: normalizedPhone } }
      );
    }
    if (update.password !== undefined && update.password.trim() !== '') {
      const passwordHash = await argon2.hash(update.password, { type: argon2.argon2id });
      await this.authIdentityRepository.update(
        { userId: user.id, provider: 'password' },
        { passwordHash }
      );
    }
    user.workStartHour = update.workStartHour;
    user.workStartMinute = update.workStartMinute;
    user.workEndHour = update.workEndHour;
    user.workEndMinute = update.workEndMinute;
    if (update.agentPermissions !== undefined) user.agentPermissions = update.agentPermissions;

    await this.userRepository.save(user);
    return user;
  }

  async findBackofficeUserByCredentials(
    phoneNumber: string,
    password: string,
  ): Promise<User> {
    // Match on the canonical +251 form, but also accept the exact string the
    // agent was stored under (older rows may hold "09…" or "2519…").
    const rawTrimmed = phoneNumber.trim();
    const normalizedPhone = normalizeEthiopianPhone(rawTrimmed) ?? rawTrimmed;
    const candidates = [...new Set([normalizedPhone, rawTrimmed])];
    const identity = await this.authIdentityRepository.findOne({
      where: { provider: 'password', providerUserId: In(candidates) },
      select: ['id', 'userId', 'passwordHash', 'provider', 'providerUserId']
    });

    if (!identity || !identity.passwordHash) {
      throw new BadRequestException('Invalid phone number or password');
    }

    const valid = await argon2.verify(identity.passwordHash, password);
    if (!valid) {
      throw new BadRequestException('Invalid phone number or password');
    }

    const user = await this.userRepository.findOneBy({ id: identity.userId });
    if (!user || user.status !== 'active') {
      throw new BadRequestException('Account is inactive');
    }

    const hasBackofficeRole =
      Array.isArray(user.roles) &&
      (user.roles.includes('agent' as any) || user.roles.includes('admin' as any));
    if (!hasBackofficeRole) {
      throw new BadRequestException('Account does not have backoffice access');
    }

    identity.lastAuthAt = new Date();
    await this.authIdentityRepository.save(identity);

    return user;
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    if (!currentPassword || !newPassword || newPassword.length < 8) {
      throw new BadRequestException('Current password and a new password of at least 8 characters are required');
    }

    const identity = await this.authIdentityRepository.findOne({
      where: { userId, provider: 'password' },
      select: ['id', 'userId', 'passwordHash', 'provider', 'providerUserId']
    });

    if (!identity || !identity.passwordHash) {
      throw new BadRequestException('This account does not have a password login');
    }

    const valid = await argon2.verify(identity.passwordHash, currentPassword);
    if (!valid) {
      throw new BadRequestException('Current password is incorrect');
    }

    identity.passwordHash = await argon2.hash(newPassword, { type: argon2.argon2id });
    await this.authIdentityRepository.save(identity);

    await this.refreshSessionRepository.update(
      { userId, revokedAt: IsNull() },
      { revokedAt: new Date() }
    );
  }

  async listAgents(page: number, limit: number) {
    const skip = (page - 1) * limit;
    const [data, total] = await this.userRepository
      .createQueryBuilder('user')
      .where('JSON_CONTAINS(user.roles, :role)', { role: '"agent"' })
      .orderBy('user.createdAt', 'DESC')
      .skip(skip)
      .take(limit)
      .getManyAndCount();

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getProfile(userId: string): Promise<User> {
    return this.findById(userId);
  }

  async updateProfile(userId: string, update: { displayName?: string; phoneNumber?: string }): Promise<User> {
    const user = await this.userRepository.findOneBy({ id: userId });
    if (!user) throw new NotFoundException('User not found');
    if (update.displayName?.trim()) user.displayName = update.displayName.trim();
    if (update.phoneNumber?.trim()) {
      const normalizedPhone = normalizeEthiopianPhone(update.phoneNumber);
      if (!normalizedPhone) throw new BadRequestException('Enter a valid Ethiopian phone number (e.g. 09XXXXXXXX)');
      user.phoneNumber = normalizedPhone;
    }
    await this.userRepository.save(user);
    return user;
  }

  async updatePhoneByTelegramId(telegramUserId: string, phoneNumber: string): Promise<void> {
    const normalized = normalizeEthiopianPhone(phoneNumber);
    if (!normalized) return;
    const identity = await this.authIdentityRepository.findOneBy({ provider: 'telegram', providerUserId: telegramUserId });
    if (!identity) return;
    await this.userRepository.update(identity.userId, { phoneNumber: normalized });
  }

  async updateStatus(userId: string, status: 'active' | 'suspended' | 'closed') {
    const user = await this.userRepository.findOneBy({ id: userId });
    if (!user) throw new NotFoundException('User not found');

    user.status = status;
    await this.userRepository.save(user);

    if (status === 'suspended' || status === 'closed') {
      await this.refreshSessionRepository.update(
        { userId, revokedAt: IsNull() },
        { revokedAt: new Date() }
      );
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
