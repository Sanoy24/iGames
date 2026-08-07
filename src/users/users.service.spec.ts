import {
    BadRequestException,
    ConflictException,
    NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UsersService } from './users.service';
import { AuthIdentity } from './entities/auth-identity.entity';
import { User } from './entities/user.entity';

// A FindOperator (e.g. Like(...), In(...)) carries its comparator in `_type`
// and its comparand in `_value`  matching TypeORM's own internal shape
// closely enough for these repository mocks to interpret it.
function matchesValue(actual: unknown, expected: unknown): boolean {
    if (
        expected &&
        typeof expected === 'object' &&
        '_type' in (expected as any)
    ) {
        const op = expected as { _type: string; _value: unknown };
        if (op._type === 'like') {
            const pattern = String(op._value)
                .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
                .replace(/%/g, '.*');
            return new RegExp(`^${pattern}$`).test(String(actual));
        }
        if (op._type === 'in') {
            return (op._value as unknown[]).includes(actual);
        }
        return false;
    }
    return actual === expected;
}

function matchesWhere(
    entity: Record<string, unknown>,
    where: Record<string, unknown>,
): boolean {
    return Object.entries(where).every(([k, v]) => matchesValue(entity[k], v));
}

// Covers only the new agent-bot phone-linking methods added for the agent
// area feature  UsersService's older, transaction-heavy methods (e.g.
// createAgentUser, findOrCreateTelegramUser) are exercised at the integration
// level elsewhere, not here.
describe('UsersService  agent Telegram phone linking', () => {
    function makeService(input: {
        authIdentities?: Partial<AuthIdentity>[];
        users?: Partial<User>[];
    }) {
        const authIdentities = input.authIdentities ?? [];
        const users = input.users ?? [];

        const authIdentityRepository = {
            findOneBy: jest
                .fn()
                .mockImplementation((where: Record<string, unknown>) => {
                    const found = authIdentities.find((a) =>
                        matchesWhere(a as any, where),
                    );
                    return Promise.resolve(found ?? null);
                }),
            findOne: jest
                .fn()
                .mockImplementation(
                    ({ where }: { where: Record<string, unknown> }) => {
                        const found = authIdentities.find((a) =>
                            matchesWhere(a as any, where),
                        );
                        return Promise.resolve(found ?? null);
                    },
                ),
            find: jest
                .fn()
                .mockImplementation(
                    ({
                        where,
                    }: {
                        where:
                            | Record<string, unknown>
                            | Record<string, unknown>[];
                    }) => {
                        const clauses = Array.isArray(where) ? where : [where];
                        const found = authIdentities.filter((a) =>
                            clauses.some((clause) =>
                                matchesWhere(a as any, clause),
                            ),
                        );
                        return Promise.resolve(found);
                    },
                ),
            create: jest.fn().mockImplementation((dto) => dto),
            save: jest
                .fn()
                .mockImplementation((entity) =>
                    Promise.resolve({
                        id: entity.id ?? 'identity-new',
                        ...entity,
                    }),
                ),
            remove: jest
                .fn()
                .mockImplementation((entities) => Promise.resolve(entities)),
        };

        const userRepository = {
            findOneBy: jest
                .fn()
                .mockImplementation((where: Record<string, unknown>) => {
                    const found = users.find((u) =>
                        matchesWhere(u as any, where),
                    );
                    return Promise.resolve(found ?? null);
                }),
            findBy: jest
                .fn()
                .mockImplementation((where: Record<string, unknown>) => {
                    const found = users.filter((u) =>
                        matchesWhere(u as any, where),
                    );
                    return Promise.resolve(found);
                }),
            create: jest
                .fn()
                .mockImplementation((dto) => ({
                    id: dto.id ?? 'user-new',
                    ...dto,
                })),
            save: jest
                .fn()
                .mockImplementation((entity) =>
                    Promise.resolve({ id: entity.id ?? 'user-new', ...entity }),
                ),
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
                authIdentities: [
                    {
                        provider: 'password',
                        providerUserId: '+251912345678',
                        userId: 'agent-1',
                    },
                ],
                users: [
                    {
                        id: 'agent-1',
                        roles: ['agent'] as any,
                        displayName: 'Agent One',
                    },
                ],
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
                authIdentities: [
                    {
                        provider: 'password',
                        providerUserId: '+251912345678',
                        userId: 'user-1',
                    },
                ],
                users: [
                    {
                        id: 'user-1',
                        roles: ['player'] as any,
                        displayName: 'Some Player',
                    },
                ],
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
                    {
                        id: 'id-admin',
                        provider: 'password',
                        providerUserId: '+251912345678',
                        userId: 'admin-1',
                    },
                    {
                        id: 'id-agent',
                        provider: 'password',
                        providerUserId: '+251912345678#agent',
                        userId: 'agent-1',
                    },
                ],
                users: [
                    {
                        id: 'admin-1',
                        roles: ['admin'] as any,
                        displayName: 'Admin One',
                    },
                    {
                        id: 'agent-1',
                        roles: ['agent'] as any,
                        displayName: 'Agent One',
                    },
                ],
            });

            const result = await service.findAgentByPhone('0912345678');
            expect(result?.id).toBe('agent-1');
        });

        it('self-heals an orphaned identity (userId pointing at a deleted user) instead of blocking the phone', async () => {
            const { service, authIdentityRepository } = makeService({
                authIdentities: [
                    {
                        id: 'id-orphan',
                        provider: 'password',
                        providerUserId: '+251912345678',
                        userId: 'deleted-user',
                    },
                ],
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
            const { service, authIdentityRepository, userRepository } =
                makeService({
                    authIdentities: [
                        {
                            id: 'id-agent',
                            provider: 'telegram',
                            providerUserId: '999',
                            userId: 'agent-1',
                        },
                    ],
                    users: [
                        {
                            id: 'agent-1',
                            roles: ['agent'] as any,
                            displayName: 'Agent One',
                        },
                    ],
                });

            const result = await service.findOrCreateTelegramUser({
                telegramUserId: '999',
                username: 'player_tg',
            });

            expect(authIdentityRepository.save).toHaveBeenCalledWith(
                expect.objectContaining({
                    id: 'id-agent',
                    providerUserId: '999#agent',
                }),
            );
            expect(userRepository.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    roles: ['player'],
                    username: 'player_tg',
                }),
            );
            expect(authIdentityRepository.save).toHaveBeenCalledWith(
                expect.objectContaining({
                    userId: 'user-new',
                    provider: 'telegram',
                    providerUserId: '999',
                }),
            );
            expect(result.user.roles).toEqual(['player']);
            expect(result.created).toBe(true);
        });
    });

    describe('linkTelegramIdentityToUser', () => {
        it('creates a role-scoped telegram identity pointing at the given agent user', async () => {
            const { service, authIdentityRepository } = makeService({
                authIdentities: [],
                users: [
                    {
                        id: 'agent-1',
                        roles: ['agent'] as any,
                        displayName: 'Agent One',
                    },
                ],
            });

            await service.linkTelegramIdentityToUser(
                'agent-1',
                { telegramUserId: '999', username: 'agent_tg' },
                'agent',
            );

            expect(authIdentityRepository.save).toHaveBeenCalledWith(
                expect.objectContaining({
                    userId: 'agent-1',
                    provider: 'telegram',
                    providerUserId: '999#agent',
                }),
            );
        });

        it('moves an existing raw identity for the same agent to the role-scoped id', async () => {
            const { service, authIdentityRepository } = makeService({
                authIdentities: [
                    {
                        id: 'id-1',
                        provider: 'telegram',
                        providerUserId: '999',
                        userId: 'agent-1',
                    },
                ],
                users: [
                    {
                        id: 'agent-1',
                        roles: ['agent'] as any,
                        displayName: 'Agent One',
                    },
                ],
            });

            await service.linkTelegramIdentityToUser(
                'agent-1',
                { telegramUserId: '999', username: 'renamed' },
                'agent',
            );

            expect(authIdentityRepository.save).toHaveBeenCalledWith(
                expect.objectContaining({
                    id: 'id-1',
                    userId: 'agent-1',
                    providerUserId: '999#agent',
                }),
            );
        });

        it('rejects when this Telegram id is already linked to a DIFFERENT user of the SAME role', async () => {
            const { service } = makeService({
                authIdentities: [
                    {
                        id: 'id-1',
                        provider: 'telegram',
                        providerUserId: '999',
                        userId: 'other-agent',
                    },
                ],
                users: [
                    {
                        id: 'other-agent',
                        roles: ['agent'] as any,
                        displayName: 'Other Agent',
                    },
                ],
            });

            await expect(
                service.linkTelegramIdentityToUser(
                    'agent-1',
                    { telegramUserId: '999' },
                    'agent',
                ),
            ).rejects.toBeInstanceOf(ConflictException);
        });

        it('adds a role-suffixed identity when this Telegram id is already linked to a DIFFERENT-role user (e.g. an existing player account)', async () => {
            const { service, authIdentityRepository } = makeService({
                authIdentities: [
                    {
                        id: 'id-player',
                        provider: 'telegram',
                        providerUserId: '999',
                        userId: 'player-1',
                    },
                ],
                users: [
                    {
                        id: 'player-1',
                        roles: ['player'] as any,
                        displayName: 'Yoni',
                    },
                    {
                        id: 'agent-1',
                        roles: ['agent'] as any,
                        displayName: 'Agent One',
                    },
                ],
            });

            await service.linkTelegramIdentityToUser(
                'agent-1',
                { telegramUserId: '999', username: 'agent_tg' },
                'agent',
            );

            expect(authIdentityRepository.save).toHaveBeenCalledWith(
                expect.objectContaining({
                    userId: 'agent-1',
                    provider: 'telegram',
                    providerUserId: '999#agent',
                }),
            );
            // the existing player identity is untouched, not overwritten
            expect(authIdentityRepository.remove).not.toHaveBeenCalled();
        });
    });

    describe('findAgentPhoneByTelegramId', () => {
        it('resolves the phone number of the linked agent', async () => {
            const { service } = makeService({
                authIdentities: [
                    {
                        provider: 'telegram',
                        providerUserId: '999',
                        userId: 'agent-1',
                    },
                ],
                users: [
                    {
                        id: 'agent-1',
                        roles: ['agent'] as any,
                        phoneNumber: '+251912345678',
                        displayName: 'Agent One',
                    },
                ],
            });

            const result = await service.findAgentPhoneByTelegramId('999');
            expect(result).toEqual({
                phoneNumber: '+251912345678',
                displayName: 'Agent One',
            });
        });

        it('returns null when no identity is linked yet', async () => {
            const { service } = makeService({ authIdentities: [] });
            expect(await service.findAgentPhoneByTelegramId('999')).toBeNull();
        });

        it('returns null when the linked user is no longer an agent', async () => {
            const { service } = makeService({
                authIdentities: [
                    {
                        provider: 'telegram',
                        providerUserId: '999',
                        userId: 'user-1',
                    },
                ],
                users: [
                    {
                        id: 'user-1',
                        roles: ['player'] as any,
                        phoneNumber: '+251900000000',
                        displayName: 'X',
                    },
                ],
            });
            expect(await service.findAgentPhoneByTelegramId('999')).toBeNull();
        });

        it('resolves the agent identity when the same Telegram id also backs a player account (role-suffixed identity)', async () => {
            const { service } = makeService({
                authIdentities: [
                    {
                        provider: 'telegram',
                        providerUserId: '999',
                        userId: 'player-1',
                    },
                    {
                        provider: 'telegram',
                        providerUserId: '999#agent',
                        userId: 'agent-1',
                    },
                ],
                users: [
                    {
                        id: 'player-1',
                        roles: ['player'] as any,
                        phoneNumber: '+251900000000',
                        displayName: 'Yoni',
                    },
                    {
                        id: 'agent-1',
                        roles: ['agent'] as any,
                        phoneNumber: '+251912345678',
                        displayName: 'Agent One',
                    },
                ],
            });

            const result = await service.findAgentPhoneByTelegramId('999');
            expect(result).toEqual({
                phoneNumber: '+251912345678',
                displayName: 'Agent One',
            });
        });
    });
});

describe('UsersService  agent referral codes', () => {
    /**
     * attributeReferral/ensureAgentReferralCode go through createQueryBuilder for
     * their guarded UPDATEs, so this block uses its own mock that records the
     * `set`/`where` payloads rather than reusing the finder-only mock above.
     */
    function makeService(input: {
        users?: Partial<User>[];
        affected?: number;
    }) {
        const users = input.users ?? [];
        const updates: Array<{
            set: Record<string, unknown>;
            where: string;
            params: unknown;
        }> = [];

        const queryBuilder = {
            update: jest.fn().mockReturnThis(),
            set: jest
                .fn()
                .mockImplementation((values: Record<string, unknown>) => {
                    updates.push({ set: values, where: '', params: undefined });
                    return queryBuilder;
                }),
            where: jest
                .fn()
                .mockImplementation((clause: string, params: unknown) => {
                    if (updates.length > 0) {
                        updates[updates.length - 1].where = clause;
                        updates[updates.length - 1].params = params;
                    }
                    return queryBuilder;
                }),
            execute: jest
                .fn()
                .mockImplementation(() =>
                    Promise.resolve({ affected: input.affected ?? 1 }),
                ),
        };

        const userRepository = {
            findOneBy: jest
                .fn()
                .mockImplementation((where: Record<string, unknown>) => {
                    const found = users.find((u) =>
                        matchesWhere(u as any, where),
                    );
                    return Promise.resolve(found ?? null);
                }),
            findOne: jest
                .fn()
                .mockImplementation(
                    ({ where }: { where: Record<string, unknown> }) => {
                        const found = users.find((u) =>
                            matchesWhere(u as any, where),
                        );
                        return Promise.resolve(found ?? null);
                    },
                ),
            count: jest
                .fn()
                .mockImplementation(
                    ({ where }: { where: Record<string, unknown> }) =>
                        Promise.resolve(
                            users.filter((u) => matchesWhere(u as any, where))
                                .length,
                        ),
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

            const result = await service.attributeReferral(
                'player-1',
                'ABC234',
            );

            expect(result).toBe('Agent One');
            expect(updates).toHaveLength(1);
            expect(updates[0].set).toEqual({ referredByAgentId: 'agent-1' });
            // The IS NULL guard is what makes first-attribution-wins true.
            expect(updates[0].where).toContain('referredByAgentId IS NULL');
            expect(updates[0].params).toEqual({ userId: 'player-1' });
        });

        it('accepts a lowercase / separator-laden code', async () => {
            const { service } = makeService({ users: [AGENT] });
            expect(
                await service.attributeReferral('player-1', ' abc-234 '),
            ).toBe('Agent One');
        });

        it('returns null and writes nothing for an unknown code', async () => {
            const { service, updates } = makeService({ users: [AGENT] });

            expect(
                await service.attributeReferral('player-1', 'ZZZZZZ'),
            ).toBeNull();
            expect(updates).toHaveLength(0);
        });

        it('returns null and writes nothing for a malformed payload', async () => {
            const { service, updates } = makeService({ users: [AGENT] });

            expect(
                await service.attributeReferral('player-1', '<script>'),
            ).toBeNull();
            expect(updates).toHaveLength(0);
        });

        it('refuses to let an agent refer themselves', async () => {
            const { service, updates } = makeService({ users: [AGENT] });

            expect(
                await service.attributeReferral('agent-1', 'ABC234'),
            ).toBeNull();
            expect(updates).toHaveLength(0);
        });

        it('ignores a code owned by a suspended agent', async () => {
            const { service, updates } = makeService({
                users: [{ ...AGENT, status: 'suspended' as any }],
            });

            expect(
                await service.attributeReferral('player-1', 'ABC234'),
            ).toBeNull();
            expect(updates).toHaveLength(0);
        });

        it('ignores a code owned by a non-agent account', async () => {
            const { service, updates } = makeService({
                users: [{ ...AGENT, roles: ['player'] as any }],
            });

            expect(
                await service.attributeReferral('player-1', 'ABC234'),
            ).toBeNull();
            expect(updates).toHaveLength(0);
        });

        it('returns null when the player was ALREADY attributed (guard matched no rows)', async () => {
            const { service } = makeService({ users: [AGENT], affected: 0 });

            expect(
                await service.attributeReferral('player-1', 'ABC234'),
            ).toBeNull();
        });
    });

    describe('ensureAgentReferralCode', () => {
        it('returns the existing code without generating a new one', async () => {
            const { service, updates } = makeService({ users: [AGENT] });

            expect(await service.ensureAgentReferralCode('agent-1')).toBe(
                'ABC234',
            );
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

            await expect(
                service.ensureAgentReferralCode('u-1'),
            ).rejects.toBeInstanceOf(NotFoundException);
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

describe('UsersService  updateProfile phone conflict', () => {
    /**
     * Regression for a real production incident: PATCH /users/me has no @Roles
     * guard and updateProfile previously wrote phoneNumber with NO check that
     * another account already held it  a player editing their profile silently
     * created a second account sharing a phone with an existing one (two live
     * wallets, one balance effectively stranded). This block covers the guard
     * added to close that gap. Uses a SELECT-style queryBuilder mock (.getOne()),
     * unlike the UPDATE-style one in the referral-codes block above.
     */
    function makeService(input: {
        users?: Partial<User>[];
        conflictUser?: Partial<User> | null;
    }) {
        const users = input.users ?? [];

        const queryBuilder = {
            where: jest.fn().mockReturnThis(),
            andWhere: jest.fn().mockReturnThis(),
            getOne: jest
                .fn()
                .mockImplementation(() =>
                    Promise.resolve(input.conflictUser ?? null),
                ),
        };

        const userRepository = {
            findOneBy: jest
                .fn()
                .mockImplementation((where: Record<string, unknown>) => {
                    const found = users.find((u) =>
                        matchesWhere(u as any, where),
                    );
                    return Promise.resolve(found ?? null);
                }),
            save: jest
                .fn()
                .mockImplementation((entity) => Promise.resolve(entity)),
            createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
        };

        const service = new UsersService(
            {} as DataSource,
            userRepository as any,
            {} as any, // authIdentityRepository
            {} as any, // refreshSessionRepository
        );

        return { service, userRepository, queryBuilder };
    }

    // A fresh object per test  updateProfile mutates the entity it's given
    // (`user.phoneNumber = ...`), so a single shared constant would leak state
    // between tests since the mock's findOneBy returns this exact reference.
    const makeSelf = () => ({
        id: 'player-1',
        displayName: 'Me',
        phoneNumber: '+251911111111',
        roles: ['player'] as any,
    });

    it('allows the update when no other account holds the phone', async () => {
        const { service, userRepository } = makeService({
            users: [makeSelf()],
            conflictUser: null,
        });

        const result = await service.updateProfile('player-1', {
            phoneNumber: '0922222222',
        });

        expect(result.phoneNumber).toBe('+251922222222');
        expect(userRepository.save).toHaveBeenCalled();
    });

    it('allows re-saving the SAME phone the account already has (no-op edit)', async () => {
        const { service, queryBuilder } = makeService({
            users: [makeSelf()],
            conflictUser: null,
        });

        await service.updateProfile('player-1', {
            phoneNumber: '0911111111',
            displayName: 'Me',
        });

        // Same phone as before normalization  the conflict query must be skipped entirely.
        expect(queryBuilder.getOne).not.toHaveBeenCalled();
    });

    it('rejects when another ACTIVE player already holds that phone', async () => {
        const { service } = makeService({
            users: [makeSelf()],
            conflictUser: {
                id: 'player-2',
                roles: ['player'] as any,
                status: 'active' as any,
            },
        });

        await expect(
            service.updateProfile('player-1', { phoneNumber: '0933333333' }),
        ).rejects.toBeInstanceOf(ConflictException);
    });

    it('does not block on a phone shared by a DIFFERENT-role account (deliberate agent/admin sharing)', async () => {
        // The conflict query itself is scoped to role:'player' via JSON_CONTAINS, so a
        // real agent/admin row sharing this phone would never be returned here  this
        // asserts the allow-path when the DB correctly returns no conflict.
        const { service, userRepository } = makeService({
            users: [makeSelf()],
            conflictUser: null,
        });

        const result = await service.updateProfile('player-1', {
            phoneNumber: '0938967749',
        });
        expect(result.phoneNumber).toBe('+251938967749');
        expect(userRepository.save).toHaveBeenCalled();
    });

    it('rejects an invalid phone before ever checking for a conflict', async () => {
        const { service, queryBuilder } = makeService({ users: [makeSelf()] });

        await expect(
            service.updateProfile('player-1', { phoneNumber: 'not-a-phone' }),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(queryBuilder.getOne).not.toHaveBeenCalled();
    });
});

describe('UsersService  direct player→agent GPS matching', () => {
    function makeAgent(overrides: Partial<User> = {}): User {
        return {
            id: 'agent-1',
            displayName: 'Agent One',
            sharedLatitude: 8.9806,
            sharedLongitude: 38.7578,
            ...overrides,
        } as User;
    }

    function makeService(input: { users?: Partial<User>[] } = {}) {
        const users = input.users ?? [];

        const userRepository = {
            findOneBy: jest
                .fn()
                .mockImplementation((where: Record<string, unknown>) => {
                    const found = users.find((u) =>
                        matchesWhere(u as any, where),
                    );
                    return Promise.resolve(found ?? null);
                }),
            save: jest
                .fn()
                .mockImplementation((entity) => Promise.resolve(entity)),
        };

        const service = new UsersService(
            {} as DataSource,
            userRepository as any,
            {} as any, // authIdentityRepository
            {} as any, // refreshSessionRepository
        );

        return { service, userRepository };
    }

    // Two points ~1.1km apart (0.01° latitude)  well within the 5km match radius.
    const NEAR_LAT = 8.9806;
    const NEAR_LNG = 38.7578;
    // ~13 degrees away  far outside any plausible match radius.
    const FAR_LAT = 22.0;
    const FAR_LNG = 38.7578;

    describe('matchAgentFromCoords', () => {
        it('matches the nearest on-duty agent within range', async () => {
            const { service } = makeService();
            jest.spyOn(service, 'findOnDutyAgents').mockResolvedValue([
                makeAgent(),
            ]);

            const result = await service.matchAgentFromCoords(
                NEAR_LAT,
                NEAR_LNG,
            );
            expect(result?.id).toBe('agent-1');
        });

        it('skips on-duty agents who never shared a pin', async () => {
            const { service } = makeService();
            jest.spyOn(service, 'findOnDutyAgents').mockResolvedValue([
                makeAgent({
                    id: 'no-pin',
                    sharedLatitude: null,
                    sharedLongitude: null,
                }),
            ]);

            const result = await service.matchAgentFromCoords(
                NEAR_LAT,
                NEAR_LNG,
            );
            expect(result).toBeNull();
        });

        it('returns null when nothing is within range', async () => {
            const { service } = makeService();
            jest.spyOn(service, 'findOnDutyAgents').mockResolvedValue([
                makeAgent(),
            ]);

            const result = await service.matchAgentFromCoords(FAR_LAT, FAR_LNG);
            expect(result).toBeNull();
        });

        it('returns null when nobody is on duty', async () => {
            const { service } = makeService();
            jest.spyOn(service, 'findOnDutyAgents').mockResolvedValue([]);

            const result = await service.matchAgentFromCoords(
                NEAR_LAT,
                NEAR_LNG,
            );
            expect(result).toBeNull();
        });
    });

    describe('setAssignedAgent', () => {
        it('rejects when both agentId and other are supplied', async () => {
            const { service } = makeService({
                users: [{ id: 'player-1' } as any],
            });
            await expect(
                service.setAssignedAgent('player-1', {
                    agentId: 'agent-1',
                    other: true,
                }),
            ).rejects.toBeInstanceOf(BadRequestException);
        });

        it('rejects when neither agentId nor other are supplied', async () => {
            const { service } = makeService({
                users: [{ id: 'player-1' } as any],
            });
            await expect(
                service.setAssignedAgent('player-1', {}),
            ).rejects.toBeInstanceOf(BadRequestException);
        });

        it('rejects an agentId that is not currently on duty', async () => {
            const { service } = makeService({
                users: [{ id: 'player-1' } as any],
            });
            jest.spyOn(service, 'findOnDutyAgents').mockResolvedValue([]);

            await expect(
                service.setAssignedAgent('player-1', { agentId: 'agent-1' }),
            ).rejects.toBeInstanceOf(NotFoundException);
        });

        it('other: true always forces source "other", regardless of the source arg', async () => {
            const { service } = makeService({
                users: [{ id: 'player-1' } as any],
            });

            const result = await service.setAssignedAgent(
                'player-1',
                { other: true },
                'gps_match',
            );
            expect(result).toEqual({
                assignedAgentId: null,
                assignedAgentName: null,
                assignedAgentSource: 'other',
            });
        });

        it('assigns a currently on-duty agent and is reassignable on a later call', async () => {
            const player = { id: 'player-1' } as any;
            const { service } = makeService({ users: [player] });
            jest.spyOn(service, 'findOnDutyAgents').mockResolvedValue([
                makeAgent(),
            ]);

            const first = await service.setAssignedAgent(
                'player-1',
                { agentId: 'agent-1' },
                'gps_match',
            );
            expect(first).toEqual({
                assignedAgentId: 'agent-1',
                assignedAgentName: 'Agent One',
                assignedAgentSource: 'gps_match',
            });
            expect(player.assignedAgentId).toBe('agent-1');

            jest.spyOn(service, 'findOnDutyAgents').mockResolvedValue([
                makeAgent({ id: 'agent-2', displayName: 'Agent Two' }),
            ]);
            const second = await service.setAssignedAgent(
                'player-1',
                { agentId: 'agent-2' },
                'manual_pick',
            );
            expect(second.assignedAgentId).toBe('agent-2');
            expect(player.assignedAgentId).toBe('agent-2');
        });
    });
});
