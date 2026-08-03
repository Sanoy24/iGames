import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import { Repository, EntityManager, DataSource, IsNull, In, Like } from 'typeorm';
import { User } from './entities/user.entity';
import { AuthIdentity } from './entities/auth-identity.entity';
import { RefreshSession } from '../auth/entities/refresh-session.entity';
import { normalizeEthiopianPhone } from '../common/phone.util';
import { generateReferralCode, normalizeReferralCode } from '../common/referral-code.util';
import { AgentDutyMode, isAgentEffectivelyOnDuty, isWithinWorkingWindow } from '../common/agent-duty.util';
import { findNearestLocation, GeoCandidate } from '../locations/location-geo';

/** Default max distance for GPS-based player→agent matching, in metres.
 * Mirrors Location.radiusMeters's own default. Not yet admin-configurable —
 * a natural follow-up if 5km proves wrong in practice. */
const AGENT_MATCH_RADIUS_METERS = 5000;

export type AssignedAgentResult = {
  assignedAgentId: string | null;
  assignedAgentName: string | null;
  assignedAgentSource: 'gps_match' | 'manual_pick' | 'other';
};

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
      const existingUser = await userRepo.findOneBy({ id: existingIdentity.userId });
      if (!existingUser) {
        throw new NotFoundException('User not found');
      }

      if (!this.isPlayerUser(existingUser)) {
        await this.moveTelegramIdentityToRoleScope(
          existingIdentity,
          existingUser,
          providerUserId,
          authRepo,
        );
      } else {
        existingIdentity.providerUsername = input.username?.toLowerCase();
        existingIdentity.profileSnapshot = this.toTelegramSnapshot(input);
        existingIdentity.lastAuthAt = now;
        await authRepo.save(existingIdentity);

        existingUser.lastLoginAt = now;
        await userRepo.save(existingUser);

        return {
          user: existingUser,
          identity: existingIdentity,
          created: false
        };
      }
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

  private isPlayerUser(user: User): boolean {
    return Array.isArray(user.roles) && user.roles.includes('player' as any);
  }

  private getPrimaryScopedRole(user: User): string {
    if (Array.isArray(user.roles)) {
      const role = user.roles.find((r) => r !== 'player');
      if (role) return role;
    }
    return 'user';
  }

  private async moveTelegramIdentityToRoleScope(
    identity: AuthIdentity,
    user: User,
    telegramUserId: string,
    authRepo: Repository<AuthIdentity>,
  ): Promise<void> {
    const scopedProviderUserId = this.buildTelegramProviderUserId(
      telegramUserId,
      this.getPrimaryScopedRole(user),
    );

    if (identity.providerUserId === scopedProviderUserId) return;

    const existingScoped = await authRepo.findOneBy({
      provider: 'telegram',
      providerUserId: scopedProviderUserId,
    });
    if (existingScoped) {
      if (existingScoped.userId === identity.userId) {
        await authRepo.remove(identity);
      }
      return;
    }

    identity.providerUserId = scopedProviderUserId;
    await authRepo.save(identity);
  }

  /**
   * All LIVE identities for a given provider + base id (a phone number for
   * provider:'password', a Telegram user id for provider:'telegram'). One
   * base id can now back more than one account as long as each is a
   * DIFFERENT role (e.g. one admin + one agent sharing a phone; or one
   * player + one agent sharing the same Telegram account) — see
   * createAgentUser/ensureAdminAccount/linkTelegramIdentityToUser. Password
   * identities keep the first account on the plain id; Telegram keeps the plain
   * id for the player Mini App and stores non-player links as `${baseId}#${role}`
   * so the game bot never resolves to an agent/admin account. The base id itself
   * stays the one thing that identifies the person; lookup helpers match every
   * form for that base id and disambiguate by password/role respectively.
   *
   * Self-healing: if an identity's userId points at a User row that no longer
   * exists (e.g. someone deleted the user directly in the database, bypassing
   * the app — there is no real FK constraint enforcing cascade, since schema
   * is managed by ensure-schema.ts, not TypeORM sync), that stale identity is
   * deleted here on the spot instead of permanently blocking the base id.
   */
  private async findLiveIdentities(
    provider: 'password' | 'telegram',
    baseId: string,
    manager?: EntityManager,
  ): Promise<Array<{ identity: AuthIdentity; user: User }>> {
    const authRepo = manager ? manager.getRepository(AuthIdentity) : this.authIdentityRepository;
    const userRepo = manager ? manager.getRepository(User) : this.userRepository;

    const candidates = await authRepo.find({
      where: [
        { provider, providerUserId: baseId },
        { provider, providerUserId: Like(`${baseId}#%`) },
      ],
      select: ['id', 'userId', 'passwordHash', 'provider', 'providerUserId'],
    });
    if (candidates.length === 0) return [];

    const users = await userRepo.findBy({ id: In(candidates.map((c) => c.userId)) });
    const userById = new Map(users.map((u) => [u.id, u]));

    const live: Array<{ identity: AuthIdentity; user: User }> = [];
    const orphaned: AuthIdentity[] = [];
    for (const identity of candidates) {
      const user = userById.get(identity.userId);
      if (user) live.push({ identity, user });
      else orphaned.push(identity);
    }

    if (orphaned.length > 0) {
      await authRepo.remove(orphaned).catch(() => undefined);
    }

    return live;
  }

  private async findLivePasswordIdentities(
    phone: string,
    manager?: EntityManager,
  ): Promise<Array<{ identity: AuthIdentity; user: User }>> {
    return this.findLiveIdentities('password', phone, manager);
  }

  private async findLiveTelegramIdentities(
    telegramUserId: string,
    manager?: EntityManager,
  ): Promise<Array<{ identity: AuthIdentity; user: User }>> {
    return this.findLiveIdentities('telegram', telegramUserId, manager);
  }

  /** The providerUserId to store for a NEW identity on this base id — see findLiveIdentities. */
  private buildScopedProviderUserId(
    baseId: string,
    role: string,
    existingForBaseId: Array<{ identity: AuthIdentity; user: User }>,
  ): string {
    return existingForBaseId.length === 0 ? baseId : `${baseId}#${role}`;
  }

  /**
   * Telegram's player Mini App auth intentionally looks up the plain Telegram
   * user id. Agent/admin Telegram links must therefore be role-scoped even when
   * they are the first link for that Telegram account, otherwise the player bot
   * can log into the agent account and render the Agent tab on the game domain.
   */
  private buildTelegramProviderUserId(baseId: string, role: string): string {
    return role === 'player' ? baseId : `${baseId}#${role}`;
  }

  /**
   * Persist a Telegram user's shared phone number. Ensures the internal user +
   * identity exist first (the contact is usually shared on /start, BEFORE the
   * Mini App has ever opened, so the user row may not exist yet), then stores
   * the normalized `+2519XXXXXXXX` phone. Returns the normalized phone, or null
   * when the shared number is not a valid Ethiopian mobile number.
   */
  async setTelegramPhone(
    input: TelegramIdentityInput & { phoneNumber: string },
  ): Promise<{ phoneNumber: string; userId: string } | null> {
    const normalized = normalizeEthiopianPhone(input.phoneNumber);
    if (!normalized) return null;

    const { user } = await this.findOrCreateTelegramUser(input);
    await this.userRepository.update(user.id, { phoneNumber: normalized });
    return { phoneNumber: normalized, userId: user.id };
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

  async listUsers(
    page: number,
    limit: number,
    role?: string,
    search?: string,
    filters: {
      isBot?: boolean;
      status?: 'active' | 'suspended' | 'closed';
      /** Pre-resolved by the caller (online state is in-memory via the socket
       * gateway, not a DB column) — undefined means "don't filter on this". */
      onlineUserIds?: string[];
      online?: boolean;
      hasPhone?: boolean;
      minBalanceMinor?: number;
      maxBalanceMinor?: number;
    } = {},
  ) {
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

    // Every bot account has productMetadata.botPolicy set (see BotsService);
    // real accounts never do. Same JSON_EXTRACT check used there.
    if (filters.isBot === true) {
      queryBuilder.andWhere("JSON_EXTRACT(user.productMetadata, '$.botPolicy') IS NOT NULL");
    } else if (filters.isBot === false) {
      queryBuilder.andWhere("JSON_EXTRACT(user.productMetadata, '$.botPolicy') IS NULL");
    }

    if (filters.status) {
      queryBuilder.andWhere('user.status = :status', { status: filters.status });
    }

    if (filters.hasPhone === true) {
      queryBuilder.andWhere('user.phoneNumber IS NOT NULL');
    } else if (filters.hasPhone === false) {
      queryBuilder.andWhere('user.phoneNumber IS NULL');
    }

    if (filters.minBalanceMinor !== undefined) {
      queryBuilder.andWhere('wallet.availableMinor >= :minBalance', { minBalance: filters.minBalanceMinor });
    }
    if (filters.maxBalanceMinor !== undefined) {
      queryBuilder.andWhere('wallet.availableMinor <= :maxBalance', { maxBalance: filters.maxBalanceMinor });
    }

    // Online/offline is resolved by the controller from the live socket gateway
    // (not a DB column) and passed down as a concrete id list, so pagination and
    // totals stay correct at the DB level instead of filtering after the fact.
    if (filters.online === true) {
      const ids = filters.onlineUserIds ?? [];
      if (ids.length === 0) return { data: [], total: 0, page, limit, totalPages: 0 };
      queryBuilder.andWhere('user.id IN (:...onlineIds)', { onlineIds: ids });
    } else if (filters.online === false && filters.onlineUserIds && filters.onlineUserIds.length > 0) {
      queryBuilder.andWhere('user.id NOT IN (:...onlineIds)', { onlineIds: filters.onlineUserIds });
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

      const existingForPhone = await this.findLivePasswordIdentities(normalizedPhone, manager);
      if (existingForPhone.some(({ user }) => Array.isArray(user.roles) && user.roles.includes('agent' as any))) {
        throw new ConflictException('An agent with that phone number already exists');
      }
      const providerUserId = this.buildScopedProviderUserId(normalizedPhone, 'agent', existingForPhone);

      const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });

      const user = userRepo.create({
        displayName: input.displayName.trim(),
        phoneNumber: normalizedPhone,
        roles: ['agent'],
        status: 'active',
        referralCode: await this.allocateReferralCode(manager),
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
        providerUserId,
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

      const existingForPhone = await this.findLivePasswordIdentities(normalizedPhone, manager);
      if (existingForPhone.some(({ user }) => Array.isArray(user.roles) && user.roles.includes('admin' as any))) {
        return 'exists';
      }
      const providerUserId = this.buildScopedProviderUserId(normalizedPhone, 'admin', existingForPhone);

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
        providerUserId,
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
      referralCommissionPct?: number | null;
      bingoRoomLabel?: string | null;
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
    if (update.referralCommissionPct !== undefined) user.referralCommissionPct = update.referralCommissionPct;
    if (update.bingoRoomLabel !== undefined) user.bingoRoomLabel = update.bingoRoomLabel?.trim() || null;

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

  // ── Direct player→agent GPS matching ────────────────────────────────
  // Replaces the old Location-catalog onboarding step: a player is matched to
  // the nearest currently on-duty agent by proximity to that agent's own
  // shared pin, with no admin-curated area catalog involved.

  /** Player-facing fallback list — on-duty agents by name only. */
  async listOnDutyAgentsForMatching(): Promise<Array<{ id: string; name: string }>> {
    const agents = await this.findOnDutyAgents();
    return agents.map((a) => ({ id: a.id, name: a.displayName }));
  }

  /**
   * Pure/read-only: map a shared GPS pin onto the nearest on-duty agent's own
   * last-shared pin, within AGENT_MATCH_RADIUS_METERS. Does NOT persist —
   * callers follow up with setAssignedAgent. Returns null when no on-duty
   * agent has a pin in range (including agents who never shared one).
   */
  async matchAgentFromCoords(
    latitude: number,
    longitude: number,
  ): Promise<{ id: string; name: string; distanceMeters: number } | null> {
    const onDuty = await this.findOnDutyAgents();
    const candidates: GeoCandidate[] = onDuty.map((a) => ({
      id: a.id,
      name: a.displayName,
      latitude: a.sharedLatitude ?? null,
      longitude: a.sharedLongitude ?? null,
      radiusMeters: AGENT_MATCH_RADIUS_METERS,
    }));
    return findNearestLocation(candidates, latitude, longitude);
  }

  /**
   * Record the player's agent assignment. Exactly one of {agentId, other}.
   * `other` always forces source 'other' regardless of the `source` arg —
   * mirrors LocationsService.setUserLocation's wantsOther branch. A supplied
   * agentId must currently be on duty, so a stale/spoofed client can't pin a
   * player to an unavailable or nonexistent agent. Reassignable — a player who
   * re-shares location gets rematched to whichever on-duty agent is nearest
   * now (unlike `referredByAgentId`, which is set once and never moves).
   */
  async setAssignedAgent(
    userId: string,
    dto: { agentId?: string; other?: boolean },
    source: 'gps_match' | 'manual_pick' = 'manual_pick',
  ): Promise<AssignedAgentResult> {
    const wantsOther = dto.other === true;

    if (wantsOther && dto.agentId) {
      throw new BadRequestException('Send either agentId or other, not both');
    }
    if (!wantsOther && !dto.agentId) {
      throw new BadRequestException('Send an agentId, or other: true to skip attribution');
    }

    const user = await this.findById(userId);

    if (wantsOther) {
      user.assignedAgentId = null;
      user.assignedAgentSource = 'other';
      user.assignedAgentAt = new Date();
      await this.userRepository.save(user);
      return { assignedAgentId: null, assignedAgentName: null, assignedAgentSource: 'other' };
    }

    const onDuty = await this.findOnDutyAgents();
    const agent = onDuty.find((a) => a.id === dto.agentId);
    if (!agent) throw new NotFoundException('That agent is not currently available');

    user.assignedAgentId = agent.id;
    user.assignedAgentSource = source;
    user.assignedAgentAt = new Date();
    await this.userRepository.save(user);

    return { assignedAgentId: agent.id, assignedAgentName: agent.displayName, assignedAgentSource: source };
  }

  /** The player's current agent assignment, or null when never asked. */
  async getAssignedAgent(userId: string): Promise<AssignedAgentResult | null> {
    const user = await this.findById(userId);
    if (!user.assignedAgentSource) return null;

    let assignedAgentName: string | null = null;
    if (user.assignedAgentId) {
      const agent = await this.userRepository.findOneBy({ id: user.assignedAgentId });
      assignedAgentName = agent?.displayName ?? null;
    }

    return {
      assignedAgentId: user.assignedAgentId ?? null,
      assignedAgentName,
      assignedAgentSource: user.assignedAgentSource,
    };
  }

  /**
   * Players directly assigned to this agent — the replacement for
   * listPlayersByLocationIds under direct agent-attribution. Same shape.
   */
  async listPlayersByAssignedAgentId(
    agentId: string,
    opts: { search?: string; page?: number; limit?: number } = {},
  ) {
    const page = Math.max(opts.page ?? 1, 1);
    const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);

    const queryBuilder = this.userRepository.createQueryBuilder('user')
      .leftJoinAndSelect('user.wallets', 'wallet')
      .where('user.assignedAgentId = :agentId', { agentId })
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

  // ── Agent referral codes ───────────────────────────────────────────
  // Attribution only: a code sets the player's `referredByAgentId`, which drives
  // "customers brought" stats and lobby highlighting. It deliberately does NOT
  // introduce a payout path — agent commission stays per-deposit and per-room.

  /**
   * A referral code not already taken. Retries on collision rather than trusting
   * randomness: the unique index on `users.referralCode` is the real guarantee,
   * and 30^6 keeps collisions vanishingly rare, so a handful of tries is plenty.
   */
  private async allocateReferralCode(manager?: EntityManager): Promise<string> {
    const userRepo = manager ? manager.getRepository(User) : this.userRepository;

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const code = generateReferralCode();
      const taken = await userRepo.findOne({ where: { referralCode: code }, select: ['id'] });
      if (!taken) return code;
    }
    throw new ConflictException('Could not allocate a referral code — please try again');
  }

  /**
   * The agent's referral code, generating one on first access. Lazy generation is
   * what backfills agents created BEFORE referral codes existed, so no one-off
   * migration script is needed.
   */
  async ensureAgentReferralCode(agentId: string): Promise<string> {
    const user = await this.userRepository.findOneBy({ id: agentId });
    if (!user || !Array.isArray(user.roles) || !user.roles.includes('agent' as any)) {
      throw new NotFoundException('Agent not found');
    }
    if (user.referralCode) return user.referralCode;

    const code = await this.allocateReferralCode();
    // Guarded update: if a concurrent request allocated one first, keep theirs
    // instead of overwriting a code that may already be in circulation.
    await this.userRepository
      .createQueryBuilder()
      .update(User)
      .set({ referralCode: code })
      .where('id = :agentId AND referralCode IS NULL', { agentId })
      .execute();

    const refreshed = await this.userRepository.findOneBy({ id: agentId });
    return refreshed?.referralCode ?? code;
  }

  /** How many players this agent has been credited with bringing in. */
  async countReferredPlayers(agentId: string): Promise<number> {
    return this.userRepository.count({ where: { referredByAgentId: agentId } });
  }

  /**
   * Referred players who placed at least one Bingo or Keno ticket since
   * `sinceDate` — the agent dashboard's "Active Players" metric.
   */
  async countActiveReferredPlayers(agentId: string, sinceDate: Date): Promise<number> {
    const [row] = await this.userRepository.query(
      `SELECT COUNT(DISTINCT u.id) c FROM users u
        WHERE u.referredByAgentId = ?
          AND (EXISTS (SELECT 1 FROM bingo_tickets bt WHERE bt.userId = u.id AND bt.createdAt >= ?)
            OR EXISTS (SELECT 1 FROM keno_tickets kt WHERE kt.userId = u.id AND kt.createdAt >= ?))`,
      [agentId, sinceDate, sinceDate],
    );
    return Number(row?.c ?? 0);
  }

  /**
   * Attribute a player to the agent owning `code`. Returns the agent's display
   * name on success, or null when the code is unknown, the agent is not an
   * active agent, the player is the agent themselves, or the player is ALREADY
   * attributed — the `IS NULL` guard means first attribution wins and is never
   * reassigned, matching the deposit-linking path in PaymentsService.
   */
  async attributeReferral(userId: string, rawCode: string): Promise<string | null> {
    const code = normalizeReferralCode(rawCode);
    if (!code) return null;

    const agent = await this.userRepository.findOneBy({ referralCode: code });
    if (!agent || agent.status !== 'active') return null;
    if (!Array.isArray(agent.roles) || !agent.roles.includes('agent' as any)) return null;
    if (agent.id === userId) return null; // an agent can't refer themselves

    const result = await this.userRepository
      .createQueryBuilder()
      .update(User)
      .set({ referredByAgentId: agent.id })
      .where('id = :userId AND referredByAgentId IS NULL', { userId })
      .execute();

    return (result.affected ?? 0) > 0 ? agent.displayName : null;
  }

  /**
   * Record an agent's shared GPS pin. INFORMATIONAL ONLY — this never touches
   * `agent_locations`, so it cannot change which players the agent is allowed to
   * see (that stays admin-managed). See the column docs on `User.sharedLatitude`.
   */
  async setAgentSharedLocation(
    agentId: string,
    latitude: number,
    longitude: number,
  ): Promise<void> {
    await this.userRepository.update(agentId, {
      sharedLatitude: latitude,
      sharedLongitude: longitude,
      sharedLocationAt: new Date(),
    });
  }

  /** Whether this agent has completed the mandatory location-share step. */
  async hasSharedLocation(agentId: string): Promise<boolean> {
    const agent = await this.userRepository.findOne({
      where: { id: agentId },
      select: ['id', 'sharedLatitude', 'sharedLongitude'],
    });
    return !!agent && agent.sharedLatitude != null && agent.sharedLongitude != null;
  }

  async findBackofficeUserByCredentials(
    phoneNumber: string,
    password: string,
  ): Promise<User> {
    // Match on the canonical +251 form, but also accept the exact string the
    // agent was stored under (older rows may hold "09…" or "2519…").
    const rawTrimmed = phoneNumber.trim();
    const normalizedPhone = normalizeEthiopianPhone(rawTrimmed) ?? rawTrimmed;
    const candidatePhones = [...new Set([normalizedPhone, rawTrimmed])];

    // A phone can now back more than one account (e.g. one admin + one agent,
    // see findLivePasswordIdentities) — try the password against every live
    // identity for this phone and log into whichever one it matches.
    const candidateLists = await Promise.all(
      candidatePhones.map((phone) => this.findLivePasswordIdentities(phone)),
    );
    const seen = new Set<string>();
    const identities: Array<{ identity: AuthIdentity; user: User }> = [];
    for (const list of candidateLists) {
      for (const entry of list) {
        if (seen.has(entry.identity.id)) continue;
        seen.add(entry.identity.id);
        identities.push(entry);
      }
    }

    let matched: { identity: AuthIdentity; user: User } | undefined;
    for (const entry of identities) {
      if (!entry.identity.passwordHash) continue;
      if (await argon2.verify(entry.identity.passwordHash, password)) {
        matched = entry;
        break;
      }
    }
    if (!matched) {
      throw new BadRequestException('Invalid phone number or password');
    }

    const { identity, user } = matched;
    if (user.status !== 'active') {
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
   * A phone may also back a non-agent (e.g. admin) account at the same time —
   * findLivePasswordIdentities returns all of them, and we pick the agent one.
   */
  async findAgentByPhone(phoneNumber: string): Promise<User | null> {
    const normalizedPhone = normalizeEthiopianPhone(phoneNumber);
    if (!normalizedPhone) return null;

    const identities = await this.findLivePasswordIdentities(normalizedPhone);
    const match = identities.find(
      ({ user }) => Array.isArray(user.roles) && user.roles.includes('agent' as any),
    );
    return match?.user ?? null;
  }

  /**
   * Link a Telegram identity to an EXISTING user (the agent bot's use case —
   * the user already exists, created by an admin; this just adds a
   * provider:'telegram' AuthIdentity pointing at it, so later Mini App opens
   * resolve back to the same account). `role` is the role this link is FOR
   * (e.g. 'agent') — the same Telegram account may already be linked to a
   * DIFFERENT-role account (most commonly a player account, auto-created by
   * the main bot's findOrCreateTelegramUser the first time this person ever
   * opened the player Mini App); that coexists fine via a role-suffixed
   * identity (`${telegramUserId}#${role}`, see findLiveIdentities) rather than
   * being treated as a conflict. Only rejects if this Telegram id is already
   * linked to a DIFFERENT user of the SAME role — that would be a genuine,
   * unexpected double-link, never silently re-pointed.
   */
  async linkTelegramIdentityToUser(userId: string, input: TelegramIdentityInput, role: string): Promise<AuthIdentity> {
    const now = new Date();
    const existingForTelegramId = await this.findLiveTelegramIdentities(input.telegramUserId);
    const providerUserId = this.buildTelegramProviderUserId(input.telegramUserId, role);

    const own = existingForTelegramId.find(({ user, identity }) =>
      user.id === userId &&
      (
        identity.providerUserId === providerUserId ||
        (Array.isArray(user.roles) && user.roles.includes(role as any))
      ),
    );
    if (own) {
      const identity = own.identity;
      identity.providerUserId = providerUserId;
      identity.providerUsername = input.username?.toLowerCase();
      identity.profileSnapshot = this.toTelegramSnapshot(input);
      identity.lastAuthAt = now;
      return this.authIdentityRepository.save(identity);
    }

    const sameRoleConflict = existingForTelegramId.find(
      ({ user }) => Array.isArray(user.roles) && user.roles.includes(role as any),
    );
    if (sameRoleConflict) {
      throw new ConflictException('This Telegram account is already linked to a different account');
    }

    const identity = this.authIdentityRepository.create({
      userId,
      provider: 'telegram',
      providerUserId,
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
   * (frontend tells them to share their phone with the agent bot first). Uses
   * findLiveTelegramIdentities so this still resolves correctly when the same
   * Telegram account also has an unrelated, different-role identity (e.g. a
   * player account) sharing the same Telegram user id.
   */
  async findAgentPhoneByTelegramId(telegramUserId: string): Promise<{ phoneNumber: string; displayName: string } | null> {
    const identities = await this.findLiveTelegramIdentities(telegramUserId);
    const match = identities.find(
      ({ user }) => Array.isArray(user.roles) && user.roles.includes('agent' as any),
    );
    if (!match || !match.user.phoneNumber) return null;
    return { phoneNumber: match.user.phoneNumber, displayName: match.user.displayName };
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

      // Self-service edit, unlike agent/admin creation (which deliberately allows one
      // phone to back accounts of DIFFERENT roles, see findLiveIdentities): this endpoint
      // has no @Roles guard, so without this check any account could silently claim a
      // phone number an active PLAYER already uses — no verification of any kind that
      // they actually own it. Scoped to 'player' so it never collides with that
      // intentional agent/admin phone-sharing design.
      if (normalizedPhone !== user.phoneNumber) {
        const conflict = await this.userRepository
          .createQueryBuilder('u')
          .where('u.phoneNumber = :phone', { phone: normalizedPhone })
          .andWhere('u.id != :userId', { userId })
          .andWhere('u.status = :status', { status: 'active' })
          .andWhere(`JSON_CONTAINS(u.roles, '"player"')`)
          .getOne();
        if (conflict) {
          throw new ConflictException('This phone number is already registered to a different account');
        }
      }
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
