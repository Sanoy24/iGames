import { ConflictException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AdminService } from './admin.service';

function makeDashboardService(queryResults: unknown[][]) {
    const query = jest.fn();
    queryResults.forEach((rows) => query.mockResolvedValueOnce(rows));
    const dataSource = { query } as unknown as DataSource;

    const service = new AdminService(
        dataSource,
        {} as any, // systemConfigRepository
        {} as any, // platformStatsRepository
        {} as any, // configChangeLogRepository
        {} as any, // withdrawalFeeRangeRepository
        {} as any, // walletService
        {} as any, // usersService
        {} as any, // agentsService
        {} as any, // gameEventsGateway
        {} as any, // notificationsService
    );

    return { service, query };
}

// Covers only the Master Wallet transfer primitives added so that EVERY credit
// in the system (player deposits, agent commissions, admin adjustments, welcome
// bonus) is funded from the Master Wallet rather than minted independently  the
// rest of AdminService is exercised at the integration level elsewhere.
function makeService(input: {
    masterWalletUserId?: string;
    debitImpl?: jest.Mock;
    creditImpl?: jest.Mock;
}) {
    const masterWalletUserId = input.masterWalletUserId ?? 'master-1';

    const systemConfigRepository = {
        findOneBy: jest
            .fn()
            .mockResolvedValue({
                key: 'global',
                masterWalletUserId,
                welcomeBonusMinor: 0,
            }),
        save: jest.fn().mockImplementation((x: unknown) => Promise.resolve(x)),
        create: jest.fn().mockImplementation((x: unknown) => x),
    };

    const walletService = {
        ensureDefaultWallet: jest.fn().mockResolvedValue(undefined),
        debitInSession:
            input.debitImpl ??
            jest
                .fn()
                .mockResolvedValue({
                    wallet: {},
                    ledgerEntry: { id: 'debit-1' },
                }),
        creditInSession:
            input.creditImpl ??
            jest
                .fn()
                .mockResolvedValue({
                    wallet: {},
                    ledgerEntry: { id: 'credit-1' },
                }),
    };

    const service = new AdminService(
        {} as unknown as DataSource,
        systemConfigRepository as any,
        {} as any, // platformStatsRepository
        {} as any, // configChangeLogRepository
        {} as any, // withdrawalFeeRangeRepository
        walletService as any,
        {} as any, // usersService
        {} as any, // agentsService
        {} as any, // gameEventsGateway
        {} as any, // notificationsService
    );

    return { service, systemConfigRepository, walletService };
}

describe('AdminService  Master Wallet backed crediting', () => {
    const manager = {} as any;

    describe('creditFromMasterWallet', () => {
        it('debits the Master Wallet and credits the target, in that order, within the caller-supplied manager', async () => {
            const order: string[] = [];
            const debitInSession = jest.fn().mockImplementation(() => {
                order.push('debit');
                return Promise.resolve({
                    wallet: {},
                    ledgerEntry: { id: 'd1' },
                });
            });
            const creditInSession = jest.fn().mockImplementation(() => {
                order.push('credit');
                return Promise.resolve({
                    wallet: {},
                    ledgerEntry: { id: 'c1' },
                });
            });
            const { service, walletService } = makeService({
                debitImpl: debitInSession,
                creditImpl: creditInSession,
            });

            await service.creditFromMasterWallet(
                {
                    targetUserId: 'player-1',
                    amountMinor: 1000,
                    entryType: 'deposit',
                    sourceType: 'telebirr_receipt',
                    sourceId: 'REC1',
                    idempotencyKey: 'telebirr:REC1',
                },
                manager,
            );

            expect(order).toEqual(['debit', 'credit']);
            expect(walletService.debitInSession).toHaveBeenCalledWith(
                expect.objectContaining({
                    userId: 'master-1',
                    amountMinor: 1000,
                    entryType: 'adjustment',
                    sourceType: 'master_wallet_funding',
                    idempotencyKey: 'telebirr:REC1:master-debit',
                }),
                manager,
            );
            expect(walletService.creditInSession).toHaveBeenCalledWith(
                expect.objectContaining({
                    userId: 'player-1',
                    amountMinor: 1000,
                    entryType: 'deposit',
                    sourceType: 'telebirr_receipt',
                    idempotencyKey: 'telebirr:REC1',
                }),
                manager,
            );
        });

        it('rejects with a generic message (never mentioning the Master Wallet) and never credits the target when the Master Wallet balance is insufficient', async () => {
            const debitInSession = jest
                .fn()
                .mockRejectedValue(
                    new ConflictException(
                        'Insufficient wallet balance or concurrent update failed',
                    ),
                );
            const creditInSession = jest.fn();
            const { service } = makeService({
                debitImpl: debitInSession,
                creditImpl: creditInSession,
            });

            await expect(
                service.creditFromMasterWallet(
                    {
                        targetUserId: 'player-1',
                        amountMinor: 1_000_000,
                        entryType: 'deposit',
                        sourceType: 'telebirr_receipt',
                        sourceId: 'REC2',
                        idempotencyKey: 'telebirr:REC2',
                    },
                    manager,
                ),
            ).rejects.toThrow(/please try again|contact support/i);

            expect(creditInSession).not.toHaveBeenCalled();
        });
    });

    describe('debitToMasterWallet', () => {
        it('debits the source and returns the amount to the Master Wallet, in that order', async () => {
            const order: string[] = [];
            const debitInSession = jest.fn().mockImplementation(() => {
                order.push('debit');
                return Promise.resolve({
                    wallet: {},
                    ledgerEntry: { id: 'd1' },
                });
            });
            const creditInSession = jest.fn().mockImplementation(() => {
                order.push('credit');
                return Promise.resolve({
                    wallet: {},
                    ledgerEntry: { id: 'c1' },
                });
            });
            const { service, walletService } = makeService({
                debitImpl: debitInSession,
                creditImpl: creditInSession,
            });

            await service.debitToMasterWallet(
                {
                    sourceUserId: 'player-1',
                    amountMinor: 500,
                    entryType: 'bonus',
                    sourceType: 'admin_adjustment',
                    sourceId: 'adj-1',
                    idempotencyKey: 'admin-adj:adj-1',
                },
                manager,
            );

            expect(order).toEqual(['debit', 'credit']);
            expect(walletService.debitInSession).toHaveBeenCalledWith(
                expect.objectContaining({
                    userId: 'player-1',
                    amountMinor: 500,
                    idempotencyKey: 'admin-adj:adj-1',
                }),
                manager,
            );
            expect(walletService.creditInSession).toHaveBeenCalledWith(
                expect.objectContaining({
                    userId: 'master-1',
                    amountMinor: 500,
                    entryType: 'adjustment',
                    sourceType: 'master_wallet_reclaim',
                    idempotencyKey: 'admin-adj:adj-1:master-credit',
                }),
                manager,
            );
        });

        it('propagates an insufficient-balance error from the SOURCE wallet unmodified (not the masked Master Wallet message)', async () => {
            const debitInSession = jest
                .fn()
                .mockRejectedValue(
                    new ConflictException(
                        'Insufficient wallet balance or concurrent update failed',
                    ),
                );
            const { service } = makeService({ debitImpl: debitInSession });

            await expect(
                service.debitToMasterWallet(
                    {
                        sourceUserId: 'player-1',
                        amountMinor: 500,
                        entryType: 'bonus',
                        sourceType: 'admin_adjustment',
                        sourceId: 'adj-2',
                        idempotencyKey: 'admin-adj:adj-2',
                    },
                    manager,
                ),
            ).rejects.toThrow(
                'Insufficient wallet balance or concurrent update failed',
            );
        });
    });
});

describe('AdminService.getGameTransactionsDashboard', () => {
    it('combines ticket wins and the bonus faucet into winSplit.botWinMinor, and maps every section', async () => {
        const { service, query } = makeDashboardService([
            [{ botTicketWin: '500', realTicketWin: '300' }],
            [
                { source: 'bingo_ticket', amountMinor: '500' },
                { source: 'bingo_bot_win_interval', amountMinor: '200' },
            ],
            [{ botTickets: '10', realTickets: '20' }],
            [
                {
                    roomId: 'r1',
                    createdAt: '2026-08-01T00:00:00.000Z',
                    realPlayers: '2',
                    bots: '3',
                },
            ],
            [
                {
                    day: '2026-08-01',
                    realStakeMinor: '1000',
                    realPayoutMinor: '400',
                    botPayoutMinor: '500',
                },
            ],
            [
                {
                    agentId: 'a1',
                    agentName: 'Agent A',
                    realStakeMinor: '1000',
                    realPayoutMinor: '600',
                },
            ],
        ]);

        const result = await service.getGameTransactionsDashboard();

        expect(query).toHaveBeenCalledTimes(6);
        // Bot win = ticket-tied win (500) + the unconditional bonus faucet (200).
        expect(result.winSplit).toEqual({ botWinMinor: 700, realWinMinor: 300 });
        expect(result.botWinBySource).toEqual([
            { source: 'bingo_ticket', amountMinor: 500 },
            { source: 'bingo_bot_win_interval', amountMinor: 200 },
        ]);
        expect(result.ticketSplit).toEqual({ botTickets: 10, realTickets: 20 });
        expect(result.roomParticipationTrend).toEqual([
            { roomId: 'r1', createdAt: '2026-08-01T00:00:00.000Z', realPlayers: 2, bots: 3 },
        ]);
        expect(result.dailyTrend).toEqual([
            { day: '2026-08-01', realStakeMinor: 1000, realPayoutMinor: 400, botPayoutMinor: 500 },
        ]);
        expect(result.revenueByAgent).toEqual([
            {
                agentId: 'a1',
                agentName: 'Agent A',
                realStakeMinor: 1000,
                realPayoutMinor: 600,
                realEmoneyEarnedMinor: 400,
            },
        ]);
    });

    it('does not add a faucet amount to winSplit.botWinMinor when no bonus-faucet row exists', async () => {
        const { service } = makeDashboardService([
            [{ botTicketWin: '500', realTicketWin: '300' }],
            [{ source: 'bingo_ticket', amountMinor: '500' }], // no bingo_bot_win_interval row
            [{ botTickets: '10', realTickets: '20' }],
            [],
            [],
            [],
        ]);

        const result = await service.getGameTransactionsDashboard();

        expect(result.winSplit).toEqual({ botWinMinor: 500, realWinMinor: 300 });
    });

    it('returns empty sections gracefully when there is no data at all', async () => {
        const { service } = makeDashboardService([[], [], [], [], [], []]);

        const result = await service.getGameTransactionsDashboard();

        expect(result.winSplit).toEqual({ botWinMinor: 0, realWinMinor: 0 });
        expect(result.botWinBySource).toEqual([]);
        expect(result.ticketSplit).toEqual({ botTickets: 0, realTickets: 0 });
        expect(result.roomParticipationTrend).toEqual([]);
        expect(result.dailyTrend).toEqual([]);
        expect(result.revenueByAgent).toEqual([]);
    });
});

// ── Transactions (admin-wide money-movement feed) ──────────────────────────

/** Chainable TypeORM QueryBuilder stub. Every method returns `this` except the
 * two terminal calls, which resolve to the canned rows/count supplied. */
function makeQueryBuilderStub(rows: unknown[] = [], total = rows.length) {
    const qb: Record<string, jest.Mock> = {};
    const chain = [
        'leftJoinAndSelect',
        'where',
        'andWhere',
        'orderBy',
        'skip',
        'take',
    ];
    for (const method of chain) {
        qb[method] = jest.fn().mockReturnValue(qb);
    }
    qb.getManyAndCount = jest.fn().mockResolvedValue([rows, total]);
    qb.getMany = jest.fn().mockResolvedValue(rows);
    return qb;
}

function makeTransactionsService(qb: ReturnType<typeof makeQueryBuilderStub>) {
    const dataSource = {
        getRepository: jest.fn().mockReturnValue({
            createQueryBuilder: jest.fn().mockReturnValue(qb),
        }),
    } as unknown as DataSource;

    const service = new AdminService(
        dataSource,
        {} as any, // systemConfigRepository
        {} as any, // platformStatsRepository
        {} as any, // configChangeLogRepository
        {} as any, // withdrawalFeeRangeRepository
        {} as any, // walletService
        {} as any, // usersService
        {} as any, // agentsService
        {} as any, // gameEventsGateway
        {} as any, // notificationsService
    );
    return { service, qb };
}

describe('AdminService.getTransactions  entryType filtering', () => {
    // THE one piece of non-obvious logic here: `entryType IN (:...types)` is
    // invalid SQL for an empty array, so a filter that names only gameplay
    // types (or nothing recognizable at all) must fall back to the full
    // money-movement set - never to an empty list, which TypeORM would throw
    // on and the admin would see as a broken page for an honest typo.
    it('defaults to the full money-movement set when no entryType filter is given', async () => {
        const { service, qb } = makeTransactionsService(makeQueryBuilderStub());

        await service.getTransactions({ page: 1, limit: 50 });

        const [, params] = qb.where.mock.calls[0];
        expect(params.types.sort()).toEqual(
            [
                'deposit',
                'adjustment',
                'bonus',
                'withdrawal',
                'agent_receipt',
                'reversal',
            ].sort(),
        );
    });

    it('falls back to the full set rather than an empty IN() when every requested type is gameplay-only', async () => {
        const { service, qb } = makeTransactionsService(makeQueryBuilderStub());

        await service.getTransactions({
            page: 1,
            limit: 50,
            entryType: 'stake,win,refund',
        });

        const [, params] = qb.where.mock.calls[0];
        expect(params.types.length).toBe(6);
        expect(params.types).not.toContain('stake');
    });

    it('narrows to just the requested types when they are valid money-movement types', async () => {
        const { service, qb } = makeTransactionsService(makeQueryBuilderStub());

        await service.getTransactions({
            page: 1,
            limit: 50,
            entryType: 'deposit,withdrawal',
        });

        const [, params] = qb.where.mock.calls[0];
        expect(params.types.sort()).toEqual(['deposit', 'withdrawal']);
    });

    it('silently drops a gameplay type mixed in with valid ones, rather than rejecting the whole filter', async () => {
        const { service, qb } = makeTransactionsService(makeQueryBuilderStub());

        await service.getTransactions({
            page: 1,
            limit: 50,
            entryType: 'deposit,stake',
        });

        const [, params] = qb.where.mock.calls[0];
        expect(params.types).toEqual(['deposit']);
    });

    it('applies search/sourceType/direction/date filters via andWhere, and paginates', async () => {
        const { service, qb } = makeTransactionsService(makeQueryBuilderStub());

        await service.getTransactions({
            page: 2,
            limit: 25,
            search: 'Yitbarek',
            sourceType: 'admin_to_agent_transfer',
            direction: 'credit',
            dateFrom: '2026-08-01',
            dateTo: '2026-08-31',
        });

        // search, sourceType, direction, dateFrom, dateTo
        expect(qb.andWhere).toHaveBeenCalledTimes(5);
        expect(qb.skip).toHaveBeenCalledWith(25); // (page 2 - 1) * limit 25
        expect(qb.take).toHaveBeenCalledWith(25);
    });

    it('returns the paginated shape the frontend expects', async () => {
        const { service } = makeTransactionsService(
            makeQueryBuilderStub([{ id: 't-1' }], 73),
        );

        const result = await service.getTransactions({ page: 1, limit: 50 });

        expect(result).toEqual({
            data: [{ id: 't-1' }],
            total: 73,
            page: 1,
            limit: 50,
            totalPages: 2,
        });
    });
});

describe('AdminService.exportTransactionsCsv', () => {
    it('produces a header row plus one line per transaction, capped rather than paginated', async () => {
        const rows = [
            {
                createdAt: new Date('2026-08-25T10:00:00.000Z'),
                user: { displayName: 'Yitbarek', phoneNumber: '+251988610289' },
                direction: 'credit',
                entryType: 'deposit',
                sourceType: 'telebirr_receipt',
                amountMinor: 100,
                balanceAfterMinor: 100,
                sourceId: 'RCPT-1',
            },
        ];
        const { service, qb } = makeTransactionsService(
            makeQueryBuilderStub(rows),
        );

        const csv = await service.exportTransactionsCsv({});

        expect(qb.skip).not.toHaveBeenCalled(); // capped, not paginated
        const lines = csv.split('\n');
        expect(lines[0]).toBe(
            'Date,User,Phone,Direction,Type,Source,AmountETB,BalanceAfterETB,SourceId',
        );
        expect(lines[1]).toContain('Yitbarek');
        expect(lines[1]).toContain('telebirr_receipt');
        expect(lines[1]).toContain('RCPT-1');
    });

    // A display name with a comma (or embedded quotes) must not silently
    // corrupt the CSV's column boundaries for every row after it.
    it('quotes and escapes fields containing commas or quotes', async () => {
        const rows = [
            {
                createdAt: new Date('2026-08-25T10:00:00.000Z'),
                user: { displayName: 'Doe, "Jr" John', phoneNumber: '' },
                direction: 'debit',
                entryType: 'withdrawal',
                sourceType: 'withdrawal',
                amountMinor: 50,
                balanceAfterMinor: 0,
                sourceId: 'wd-1',
            },
        ];
        const { service } = makeTransactionsService(makeQueryBuilderStub(rows));

        const csv = await service.exportTransactionsCsv({});

        expect(csv).toContain('"Doe, ""Jr"" John"');
    });
});

describe('AdminService.listAgents  balance/float enrichment', () => {
    it('attaches wallet balance and deposit-float-remaining to every agent, batched not per-row', async () => {
        const agents = [
            { id: 'agent-1', displayName: 'A' },
            { id: 'agent-2', displayName: 'B' },
        ];
        const usersService = {
            listAgents: jest.fn().mockResolvedValue({
                data: agents,
                total: 2,
                page: 1,
                limit: 50,
                totalPages: 1,
            }),
        };
        const walletService = {
            getAvailableBalances: jest
                .fn()
                .mockResolvedValue(
                    new Map([
                        ['agent-1', 98],
                        ['agent-2', 0],
                    ]),
                ),
            getAgentFloatRemaining: jest
                .fn()
                .mockResolvedValue(new Map([['agent-1', 0]])), // agent-2 absent -> 0
        };
        const service = new AdminService(
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            walletService as any,
            usersService as any,
            {} as any,
            {} as any,
            {} as any,
        );

        const result = await service.listAgents(1, 50);

        expect(walletService.getAvailableBalances).toHaveBeenCalledWith([
            'agent-1',
            'agent-2',
        ]);
        expect(walletService.getAgentFloatRemaining).toHaveBeenCalledWith([
            'agent-1',
            'agent-2',
        ]);
        expect(result.data).toEqual([
            {
                id: 'agent-1',
                displayName: 'A',
                walletAvailableMinor: 98,
                depositFloatRemainingMinor: 0,
            },
            {
                id: 'agent-2',
                displayName: 'B',
                walletAvailableMinor: 0,
                depositFloatRemainingMinor: 0,
            },
        ]);
    });
});
