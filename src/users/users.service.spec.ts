import { ConflictException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UsersService } from './users.service';
import { AuthIdentity } from './entities/auth-identity.entity';
import { User } from './entities/user.entity';

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
        const found = authIdentities.find((a) =>
          Object.entries(where).every(([k, v]) => (a as any)[k] === v),
        );
        return Promise.resolve(found ?? null);
      }),
      create: jest.fn().mockImplementation((dto) => dto),
      save: jest.fn().mockImplementation((entity) => Promise.resolve({ id: entity.id ?? 'identity-new', ...entity })),
    };

    const userRepository = {
      findOneBy: jest.fn().mockImplementation((where: Record<string, unknown>) => {
        const found = users.find((u) => Object.entries(where).every(([k, v]) => (u as any)[k] === v));
        return Promise.resolve(found ?? null);
      }),
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
  });

  describe('linkTelegramIdentityToUser', () => {
    it('creates a new telegram identity pointing at the given user', async () => {
      const { service, authIdentityRepository } = makeService({ authIdentities: [] });

      await service.linkTelegramIdentityToUser('agent-1', { telegramUserId: '999', username: 'agent_tg' });

      expect(authIdentityRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'agent-1', provider: 'telegram', providerUserId: '999' }),
      );
    });

    it('reuses (updates) an existing identity already linked to the SAME user', async () => {
      const { service, authIdentityRepository } = makeService({
        authIdentities: [{ id: 'id-1', provider: 'telegram', providerUserId: '999', userId: 'agent-1' }],
      });

      await service.linkTelegramIdentityToUser('agent-1', { telegramUserId: '999', username: 'renamed' });

      expect(authIdentityRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'id-1', userId: 'agent-1' }),
      );
    });

    it('rejects when this Telegram id is already linked to a DIFFERENT user', async () => {
      const { service } = makeService({
        authIdentities: [{ id: 'id-1', provider: 'telegram', providerUserId: '999', userId: 'other-agent' }],
      });

      await expect(
        service.linkTelegramIdentityToUser('agent-1', { telegramUserId: '999' }),
      ).rejects.toBeInstanceOf(ConflictException);
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
  });
});
