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
            const wagerLimitRepo = {
                findOneBy: jest.fn().mockResolvedValue(null),
                create: jest.fn().mockImplementation((dto: any) => dto),
                save: jest
                    .fn()
                    .mockImplementation((w: any) => Promise.resolve(w)),
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
