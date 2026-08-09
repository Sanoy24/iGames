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
