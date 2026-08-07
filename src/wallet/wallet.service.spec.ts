import {
    BadRequestException,
    ConflictException,
    NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { WalletService } from './wallet.service';
import { LedgerService } from '../ledger/ledger.service';
import { Wallet } from './entities/wallet.entity';

// ─── Shared mock builder ──────────────────────────────────────────────────────

function makeWallet(overrides: Partial<Wallet> = {}): Wallet {
    return Object.assign(new Wallet(), {
        id: 'wallet-1',
        userId: 'user-1',
        currencyCode: 'CREDIT',
        availableMinor: 10_000,
        reservedMinor: 0,
        status: 'active',
        ...overrides,
    });
}

function makeIdempotencyRecord(response: object) {
    return {
        id: 'idem-1',
        status: 'completed',
        requestHash: 'hash-abc',
        response,
    };
}

function makeService({
    wallet,
    existingIdempotency = null,
}: {
    wallet?: Wallet;
    existingIdempotency?: object | null;
}) {
    const savedWallet = wallet ?? makeWallet();

    // The manager returned inside dataSource.transaction
    const mockManager = {
        getRepository: jest.fn().mockImplementation((entity) => {
            // WagerLimit  enforceWagerLimit reads and saves this
            if (
                entity?.name === 'WagerLimit' ||
                String(entity) ===
                    String(require('./entities/wager-limit.entity').WagerLimit)
            ) {
                return {
                    findOneBy: jest.fn().mockResolvedValue(null), // no limit set → allow
                    save: jest
                        .fn()
                        .mockImplementation((x: unknown) => Promise.resolve(x)),
                    create: jest.fn().mockImplementation((x: unknown) => x),
                };
            }
            // Wallet (default)
            return {
                findOne: jest.fn().mockResolvedValue(savedWallet),
                save: jest
                    .fn()
                    .mockImplementation((w: Wallet) => Promise.resolve(w)),
            };
        }),
        query: jest.fn().mockResolvedValue(undefined),
    } as unknown as EntityManager;

    const mockDataSource = {
        transaction: jest
            .fn()
            .mockImplementation(
                async (cb: (m: EntityManager) => Promise<unknown>) =>
                    cb(mockManager),
            ),
    } as unknown as DataSource;

    const mockLedgerService = {
        findIdempotencyRecord: jest.fn().mockResolvedValue(existingIdempotency),
        createPendingIdempotencyRecord: jest
            .fn()
            .mockResolvedValue({ id: 'idem-new', requestHash: 'hash-abc' }),
        createEntry: jest.fn().mockResolvedValue({
            id: 'ledger-1',
            walletId: savedWallet.id,
            currencyCode: 'CREDIT',
            amountMinor: 1_000,
            direction: 'debit',
            entryType: 'stake',
            sourceType: 'keno_ticket',
            sourceId: 'ticket-1',
            idempotencyKey: 'key-1',
            balanceAfterMinor: savedWallet.availableMinor - 1_000,
            metadata: {},
            createdAt: new Date(),
        }),
        assertIdempotentRequestMatches: jest.fn(),
        completeIdempotencyRecord: jest.fn().mockResolvedValue(undefined),
    } as unknown as LedgerService;

    const mockEventsGateway = {
        emitWalletUpdated: jest.fn(),
        emitUserNotification: jest.fn(),
    } as any;
    const mockNotificationsService = {
        create: jest.fn(),
        safeCreate: jest.fn(),
    } as any;

    const service = new WalletService(
        mockDataSource,
        { findOneBy: jest.fn(), create: jest.fn(), save: jest.fn() } as any,
        { findOneBy: jest.fn() } as any,
        { findOneBy: jest.fn() } as any,
        { findOneBy: jest.fn() } as any,
        { findOneBy: jest.fn(), find: jest.fn().mockResolvedValue([]) } as any,
        mockLedgerService,
        mockEventsGateway,
        mockNotificationsService,
    );

    return { service, mockManager, mockDataSource, mockLedgerService };
}

// ─── verifyAgentWithdrawal  admin gate on fund release ───────────────────────
// Self-contained mocks (not the shared makeService above) since this exercises a
// different set of repos (Withdrawal, Wallet-by-two-different-userIds, AgentActionLog).

function makeWithdrawal(overrides: Partial<Record<string, unknown>> = {}) {
    return {
        id: 'wd-1',
        userId: 'player-1',
        agentId: 'agent-1',
        amountMinor: 25_000,
        status: 'awaiting_verification',
        serviceChargeMinor: 1_000,
        netAmountMinor: 24_000,
        destinationAccount: '0911111111',
        telebirrReference: 'REF123',
        ...overrides,
    };
}

function makeVerifyService(input: {
    withdrawal?: Record<string, unknown> | null;
    playerWallet?: Wallet;
    agentWallet?: Wallet;
}) {
    const withdrawal =
        input.withdrawal === undefined ? makeWithdrawal() : input.withdrawal;
    const playerWallet =
        input.playerWallet ??
        makeWallet({
            id: 'wallet-player',
            userId: 'player-1',
            reservedMinor: 25_000,
            availableMinor: 0,
        });
    const agentWallet =
        input.agentWallet ??
        makeWallet({
            id: 'wallet-agent',
            userId: 'agent-1',
            availableMinor: 0,
        });

    const withdrawalRepo = {
        findOneBy: jest.fn().mockResolvedValue(withdrawal),
        save: jest.fn().mockImplementation((w: unknown) => Promise.resolve(w)),
    };
    const walletRepo = {
        findOne: jest
            .fn()
            .mockImplementation(({ where }: { where: { userId: string } }) =>
                Promise.resolve(
                    where.userId === 'agent-1' ? agentWallet : playerWallet,
                ),
            ),
        findOneBy: jest
            .fn()
            .mockImplementation(({ userId }: { userId: string }) =>
                Promise.resolve(
                    userId === 'agent-1' ? agentWallet : playerWallet,
                ),
            ),
        save: jest.fn().mockImplementation((w: Wallet) => Promise.resolve(w)),
    };
    const agentActionLogRepo = {
        create: jest.fn().mockImplementation((x: unknown) => x),
        save: jest.fn().mockResolvedValue(undefined),
    };

    const mockManager = {
        getRepository: jest.fn().mockImplementation((entity) => {
            const name = entity?.name ?? String(entity);
            if (name.includes('Withdrawal')) return withdrawalRepo;
            if (name.includes('AgentActionLog')) return agentActionLogRepo;
            return walletRepo; // Wallet (default)
        }),
        query: jest.fn().mockResolvedValue(undefined),
    } as unknown as EntityManager;

    const mockDataSource = {
        transaction: jest
            .fn()
            .mockImplementation(
                async (cb: (m: EntityManager) => Promise<unknown>) =>
                    cb(mockManager),
            ),
        getRepository: jest.fn(),
    } as unknown as DataSource;

    const mockLedgerService = {
        findIdempotencyRecord: jest.fn().mockResolvedValue(null),
        createPendingIdempotencyRecord: jest
            .fn()
            .mockResolvedValue({ id: 'idem-new', requestHash: 'hash' }),
        createEntry: jest
            .fn()
            .mockImplementation((entry) =>
                Promise.resolve({ id: 'ledger-x', ...entry }),
            ),
        assertIdempotentRequestMatches: jest.fn(),
        completeIdempotencyRecord: jest.fn().mockResolvedValue(undefined),
    } as unknown as LedgerService;

    const mockEventsGateway = {
        emitWalletUpdated: jest.fn(),
        emitUserNotification: jest.fn(),
    } as any;
    const mockNotificationsService = {
        create: jest.fn(),
        safeCreate: jest.fn(),
    } as any;

    const service = new WalletService(
        mockDataSource,
        walletRepo as any,
        { findOneBy: jest.fn() } as any,
        withdrawalRepo as any,
        { findOneBy: jest.fn() } as any,
        { findOneBy: jest.fn(), find: jest.fn().mockResolvedValue([]) } as any,
        mockLedgerService,
        mockEventsGateway,
        mockNotificationsService,
    );

    return {
        service,
        withdrawalRepo,
        walletRepo,
        agentWallet,
        playerWallet,
        mockLedgerService,
    };
}

describe('WalletService.verifyAgentWithdrawal', () => {
    it('rejects when the withdrawal is not awaiting_verification', async () => {
        const { service } = makeVerifyService({ withdrawal: null });
        await expect(
            service.verifyAgentWithdrawal('wd-1', 'approve', 'admin-1'),
        ).rejects.toThrow(ConflictException);
    });

    it('rejects a reject-decision with notes under 15 characters', async () => {
        const { service } = makeVerifyService({});
        await expect(
            service.verifyAgentWithdrawal(
                'wd-1',
                'reject',
                'admin-1',
                'too short',
            ),
        ).rejects.toThrow(BadRequestException);
    });

    it('approve: releases the fund-hold and credits the agent custody + fee using amounts stored at submission time', async () => {
        const { service, withdrawalRepo, playerWallet, agentWallet } =
            makeVerifyService({});

        await service.verifyAgentWithdrawal('wd-1', 'approve', 'admin-1');

        expect(playerWallet.reservedMinor).toBe(0); // 25,000 - 25,000
        expect(agentWallet.availableMinor).toBe(25_000); // 24,000 custody + 1,000 fee
        const saved = (withdrawalRepo.save as jest.Mock).mock.calls[0][0];
        expect(saved.status).toBe('completed');
        expect(saved.verifiedBy).toBe('admin-1');
        expect(saved.verifiedAt).toBeInstanceOf(Date);
    });

    it("reject: refunds the reservation to the player's available balance and does not credit the agent", async () => {
        const {
            service,
            withdrawalRepo,
            playerWallet,
            agentWallet,
            mockLedgerService,
        } = makeVerifyService({});

        await service.verifyAgentWithdrawal(
            'wd-1',
            'reject',
            'admin-1',
            'Agent could not confirm payout details',
        );

        expect(playerWallet.reservedMinor).toBe(0);
        expect(playerWallet.availableMinor).toBe(25_000);
        expect(agentWallet.availableMinor).toBe(0);
        expect(mockLedgerService.createEntry).toHaveBeenCalledWith(
            expect.objectContaining({
                entryType: 'refund',
                amountMinor: 25_000,
            }),
            expect.anything(),
        );
        const saved = (withdrawalRepo.save as jest.Mock).mock.calls[0][0];
        expect(saved.status).toBe('rejected');
        expect(saved.verifiedBy).toBe('admin-1');
    });
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('WalletService  unit (mocked repos)', () => {
    const baseInput = {
        userId: 'user-1',
        amountMinor: 1_000,
        entryType: 'stake' as const,
        sourceType: 'keno_ticket',
        sourceId: 'ticket-1',
        idempotencyKey: 'idem-key-001',
    };

    // ── debit ────────────────────────────────────────────────────────────────

    describe('debit', () => {
        it('returns a WalletMutationResult with idempotent=false on first call', async () => {
            const { service } = makeService({});
            const result = await service.debit(baseInput);
            expect(result.idempotent).toBe(false);
            expect(result.wallet).toBeDefined();
            expect(result.ledgerEntry).toBeDefined();
        });

        it('creates a ledger entry on each unique debit', async () => {
            const { service, mockLedgerService } = makeService({});
            await service.debit(baseInput);
            expect(mockLedgerService.createEntry).toHaveBeenCalledTimes(1);
        });

        it('throws ConflictException when balance is insufficient', async () => {
            const brokeWallet = makeWallet({ availableMinor: 500 });
            const { service } = makeService({ wallet: brokeWallet });
            await expect(
                service.debit({ ...baseInput, amountMinor: 1_000 }),
            ).rejects.toThrow(ConflictException);
        });

        it('throws on inactive wallet', async () => {
            const frozenWallet = makeWallet({ status: 'locked' });
            const { service } = makeService({ wallet: frozenWallet });
            await expect(service.debit(baseInput)).rejects.toThrow(
                ConflictException,
            );
        });

        it('returns cached result and skips ledger write on duplicate idempotency key', async () => {
            const cachedResult = {
                wallet: {
                    id: 'wallet-1',
                    userId: 'user-1',
                    availableMinor: 9_000,
                    reservedMinor: 0,
                    currencyCode: 'CREDIT',
                    status: 'active',
                },
                ledgerEntry: {
                    id: 'ledger-old',
                    walletId: 'wallet-1',
                    currencyCode: 'CREDIT',
                    amountMinor: 1_000,
                    direction: 'debit',
                    entryType: 'stake',
                    sourceType: 'keno_ticket',
                    sourceId: 'ticket-1',
                    idempotencyKey: 'idem-key-001',
                    balanceAfterMinor: 9_000,
                    metadata: {},
                },
                idempotent: false,
            };
            const { service, mockLedgerService } = makeService({
                existingIdempotency: makeIdempotencyRecord(cachedResult),
            });
            const result = await service.debit(baseInput);
            expect(result.idempotent).toBe(true);
            expect(mockLedgerService.createEntry).not.toHaveBeenCalled();
        });
    });

    // ── credit ───────────────────────────────────────────────────────────────

    describe('credit', () => {
        it('returns a WalletMutationResult with idempotent=false on first call', async () => {
            const { service } = makeService({});
            const result = await service.credit({
                ...baseInput,
                entryType: 'win',
                idempotencyKey: 'credit-key-001',
            });
            expect(result.idempotent).toBe(false);
        });

        it('creates a ledger entry on each unique credit', async () => {
            const { service, mockLedgerService } = makeService({});
            await service.credit({
                ...baseInput,
                entryType: 'win',
                idempotencyKey: 'credit-key-002',
            });
            expect(mockLedgerService.createEntry).toHaveBeenCalledTimes(1);
        });

        it('returns cached result on duplicate idempotency key', async () => {
            const cachedResult = {
                wallet: {
                    id: 'wallet-1',
                    userId: 'user-1',
                    availableMinor: 11_000,
                    reservedMinor: 0,
                    currencyCode: 'CREDIT',
                    status: 'active',
                },
                ledgerEntry: {
                    id: 'ledger-old',
                    walletId: 'wallet-1',
                    currencyCode: 'CREDIT',
                    amountMinor: 1_000,
                    direction: 'credit',
                    entryType: 'win',
                    sourceType: 'keno_ticket',
                    sourceId: 'ticket-1',
                    idempotencyKey: 'credit-key-003',
                    balanceAfterMinor: 11_000,
                    metadata: {},
                },
                idempotent: false,
            };
            const { service, mockLedgerService } = makeService({
                existingIdempotency: makeIdempotencyRecord(cachedResult),
            });
            const result = await service.credit({
                ...baseInput,
                entryType: 'win',
                idempotencyKey: 'credit-key-003',
            });
            expect(result.idempotent).toBe(true);
            expect(mockLedgerService.createEntry).not.toHaveBeenCalled();
        });
    });

    // ── amount validation ─────────────────────────────────────────────────────

    describe('amount validation', () => {
        it('throws BadRequestException on amount = 0', async () => {
            const { service } = makeService({});
            await expect(
                service.debit({ ...baseInput, amountMinor: 0 }),
            ).rejects.toThrow();
        });

        it('throws BadRequestException on negative amount', async () => {
            const { service } = makeService({});
            await expect(
                service.debit({ ...baseInput, amountMinor: -100 }),
            ).rejects.toThrow();
        });
    });

    // ── debitInSession / creditInSession ──────────────────────────────────────

    describe('debitInSession', () => {
        it('uses the supplied manager instead of opening a new transaction', async () => {
            const { service, mockDataSource, mockLedgerService } = makeService(
                {},
            );

            const savedWallet2 = makeWallet();
            const externalManager = {
                getRepository: jest.fn().mockImplementation((entity) => {
                    if (entity?.name === 'WagerLimit') {
                        return {
                            findOneBy: jest.fn().mockResolvedValue(null),
                            save: jest
                                .fn()
                                .mockImplementation((x: unknown) =>
                                    Promise.resolve(x),
                                ),
                            create: jest
                                .fn()
                                .mockImplementation((x: unknown) => x),
                        };
                    }
                    return {
                        findOne: jest.fn().mockResolvedValue(savedWallet2),
                        save: jest
                            .fn()
                            .mockImplementation((w: Wallet) =>
                                Promise.resolve(w),
                            ),
                    };
                }),
                query: jest.fn().mockResolvedValue(undefined),
            } as unknown as EntityManager;

            mockLedgerService.findIdempotencyRecord = jest
                .fn()
                .mockResolvedValue(null);
            mockLedgerService.createPendingIdempotencyRecord = jest
                .fn()
                .mockResolvedValue({ id: 'idem-x', requestHash: 'hash-x' });

            await service.debitInSession(baseInput, externalManager);

            // The DataSource.transaction method must NOT be called  caller owns the transaction
            expect(mockDataSource.transaction).not.toHaveBeenCalled();
        });
    });

    // Regression: agents typing a player's phone in national "09…"/"07…" form got a
    // silent "user not found" because the lookup ran on the raw, unnormalized string
    // while users.phoneNumber is always stored as +2519…/+2517…  see phone.util.ts.
    describe('transferAgentToUser', () => {
        it('rejects a malformed phone before opening a transaction', async () => {
            const { service, mockDataSource } = makeService({});

            await expect(
                service.transferAgentToUser('agent-1', 'not-a-phone', 1_000),
            ).rejects.toBeInstanceOf(BadRequestException);
            expect(mockDataSource.transaction).not.toHaveBeenCalled();
        });

        it('normalizes a national "09…" phone to +2519… before looking up the recipient', async () => {
            const userRepo = { findOneBy: jest.fn().mockResolvedValue(null) };
            const { service, mockManager } = makeService({});
            (mockManager.getRepository as jest.Mock).mockImplementation(
                (entity) => {
                    if (entity?.name === 'User') return userRepo;
                    if (entity?.name === 'WagerLimit') {
                        return {
                            findOneBy: jest.fn().mockResolvedValue(null),
                            save: jest.fn(),
                            create: jest.fn((x: unknown) => x),
                        };
                    }
                    return {
                        findOne: jest.fn().mockResolvedValue(makeWallet()),
                        save: jest.fn(),
                    };
                },
            );

            await expect(
                service.transferAgentToUser('agent-1', '0912345678', 1_000),
            ).rejects.toBeInstanceOf(NotFoundException);

            expect(userRepo.findOneBy).toHaveBeenCalledWith({
                phoneNumber: '+251912345678',
            });
        });

        it('also normalizes a bare 9-digit phone', async () => {
            const userRepo = { findOneBy: jest.fn().mockResolvedValue(null) };
            const { service, mockManager } = makeService({});
            (mockManager.getRepository as jest.Mock).mockImplementation(
                (entity) => {
                    if (entity?.name === 'User') return userRepo;
                    return {
                        findOneBy: jest.fn().mockResolvedValue(null),
                        save: jest.fn(),
                        create: jest.fn((x: unknown) => x),
                        findOne: jest.fn().mockResolvedValue(makeWallet()),
                    };
                },
            );

            await expect(
                service.transferAgentToUser('agent-1', '912345678', 1_000),
            ).rejects.toBeInstanceOf(NotFoundException);

            expect(userRepo.findOneBy).toHaveBeenCalledWith({
                phoneNumber: '+251912345678',
            });
        });
    });

    // Manager-scoped sibling of transferAgentToUser, used by PaymentsService to
    // fund a deposit's player-credit from the matched agent's own wallet inside
    // the deposit's existing transaction.
    describe('fundUserCreditFromAgent', () => {
        function makeSessionManager(agentWallet: Wallet, userWallet: Wallet) {
            return {
                getRepository: jest.fn().mockImplementation((entity) => {
                    if (entity?.name === 'WagerLimit') {
                        return {
                            findOneBy: jest.fn().mockResolvedValue(null),
                            save: jest.fn(),
                            create: jest.fn((x: unknown) => x),
                        };
                    }
                    // Wallet repo  ensureDefaultWallet uses findOneBy, the debit/credit lock uses findOne.
                    return {
                        findOneBy: jest
                            .fn()
                            .mockImplementation(
                                ({ userId }: { userId: string }) =>
                                    Promise.resolve(
                                        userId === agentWallet.userId
                                            ? agentWallet
                                            : userWallet,
                                    ),
                            ),
                        findOne: jest
                            .fn()
                            .mockImplementation(
                                ({ where }: { where: { userId: string } }) =>
                                    Promise.resolve(
                                        where.userId === agentWallet.userId
                                            ? agentWallet
                                            : userWallet,
                                    ),
                            ),
                        save: jest
                            .fn()
                            .mockImplementation((w: Wallet) =>
                                Promise.resolve(w),
                            ),
                        create: jest.fn().mockImplementation((x: unknown) => x),
                    };
                }),
                query: jest.fn().mockResolvedValue(undefined),
            } as unknown as EntityManager;
        }

        const fundingInput = {
            agentId: 'agent-1',
            targetUserId: 'user-2',
            amountMinor: 1_000,
            entryType: 'deposit' as const,
            sourceType: 'telebirr_receipt',
            sourceId: 'REC1',
            idempotencyKey: 'telebirr:REC1',
        };

        it('debits the agent wallet and credits the target user wallet using the caller-supplied manager (no new transaction)', async () => {
            const { service, mockDataSource, mockLedgerService } = makeService(
                {},
            );
            mockLedgerService.findIdempotencyRecord = jest
                .fn()
                .mockResolvedValue(null);

            const agentWallet = makeWallet({
                id: 'wallet-agent',
                userId: 'agent-1',
                availableMinor: 5_000,
            });
            const userWallet = makeWallet({
                id: 'wallet-user',
                userId: 'user-2',
                availableMinor: 0,
            });
            const manager = makeSessionManager(agentWallet, userWallet);

            const result = await service.fundUserCreditFromAgent(
                fundingInput,
                manager,
            );

            expect(mockDataSource.transaction).not.toHaveBeenCalled();
            expect(result.wallet).toBeDefined();
            expect(mockLedgerService.createEntry).toHaveBeenCalledTimes(2);
            // Debit side is a distinct sourceType so it's traceable separately from the credit.
            expect(mockLedgerService.createEntry).toHaveBeenCalledWith(
                expect.objectContaining({
                    userId: 'agent-1',
                    direction: 'debit',
                    sourceType: 'agent_deposit_funding',
                }),
                expect.anything(),
            );
            expect(mockLedgerService.createEntry).toHaveBeenCalledWith(
                expect.objectContaining({
                    userId: 'user-2',
                    direction: 'credit',
                    sourceType: 'telebirr_receipt',
                }),
                expect.anything(),
            );
        });

        it('throws ConflictException (and never credits the user) when the agent wallet balance is insufficient', async () => {
            const { service, mockLedgerService } = makeService({});
            mockLedgerService.findIdempotencyRecord = jest
                .fn()
                .mockResolvedValue(null);

            const agentWallet = makeWallet({
                id: 'wallet-agent',
                userId: 'agent-1',
                availableMinor: 100,
            });
            const userWallet = makeWallet({
                id: 'wallet-user',
                userId: 'user-2',
                availableMinor: 0,
            });
            const manager = makeSessionManager(agentWallet, userWallet);

            await expect(
                service.fundUserCreditFromAgent(fundingInput, manager),
            ).rejects.toBeInstanceOf(ConflictException);
            expect(mockLedgerService.createEntry).not.toHaveBeenCalled();
        });
    });
});

// ─── getLeaderboard / getRecentPlatformWins  admin-gated, bots excluded ──────
// Self-contained mocks (not the shared makeService above): these two methods
// only ever touch systemConfigRepository + a raw LedgerEntry QueryBuilder, not
// any of the wallet/wagerLimit/withdrawal repos or ledgerService.

function makeQueryBuilder(rawRows: unknown[]) {
    const qb: Record<string, jest.Mock> = {};
    for (const method of [
        'innerJoin',
        'select',
        'addSelect',
        'where',
        'andWhere',
        'groupBy',
        'addGroupBy',
        'orderBy',
        'limit',
    ]) {
        qb[method] = jest.fn().mockReturnValue(qb);
    }
    qb.getRawMany = jest.fn().mockResolvedValue(rawRows);
    return qb;
}

function makeLeaderboardService(input: {
    config?: { leaderboardEnabled?: boolean; recentWinsEnabled?: boolean } | null;
    rawRows?: unknown[];
}) {
    const qb = makeQueryBuilder(input.rawRows ?? []);
    const mockDataSource = {
        getRepository: jest.fn().mockReturnValue({
            createQueryBuilder: jest.fn().mockReturnValue(qb),
        }),
    } as unknown as DataSource;

    const systemConfigRepository = {
        findOneBy: jest.fn().mockResolvedValue(input.config ?? null),
    };

    const service = new WalletService(
        mockDataSource,
        {} as any,
        {} as any,
        {} as any,
        systemConfigRepository as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
    );

    return { service, mockDataSource, qb };
}

describe('WalletService.getLeaderboard', () => {
    it('returns disabled with no entries and never queries the DB when the flag is off', async () => {
        const { service, mockDataSource } = makeLeaderboardService({
            config: { leaderboardEnabled: false },
        });

        const result = await service.getLeaderboard({ limit: 10 });

        expect(result).toEqual({ enabled: false, entries: [] });
        expect(mockDataSource.getRepository).not.toHaveBeenCalled();
    });

    it('returns disabled with no entries when no config row exists', async () => {
        const { service } = makeLeaderboardService({ config: null });

        const result = await service.getLeaderboard({ limit: 10 });

        expect(result).toEqual({ enabled: false, entries: [] });
    });

    it('excludes bot accounts via the real-players-only filter when enabled', async () => {
        const { service, qb } = makeLeaderboardService({
            config: { leaderboardEnabled: true },
            rawRows: [
                { displayName: 'Abebe', totalWinMinor: '5000', winCount: '3' },
            ],
        });

        const result = await service.getLeaderboard({ limit: 10 });

        expect(result.enabled).toBe(true);
        expect(result.entries).toEqual([
            { rank: 1, displayName: 'Abebe', totalWinMinor: 5000, winCount: 3 },
        ]);
        expect(qb.andWhere).toHaveBeenCalledWith(
            expect.stringContaining("botPolicy"),
        );
    });
});

describe('WalletService.getRecentPlatformWins', () => {
    it('returns disabled with no wins and never queries the DB when the flag is off', async () => {
        const { service, mockDataSource } = makeLeaderboardService({
            config: { recentWinsEnabled: false },
        });

        const result = await service.getRecentPlatformWins(20);

        expect(result).toEqual({ enabled: false, wins: [] });
        expect(mockDataSource.getRepository).not.toHaveBeenCalled();
    });

    it('excludes bot accounts via the real-players-only filter when enabled', async () => {
        const { service, qb } = makeLeaderboardService({
            config: { recentWinsEnabled: true },
            rawRows: [
                {
                    displayName: 'Kebede',
                    amountMinor: '1200',
                    sourceType: 'bingo_win',
                    createdAt: new Date('2026-08-07T00:00:00Z'),
                },
            ],
        });

        const result = await service.getRecentPlatformWins(20);

        expect(result.enabled).toBe(true);
        expect(result.wins).toEqual([
            {
                displayName: 'Kebede',
                amountMinor: 1200,
                game: 'Bingo',
                timestamp: '2026-08-07T00:00:00.000Z',
            },
        ]);
        expect(qb.andWhere).toHaveBeenCalledWith(
            expect.stringContaining("botPolicy"),
        );
    });
});
