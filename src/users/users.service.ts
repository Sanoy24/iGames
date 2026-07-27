import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import { Repository, EntityManager, DataSource, IsNull, In } from 'typeorm';
import { User } from './entities/user.entity';
import { AuthIdentity } from './entities/auth-identity.entity';
import { RefreshSession } from '../auth/entities/refresh-session.entity';
import { normalizeEthiopianPhone } from '../common/phone.util';
import { AgentDutyMode, isAgentEffectivelyOnDuty, isWithinWorkingWindow } from '../common/agent-duty.util';

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

  /**
   * Resolve the internal user behind a Telegram account, or null if they have
   * never been linked. Lets bot handlers act on the internal user id without
   * creating an account as a side effect.
   */
  async findByTelegramUserId(telegramUserId: string): Promise<User | null> {
    const identity = await this.authIdentityRepository.findOneBy({
      provider: 'telegram',
      providerUserId: telegramUserId,
    });
    if (!identity) return null;
    return this.userRepository.findOneBy({ id: identity.userId });
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

  /**
   * Players whose locationId is in the given set — the "area visibility" an
   * agent needs (via their assigned locations, see LocationsService), not
   * scoped to any one agent's own referrals. Mirrors listUsers's query shape.
   */
  async listPlayersByLocationIds(
    locationIds: string[],
    opts: { search?: string; page?: number; limit?: number } = {},
  ) {
    const page = Math.max(opts.page ?? 1, 1);
    const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);

    if (locationIds.length === 0) {
      return { data: [] as User[], total: 0, page, limit, totalPages: 0 };
    }

    const queryBuilder = this.userRepository.createQueryBuilder('user')
      .leftJoinAndSelect('user.wallets', 'wallet')
      .where('user.locationId IN (:...locationIds)', { locationIds })
      .andWhere("JSON_CONTAINS(user.roles, '\"player\"')")
      .orderBy('user.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    if (opts.search) {
      queryBuilder.andWhere(
        '(user.displayName LIKE :search OR user.phoneNumber LIKE :search OR user.username LIKE :search)',
        { search: `%${opts.search}%` },
      );
    }

    const [data, total] = await queryBuilder.getManyAndCount();
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async createAgentUser(input: {
    phoneNumber: string;
    displayName: string;
    password: string;
    workStartHour?: number;
    workStartMinute?: number;
    workEndHour?: number;
    workEndMinute?: number;
    workDaysOfWeek?: number[];
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
        workDaysOfWeek: input.workDaysOfWeek ?? [],
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

  /**
   * Create a dedicated internal "system" account — NO login identity at all (no
   * password, no Telegram link, no phone). Used to anchor system-level ledger
   * balances that must not belong to any individual human account, e.g. the
   * Master Wallet (see AdminService.getOrCreateMasterWalletUserId). Never shows
   * up in the admin/agent/player lists, since those all filter by a specific
   * role and this account holds none of them.
   */
  async createSystemUser(displayName: string): Promise<User> {
    const user = this.userRepository.create({
      displayName,
      roles: ['system'],
      status: 'active',
    });
    return this.userRepository.save(user);
  }

  /**
   * Idempotent admin bootstrap: create an admin account with phone+password
   * login if one doesn't already exist for that phone. There is no self-service
   * admin sign-up endpoint, so this is how the very first admin(s) get into a
   * brand-new production database (see AdminBootstrapService, run once at boot).
   * Never touches an existing account — if the phone is already registered this
   * is a no-op, so a password the admin changes later is never undone by a restart.
   */
  async ensureAdminAccount(input: {
    phoneNumber: string;
    password: string;
    displayName: string;
  }): Promise<'created' | 'exists'> {
    const normalizedPhone = normalizeEthiopianPhone(input.phoneNumber);
    if (!normalizedPhone) throw new BadRequestException(`Invalid admin bootstrap phone number: ${input.phoneNumber}`);

    return this.dataSource.transaction(async (manager) => {
      const authRepo = manager.getRepository(AuthIdentity);
      const userRepo = manager.getRepository(User);

      const existing = await authRepo.findOneBy({ provider: 'password', providerUserId: normalizedPhone });
      if (existing) return 'exists';

      const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });

      const user = userRepo.create({
        displayName: input.displayName.trim(),
        phoneNumber: normalizedPhone,
        roles: ['admin'],
        status: 'active',
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

      return 'created';
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
      workDaysOfWeek?: number[];
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
    if (update.workDaysOfWeek !== undefined) user.workDaysOfWeek = update.workDaysOfWeek;
    if (update.agentPermissions !== undefined) user.agentPermissions = update.agentPermissions;

    await this.userRepository.save(user);
    return user;
  }

  /**
   * Admin sets an agent's on-duty mode (`auto` | `on` | `off`). Force-`on` is
   * single-primary: putting one agent force-on demotes any other force-on agent
   * back to `auto`, so at most one agent is ever manually pinned on.
   */
  async setAgentOnDutyMode(agentId: string, mode: AgentDutyMode): Promise<User> {
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(User);
      const user = await repo.findOneBy({ id: agentId });
      if (!user || !user.roles.includes('agent')) {
        throw new NotFoundException('Agent not found');
      }

      if (mode === 'on') {
        await repo
          .createQueryBuilder()
          .update(User)
          .set({ onDutyMode: 'auto' })
          .where('onDutyMode = :on', { on: 'on' })
          .andWhere('id != :id', { id: agentId })
          .execute();
      }

      user.onDutyMode = mode;
      await repo.save(user);
      return user;
    });
  }

  /**
   * The single agent effectively on duty right now, or null. Prefers a manually
   * pinned (`on`) agent, otherwise the earliest-starting agent whose Ethiopia-time
   * working window currently covers now. Only active accounts are considered.
   */
  async findOnDutyAgent(): Promise<User | null> {
    const agents = await this.userRepository
      .createQueryBuilder('user')
      .where('JSON_CONTAINS(user.roles, :role)', { role: '"agent"' })
      .andWhere('user.status = :status', { status: 'active' })
      .getMany();

    const now = new Date();
    const onDuty = agents.filter((a) => isAgentEffectivelyOnDuty(a, now));
    if (onDuty.length === 0) return null;

    const forced = onDuty.filter((a) => a.onDutyMode === 'on');
    if (forced.length > 0) {
      // Most recently pinned wins (single-primary should leave just one anyway).
      forced.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
      return forced[0];
    }

    // Scheduled: deterministic pick by earliest start time, then creation order.
    onDuty.sort((a, b) => {
      const sa = (a.workStartHour ?? 0) * 60 + (a.workStartMinute ?? 0);
      const sb = (b.workStartHour ?? 0) * 60 + (b.workStartMinute ?? 0);
      if (sa !== sb) return sa - sb;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });
    return onDuty[0];
  }

  /**
   * Every active agent currently on duty — used when a player may CHOOSE which
   * agent to deposit to (more than one on duty). Ordered so the same primary that
   * `findOnDutyAgent` picks comes first: force-pinned agents (most recent first),
   * then scheduled agents by earliest start.
   */
  async findOnDutyAgents(): Promise<User[]> {
    const agents = await this.userRepository
      .createQueryBuilder('user')
      .where('JSON_CONTAINS(user.roles, :role)', { role: '"agent"' })
      .andWhere('user.status = :status', { status: 'active' })
      .getMany();

    const now = new Date();
    const onDuty = agents.filter((a) => isAgentEffectivelyOnDuty(a, now));

    return onDuty.sort((a, b) => {
      const aForced = a.onDutyMode === 'on' ? 1 : 0;
      const bForced = b.onDutyMode === 'on' ? 1 : 0;
      if (aForced !== bForced) return bForced - aForced; // forced-on first
      if (aForced && bForced) return b.updatedAt.getTime() - a.updatedAt.getTime();
      const sa = (a.workStartHour ?? 0) * 60 + (a.workStartMinute ?? 0);
      const sb = (b.workStartHour ?? 0) * 60 + (b.workStartMinute ?? 0);
      if (sa !== sb) return sa - sb;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });
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

  /**
   * Look up an EXISTING agent by phone number — used by the agent bot's
   * contact-share handler to match a Telegram user to an already-admin-created
   * agent account. Never creates a user (unlike findOrCreateTelegramUser,
   * which is for players). Returns null if no password-login identity with
   * this phone belongs to an agent — the caller decides what to tell the bot
   * user (no match vs suspended vs success), so this does NOT gate on status.
   */
  async findAgentByPhone(phoneNumber: string): Promise<User | null> {
    const normalizedPhone = normalizeEthiopianPhone(phoneNumber);
    if (!normalizedPhone) return null;

    const identity = await this.authIdentityRepository.findOneBy({
      provider: 'password',
      providerUserId: normalizedPhone,
    });
    if (!identity) return null;

    const user = await this.userRepository.findOneBy({ id: identity.userId });
    if (!user || !Array.isArray(user.roles) || !user.roles.includes('agent' as any)) return null;
    return user;
  }

  /**
   * Link a Telegram identity to an EXISTING user (the agent bot's use case —
   * the user already exists, created by an admin; this just adds a
   * provider:'telegram' AuthIdentity pointing at it, so later Mini App opens
   * resolve back to the same account). Rejects if this Telegram id is already
   * linked to a DIFFERENT user — never silently re-points an identity.
   */
  async linkTelegramIdentityToUser(userId: string, input: TelegramIdentityInput): Promise<AuthIdentity> {
    const now = new Date();
    const existing = await this.authIdentityRepository.findOneBy({
      provider: 'telegram',
      providerUserId: input.telegramUserId,
    });

    if (existing) {
      if (existing.userId !== userId) {
        throw new ConflictException('This Telegram account is already linked to a different account');
      }
      existing.providerUsername = input.username?.toLowerCase();
      existing.profileSnapshot = this.toTelegramSnapshot(input);
      existing.lastAuthAt = now;
      return this.authIdentityRepository.save(existing);
    }

    const identity = this.authIdentityRepository.create({
      userId,
      provider: 'telegram',
      providerUserId: input.telegramUserId,
      providerUsername: input.username?.toLowerCase(),
      profileSnapshot: this.toTelegramSnapshot(input),
      linkedAt: now,
      lastAuthAt: now,
    });
    return this.authIdentityRepository.save(identity);
  }

  /**
   * Resolve the phone number of the agent linked to this Telegram id — used by
   * the agent Mini App to pre-fill/lock the phone field before the agent types
   * their password (POST /auth/credentials, unchanged). Null if not linked yet
   * (frontend tells them to share their phone with the agent bot first).
   */
  async findAgentPhoneByTelegramId(telegramUserId: string): Promise<{ phoneNumber: string; displayName: string } | null> {
    const identity = await this.authIdentityRepository.findOneBy({
      provider: 'telegram',
      providerUserId: telegramUserId,
    });
    if (!identity) return null;

    const user = await this.userRepository.findOneBy({ id: identity.userId });
    if (!user || !user.phoneNumber || !Array.isArray(user.roles) || !user.roles.includes('agent' as any)) return null;
    return { phoneNumber: user.phoneNumber, displayName: user.displayName };
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

    // Annotate each agent with their live Ethiopia-time duty state so the admin UI
    // can show who is actually covering deposits without re-deriving the timezone.
    const now = new Date();
    const annotated = data.map((u) => ({
      ...u,
      effectiveOnDuty: isAgentEffectivelyOnDuty(u, now),
      withinWorkingWindow: isWithinWorkingWindow(u, now),
    }));

    return { data: annotated, total, page, limit, totalPages: Math.ceil(total / limit) };
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
