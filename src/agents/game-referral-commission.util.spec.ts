import { settleGameReferralCommission } from './game-referral-commission.util';

function makeDataSource(queryResults: unknown[][]) {
    const query = jest.fn();
    for (const result of queryResults) {
        query.mockResolvedValueOnce(result);
    }
    // Any query beyond the ones seeded above (e.g. the error-log INSERT on a
    // path that shouldn't fail) resolves harmlessly instead of throwing.
    query.mockResolvedValue([]);
    const transaction = jest.fn(async (cb: (manager: unknown) => unknown) =>
        cb({}),
    );
    return { query, transaction } as any;
}

function makeWalletService() {
    return { creditInSession: jest.fn().mockResolvedValue(undefined) } as any;
}

function makeLogger() {
    return { log: jest.fn(), error: jest.fn() };
}

describe('settleGameReferralCommission', () => {
    it('does nothing when there are no agent-stake rows', async () => {
        const dataSource = makeDataSource([]);
        const walletService = makeWalletService();
        await settleGameReferralCommission({
            dataSource,
            walletService,
            game: 'keno',
            referenceId: 'draw-1',
            agentStakes: [],
            houseEdgePct: null,
            sourceType: 'keno_referral_commission',
            logger: makeLogger(),
        });
        expect(dataSource.query).not.toHaveBeenCalled();
        expect(walletService.creditInSession).not.toHaveBeenCalled();
    });

    it('credits a flat % of stake when houseEdgePct is null (Keno/Pool/Werk)', async () => {
        const dataSource = makeDataSource([
            // global config row
            [{ referralCommissionPct: 0, referralCommissionPctByGame: null }],
            // agent rows
            [{ id: 'agent-1', referralCommissionPct: null, referralCommissionPctByGame: { keno: 10 } }],
        ]);
        const walletService = makeWalletService();
        await settleGameReferralCommission({
            dataSource,
            walletService,
            game: 'keno',
            referenceId: 'draw-1',
            agentStakes: [{ agentId: 'agent-1', stakedMinor: 1000 }],
            houseEdgePct: null,
            sourceType: 'keno_referral_commission',
            logger: makeLogger(),
        });

        expect(walletService.creditInSession).toHaveBeenCalledTimes(1);
        const [input] = walletService.creditInSession.mock.calls[0];
        expect(input.userId).toBe('agent-1');
        expect(input.amountMinor).toBe(100); // 10% of 1000 stake, no edge multiplier
        expect(input.sourceType).toBe('keno_referral_commission');
        expect(input.idempotencyKey).toBe(
            'keno_referral_commission:draw-1:agent-1',
        );
    });

    it('applies the house-edge multiplier before the commission % when houseEdgePct is set (Bingo/Crash-style)', async () => {
        const dataSource = makeDataSource([
            [{ referralCommissionPct: 0, referralCommissionPctByGame: null }],
            [{ id: 'agent-1', referralCommissionPct: null, referralCommissionPctByGame: { crash: 20 } }],
        ]);
        const walletService = makeWalletService();
        await settleGameReferralCommission({
            dataSource,
            walletService,
            game: 'crash',
            referenceId: 'round-1',
            agentStakes: [{ agentId: 'agent-1', stakedMinor: 10_000 }],
            houseEdgePct: 3,
            sourceType: 'crash_referral_commission',
            logger: makeLogger(),
        });

        // serviceFee = floor(10000 * 3 / 100) = 300; commission = floor(300 * 20 / 100) = 60
        const [input] = walletService.creditInSession.mock.calls[0];
        expect(input.amountMinor).toBe(60);
        expect(input.metadata.baseMinor).toBe(300);
    });

    it('falls back to the global per-game default when the agent has no override', async () => {
        const dataSource = makeDataSource([
            [{ referralCommissionPct: 0, referralCommissionPctByGame: { pool: 8 } }],
            [{ id: 'agent-1', referralCommissionPct: null, referralCommissionPctByGame: null }],
        ]);
        const walletService = makeWalletService();
        await settleGameReferralCommission({
            dataSource,
            walletService,
            game: 'pool',
            referenceId: 'match-1',
            agentStakes: [{ agentId: 'agent-1', stakedMinor: 500 }],
            houseEdgePct: null,
            sourceType: 'pool_referral_commission',
            logger: makeLogger(),
        });

        const [input] = walletService.creditInSession.mock.calls[0];
        expect(input.amountMinor).toBe(40); // 8% of 500
    });

    it('skips crediting an agent whose resolved commission % is 0', async () => {
        const dataSource = makeDataSource([
            [{ referralCommissionPct: 0, referralCommissionPctByGame: null }],
            [{ id: 'agent-1', referralCommissionPct: null, referralCommissionPctByGame: null }],
        ]);
        const walletService = makeWalletService();
        await settleGameReferralCommission({
            dataSource,
            walletService,
            game: 'werk',
            referenceId: 'round-1',
            agentStakes: [{ agentId: 'agent-1', stakedMinor: 500 }],
            houseEdgePct: null,
            sourceType: 'werk_referral_commission',
            logger: makeLogger(),
        });

        expect(walletService.creditInSession).not.toHaveBeenCalled();
    });

    it('never throws when the query layer fails, and logs the error instead', async () => {
        const dataSource = {
            query: jest.fn().mockRejectedValueOnce(new Error('db down')),
            transaction: jest.fn(),
        } as any;
        const walletService = makeWalletService();
        const logger = makeLogger();

        await expect(
            settleGameReferralCommission({
                dataSource,
                walletService,
                game: 'werk',
                referenceId: 'round-1',
                agentStakes: [{ agentId: 'agent-1', stakedMinor: 500 }],
                houseEdgePct: null,
                sourceType: 'werk_referral_commission',
                logger,
            }),
        ).resolves.toBeUndefined();

        expect(logger.error).toHaveBeenCalled();
        expect(walletService.creditInSession).not.toHaveBeenCalled();
    });
});
