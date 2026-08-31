import { WalletService } from './wallet.service';
import { Wallet } from './entities/wallet.entity';
import { WagerLimit } from './entities/wager-limit.entity';
import { SystemConfig } from '../admin/entities/system-config.entity';

/**
 * Deposit cashback: when a STAKE debit (a bet/ticket purchase) leaves a
 * player's wallet at exactly 0, credit back `depositCashbackPct`% of their
 * most recent Telebirr/M-Pesa deposit  once per deposit, ever. See
 * WalletService.maybeTriggerDepositCashback for the full rule and why it is
 * deliberately scoped to stake debits only (never withdrawals/adjustments,
 * which would let a player collect cashback just for cashing out).
 *
 * Split into two layers, matching the two places the logic actually lives:
 *  - The GATE inside mutateWalletInSession, which decides WHETHER to even look
 *    at cashback (only entryType='stake' debits landing at exactly 0).
 *  - maybeTriggerDepositCashback itself, which decides HOW MUCH (config,
 *    bot exclusion, deposit lookup, rounding) and pays it.
 */
describe('WalletService  deposit cashback', () => {
    function makeService() {
        const mockDataSource = { transaction: jest.fn() };
        const mockWalletRepo = {};
        const mockWagerLimitRepo = {};
        const mockWithdrawalRepo = {};
        const mockSystemConfigRepo = {};
        const mockWithdrawalFeeRangeRepo = {};
        const mockLedgerService = {
            findIdempotencyRecord: jest.fn().mockResolvedValue(null),
            createPendingIdempotencyRecord: jest
                .fn()
                .mockResolvedValue({ id: 'idem-1' }),
            createEntry: jest
                .fn()
                .mockImplementation((input: Record<string, unknown>) =>
                    Promise.resolve({
                        id: `ledger-${Math.random()}`,
                        walletId: 'wallet-1',
                        ...input,
                    }),
                ),
            completeIdempotencyRecord: jest.fn().mockResolvedValue(undefined),
            assertIdempotentRequestMatches: jest.fn(),
        };
        const mockGameEventsGateway = { emitWalletUpdated: jest.fn() };
        const mockNotificationsService = { safeCreate: jest.fn() };

        const service = new WalletService(
            mockDataSource as any,
            mockWalletRepo as any,
            mockWagerLimitRepo as any,
            mockWithdrawalRepo as any,
            mockSystemConfigRepo as any,
            mockWithdrawalFeeRangeRepo as any,
            mockLedgerService as any,
            mockGameEventsGateway as any,
            mockNotificationsService as any,
        );
        return {
            service,
            mockDataSource,
            mockLedgerService,
            mockGameEventsGateway,
        };
    }

    // ── The gate inside mutateWalletInSession ────────────────────────────────
    // Exercises the real debit path (debitInSession, not a mock) so the wiring
    // itself is under test, not just the decision logic in isolation.
    describe('the trigger gate (only a stake debit landing at exactly 0)', () => {
        function makeManager(walletAvailableMinor: number) {
            const wallet = {
                id: 'wallet-1',
                userId: 'user-1',
                currencyCode: 'CREDIT',
                availableMinor: walletAvailableMinor,
                reservedMinor: 0,
                status: 'active',
            };
            const walletRepo = {
                findOne: jest.fn().mockResolvedValue(wallet),
                save: jest
                    .fn()
                    .mockImplementation((w: any) => Promise.resolve(w)),
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
        { notifyWithdrawalRequested: jest.fn() } as any,
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
        { notifyWithdrawalRequested: jest.fn() } as any,
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
            const manager = {
                getRepository: jest.fn().mockImplementation((entity: any) => {
                    if (entity === Wallet) return walletRepo;
                    if (entity === WagerLimit) return wagerLimitRepo;
                    throw new Error(`Unexpected getRepository(${entity})`);
                }),
                query: jest.fn().mockResolvedValue(undefined),
            };
            return { manager, wallet };
        }

        it('fires for a STAKE debit that leaves the balance at exactly 0', async () => {
            const { service } = makeService();
            const { manager } = makeManager(50);
            const trigger = jest
                .spyOn(service as any, 'maybeTriggerDepositCashback')
                .mockResolvedValue(undefined);

            await service.debitInSession(
                {
                    userId: 'user-1',
                    amountMinor: 50, // exactly wipes the balance
                    entryType: 'stake',
                    sourceType: 'bingo_ticket',
                    sourceId: 'room-1',
                    idempotencyKey: 'stake-1',
                },
                manager as any,
            );

            expect(trigger).toHaveBeenCalledWith('user-1', manager);
        });

        it('does not fire for a STAKE debit that leaves money in the wallet', async () => {
            const { service } = makeService();
            const { manager } = makeManager(100);
            const trigger = jest
                .spyOn(service as any, 'maybeTriggerDepositCashback')
                .mockResolvedValue(undefined);

            await service.debitInSession(
                {
                    userId: 'user-1',
                    amountMinor: 50, // 50 left over
                    entryType: 'stake',
                    sourceType: 'bingo_ticket',
                    sourceId: 'room-1',
                    idempotencyKey: 'stake-2',
                },
                manager as any,
            );

            expect(trigger).not.toHaveBeenCalled();
        });

        // THE anti-exploit guard. A withdrawal debit reaching exactly 0 is the
        // player cashing OUT, not losing while playing - if this fired here too,
        // depositing 100 and immediately withdrawing all 100 would be a free 10%.
        it('does NOT fire for a WITHDRAWAL debit, even one that lands at exactly 0', async () => {
            const { service } = makeService();
            const { manager } = makeManager(100);
            const trigger = jest
                .spyOn(service as any, 'maybeTriggerDepositCashback')
                .mockResolvedValue(undefined);

            await service.debitInSession(
                {
                    userId: 'user-1',
                    amountMinor: 100,
                    entryType: 'withdrawal',
                    sourceType: 'withdrawal',
                    sourceId: 'wd-1',
                    idempotencyKey: 'wd-1',
                },
                manager as any,
            );

            expect(trigger).not.toHaveBeenCalled();
        });

        // Same guard for an admin manual debit adjustment.
        it('does NOT fire for an admin adjustment debit landing at exactly 0', async () => {
            const { service } = makeService();
            const { manager } = makeManager(100);
            const trigger = jest
                .spyOn(service as any, 'maybeTriggerDepositCashback')
                .mockResolvedValue(undefined);

            await service.debitInSession(
                {
                    userId: 'user-1',
                    amountMinor: 100,
                    entryType: 'adjustment',
                    sourceType: 'admin_adjustment',
                    sourceId: 'adj-1',
                    idempotencyKey: 'adj-1',
                },
                manager as any,
            );

            expect(trigger).not.toHaveBeenCalled();
        });

        it('does not fire for a CREDIT (win) even when it happens to land the wallet on 0', async () => {
            const { service } = makeService();
            // A win crediting into a wallet that nets to 0 can't happen with a
            // positive amount, but direction alone must gate it regardless -
            // credits never reach this branch at all.
            const { manager } = makeManager(0);
            const trigger = jest
                .spyOn(service as any, 'maybeTriggerDepositCashback')
                .mockResolvedValue(undefined);

            await service.creditInSession(
                {
                    userId: 'user-1',
                    amountMinor: 10,
                    entryType: 'stake', // even mislabeled, direction is credit
                    sourceType: 'refund',
                    sourceId: 'r-1',
                    idempotencyKey: 'credit-1',
                },
                manager as any,
            );

            expect(trigger).not.toHaveBeenCalled();
        });
    });

    // ── The decision logic itself ────────────────────────────────────────────
    describe('maybeTriggerDepositCashback', () => {
        const CFG_ON = {
            depositCashbackEnabled: true,
            depositCashbackPct: 10,
            masterWalletUserId: 'master-1',
        };

        function makeManager(opts: {
            config?: Record<string, unknown> | null;
            isBot?: boolean;
            deposit?: {
                provider: 'telebirr' | 'mpesa';
                depositId: string;
                amountMinor: number;
            } | null;
        }) {
            const configRepo = {
                findOneBy: jest
                    .fn()
                    .mockResolvedValue(opts.config ?? CFG_ON),
            };
            const query = jest.fn().mockImplementation((sql: string) => {
                if (sql.includes('isBot')) {
                    return Promise.resolve([
                        { isBot: opts.isBot ? 1 : 0 },
                    ]);
                }
                if (sql.includes('latest_deposit')) {
                    return Promise.resolve(
                        opts.deposit ? [opts.deposit] : [],
                    );
                }
                throw new Error(`Unexpected query: ${sql}`);
            });
            const manager = {
                getRepository: jest.fn().mockImplementation((entity: any) => {
                    if (entity === SystemConfig) return configRepo;
                    throw new Error(`Unexpected getRepository(${entity})`);
                }),
                query,
            };
            return manager;
        }

        it('pays 10% of a 100 ETB deposit as 10, funded from the Master Wallet, keyed to that deposit', async () => {
            const { service } = makeService();
            const manager = makeManager({
                deposit: {
                    provider: 'telebirr',
                    depositId: 'RCPT-1',
                    amountMinor: 100,
                },
            });
            const debitSpy = jest
                .spyOn(service, 'debitInSession')
                .mockResolvedValue({} as any);
            const creditSpy = jest
                .spyOn(service, 'creditInSession')
                .mockResolvedValue({} as any);

            await (service as any).maybeTriggerDepositCashback(
                'user-1',
                manager,
            );

            expect(debitSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    userId: 'master-1',
                    amountMinor: 10,
                    entryType: 'adjustment',
                    sourceType: 'deposit_cashback_funding',
                    idempotencyKey: 'deposit-cashback:telebirr:RCPT-1:debit',
                }),
                manager,
            );
            expect(creditSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    userId: 'user-1',
                    amountMinor: 10,
                    entryType: 'bonus',
                    sourceType: 'deposit_cashback',
                    idempotencyKey: 'deposit-cashback:telebirr:RCPT-1:credit',
                }),
                manager,
            );
        });

        // 33 x 10% = 3.3 -> rounds to 3, per the admin's chosen rounding rule
        // (round to nearest birr).
        it('rounds the cashback amount to the nearest whole birr', async () => {
            const { service } = makeService();
            const manager = makeManager({
                deposit: {
                    provider: 'mpesa',
                    depositId: 'MP-1',
                    amountMinor: 33,
                },
            });
            const creditSpy = jest
                .spyOn(service, 'creditInSession')
                .mockResolvedValue({} as any);
            jest.spyOn(service, 'debitInSession').mockResolvedValue(
                {} as any,
            );

            await (service as any).maybeTriggerDepositCashback(
                'user-1',
                manager,
            );

            expect(creditSpy).toHaveBeenCalledWith(
                expect.objectContaining({ amountMinor: 3 }),
                manager,
            );
        });

        it('rounds 5+ up, not just truncates', async () => {
            const { service } = makeService();
            // 35 x 10% = 3.5 -> rounds to 4.
            const manager = makeManager({
                deposit: {
                    provider: 'mpesa',
                    depositId: 'MP-2',
                    amountMinor: 35,
                },
            });
            const creditSpy = jest
                .spyOn(service, 'creditInSession')
                .mockResolvedValue({} as any);
            jest.spyOn(service, 'debitInSession').mockResolvedValue(
                {} as any,
            );

            await (service as any).maybeTriggerDepositCashback(
                'user-1',
                manager,
            );

            expect(creditSpy).toHaveBeenCalledWith(
                expect.objectContaining({ amountMinor: 4 }),
                manager,
            );
        });

        it('does nothing when the feature is disabled, without even querying for a deposit', async () => {
            const { service } = makeService();
            const manager = makeManager({
                config: { ...CFG_ON, depositCashbackEnabled: false },
                deposit: { provider: 'telebirr', depositId: 'X', amountMinor: 100 },
            });
            const debitSpy = jest.spyOn(service, 'debitInSession');
            const creditSpy = jest.spyOn(service, 'creditInSession');

            await (service as any).maybeTriggerDepositCashback(
                'user-1',
                manager,
            );

            expect(debitSpy).not.toHaveBeenCalled();
            expect(creditSpy).not.toHaveBeenCalled();
            expect(manager.query).not.toHaveBeenCalled();
        });

        it('does nothing when the percentage is 0, even if the toggle is on', async () => {
            const { service } = makeService();
            const manager = makeManager({
                config: { ...CFG_ON, depositCashbackPct: 0 },
                deposit: { provider: 'telebirr', depositId: 'X', amountMinor: 100 },
            });
            const creditSpy = jest.spyOn(service, 'creditInSession');

            await (service as any).maybeTriggerDepositCashback(
                'user-1',
                manager,
            );

            expect(creditSpy).not.toHaveBeenCalled();
        });

        it('does nothing when the Master Wallet has not been resolved yet, rather than trying to create one here', async () => {
            const { service } = makeService();
            const manager = makeManager({
                config: { ...CFG_ON, masterWalletUserId: null },
                deposit: { provider: 'telebirr', depositId: 'X', amountMinor: 100 },
            });
            const creditSpy = jest.spyOn(service, 'creditInSession');

            await (service as any).maybeTriggerDepositCashback(
                'user-1',
                manager,
            );

            expect(creditSpy).not.toHaveBeenCalled();
        });

        // Bots never receive cashback - matches every other bonus mechanism in
        // this codebase (welcome bonus, referral commission).
        it('excludes bot accounts', async () => {
            const { service } = makeService();
            const manager = makeManager({
                isBot: true,
                deposit: { provider: 'telebirr', depositId: 'X', amountMinor: 100 },
            });
            const creditSpy = jest.spyOn(service, 'creditInSession');

            await (service as any).maybeTriggerDepositCashback(
                'user-1',
                manager,
            );

            expect(creditSpy).not.toHaveBeenCalled();
        });

        it('does nothing when the player has never made a Telebirr/M-Pesa deposit', async () => {
            const { service } = makeService();
            const manager = makeManager({ deposit: null });
            const creditSpy = jest.spyOn(service, 'creditInSession');

            await (service as any).maybeTriggerDepositCashback(
                'user-1',
                manager,
            );

            expect(creditSpy).not.toHaveBeenCalled();
        });

        // The deposit lookup deliberately excludes admin_topup /
        // admin_to_agent_transfer / agent_to_user_transfer - only the two
        // provider-receipt tables are ever queried, so an admin/agent-issued
        // credit can never itself fund a cashback payout.
        it('only ever looks at telebirr_deposits and mpesa_deposits, never other credit sources', async () => {
            const { service } = makeService();
            const manager = makeManager({
                deposit: {
                    provider: 'telebirr',
                    depositId: 'RCPT-1',
                    amountMinor: 100,
                },
            });
            jest.spyOn(service, 'debitInSession').mockResolvedValue(
                {} as any,
            );
            jest.spyOn(service, 'creditInSession').mockResolvedValue(
                {} as any,
            );

            await (service as any).maybeTriggerDepositCashback(
                'user-1',
                manager,
            );

            const depositQuery = manager.query.mock.calls.find((c: any[]) =>
                c[0].includes('latest_deposit'),
            );
            expect(depositQuery[0]).toContain('telebirr_deposits');
            expect(depositQuery[0]).toContain('mpesa_deposits');
            expect(depositQuery[0]).toContain("status = 'credited'");
            expect(depositQuery[0]).not.toContain('admin_topup');
            // Both branches are scoped to the SAME userId being evaluated.
            expect(depositQuery[1]).toEqual(['user-1', 'user-1']);
        });

        it('never lets a cashback failure escape - errors are caught, not rethrown', async () => {
            const { service } = makeService();
            const manager = makeManager({
                deposit: {
                    provider: 'telebirr',
                    depositId: 'RCPT-1',
                    amountMinor: 100,
                },
            });
            jest.spyOn(service, 'debitInSession').mockRejectedValue(
                new Error('Master Wallet is short'),
            );

            await expect(
                (service as any).maybeTriggerDepositCashback(
                    'user-1',
                    manager,
                ),
            ).resolves.toBeUndefined();
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
        { notifyWithdrawalRequested: jest.fn() } as any,
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

// ─── getAgentFloatRemaining  admin float delta, not raw wallet balance ──────
// Self-contained mocks: only walletRepository.find (for getAvailableBalances)
// and a LedgerEntry QueryBuilder are touched.

function makeFloatRemainingService(input: {
    wallets?: Array<{ userId: string; availableMinor: number }>;
    rawRows?: unknown[];
}) {
    const qb = makeQueryBuilder(input.rawRows ?? []);
    const mockDataSource = {
        getRepository: jest.fn().mockReturnValue({
            createQueryBuilder: jest.fn().mockReturnValue(qb),
        }),
    } as unknown as DataSource;

    const walletRepository = {
        find: jest.fn().mockResolvedValue(
            (input.wallets ?? []).map((w) =>
                makeWallet({ userId: w.userId, availableMinor: w.availableMinor }),
            ),
        ),
    };

    const service = new WalletService(
        mockDataSource,
        walletRepository as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        { notifyWithdrawalRequested: jest.fn() } as any,
    );

    return { service, qb, walletRepository };
}

describe('WalletService.getAgentFloatRemaining', () => {
    it('returns an empty map for no agent ids without querying anything', async () => {
        const { service, walletRepository } = makeFloatRemainingService({});
        expect(await service.getAgentFloatRemaining([])).toEqual(new Map());
        expect(walletRepository.find).not.toHaveBeenCalled();
    });

    it('excludes an agent whose wallet balance comes only from commission/receipt credits, not admin transfers', async () => {
        // Regression for the "agent shows in the deposit list despite never being
        // funded" bug: this agent's wallet is 5,000 purely from referral
        // commission (bingo_referral_commission)  no admin_to_agent_transfer row
        // exists at all, so float remaining must be 0 even though the raw wallet
        // balance is positive.
        const { service } = makeFloatRemainingService({
            wallets: [{ userId: 'agent-1', availableMinor: 5_000 }],
            rawRows: [],
        });

        const result = await service.getAgentFloatRemaining(['agent-1']);

        expect(result.get('agent-1')).toBe(0);
    });

    it('returns the admin-funded amount minus what has already been spent funding deposits', async () => {
        const { service } = makeFloatRemainingService({
            wallets: [{ userId: 'agent-1', availableMinor: 10_000 }],
            rawRows: [
                {
                    userId: 'agent-1',
                    sourceType: 'admin_to_agent_transfer',
                    direction: 'credit',
                    total: '8000',
                },
                {
                    userId: 'agent-1',
                    sourceType: 'agent_deposit_funding',
                    direction: 'debit',
                    total: '3000',
                },
            ],
        });

        const result = await service.getAgentFloatRemaining(['agent-1']);

        expect(result.get('agent-1')).toBe(5_000);
    });

    it('caps the float delta at the wallet actual balance', async () => {
        // The agent was funded 8,000 and has only spent 1,000 on deposits (delta
        // = 7,000 by the ledger math), but separately drained their own wallet via
        // an unrelated debit (e.g. transferAgentToUser) down to 2,000. They can
        // only ever hand out what they still hold.
        const { service } = makeFloatRemainingService({
            wallets: [{ userId: 'agent-1', availableMinor: 2_000 }],
            rawRows: [
                {
                    userId: 'agent-1',
                    sourceType: 'admin_to_agent_transfer',
                    direction: 'credit',
                    total: '8000',
                },
                {
                    userId: 'agent-1',
                    sourceType: 'agent_deposit_funding',
                    direction: 'debit',
                    total: '1000',
                },
            ],
        });

        const result = await service.getAgentFloatRemaining(['agent-1']);

        expect(result.get('agent-1')).toBe(2_000);
    });

    it('treats an agent absent from both the wallet and ledger rows as zero', async () => {
        const { service } = makeFloatRemainingService({
            wallets: [],
            rawRows: [],
        });

        const result = await service.getAgentFloatRemaining(['agent-1']);

        expect(result.get('agent-1')).toBe(0);
    });
});

// ─── Agent withdrawal routing (agentWithdrawalRoutingEnabled) ────────────────
// getAvailableWithdrawals/claimWithdrawal/getWithdrawalsByUsersAgent only ever
// touch systemConfigRepository + a withdrawalRepository query builder.

function makeWithdrawalQueryBuilder(overrides: {
    getMany?: unknown[];
    getOne?: unknown | null;
} = {}) {
    const qb: Record<string, jest.Mock> = {};
    for (const method of ['leftJoinAndSelect', 'where', 'andWhere', 'orderBy']) {
        qb[method] = jest.fn().mockReturnValue(qb);
    }
    qb.getMany = jest.fn().mockResolvedValue(overrides.getMany ?? []);
    qb.getOne = jest.fn().mockResolvedValue(overrides.getOne ?? null);
    return qb;
}

function makeRoutingService(input: {
    config?: { agentWithdrawalRoutingEnabled?: boolean } | null;
    qb?: ReturnType<typeof makeWithdrawalQueryBuilder>;
}) {
    const qb = input.qb ?? makeWithdrawalQueryBuilder();
    const withdrawalRepository = {
        createQueryBuilder: jest.fn().mockReturnValue(qb),
        save: jest.fn().mockImplementation(async (v: unknown) => v),
    };
    const systemConfigRepository = {
        findOneBy: jest.fn().mockResolvedValue(input.config ?? null),
    };
    const agentActionLogRepo = {
        create: jest.fn().mockImplementation((v: unknown) => v),
        save: jest.fn().mockResolvedValue(undefined),
    };
    const mockDataSource = {
        getRepository: jest.fn().mockReturnValue(agentActionLogRepo),
    } as unknown as DataSource;

    const service = new WalletService(
        mockDataSource,
        {} as any, // walletRepository
        {} as any, // wagerLimitRepository
        withdrawalRepository as any,
        systemConfigRepository as any,
        {} as any, // withdrawalFeeRangeRepository
        {} as any, // ledgerService
        {} as any, // gameEventsGateway
        {} as any, // notificationsService
        { notifyWithdrawalRequested: jest.fn() } as any, // adminNotificationBotService
    );

    return { service, qb, withdrawalRepository, systemConfigRepository };
}

describe('WalletService.getAvailableWithdrawals', () => {
    it('returns nothing and never queries when routing is off', async () => {
        const { service, withdrawalRepository } = makeRoutingService({
            config: { agentWithdrawalRoutingEnabled: false },
        });

        expect(await service.getAvailableWithdrawals('agent-1')).toEqual([]);
        expect(withdrawalRepository.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('returns nothing and never queries when no config row exists', async () => {
        const { service, withdrawalRepository } = makeRoutingService({
            config: null,
        });

        expect(await service.getAvailableWithdrawals('agent-1')).toEqual([]);
        expect(withdrawalRepository.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('filters pending withdrawals by the REQUESTING player\'s attributed agent when routing is on', async () => {
        const rows = [{ id: 'w-1' }];
        const qb = makeWithdrawalQueryBuilder({ getMany: rows });
        const { service } = makeRoutingService({
            config: { agentWithdrawalRoutingEnabled: true },
            qb,
        });

        const result = await service.getAvailableWithdrawals('agent-1');

        expect(result).toBe(rows);
        expect(qb.andWhere).toHaveBeenCalledWith(
            'COALESCE(user.referredByAgentId, user.assignedAgentId) = :agentId',
            { agentId: 'agent-1' },
        );
    });
});

describe('WalletService.claimWithdrawal  server-side routing enforcement', () => {
    function makeWithdrawal(overrides: Record<string, unknown> = {}) {
        return {
            id: 'w-1',
            status: 'pending',
            userId: 'player-1',
            amountMinor: 500,
            destinationAccount: '0912345678',
            user: { id: 'player-1', referredByAgentId: null, assignedAgentId: null },
            ...overrides,
        };
    }

    it('throws and never queries the withdrawal when routing is off', async () => {
        const { service, withdrawalRepository } = makeRoutingService({
            config: { agentWithdrawalRoutingEnabled: false },
        });

        await expect(
            service.claimWithdrawal('w-1', 'agent-1'),
        ).rejects.toBeInstanceOf(ConflictException);
        expect(withdrawalRepository.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('throws when the withdrawal is not pending / not found', async () => {
        const qb = makeWithdrawalQueryBuilder({ getOne: null });
        const { service } = makeRoutingService({
            config: { agentWithdrawalRoutingEnabled: true },
            qb,
        });

        await expect(
            service.claimWithdrawal('w-1', 'agent-1'),
        ).rejects.toBeInstanceOf(ConflictException);
    });

    it("rejects a claim when the withdrawal belongs to a DIFFERENT agent's user", async () => {
        const qb = makeWithdrawalQueryBuilder({
            getOne: makeWithdrawal({
                user: {
                    id: 'player-1',
                    referredByAgentId: 'agent-2',
                    assignedAgentId: null,
                },
            }),
        });
        const { service, withdrawalRepository } = makeRoutingService({
            config: { agentWithdrawalRoutingEnabled: true },
            qb,
        });

        await expect(
            service.claimWithdrawal('w-1', 'agent-1'),
        ).rejects.toBeInstanceOf(ConflictException);
        expect(withdrawalRepository.save).not.toHaveBeenCalled();
    });

    it('rejects a claim when the withdrawal belongs to a player with NO agent at all', async () => {
        const qb = makeWithdrawalQueryBuilder({
            getOne: makeWithdrawal({
                user: { id: 'player-1', referredByAgentId: null, assignedAgentId: null },
            }),
        });
        const { service, withdrawalRepository } = makeRoutingService({
            config: { agentWithdrawalRoutingEnabled: true },
            qb,
        });

        await expect(
            service.claimWithdrawal('w-1', 'agent-1'),
        ).rejects.toBeInstanceOf(ConflictException);
        expect(withdrawalRepository.save).not.toHaveBeenCalled();
    });

    it('allows the claim when referredByAgentId matches this agent', async () => {
        const qb = makeWithdrawalQueryBuilder({
            getOne: makeWithdrawal({
                user: {
                    id: 'player-1',
                    referredByAgentId: 'agent-1',
                    assignedAgentId: null,
                },
            }),
        });
        const { service, withdrawalRepository } = makeRoutingService({
            config: { agentWithdrawalRoutingEnabled: true },
            qb,
        });

        const result = await service.claimWithdrawal('w-1', 'agent-1');

        expect(result.status).toBe('claimed');
        expect(result.agentId).toBe('agent-1');
        expect(withdrawalRepository.save).toHaveBeenCalled();
    });

    it('falls back to assignedAgentId when referredByAgentId is null and it matches this agent', async () => {
        const qb = makeWithdrawalQueryBuilder({
            getOne: makeWithdrawal({
                user: {
                    id: 'player-1',
                    referredByAgentId: null,
                    assignedAgentId: 'agent-1',
                },
            }),
        });
        const { service, withdrawalRepository } = makeRoutingService({
            config: { agentWithdrawalRoutingEnabled: true },
            qb,
        });

        const result = await service.claimWithdrawal('w-1', 'agent-1');

        expect(result.status).toBe('claimed');
        expect(withdrawalRepository.save).toHaveBeenCalled();
    });
});

describe('WalletService.getWithdrawalsByUsersAgent', () => {
    it("queries ALL statuses filtered by the requesting player's attributed agent", async () => {
        const rows = [{ id: 'w-1' }, { id: 'w-2' }];
        const qb = makeWithdrawalQueryBuilder({ getMany: rows });
        const { service } = makeRoutingService({ qb });

        const result = await service.getWithdrawalsByUsersAgent('agent-1');

        expect(result).toBe(rows);
        expect(qb.where).toHaveBeenCalledWith(
            'COALESCE(user.referredByAgentId, user.assignedAgentId) = :agentId',
            { agentId: 'agent-1' },
        );
        // Unlike getAvailableWithdrawals, this must NOT restrict by status  it's
        // meant to show admin every request from this agent's users, any state.
        expect(qb.andWhere).not.toHaveBeenCalled();
    });
});
