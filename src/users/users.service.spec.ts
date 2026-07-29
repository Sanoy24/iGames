import { ConflictException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UsersService } from './users.service';
import { AuthIdentity } from './entities/auth-identity.entity';
import { User } from './entities/user.entity';

// A FindOperator (e.g. Like(...), In(...)) carries its comparator in `_type`
// and its comparand in `_value` — matching TypeORM's own internal shape
// closely enough for these repository mocks to interpret it.
function matchesValue(actual: unknown, expected: unknown): boolean {
  if (expected && typeof expected === 'object' && '_type' in (expected as any)) {
    const op = expected as { _type: string; _value: unknown };
    if (op._type === 'like') {
      const pattern = String(op._value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*');
      return new RegExp(`^${pattern}$`).test(String(actual));
    }
    if (op._type === 'in') {
      return (op._value as unknown[]).includes(actual);
    }
    return false;
  }
  return actual === expected;
}

function matchesWhere(entity: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([k, v]) => matchesValue(entity[k], v));
}

// Covers only the new agent-bot phone-linking methods added for the agent
// area feature — UsersService's older, transaction-heavy methods (e.g.
// createAgentUser, findOrCreateTelegramUser) are exercised at the integration
// level elsewhere, not here.
describe('UsersService — agent Telegram phone linking', () => {
  function makeService(input: {
    authIdentities?: Partial<AuthIdentity>[];
    users?: Partial<User>[];
  }) {
    const authIdentities = input.authIdentities ?? [];
    const users = input.users ?? [];

    const authIdentityRepository = {
      findOneBy: jest.fn().mockImplementation((where: Record<string, unknown>) => {
        const found = authIdentities.find((a) => matchesWhere(a as any, where));
        return Promise.resolve(found ?? null);
      }),
      findOne: jest.fn().mockImplementation(({ where }: { where: Record<string, unknown> }) => {
        const found = authIdentities.find((a) => matchesWhere(a as any, where));
        return Promise.resolve(found ?? null);
      }),
      find: jest.fn().mockImplementation(({ where }: { where: Record<string, unknown> | Record<string, unknown>[] }) => {
        const clauses = Array.isArray(where) ? where : [where];
        const found = authIdentities.filter((a) => clauses.some((clause) => matchesWhere(a as any, clause)));
        return Promise.resolve(found);
      }),
      create: jest.fn().mockImplementation((dto) => dto),
      save: jest.fn().mockImplementation((entity) => Promise.resolve({ id: entity.id ?? 'identity-new', ...entity })),
      remove: jest.fn().mockImplementation((entities) => Promise.resolve(entities)),
    };

    const userRepository = {
      findOneBy: jest.fn().mockImplementation((where: Record<string, unknown>) => {
        const found = users.find((u) => matchesWhere(u as any, where));
        return Promise.resolve(found ?? null);
      }),
      findBy: jest.fn().mockImplementation((where: Record<string, unknown>) => {
        const found = users.filter((u) => matchesWhere(u as any, where));
        return Promise.resolve(found);
      }),
      create: jest.fn().mockImplementation((dto) => ({ id: dto.id ?? 'user-new', ...dto })),
      save: jest.fn().mockImplementation((entity) => Promise.resolve({ id: entity.id ?? 'user-new', ...entity })),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    const service = new UsersService(
      {} as DataSource,
      userRepository as any,
      authIdentityRepository as any,
      {} as any, // refreshSessionRepository
    );

    return { service, authIdentityRepository, userRepository };
  }

  describe('findAgentByPhone', () => {
    it('returns the matching agent user', async () => {
      const { service } = makeService({
        authIdentities: [{ provider: 'password', providerUserId: '+251912345678', userId: 'agent-1' }],
        users: [{ id: 'agent-1', roles: ['agent'] as any, displayName: 'Agent One' }],
      });

      const result = await service.findAgentByPhone('0912345678');
      expect(result?.id).toBe('agent-1');
    });

    it('returns null when no password identity matches the phone', async () => {
      const { service } = makeService({ authIdentities: [], users: [] });
      expect(await service.findAgentByPhone('0912345678')).toBeNull();
    });

    it('returns null when the matched user is not an agent (e.g. a player sharing the same phone)', async () => {
      const { service } = makeService({
        authIdentities: [{ provider: 'password', providerUserId: '+251912345678', userId: 'user-1' }],
        users: [{ id: 'user-1', roles: ['player'] as any, displayName: 'Some Player' }],
      });
      expect(await service.findAgentByPhone('0912345678')).toBeNull();
    });

    it('returns null for an invalid phone number', async () => {
      const { service } = makeService({});
      expect(await service.findAgentByPhone('not-a-phone')).toBeNull();
    });

    it('finds the agent identity when the same phone also backs an admin account (role-suffixed identity)', async () => {
      const { service } = makeService({
        authIdentities: [
          { id: 'id-admin', provider: 'password', providerUserId: '+251912345678', userId: 'admin-1' },
          { id: 'id-agent', provider: 'password', providerUserId: '+251912345678#agent', userId: 'agent-1' },
        ],
        users: [
          { id: 'admin-1', roles: ['admin'] as any, displayName: 'Admin One' },
          { id: 'agent-1', roles: ['agent'] as any, displayName: 'Agent One' },
        ],
      });

      const result = await service.findAgentByPhone('0912345678');
      expect(result?.id).toBe('agent-1');
    });

    it('self-heals an orphaned identity (userId pointing at a deleted user) instead of blocking the phone', async () => {
      const { service, authIdentityRepository } = makeService({
        authIdentities: [{ id: 'id-orphan', provider: 'password', providerUserId: '+251912345678', userId: 'deleted-user' }],
        users: [],
      });

      expect(await service.findAgentByPhone('0912345678')).toBeNull();
      expect(authIdentityRepository.remove).toHaveBeenCalledWith([
        expect.objectContaining({ id: 'id-orphan' }),
      ]);
    });
  });

  describe('findOrCreateTelegramUser', () => {
    it('moves a raw non-player telegram identity aside and creates the player identity', async () => {
      const { service, authIdentityRepository, userRepository } = makeService({
        authIdentities: [{ id: 'id-agent', provider: 'telegram', providerUserId: '999', userId: 'agent-1' }],
        users: [{ id: 'agent-1', roles: ['agent'] as any, displayName: 'Agent One' }],
      });

      const result = await service.findOrCreateTelegramUser({ telegramUserId: '999', username: 'player_tg' });

      expect(authIdentityRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'id-agent', providerUserId: '999#agent' }),
      );
      expect(userRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ roles: ['player'], username: 'player_tg' }),
      );
      expect(authIdentityRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-new', provider: 'telegram', providerUserId: '999' }),
      );
      expect(result.user.roles).toEqual(['player']);
      expect(result.created).toBe(true);
    });
  });

  describe('linkTelegramIdentityToUser', () => {
    it('creates a role-scoped telegram identity pointing at the given agent user', async () => {
      const { service, authIdentityRepository } = makeService({
        authIdentities: [],
        users: [{ id: 'agent-1', roles: ['agent'] as any, displayName: 'Agent One' }],
      });

      await service.linkTelegramIdentityToUser('agent-1', { telegramUserId: '999', username: 'agent_tg' }, 'agent');

      expect(authIdentityRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'agent-1', provider: 'telegram', providerUserId: '999#agent' }),
      );
    });

    it('moves an existing raw identity for the same agent to the role-scoped id', async () => {
      const { service, authIdentityRepository } = makeService({
        authIdentities: [{ id: 'id-1', provider: 'telegram', providerUserId: '999', userId: 'agent-1' }],
        users: [{ id: 'agent-1', roles: ['agent'] as any, displayName: 'Agent One' }],
      });

      await service.linkTelegramIdentityToUser('agent-1', { telegramUserId: '999', username: 'renamed' }, 'agent');

      expect(authIdentityRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'id-1', userId: 'agent-1', providerUserId: '999#agent' }),
      );
    });

    it('rejects when this Telegram id is already linked to a DIFFERENT user of the SAME role', async () => {
      const { service } = makeService({
        authIdentities: [{ id: 'id-1', provider: 'telegram', providerUserId: '999', userId: 'other-agent' }],
        users: [{ id: 'other-agent', roles: ['agent'] as any, displayName: 'Other Agent' }],
      });

      await expect(
        service.linkTelegramIdentityToUser('agent-1', { telegramUserId: '999' }, 'agent'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('adds a role-suffixed identity when this Telegram id is already linked to a DIFFERENT-role user (e.g. an existing player account)', async () => {
      const { service, authIdentityRepository } = makeService({
        authIdentities: [{ id: 'id-player', provider: 'telegram', providerUserId: '999', userId: 'player-1' }],
        users: [
          { id: 'player-1', roles: ['player'] as any, displayName: 'Yoni' },
          { id: 'agent-1', roles: ['agent'] as any, displayName: 'Agent One' },
        ],
      });

      await service.linkTelegramIdentityToUser('agent-1', { telegramUserId: '999', username: 'agent_tg' }, 'agent');

      expect(authIdentityRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'agent-1', provider: 'telegram', providerUserId: '999#agent' }),
      );
      // the existing player identity is untouched, not overwritten
      expect(authIdentityRepository.remove).not.toHaveBeenCalled();
    });
  });

  describe('findAgentPhoneByTelegramId', () => {
    it('resolves the phone number of the linked agent', async () => {
      const { service } = makeService({
        authIdentities: [{ provider: 'telegram', providerUserId: '999', userId: 'agent-1' }],
        users: [{ id: 'agent-1', roles: ['agent'] as any, phoneNumber: '+251912345678', displayName: 'Agent One' }],
      });

      const result = await service.findAgentPhoneByTelegramId('999');
      expect(result).toEqual({ phoneNumber: '+251912345678', displayName: 'Agent One' });
    });

    it('returns null when no identity is linked yet', async () => {
      const { service } = makeService({ authIdentities: [] });
      expect(await service.findAgentPhoneByTelegramId('999')).toBeNull();
    });

    it('returns null when the linked user is no longer an agent', async () => {
      const { service } = makeService({
        authIdentities: [{ provider: 'telegram', providerUserId: '999', userId: 'user-1' }],
        users: [{ id: 'user-1', roles: ['player'] as any, phoneNumber: '+251900000000', displayName: 'X' }],
      });
      expect(await service.findAgentPhoneByTelegramId('999')).toBeNull();
    });

    it('resolves the agent identity when the same Telegram id also backs a player account (role-suffixed identity)', async () => {
      const { service } = makeService({
        authIdentities: [
          { provider: 'telegram', providerUserId: '999', userId: 'player-1' },
          { provider: 'telegram', providerUserId: '999#agent', userId: 'agent-1' },
        ],
        users: [
          { id: 'player-1', roles: ['player'] as any, phoneNumber: '+251900000000', displayName: 'Yoni' },
          { id: 'agent-1', roles: ['agent'] as any, phoneNumber: '+251912345678', displayName: 'Agent One' },
        ],
      });

      const result = await service.findAgentPhoneByTelegramId('999');
      expect(result).toEqual({ phoneNumber: '+251912345678', displayName: 'Agent One' });
    });
  });
});

describe('UsersService — agent referral codes', () => {
  /**
   * attributeReferral/ensureAgentReferralCode go through createQueryBuilder for
   * their guarded UPDATEs, so this block uses its own mock that records the
   * `set`/`where` payloads rather than reusing the finder-only mock above.
   */
  function makeService(input: { users?: Partial<User>[]; affected?: number }) {
    const users = input.users ?? [];
    const updates: Array<{ set: Record<string, unknown>; where: string; params: unknown }> = [];

    const queryBuilder = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockImplementation((values: Record<string, unknown>) => {
        updates.push({ set: values, where: '', params: undefined });
        return queryBuilder;
      }),
      where: jest.fn().mockImplementation((clause: string, params: unknown) => {
        if (updates.length > 0) {
          updates[updates.length - 1].where = clause;
          updates[updates.length - 1].params = params;
        }
        return queryBuilder;
      }),
      execute: jest.fn().mockImplementation(() =>
        Promise.resolve({ affected: input.affected ?? 1 }),
      ),
    };

    const userRepository = {
      findOneBy: jest.fn().mockImplementation((where: Record<string, unknown>) => {
        const found = users.find((u) => matchesWhere(u as any, where));
        return Promise.resolve(found ?? null);
      }),
      findOne: jest.fn().mockImplementation(({ where }: { where: Record<string, unknown> }) => {
        const found = users.find((u) => matchesWhere(u as any, where));
        return Promise.resolve(found ?? null);
      }),
      count: jest.fn().mockImplementation(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(users.filter((u) => matchesWhere(u as any, where)).length),
      ),
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
    };

    const service = new UsersService(
      {} as DataSource,
      userRepository as any,
      {} as any, // authIdentityRepository
      {} as any, // refreshSessionRepository
    );

    return { service, userRepository, updates };
  }

  const AGENT = {
    id: 'agent-1',
    roles: ['agent'] as any,
    status: 'active' as any,
    displayName: 'Agent One',
    referralCode: 'ABC234',
  };

  describe('attributeReferral', () => {
    it('attributes the player to the code owner and returns the agent name', async () => {
      const { service, updates } = makeService({ users: [AGENT] });

      const result = await service.attributeReferral('player-1', 'ABC234');

      expect(result).toBe('Agent One');
      expect(updates).toHaveLength(1);
      expect(updates[0].set).toEqual({ referredByAgentId: 'agent-1' });
      // The IS NULL guard is what makes first-attribution-wins true.
      expect(updates[0].where).toContain('referredByAgentId IS NULL');
      expect(updates[0].params).toEqual({ userId: 'player-1' });
    });

    it('accepts a lowercase / separator-laden code', async () => {
      const { service } = makeService({ users: [AGENT] });
      expect(await service.attributeReferral('player-1', ' abc-234 ')).toBe('Agent One');
    });

    it('returns null and writes nothing for an unknown code', async () => {
      const { service, updates } = makeService({ users: [AGENT] });

      expect(await service.attributeReferral('player-1', 'ZZZZZZ')).toBeNull();
      expect(updates).toHaveLength(0);
    });

    it('returns null and writes nothing for a malformed payload', async () => {
      const { service, updates } = makeService({ users: [AGENT] });

      expect(await service.attributeReferral('player-1', '<script>')).toBeNull();
      expect(updates).toHaveLength(0);
    });

    it('refuses to let an agent refer themselves', async () => {
      const { service, updates } = makeService({ users: [AGENT] });

      expect(await service.attributeReferral('agent-1', 'ABC234')).toBeNull();
      expect(updates).toHaveLength(0);
    });

    it('ignores a code owned by a suspended agent', async () => {
      const { service, updates } = makeService({
        users: [{ ...AGENT, status: 'suspended' as any }],
      });

      expect(await service.attributeReferral('player-1', 'ABC234')).toBeNull();
      expect(updates).toHaveLength(0);
    });

    it('ignores a code owned by a non-agent account', async () => {
      const { service, updates } = makeService({
        users: [{ ...AGENT, roles: ['player'] as any }],
      });

      expect(await service.attributeReferral('player-1', 'ABC234')).toBeNull();
      expect(updates).toHaveLength(0);
    });

    it('returns null when the player was ALREADY attributed (guard matched no rows)', async () => {
      const { service } = makeService({ users: [AGENT], affected: 0 });

      expect(await service.attributeReferral('player-1', 'ABC234')).toBeNull();
    });
  });

  describe('ensureAgentReferralCode', () => {
    it('returns the existing code without generating a new one', async () => {
      const { service, updates } = makeService({ users: [AGENT] });

      expect(await service.ensureAgentReferralCode('agent-1')).toBe('ABC234');
      expect(updates).toHaveLength(0);
    });

    it('generates and persists a code for an agent created before referral codes existed', async () => {
      const { service, updates } = makeService({
        users: [{ ...AGENT, referralCode: null }],
      });

      const code = await service.ensureAgentReferralCode('agent-1');

      expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTVWXYZ23456789]{6}$/);
      expect(updates).toHaveLength(1);
      // Guarded so a concurrent allocation isn't overwritten.
      expect(updates[0].where).toContain('referralCode IS NULL');
    });

    it('rejects a non-agent account', async () => {
      const { service } = makeService({
        users: [{ id: 'u-1', roles: ['player'] as any }],
      });

      await expect(service.ensureAgentReferralCode('u-1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('countReferredPlayers', () => {
    it('counts players attributed to this agent', async () => {
      const { service } = makeService({
        users: [
          AGENT,
          { id: 'p-1', referredByAgentId: 'agent-1' },
          { id: 'p-2', referredByAgentId: 'agent-1' },
          { id: 'p-3', referredByAgentId: 'other-agent' },
        ],
      });

      expect(await service.countReferredPlayers('agent-1')).toBe(2);
    });
  });
});
