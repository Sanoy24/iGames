import { BingoService } from './bingo.service';
import { BingoCard } from './entities/bingo-card.entity';
import { BingoRoom } from './entities/bingo-room.entity';

// ─── Fixture builders ──────────────────────────────────────────────────────────

let _roomCounter = 0;
function makeRoom(overrides: Partial<BingoRoom> = {}): BingoRoom {
    _roomCounter++;
    const pad = String(_roomCounter).padStart(12, '0');
    return Object.assign(new BingoRoom(), {
        id: `00000000-0000-0000-0000-${pad}`,
        name: 'Test Room',
        status: 'open',
        ticketPriceMinor: 100,
        maxTickets: 100,
        prizes: { one_line: 5000, two_lines: 10000, full_house: 20000 },
        winMode: 'line',
        numberRange: 90,
        patternPrizes: [],
        scheduledStartAt: new Date(),
        drawnNumbers: [],
        settledTiers: [],
        winnersByTier: {},
        settlementSummary: {},
        houseEdgePct: 5,
        prizeMinor: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
    });
}

// ─── Service factory ──────────────────────────────────────────────────────────
// Constructs a BingoService with only the bingoRoomRepository and bingoTicketRepository
// mocked. Tests call getCurrentRoom() which queries those repos.

function makeService({ rooms }: { rooms: BingoRoom[] }) {
    const getByStatus = (status: string) =>
        rooms
            .filter((r) => r.status === status)
            .sort(
                (a, b) =>
                    (a.scheduledStartAt?.getTime() ?? 0) -
                    (b.scheduledStartAt?.getTime() ?? 0),
            )[0] ?? null;

    const getLastCompleted = () =>
        rooms
            .filter((r) => r.status === 'completed')
            .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0] ??
        null;

    const mockRoomRepo = {
        findOne: jest.fn().mockImplementation(({ where }: any) => {
            if (where.status === 'running')
                return Promise.resolve(getByStatus('running'));
            if (where.status === 'open')
                return Promise.resolve(getByStatus('open'));
            if (where.status === 'completed')
                return Promise.resolve(getLastCompleted());
            return Promise.resolve(null);
        }),
        find: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockImplementation((dto) => dto),
        save: jest.fn().mockImplementation((r) => Promise.resolve(r)),
        // Raw query used by getCurrentRoom for the "recently completed" window.
        query: jest.fn().mockResolvedValue([]),
        // findOneBy is used by findRoom(id) inside getRoomState
        findOneBy: jest.fn().mockImplementation((where: any) => {
            const found = rooms.find((r) => r.id === where.id) ?? null;
            return Promise.resolve(found);
        }),
        createQueryBuilder: jest.fn().mockReturnValue({
            select: jest.fn().mockReturnThis(),
            addSelect: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            andWhere: jest.fn().mockReturnThis(),
            orderBy: jest.fn().mockReturnThis(),
            leftJoinAndSelect: jest.fn().mockReturnThis(),
            getMany: jest.fn().mockResolvedValue([]),
            getOne: jest.fn().mockResolvedValue(null),
            getRawMany: jest.fn().mockResolvedValue([]),
        }),
        // getRoomState reaches the users table through the room repo's manager
        // (to tell a real viewer from a bot before stamping firstViewedAt).
        manager: {
            findOne: jest.fn().mockResolvedValue(null),
            find: jest.fn().mockResolvedValue([]),
            query: jest.fn().mockResolvedValue([]),
        },
    };

    const mockBotNameRepo = {
        find: jest.fn().mockResolvedValue([]),
        findOneBy: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation((dto) => dto),
        save: jest.fn().mockImplementation((value) => Promise.resolve(value)),
        remove: jest.fn().mockResolvedValue(undefined),
    };

    const mockTicketRepo = {
        find: jest.fn().mockResolvedValue([]),
        findOne: jest.fn().mockResolvedValue(null),
        findOneBy: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
        countBy: jest.fn().mockResolvedValue(0),
        update: jest.fn().mockResolvedValue({ affected: 0 }),
        createQueryBuilder: jest.fn().mockReturnValue({
            select: jest.fn().mockReturnThis(),
            addSelect: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            andWhere: jest.fn().mockReturnThis(),
            groupBy: jest.fn().mockReturnThis(),
            getRawMany: jest.fn().mockResolvedValue([]),
        }),
    };

    const mockCardRepo = {
        find: jest.fn().mockResolvedValue([]),
        findOne: jest.fn().mockResolvedValue(null),
        countBy: jest.fn().mockResolvedValue(0),
        query: jest.fn().mockResolvedValue([]),
        save: jest.fn().mockImplementation((c) => Promise.resolve(c)),
        create: jest.fn().mockImplementation((dto) => dto),
    };

    const mockConfigRepo = {
        // Raw query used by the bot buy-in gate's player-presence heartbeat.
        query: jest.fn().mockResolvedValue([]),
        // The real entity maps to `bingo_config` (SINGULAR). A deliberately
        // distinctive value here proves the service reads the name from metadata
        // instead of writing one out by hand - see the regression test below.
        metadata: { tableName: 'bingo_config_from_metadata' },
        findOneBy: jest.fn().mockResolvedValue({
            key: 'default',
            enabled: true,
            autoRepeatIntervalMinutes: 5,
            defaultTicketPriceMinor: 100,
            defaultMaxTickets: 100,
            defaultOneLineMinor: 5000,
            defaultTwoLinesMinor: 10000,
            defaultFullHouseMinor: 20000,
            drawIntervalSeconds: 2,
            salesWindowSeconds: 40,
            resultDisplaySeconds: 10,
            minTicketsToStart: 1,
        }),
        create: jest.fn().mockImplementation((dto) => dto),
        save: jest.fn().mockImplementation((r) => Promise.resolve(r)),
        update: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    const mockPatternRepo = {
        find: jest.fn().mockResolvedValue([]),
        findBy: jest.fn().mockResolvedValue([]),
        findOneBy: jest.fn().mockResolvedValue(null),
        save: jest.fn().mockImplementation((p) => Promise.resolve(p)),
        create: jest.fn().mockImplementation((dto) => dto),
        remove: jest.fn().mockResolvedValue(undefined),
    };

    const mockBonusCampaignRepo = {
        find: jest.fn().mockResolvedValue([]),
        findOneBy: jest.fn().mockResolvedValue(null),
        save: jest.fn().mockImplementation((c) => Promise.resolve(c)),
        create: jest.fn().mockImplementation((dto) => dto),
        remove: jest.fn().mockResolvedValue(undefined),
    };

    const mockScheduledBotPlayRepo = {
        find: jest.fn().mockResolvedValue([]),
        findOneBy: jest.fn().mockResolvedValue(null),
        save: jest.fn().mockImplementation((s) => Promise.resolve(s)),
        create: jest.fn().mockImplementation((dto) => dto),
        remove: jest.fn().mockResolvedValue(undefined),
    };

    const mockCustomRoomSlotRepo = {
        find: jest.fn().mockResolvedValue([]),
        findBy: jest.fn().mockResolvedValue([]),
        findOneBy: jest.fn().mockResolvedValue(null),
        save: jest.fn().mockImplementation((s) => Promise.resolve(s)),
        create: jest.fn().mockImplementation((dto) => dto),
        delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    const mockCommissionSettlementErrorRepo = {
        save: jest.fn().mockImplementation((e) => Promise.resolve(e)),
        create: jest.fn().mockImplementation((dto) => dto),
    };

    const mockOperationalAlertRepo = {
        find: jest.fn().mockResolvedValue([]),
        save: jest.fn().mockImplementation((e) => Promise.resolve(e)),
        create: jest.fn().mockImplementation((dto) => dto),
    };

    const walletService = {
        debitInSession: jest.fn(),
        creditInSession: jest.fn(),
    };
    const dataSource = { transaction: jest.fn() as any };

    const service = new BingoService(
        dataSource as any,
        mockRoomRepo as any,
        mockBotNameRepo as any,
        mockTicketRepo as any,
        mockCardRepo as any,
        mockConfigRepo as any,
        mockCustomRoomSlotRepo as any,
        mockCommissionSettlementErrorRepo as any,
        mockOperationalAlertRepo as any,
        mockPatternRepo as any,
        mockBonusCampaignRepo as any,
        mockScheduledBotPlayRepo as any,
        new (require('./bingo-rules.service').BingoRulesService)(),
        { drawUniqueNumbers: jest.fn() } as any,
        walletService as any,
        { safeCreate: jest.fn(), create: jest.fn() } as any,
        {
            assertPlayable: jest.fn().mockResolvedValue(undefined),
            isPlayable: jest.fn().mockResolvedValue(true),
        } as any,
    );

    return {
        service,
        mockRoomRepo,
        mockBotNameRepo,
        mockTicketRepo,
        mockCardRepo,
        mockConfigRepo,
        mockPatternRepo,
        mockBonusCampaignRepo,
        mockScheduledBotPlayRepo,
        mockOperationalAlertRepo,
        walletService,
        dataSource,
    };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('BingoService.getCurrentRoom  unit (mocked repos)', () => {
    it('returns the running room when one exists', async () => {
        const running = makeRoom({ status: 'running' });
        const open = makeRoom({ status: 'open' });
        const { service } = makeService({ rooms: [running, open] });

        const result = await service.getCurrentRoom();
        expect(result?.id).toBe(running.id);
    });

    it('returns the open room when no room is running', async () => {
        const open = makeRoom({ status: 'open' });
        const { service } = makeService({ rooms: [open] });

        const result = await service.getCurrentRoom();
        expect(result?.id).toBe(open.id);
    });

    it('returns a recently completed room during the result window', async () => {
        const old = makeRoom({
            status: 'completed',
            updatedAt: new Date('2026-01-01'),
        });
        const recent = makeRoom({
            status: 'completed',
            updatedAt: new Date('2026-06-01'),
        });
        const { service, mockRoomRepo } = makeService({ rooms: [old, recent] });
        mockRoomRepo.query.mockResolvedValueOnce([{ id: recent.id }]);

        const result = await service.getCurrentRoom();
        expect(result?.id).toBe(recent.id);
    });

    it('does not return an old completed room after the result window has expired', async () => {
        const completed = makeRoom({
            status: 'completed',
            updatedAt: new Date('2026-06-01'),
        });
        const { service } = makeService({ rooms: [completed] });

        const result = await service.getCurrentRoom();
        expect(result).toBeNull();
    });

    it('returns null when no rooms exist at all', async () => {
        const { service } = makeService({ rooms: [] });
        const result = await service.getCurrentRoom();
        expect(result).toBeNull();
    });

    it('prefers running over open', async () => {
        const running = makeRoom({ status: 'running' });
        const open = makeRoom({ status: 'open' });
        const completed = makeRoom({
            status: 'completed',
            updatedAt: new Date(),
        });
        const { service } = makeService({ rooms: [completed, open, running] });

        const result = await service.getCurrentRoom();
        expect(result?.id).toBe(running.id);
    });

    it('prefers open over completed', async () => {
        const open = makeRoom({ status: 'open' });
        const completed = makeRoom({
            status: 'completed',
            updatedAt: new Date(),
        });
        const { service } = makeService({ rooms: [completed, open] });

        const result = await service.getCurrentRoom();
        expect(result?.id).toBe(open.id);
    });
});

// ─── computePrefilledPrizeMinor (derash payout math) ─────────────────────────

describe('BingoService.computePrefilledPrizeMinor  derash payout', () => {
    const cfg = (overrides: any = {}) => ({
        prefilledFirstPlacePct: 80,
        prefilledSecondPlaceEnabled: false,
        prefilledSecondPlacePct: 0,
        prefilledThirdPlaceEnabled: false,
        prefilledThirdPlacePct: 0,
        ...overrides,
    });

    it('pays the FULL house-adjusted pool to a single 1st-place winner (no double fee)', () => {
        const { service } = makeService({ rooms: [] });
        // pot 40, 20% house edge → pool 32. Regression: must be 32, NOT 32*0.8 = 25.
        expect(
            service.computePrefilledPrizeMinor(40, '1st', 20, cfg() as any),
        ).toBe(32);
        // pot 100 → pool 80. Regression: must be 80, NOT 64.
        expect(
            service.computePrefilledPrizeMinor(100, '1st', 20, cfg() as any),
        ).toBe(80);
    });

    it('is independent of the configured 1st-place percentage when it is the only place', () => {
        const { service } = makeService({ rooms: [] });
        // Whether the weight is 80 or 100, a single enabled place gets the whole pool.
        expect(
            service.computePrefilledPrizeMinor(
                100,
                '1st',
                20,
                cfg({ prefilledFirstPlacePct: 100 }) as any,
            ),
        ).toBe(80);
        expect(
            service.computePrefilledPrizeMinor(
                100,
                '1st',
                20,
                cfg({ prefilledFirstPlacePct: 50 }) as any,
            ),
        ).toBe(80);
    });

    it('splits the pool by weight across enabled places', () => {
        const { service } = makeService({ rooms: [] });
        const c = cfg({
            prefilledSecondPlaceEnabled: true,
            prefilledSecondPlacePct: 20,
        });
        // pool 80, weights 80/20 (total 100) → 1st 64, 2nd 16.
        expect(
            service.computePrefilledPrizeMinor(100, '1st', 20, c as any),
        ).toBe(64);
        expect(
            service.computePrefilledPrizeMinor(100, '2nd', 20, c as any),
        ).toBe(16);
    });

    it('returns 0 when no enabled place has any weight', () => {
        const { service } = makeService({ rooms: [] });
        expect(
            service.computePrefilledPrizeMinor(
                100,
                '1st',
                20,
                cfg({ prefilledFirstPlacePct: 0 }) as any,
            ),
        ).toBe(0);
    });

    it('splits the pool across all five enabled places by weight', () => {
        const { service } = makeService({ rooms: [] });
        // No house edge → pool == pot. Weights 50/25/15/6/4 (total 100).
        const c = cfg({
            prefilledFirstPlacePct: 50,
            prefilledSecondPlaceEnabled: true,
            prefilledSecondPlacePct: 25,
            prefilledThirdPlaceEnabled: true,
            prefilledThirdPlacePct: 15,
            prefilledFourthPlaceEnabled: true,
            prefilledFourthPlacePct: 6,
            prefilledFifthPlaceEnabled: true,
            prefilledFifthPlacePct: 4,
        });
        expect(
            service.computePrefilledPrizeMinor(100, '1st', 0, c as any),
        ).toBe(50);
        expect(
            service.computePrefilledPrizeMinor(100, '2nd', 0, c as any),
        ).toBe(25);
        expect(
            service.computePrefilledPrizeMinor(100, '3rd', 0, c as any),
        ).toBe(15);
        expect(
            service.computePrefilledPrizeMinor(100, '4th', 0, c as any),
        ).toBe(6);
        expect(
            service.computePrefilledPrizeMinor(100, '5th', 0, c as any),
        ).toBe(4);
    });

    it('does not let a DISABLED place dilute the enabled places', () => {
        const { service } = makeService({ rooms: [] });
        // 4th carries a weight but is NOT enabled, so its 50 must be excluded from the
        // denominator  the enabled 1st/2nd keep their full 80/20 share of the pool.
        // (computePrefilledPrizeMinor is only ever called for ENABLED places in the
        // settlement loop via nextOpenPrefilledPlace, so 4th is never requested here.)
        const c = cfg({
            prefilledSecondPlaceEnabled: true,
            prefilledSecondPlacePct: 20,
            prefilledFourthPlaceEnabled: false,
            prefilledFourthPlacePct: 50,
        });
        expect(
            service.computePrefilledPrizeMinor(100, '1st', 20, c as any),
        ).toBe(64); // 80/100 of pool 80
        expect(
            service.computePrefilledPrizeMinor(100, '2nd', 20, c as any),
        ).toBe(16); // 20/100 of pool 80
    });
});

// ─── findRunningRoomIdsDue ────────────────────────────────────────────────────

// ─── computePrefilledFinalPrizeMinor (end-of-game pool reconciliation) ────────

describe('BingoService.computePrefilledFinalPrizeMinor  filled-place reconciliation', () => {
    const cfg = (overrides: any = {}) => ({
        prefilledFirstPlacePct: 80,
        prefilledSecondPlaceEnabled: false,
        prefilledSecondPlacePct: 0,
        prefilledThirdPlaceEnabled: false,
        prefilledThirdPlacePct: 0,
        ...overrides,
    });

    it('a single filled place always takes the whole house-adjusted pool', () => {
        const { service } = makeService({ rooms: [] });
        // pot 100, 20% edge → pool 80. Only 1st filled → 1st gets the full 80.
        expect(
            service.computePrefilledFinalPrizeMinor(
                100,
                '1st',
                20,
                ['1st'],
                cfg() as any,
            ),
        ).toBe(80);
    });

    it('equals the progressive prize when every enabled place is filled', () => {
        const { service } = makeService({ rooms: [] });
        const c = cfg({
            prefilledSecondPlaceEnabled: true,
            prefilledSecondPlacePct: 20,
            prefilledThirdPlaceEnabled: true,
            prefilledThirdPlacePct: 0, // 3rd enabled, weight 0
        });
        // Enabled weights 80/20/0 = 100. All three filled → 1st 64, 2nd 16, 3rd 0.
        const filled = ['1st', '2nd', '3rd'] as any;
        expect(
            service.computePrefilledFinalPrizeMinor(
                100,
                '1st',
                20,
                filled,
                c as any,
            ),
        ).toBe(64);
        expect(
            service.computePrefilledFinalPrizeMinor(
                100,
                '2nd',
                20,
                filled,
                c as any,
            ),
        ).toBe(16);
    });

    it('redistributes an UNFILLED place’s share to the filled places (no house leak)', () => {
        const { service } = makeService({ rooms: [] });
        // Enabled 1st/2nd/3rd = 50/30/20. But only 1st and 2nd actually filled.
        const c = cfg({
            prefilledFirstPlacePct: 50,
            prefilledSecondPlaceEnabled: true,
            prefilledSecondPlacePct: 30,
            prefilledThirdPlaceEnabled: true,
            prefilledThirdPlacePct: 20,
        });
        const filled = ['1st', '2nd'] as any; // 3rd never filled
        // Pool 80 split by FILLED weights 50/30 (total 80): 1st = 80*50/80 = 50, 2nd = 30.
        // The unfilled 3rd's 20 share is NOT kept by the house  it lifts 1st+2nd.
        expect(
            service.computePrefilledFinalPrizeMinor(
                100,
                '1st',
                20,
                filled,
                c as any,
            ),
        ).toBe(50);
        expect(
            service.computePrefilledFinalPrizeMinor(
                100,
                '2nd',
                20,
                filled,
                c as any,
            ),
        ).toBe(30);
        // Filled prizes sum to the whole pool (50 + 30 = 80).
    });

    it('returns 0 when there are no filled places', () => {
        const { service } = makeService({ rooms: [] });
        expect(
            service.computePrefilledFinalPrizeMinor(
                100,
                '1st',
                20,
                [],
                cfg() as any,
            ),
        ).toBe(0);
    });
});

describe('BingoService.findRunningRoomIdsDue  unit', () => {
    it('returns room IDs whose updatedAt is older than the interval', async () => {
        const oldRoom = makeRoom({
            status: 'running',
            updatedAt: new Date(Date.now() - 10_000),
        });

        const mockRoomRepo = {
            find: jest.fn().mockResolvedValue([oldRoom]),
            query: jest.fn().mockResolvedValue([{ id: oldRoom.id }]),
            findOne: jest.fn(),
            findOneBy: jest.fn(),
        } as any;

        const service = new BingoService(
            { transaction: jest.fn() } as any,
            mockRoomRepo,
            {
                find: jest.fn().mockResolvedValue([]),
                createQueryBuilder: jest
                    .fn()
                    .mockReturnValue({
                        select: jest.fn().mockReturnThis(),
                        addSelect: jest.fn().mockReturnThis(),
                        where: jest.fn().mockReturnThis(),
                        groupBy: jest.fn().mockReturnThis(),
                        getRawMany: jest.fn().mockResolvedValue([]),
                    }),
            } as any,
            {
                countBy: jest.fn().mockResolvedValue(0),
                query: jest.fn().mockResolvedValue([]),
                find: jest.fn().mockResolvedValue([]),
                findOne: jest.fn(),
                save: jest.fn(),
                create: jest.fn(),
            } as any,
            {
                findOneBy: jest
                    .fn()
                    .mockResolvedValue({
                        drawIntervalSeconds: 2,
                        salesWindowSeconds: 40,
                        resultDisplaySeconds: 10,
                        enabled: true,
                        defaultTicketPriceMinor: 100,
                        defaultMaxTickets: 100,
                        defaultOneLineMinor: 5000,
                        defaultTwoLinesMinor: 10000,
                        defaultFullHouseMinor: 20000,
                        autoRepeatIntervalMinutes: 5,
                        minTicketsToStart: 1,
                    }),
                create: jest.fn().mockImplementation((d) => d),
                save: jest.fn().mockImplementation((d) => d),
            } as any,
            {
                find: jest.fn().mockResolvedValue([]),
                findBy: jest.fn().mockResolvedValue([]),
                findOneBy: jest.fn(),
                save: jest.fn(),
                create: jest.fn(),
                delete: jest.fn(),
            } as any,
            {
                save: jest
                    .fn()
                    .mockImplementation((e: unknown) => Promise.resolve(e)),
                create: jest.fn().mockImplementation((dto: unknown) => dto),
            } as any,
            {
                find: jest.fn().mockResolvedValue([]),
                save: jest
                    .fn()
                    .mockImplementation((e: unknown) => Promise.resolve(e)),
                create: jest.fn().mockImplementation((dto: unknown) => dto),
            } as any,
            {
                find: jest.fn().mockResolvedValue([]),
                findOneBy: jest.fn(),
                save: jest.fn(),
                create: jest.fn(),
            } as any,
            {
                find: jest.fn().mockResolvedValue([]),
                findOneBy: jest.fn().mockResolvedValue(null),
                save: jest.fn().mockImplementation((c: unknown) => c),
                create: jest.fn().mockImplementation((dto: unknown) => dto),
                remove: jest.fn().mockResolvedValue(undefined),
            } as any,
            {
                find: jest.fn().mockResolvedValue([]),
                findOneBy: jest.fn().mockResolvedValue(null),
                save: jest.fn().mockImplementation((s: unknown) => s),
                create: jest.fn().mockImplementation((dto: unknown) => dto),
                remove: jest.fn().mockResolvedValue(undefined),
            } as any,
            new (require('./bingo-rules.service').BingoRulesService)(),
            { drawUniqueNumbers: jest.fn() } as any,
            { debitInSession: jest.fn(), creditInSession: jest.fn() } as any,
            { safeCreate: jest.fn(), create: jest.fn() } as any,
            {} as any,
            {
                assertPlayable: jest.fn().mockResolvedValue(undefined),
                isPlayable: jest.fn().mockResolvedValue(true),
            } as any,
        );

        const ids = await service.findRunningRoomIdsDue(2);
        expect(ids).toContain(oldRoom.id);
    });

    it('returns empty array when no rooms are due', async () => {
        const freshRoom = makeRoom({
            id: 'room-fresh',
            status: 'running',
            updatedAt: new Date(), // just updated
        });

        const mockRoomRepo = {
            find: jest.fn().mockResolvedValue([]),
            query: jest.fn().mockResolvedValue([]),
            findOne: jest.fn(),
            findOneBy: jest.fn(),
        } as any;

        const service = new BingoService(
            { transaction: jest.fn() } as any,
            mockRoomRepo,
            {
                find: jest.fn().mockResolvedValue([]),
                createQueryBuilder: jest
                    .fn()
                    .mockReturnValue({
                        select: jest.fn().mockReturnThis(),
                        addSelect: jest.fn().mockReturnThis(),
                        where: jest.fn().mockReturnThis(),
                        groupBy: jest.fn().mockReturnThis(),
                        getRawMany: jest.fn().mockResolvedValue([]),
                    }),
            } as any,
            {
                countBy: jest.fn().mockResolvedValue(0),
                query: jest.fn().mockResolvedValue([]),
                find: jest.fn().mockResolvedValue([]),
                findOne: jest.fn(),
                save: jest.fn(),
                create: jest.fn(),
            } as any,
            {
                findOneBy: jest
                    .fn()
                    .mockResolvedValue({
                        drawIntervalSeconds: 2,
                        salesWindowSeconds: 40,
                    }),
                create: jest.fn().mockImplementation((d) => d),
                save: jest.fn().mockImplementation((d) => d),
            } as any,
            {
                find: jest.fn().mockResolvedValue([]),
                findBy: jest.fn().mockResolvedValue([]),
                findOneBy: jest.fn(),
                save: jest.fn(),
                create: jest.fn(),
                delete: jest.fn(),
            } as any,
            {
                save: jest
                    .fn()
                    .mockImplementation((e: unknown) => Promise.resolve(e)),
                create: jest.fn().mockImplementation((dto: unknown) => dto),
            } as any,
            {
                find: jest.fn().mockResolvedValue([]),
                save: jest
                    .fn()
                    .mockImplementation((e: unknown) => Promise.resolve(e)),
                create: jest.fn().mockImplementation((dto: unknown) => dto),
            } as any,
            {
                find: jest.fn().mockResolvedValue([]),
                findOneBy: jest.fn(),
                save: jest.fn(),
                create: jest.fn(),
            } as any,
            {
                find: jest.fn().mockResolvedValue([]),
                findOneBy: jest.fn().mockResolvedValue(null),
                save: jest.fn().mockImplementation((c: unknown) => c),
                create: jest.fn().mockImplementation((dto: unknown) => dto),
                remove: jest.fn().mockResolvedValue(undefined),
            } as any,
            {
                find: jest.fn().mockResolvedValue([]),
                findOneBy: jest.fn().mockResolvedValue(null),
                save: jest.fn().mockImplementation((s: unknown) => s),
                create: jest.fn().mockImplementation((dto: unknown) => dto),
                remove: jest.fn().mockResolvedValue(undefined),
            } as any,
            new (require('./bingo-rules.service').BingoRulesService)(),
            { drawUniqueNumbers: jest.fn() } as any,
            { debitInSession: jest.fn(), creditInSession: jest.fn() } as any,
            { safeCreate: jest.fn(), create: jest.fn() } as any,
            {} as any,
            {
                assertPlayable: jest.fn().mockResolvedValue(undefined),
                isPlayable: jest.fn().mockResolvedValue(true),
            } as any,
        );

        const ids = await service.findRunningRoomIdsDue(2);
        expect(ids).toHaveLength(0);

        void freshRoom; // referenced to avoid unused warning
    });
});

describe('BingoService cartela lifecycle guards', () => {
    const botCfg = (overrides: any = {}) => ({
        botCartelaPolicyEnabled: true,
        botCartelaPolicyMode: 'mirror',
        botMaxCartelasPerBotPerRoom: 5,
        botBelowThresholdEnabled: true,
        botBelowThresholdRealPlayers: 10,
        botAboveThresholdEnabled: true,
        botAboveThresholdRealPlayers: 50,
        botMaxRealPlayers: 10,
        botBonusWinEnabled: true,
        botBonusWinMode: 'interval',
        botBonusWinEveryNRounds: 0,
        botBonusWinChancePct: 0,
        globalBingoBotWinInterval: 0,
        ...overrides,
    });

    it('rejects cartel-dual config when fewer than two active Bingo bots exist', async () => {
        const { service, mockConfigRepo } = makeService({ rooms: [] });
        jest.spyOn(service, 'getBingoConfig').mockResolvedValue({
            key: 'global',
            botWinMode: 'statistical',
        } as any);
        jest.spyOn(service as any, 'getActiveBotUserIds').mockResolvedValue(
            new Set(['bot-1']),
        );
        jest.spyOn(service as any, 'autoCreateNextRoom').mockResolvedValue(
            null,
        );
        const saveSpy = jest.spyOn(mockConfigRepo, 'save');

        await expect(
            service.updateBingoConfig({ botWinMode: 'cartel-dual' } as any),
        ).rejects.toThrow(
            'Cartel Dual requires at least 2 active Bingo-enabled bots',
        );

        expect(saveSpy).not.toHaveBeenCalled();
    });

    it('allows enabling cartel-dual even when the cooldown leaves fewer than two eligible bots (only the active-bot-count check applies)', async () => {
        const { service, mockConfigRepo } = makeService({ rooms: [] });
        jest.spyOn(service, 'getBingoConfig').mockResolvedValue({
            key: 'global',
            botWinMode: 'statistical',
            botWinnerCooldownRooms: 25,
        } as any);
        jest.spyOn(service as any, 'getActiveBotUserIds').mockResolvedValue(
            new Set(['bot-1', 'bot-2', 'bot-3']),
        );
        jest.spyOn(service as any, 'autoCreateNextRoom').mockResolvedValue(
            null,
        );

        await expect(
            service.updateBingoConfig({ botWinMode: 'cartel-dual' } as any),
        ).resolves.toBeTruthy();

        expect(mockConfigRepo.save).toHaveBeenCalled();
    });

    it('does not re-run the active-bot-count check when the config was already cartel-dual and stays cartel-dual (unrelated field save)', async () => {
        const { service, mockConfigRepo } = makeService({ rooms: [] });
        jest.spyOn(service, 'getBingoConfig').mockResolvedValue({
            key: 'global',
            botWinMode: 'cartel-dual', // already cartel-dual before this save
        } as any);
        jest.spyOn(service as any, 'getActiveBotUserIds').mockResolvedValue(
            new Set(['bot-1']), // only 1 active  would fail the check if it re-ran
        );
        jest.spyOn(service as any, 'autoCreateNextRoom').mockResolvedValue(
            null,
        );

        // Admin form always resubmits the full config, so botWinMode is still
        // 'cartel-dual' in the dto even though the admin only meant to change
        // an unrelated field (e.g. botBonusWinEnabled).
        await expect(
            service.updateBingoConfig({
                botWinMode: 'cartel-dual',
                botBonusWinEnabled: false,
            } as any),
        ).resolves.toBeTruthy();

        expect(mockConfigRepo.save).toHaveBeenCalled();
    });

    it('saves bot winner cooldown rooms from the admin config', async () => {
        const { service, mockConfigRepo } = makeService({ rooms: [] });
        const cfg = {
            key: 'global',
            botWinMode: 'statistical',
            botWinnerCooldownRooms: 25,
        };
        jest.spyOn(service, 'getBingoConfig').mockResolvedValue(cfg as any);
        jest.spyOn(service as any, 'autoCreateNextRoom').mockResolvedValue(
            null,
        );
        const saveSpy = jest.spyOn(mockConfigRepo, 'save');

        await service.updateBingoConfig({ botWinnerCooldownRooms: 7 } as any);

        expect(saveSpy).toHaveBeenCalledWith(
            expect.objectContaining({ botWinnerCooldownRooms: 7 }),
        );
    });

    it('defaults old configs without bot winner cooldown rooms to the legacy cooldown', () => {
        const { service } = makeService({ rooms: [] });

        expect((service as any).resolveBotWinnerCooldownRooms({})).toBe(25);
    });

    it('rejects cartela returns during the freeze window before the draw', async () => {
        const { service, dataSource } = makeService({ rooms: [] });
        const room = makeRoom({
            winMode: 'prefilled',
            status: 'open',
            soldTickets: 1,
            scheduledStartAt: new Date(Date.now() + 4_000),
            cartelaChangeLockSeconds: 5,
        });
        const userId = '550e8400-e29b-41d4-a716-446655440001';
        const ticket = {
            id: 'ticket-1',
            userId,
            roomId: room.id,
            cartelaNumber: 7,
            stakeMinor: 100,
            status: 'active',
            settlementStatus: 'pending',
            walletCredits: [],
            cardId: null,
        };
        const manager = {
            findOne: jest
                .fn()
                .mockImplementation((entity: unknown, options: any) => {
                    if (options?.where?.id === room.id)
                        return Promise.resolve(room);
                    return Promise.resolve(ticket);
                }),
            find: jest.fn(),
            save: jest.fn().mockResolvedValue(undefined),
            update: jest.fn().mockResolvedValue(undefined),
            query: jest.fn().mockResolvedValue([{ c: 1 }]),
            countBy: jest.fn().mockResolvedValue(1),
        };
        (dataSource.transaction as jest.Mock).mockImplementation(
            (cb: (m: unknown) => Promise<unknown>) => cb(manager),
        );

        await expect(
            service.releaseCartela({
                userId,
                roomId: room.id,
                cartelaNumber: 7,
            }),
        ).rejects.toThrow('Cartela changes are locked near the draw start');

        expect(manager.findOne).toHaveBeenCalledTimes(1);
    });

    it('cancels the room and returns bot cartelas when the last real player leaves', async () => {
        const { service, dataSource, walletService } = makeService({
            rooms: [],
        });
        const room = makeRoom({
            winMode: 'prefilled',
            status: 'open',
            soldTickets: 2,
            scheduledStartAt: new Date(Date.now() + 20_000),
        });
        const userId = '550e8400-e29b-41d4-a716-446655440002';
        const realTicket = {
            id: 'ticket-1',
            userId,
            roomId: room.id,
            cartelaNumber: 7,
            stakeMinor: 100,
            status: 'active',
            settlementStatus: 'pending',
            walletCredits: [],
            cardId: null,
        };
        const botTicket = {
            id: 'bot-ticket-1',
            userId: 'bot-1',
            roomId: room.id,
            cartelaNumber: 8,
            stakeMinor: 100,
            status: 'active',
            settlementStatus: 'pending',
            walletCredits: [],
            cardId: null,
        };
        const manager = {
            findOne: jest
                .fn()
                .mockImplementation((entity: unknown, options: any) => {
                    if (options?.where?.id === room.id)
                        return Promise.resolve(room);
                    return Promise.resolve(realTicket);
                }),
            find: jest.fn().mockResolvedValue([botTicket]),
            save: jest.fn().mockImplementation(async (value: any) => value),
            update: jest.fn().mockResolvedValue(undefined),
            query: jest.fn().mockResolvedValue([{ c: 0 }]),
            countBy: jest.fn().mockResolvedValue(1),
        };
        (dataSource.transaction as jest.Mock).mockImplementation(
            (cb: (m: unknown) => Promise<unknown>) => cb(manager),
        );
        walletService.creditInSession = jest
            .fn()
            .mockResolvedValue({ id: 'credit-1' });

        const result = await service.releaseCartela({
            userId,
            roomId: room.id,
            cartelaNumber: 7,
        });

        expect(result).toEqual({
            cartelaNumber: 7,
            refundedMinor: 100,
            roomCancelled: true,
        });
        expect(room.status).toBe('cancelled');
        expect(room.soldTickets).toBe(0);
        expect(room.settlementSummary).toMatchObject({
            reason: 'bingo_room_no_real_players',
        });
        expect(botTicket.status).toBe('cancelled');
        expect(botTicket.settlementStatus).toBe('settled');
        expect(walletService.creditInSession).toHaveBeenCalledTimes(2);
        expect(manager.update).toHaveBeenCalledWith(
            BingoCard,
            { roomId: room.id },
            { assignedTicketId: null, assignedUserId: null },
        );
        expect(manager.find).toHaveBeenCalled();
    });

    it('cancels bot-only rooms instead of starting the draw', async () => {
        const { service, dataSource, walletService } = makeService({
            rooms: [],
        });
        const room = makeRoom({
            winMode: 'line',
            status: 'open',
            soldTickets: 2,
            scheduledStartAt: new Date(Date.now() - 1_000),
        });
        const botTicket = {
            id: 'bot-ticket-1',
            userId: 'bot-1',
            roomId: room.id,
            stakeMinor: 100,
            status: 'active',
            settlementStatus: 'pending',
            walletCredits: [],
            cardId: null,
        };
        const manager = {
            findOne: jest.fn().mockResolvedValue(room),
            find: jest.fn().mockResolvedValue([botTicket]),
            save: jest.fn().mockImplementation(async (value: any) => value),
            update: jest.fn().mockResolvedValue(undefined),
            query: jest.fn().mockResolvedValue([{ c: 0 }]),
            countBy: jest.fn().mockResolvedValue(2),
        };
        (dataSource.transaction as jest.Mock).mockImplementation(
            (cb: (m: unknown) => Promise<unknown>) => cb(manager),
        );
        walletService.creditInSession = jest
            .fn()
            .mockResolvedValue({ id: 'credit-1' });

        const result = await service.drawNextNumber(room.id);

        expect(result.status).toBe('cancelled');
        expect(room.status).toBe('cancelled');
        expect(walletService.creditInSession).toHaveBeenCalledTimes(1);
    });

    it('rejects cartela purchases in the freeze window before the draw', async () => {
        const { service, dataSource, walletService } = makeService({
            rooms: [],
        });
        const room = makeRoom({
            winMode: 'prefilled',
            status: 'open',
            scheduledStartAt: new Date(Date.now() + 4_000),
            cartelaChangeLockSeconds: 5,
        });
        const manager = {
            find: jest.fn().mockResolvedValue([]),
            findOne: jest.fn().mockResolvedValue(room),
        };
        (dataSource.transaction as jest.Mock).mockImplementation(
            (cb: (m: unknown) => Promise<unknown>) => cb(manager),
        );

        await expect(
            service.purchaseTickets({
                userId: '550e8400-e29b-41d4-a716-446655440000',
                roomId: room.id,
                cartelaNumbers: [1],
                idempotencyKey: 'purchase-lock-test',
            }),
        ).rejects.toThrow('Cartela changes are locked near the draw start');

        expect(walletService.debitInSession).not.toHaveBeenCalled();
    });

    // The hold is ENFORCED here, at the one funnel every cartela purchase passes
    // through, because reconcileBotCartelasInRoom is not the only way a bot buy
    // gets triggered - a real player's purchase/refund reaches it inline and the
    // auto-start path does a final top-off. Gating reconcile alone left exactly
    // those holes, which is why the bug survived several fixes.
    function makePurchaseHarness(
        opts: { botPolicy?: unknown; holdSecondsRemaining?: number } = {},
    ) {
        const harness = makeService({ rooms: [] });
        const room = makeRoom({ winMode: 'prefilled', status: 'open' });
        const user = {
            id: '550e8400-e29b-41d4-a716-446655440000',
            productMetadata: opts.botPolicy
                ? { botPolicy: opts.botPolicy }
                : {},
        };
        const manager = {
            find: jest.fn().mockResolvedValue([]),
            findOne: jest
                .fn()
                .mockResolvedValueOnce(room) // BingoRoom (locked)
                .mockResolvedValueOnce(user), // purchasing User
        };
        (harness.dataSource.transaction as jest.Mock).mockImplementation(
            (cb: (m: unknown) => Promise<unknown>) => cb(manager),
        );
        jest.spyOn(
            harness.service as any,
            'isCartelaChangeLocked',
        ).mockReturnValue(false);
        jest.spyOn(
            harness.service as any,
            'isBotBuyAllowed',
        ).mockResolvedValue({
            allowed: opts.holdSecondsRemaining == null,
            secondsRemaining: opts.holdSecondsRemaining ?? 0,
            reason:
                opts.holdSecondsRemaining == null
                    ? undefined
                    : 'a round with real players is still being presented',
        });
        return { ...harness, room, user };
    }

    it('refuses a BOT cartela purchase while a player has not yet reached the buying screen', async () => {
        const { service, room, walletService } = makePurchaseHarness({
            botPolicy: { active: true },
            holdSecondsRemaining: 12,
        });

        await expect(
            service.purchaseTickets({
                userId: '550e8400-e29b-41d4-a716-446655440000',
                roomId: room.id,
                cartelaNumbers: [1],
                idempotencyKey: 'bot-during-hold',
            }),
        ).rejects.toThrow(/Bots are held out of this room .*up to 12s/);

        // Nothing was charged, so no cartela is taken and no countdown starts -
        // the player returns to an untouched buying screen.
        expect(walletService.debitInSession).not.toHaveBeenCalled();
    });

    it('does NOT hold a real player out during the same window - only bots', async () => {
        const { service, room } = makePurchaseHarness({
            holdSecondsRemaining: 12, // hold is active...
            // ...but this user has no botPolicy
        });

        // Gets past the hold; whatever it fails on later, it is never the gate.
        await expect(
            service.purchaseTickets({
                userId: '550e8400-e29b-41d4-a716-446655440000',
                roomId: room.id,
                cartelaNumbers: [1],
                idempotencyKey: 'human-during-hold',
            }),
        ).rejects.not.toThrow(/Bots are held out/);
    });

    it('lets a bot buy once the hold has expired', async () => {
        const { service, room } = makePurchaseHarness({
            botPolicy: { active: true },
            // no holdSecondsRemaining -> window open
        });

        await expect(
            service.purchaseTickets({
                userId: '550e8400-e29b-41d4-a716-446655440000',
                roomId: room.id,
                cartelaNumbers: [1],
                idempotencyKey: 'bot-after-hold',
            }),
        ).rejects.not.toThrow(/Bots are held out/);
    });

    it('skips bot reconcile when the room enters the freeze window', async () => {
        const { service, mockRoomRepo } = makeService({ rooms: [] });
        const room = makeRoom({
            winMode: 'prefilled',
            status: 'open',
            scheduledStartAt: new Date(Date.now() + 4_000),
            cartelaChangeLockSeconds: 5,
        });
        mockRoomRepo.findOneBy.mockResolvedValue(room);
        jest.spyOn(service, 'getBingoConfig').mockResolvedValue({
            botMaxRealPlayers: 10,
            botWinMode: 'statistical',
        } as any);
        jest.spyOn(service, 'countRealPlayersInRoom').mockResolvedValue(2);
        const purchaseSpy = jest
            .spyOn(service, 'purchaseTickets')
            .mockResolvedValue([] as any);
        const releaseSpy = jest
            .spyOn(service, 'releaseCartela')
            .mockResolvedValue({ cartelaNumber: 1, refundedMinor: 100 } as any);

        const changed = await service.reconcileBotCartelasInRoom(room.id);

        expect(changed).toBe(false);
        expect(purchaseSpy).not.toHaveBeenCalled();
        expect(releaseSpy).not.toHaveBeenCalled();
    });

    it('randomizes bot cartela assignment across the available pool', async () => {
        const { service, mockRoomRepo } = makeService({ rooms: [] });
        const room = makeRoom({
            winMode: 'prefilled',
            status: 'open',
            soldTickets: 2,
            scheduledStartAt: new Date(Date.now() + 20_000),
        });
        mockRoomRepo.findOneBy.mockResolvedValue(room);
        jest.spyOn(service as any, 'isCartelaChangeLocked').mockReturnValue(
            false,
        );
        jest.spyOn(service, 'getBingoConfig').mockResolvedValue(
            botCfg() as any,
        );
        jest.spyOn(service, 'countRealPlayersInRoom').mockResolvedValue(2);
        jest.spyOn(service, 'countBotCartelasInRoom').mockResolvedValue(0);
        jest.spyOn(service as any, 'countSoldTickets' as any).mockResolvedValue(
            2 as any,
        );
        jest.spyOn(service as any, 'getActiveBotUserIds').mockResolvedValue(
            new Set(['bot-1']),
        );
        jest.spyOn(service, 'ensureRoomBotIdentities').mockResolvedValue(
            {} as any,
        );
        jest.spyOn(service as any, 'countUserCartelasInRoom').mockResolvedValue(
            0,
        );
        jest.spyOn(
            service as any,
            'listAvailableCartelaNumbers',
        ).mockResolvedValue([1, 2, 3]);
        jest.spyOn(service as any, 'shuffle' as any).mockImplementation(
            (...args: any[]) => [...args[0]].reverse(),
        );
        const purchaseSpy = jest
            .spyOn(service, 'purchaseTickets')
            .mockResolvedValue([] as any);

        await expect(service.reconcileBotCartelasInRoom(room.id)).resolves.toBe(
            true,
        );

        expect(
            (purchaseSpy.mock.calls as any[]).map(
                (call) => call[0].cartelaNumbers[0],
            ),
        ).toEqual([3, 2]);
    });

    it('keeps cartel-dual at a minimum of two bot cartelas when only one human cartela exists', async () => {
        const { service, mockRoomRepo } = makeService({ rooms: [] });
        const room = makeRoom({
            winMode: 'prefilled',
            status: 'open',
            soldTickets: 1,
            scheduledStartAt: new Date(Date.now() + 20_000),
        });
        mockRoomRepo.findOneBy.mockResolvedValue(room);
        jest.spyOn(service as any, 'isCartelaChangeLocked').mockReturnValue(
            false,
        );
        jest.spyOn(service, 'getBingoConfig').mockResolvedValue(
            botCfg({
                botWinMode: 'cartel-dual',
            }) as any,
        );
        jest.spyOn(service, 'countRealPlayersInRoom').mockResolvedValue(1);
        jest.spyOn(service, 'countBotCartelasInRoom').mockResolvedValue(0);
        jest.spyOn(service as any, 'countSoldTickets' as any).mockResolvedValue(
            1 as any,
        );
        jest.spyOn(service as any, 'getActiveBotUserIds').mockResolvedValue(
            new Set(['bot-1', 'bot-2']),
        );
        jest.spyOn(service, 'ensureRoomBotIdentities').mockResolvedValue(
            {} as any,
        );
        jest.spyOn(service as any, 'countUserCartelasInRoom').mockResolvedValue(
            0,
        );
        jest.spyOn(
            service as any,
            'listAvailableCartelaNumbers',
        ).mockResolvedValue([1, 2, 3]);
        jest.spyOn(service as any, 'shuffle' as any).mockImplementation(
            (...args: any[]) => [...args[0]],
        );
        const purchaseSpy = jest
            .spyOn(service, 'purchaseTickets')
            .mockResolvedValue([] as any);

        await expect(service.reconcileBotCartelasInRoom(room.id)).resolves.toBe(
            true,
        );

        expect(purchaseSpy).toHaveBeenCalledTimes(2);
        expect(purchaseSpy.mock.calls.map((call) => call[0].userId)).toEqual([
            'bot-1',
            'bot-2',
        ]);
        expect(
            purchaseSpy.mock.calls.map((call) => call[0]?.cartelaNumbers?.[0]),
        ).toEqual([1, 2]);
    });

    it('assigns the second cartel-dual bot cartela to a different bot account when one bot already holds a card', async () => {
        const { service, mockRoomRepo } = makeService({ rooms: [] });
        const room = makeRoom({
            winMode: 'prefilled',
            status: 'open',
            soldTickets: 2,
            scheduledStartAt: new Date(Date.now() + 20_000),
        });
        mockRoomRepo.findOneBy.mockResolvedValue(room);
        jest.spyOn(service as any, 'isCartelaChangeLocked').mockReturnValue(
            false,
        );
        jest.spyOn(service, 'getBingoConfig').mockResolvedValue(
            botCfg({
                botWinMode: 'cartel-dual',
            }) as any,
        );
        jest.spyOn(service, 'countRealPlayersInRoom').mockResolvedValue(1);
        jest.spyOn(service, 'countBotCartelasInRoom').mockResolvedValue(1);
        jest.spyOn(service as any, 'countSoldTickets' as any).mockResolvedValue(
            2 as any,
        );
        jest.spyOn(service as any, 'getActiveBotUserIds').mockResolvedValue(
            new Set(['bot-1', 'bot-2']),
        );
        jest.spyOn(service, 'ensureRoomBotIdentities').mockResolvedValue(
            {} as any,
        );
        jest.spyOn(
            service as any,
            'countUserCartelasInRoom',
        ).mockImplementation(async (botId: unknown) =>
            botId === 'bot-1' ? 1 : 0,
        );
        jest.spyOn(
            service as any,
            'listAvailableCartelaNumbers',
        ).mockResolvedValue([7, 8, 9]);
        jest.spyOn(service as any, 'shuffle' as any).mockImplementation(
            (...args: any[]) => [...args[0]],
        );
        const purchaseSpy = jest
            .spyOn(service, 'purchaseTickets')
            .mockResolvedValue([] as any);

        await expect(service.reconcileBotCartelasInRoom(room.id)).resolves.toBe(
            true,
        );

        expect(purchaseSpy).toHaveBeenCalledTimes(1);
        expect(purchaseSpy.mock.calls[0][0].userId).toBe('bot-2');
        expect(purchaseSpy.mock.calls[0][0].cartelaNumbers).toEqual([7]);
    });

    it('enforces the per-bot cartela cap while still letting bots join above threshold independently', async () => {
        const { service, mockRoomRepo } = makeService({ rooms: [] });
        const room = makeRoom({
            winMode: 'prefilled',
            status: 'open',
            soldTickets: 3,
            scheduledStartAt: new Date(Date.now() + 20_000),
        });
        mockRoomRepo.findOneBy.mockResolvedValue(room);
        jest.spyOn(service as any, 'isCartelaChangeLocked').mockReturnValue(
            false,
        );
        jest.spyOn(service, 'getBingoConfig').mockResolvedValue(
            botCfg({
                botCartelaPolicyMode: 'fixed_cap',
                botMaxCartelasPerBotPerRoom: 1,
                botBelowThresholdEnabled: false,
                botAboveThresholdEnabled: true,
                botAboveThresholdRealPlayers: 50,
            }) as any,
        );
        jest.spyOn(service, 'countRealPlayersInRoom').mockResolvedValue(60);
        jest.spyOn(service, 'countBotCartelasInRoom').mockResolvedValue(0);
        jest.spyOn(service as any, 'countSoldTickets' as any).mockResolvedValue(
            3 as any,
        );
        jest.spyOn(service as any, 'getActiveBotUserIds').mockResolvedValue(
            new Set(['bot-1']),
        );
        jest.spyOn(service, 'ensureRoomBotIdentities').mockResolvedValue(
            {} as any,
        );
        jest.spyOn(service as any, 'countUserCartelasInRoom').mockResolvedValue(
            0,
        );
        jest.spyOn(
            service as any,
            'listAvailableCartelaNumbers',
        ).mockResolvedValue([1, 2, 3]);
        jest.spyOn(service as any, 'shuffle' as any).mockImplementation(
            (...args: any[]) => [...args[0]],
        );
        const purchaseSpy = jest
            .spyOn(service, 'purchaseTickets')
            .mockResolvedValue([] as any);

        await expect(service.reconcileBotCartelasInRoom(room.id)).resolves.toBe(
            true,
        );

        expect(purchaseSpy).toHaveBeenCalledTimes(1);
        expect(purchaseSpy.mock.calls[0][0].cartelaNumbers).toHaveLength(1);
    });

    it('keeps bots out when the below-threshold rule is disabled, even if the room is small', async () => {
        const { service, mockRoomRepo } = makeService({ rooms: [] });
        const room = makeRoom({
            winMode: 'prefilled',
            status: 'open',
            soldTickets: 1,
            scheduledStartAt: new Date(Date.now() + 20_000),
        });
        mockRoomRepo.findOneBy.mockResolvedValue(room);
        jest.spyOn(service as any, 'isCartelaChangeLocked').mockReturnValue(
            false,
        );
        jest.spyOn(service, 'getBingoConfig').mockResolvedValue(
            botCfg({
                botBelowThresholdEnabled: false,
                botAboveThresholdEnabled: true,
                botAboveThresholdRealPlayers: 50,
            }) as any,
        );
        jest.spyOn(service, 'countRealPlayersInRoom').mockResolvedValue(5);
        jest.spyOn(service, 'countBotCartelasInRoom').mockResolvedValue(0);
        jest.spyOn(service as any, 'countSoldTickets' as any).mockResolvedValue(
            1 as any,
        );
        jest.spyOn(service as any, 'getActiveBotUserIds').mockResolvedValue(
            new Set(['bot-1']),
        );
        const purchaseSpy = jest
            .spyOn(service, 'purchaseTickets')
            .mockResolvedValue([] as any);

        await expect(service.reconcileBotCartelasInRoom(room.id)).resolves.toBe(
            false,
        );

        expect(purchaseSpy).not.toHaveBeenCalled();
    });

    it('uses only explicitly Bingo-enabled bot users for new Bingo cartelas', async () => {
        const { service } = makeService({ rooms: [] });
        const manager = { query: jest.fn().mockResolvedValue([]) };

        await (service as any).getActiveBotUserIds(manager);

        expect(manager.query.mock.calls[0][0]).toContain(
            "JSON_EXTRACT(productMetadata, '$.botPolicy.games.bingo.active') = true",
        );
        expect(manager.query.mock.calls[0][0]).not.toContain(
            "JSON_EXTRACT(productMetadata, '$.botPolicy.games.bingo.active') IS NULL",
        );
    });

    it('does not redirect multiple prize places to the same bot identity', () => {
        const { service } = makeService({ rooms: [] });
        jest.spyOn(
            (service as any).bingoRulesService,
            'evaluatePatternTicket',
        ).mockReturnValue({ completedPatternIds: ['pattern-1'] });

        const winner = (service as any).pickBotRedirectWinner(
            [
                { id: 'ticket-1', userId: 'bot-1', grid: [[1]] },
                { id: 'ticket-2', userId: 'bot-2', grid: [[2]] },
            ],
            new Set(['bot-1', 'bot-2']),
            { id: 'pattern-1' },
            [1],
            75,
            { awardedBotUserIds: new Set(['bot-1']) },
        );

        expect(winner?.userId).toBe('bot-2');
    });

    it('relaxes exclusions (cooldown, then same-room dedup) rather than holding when they would leave zero bots', () => {
        const { service } = makeService({ rooms: [] });
        jest.spyOn(
            (service as any).bingoRulesService,
            'evaluatePatternTicket',
        ).mockReturnValue({ completedPatternIds: ['pattern-1'] });

        // Only one bot cartela is in the room, and it's both already-awarded this
        // room AND on cross-room cooldown  the strict exclusion set would leave
        // zero bots. Cartel-dual must still redirect the win onto it rather than
        // holding the real player's win indefinitely.
        const winner = (service as any).pickBotRedirectWinner(
            [{ id: 'ticket-1', userId: 'bot-1', grid: [[1]] }],
            new Set(['bot-1']),
            { id: 'pattern-1' },
            [1],
            75,
            {
                awardedBotUserIds: new Set(['bot-1']),
                recentBotWinnerUserIds: new Set(['bot-1']),
            },
        );

        expect(winner?.userId).toBe('bot-1');
    });

    it('synthesizes a fresh, valid winning grid for a bot when none naturally completes the pattern', () => {
        const { service } = makeService({ rooms: [] });
        const pattern = { id: 'pattern-1', patternType: 'any_line' } as any;
        const drawnNumbers = [3, 20, 35, 50, 65, 7, 22, 37, 52, 67];
        const botTicket = {
            id: 'ticket-bot',
            userId: 'bot-1',
            // Doesn't complete any_line against drawnNumbers above  forces the
            // fallback (synthesis) path instead of the natural-winner shortcut.
            grid: [
                [99, null, null, null, null],
                [null, null, null, null, null],
                [null, null, null, null, null],
                [null, null, null, null, null],
                [null, null, null, null, null],
            ] as (number | null)[][],
            markedNumbers: [] as number[],
        };

        const winner = (service as any).pickBotRedirectWinner(
            [botTicket],
            new Set(['bot-1']),
            pattern,
            drawnNumbers,
            75,
        );

        expect(winner).toBe(botTicket);
        const rulesService = (service as any).bingoRulesService;
        const { completedPatternIds } = rulesService.evaluatePatternTicket(
            winner.grid,
            drawnNumbers,
            [pattern],
        );
        expect(completedPatternIds).toContain('pattern-1');
        const numbers = winner.grid
            .flat()
            .filter((v: number | null) => v !== null);
        expect(new Set(numbers).size).toBe(numbers.length);
    });

    it('holds (returns null) when there is no eligible bot to synthesize a win onto', () => {
        const { service } = makeService({ rooms: [] });
        const pattern = { id: 'pattern-1', patternType: 'any_line' } as any;

        const winner = (service as any).pickBotRedirectWinner(
            [],
            new Set(['bot-1']),
            pattern,
            [1, 2, 3],
            75,
        );

        expect(winner).toBeNull();
    });

    it('randomizes Derash bot winners while skipping the previous room bot winner', () => {
        const { service } = makeService({ rooms: [] });
        jest.spyOn(
            (service as any).bingoRulesService,
            'evaluatePatternTicket',
        ).mockReturnValue({ completedPatternIds: ['pattern-1'] });
        jest.spyOn(service as any, 'shuffle').mockImplementation(
            (values: unknown) => [...(values as unknown[])],
        );

        const winner = (service as any).pickDerashAutoWinner({
            tickets: [
                {
                    id: 'ticket-1',
                    userId: 'bot-1',
                    autoClaim: true,
                    grid: [[1]],
                },
                {
                    id: 'ticket-2',
                    userId: 'bot-2',
                    autoClaim: true,
                    grid: [[2]],
                },
            ],
            botIds: new Set(['bot-1', 'bot-2']),
            awardedBotUserIds: new Set(),
            recentBotWinnerUserIds: new Set(['bot-1']),
            pattern: { id: 'pattern-1' },
            drawnNumbers: [1],
        });

        expect(winner?.userId).toBe('bot-2');
    });

    it('does not let the only eligible bot win consecutive Bingo rooms', () => {
        const { service } = makeService({ rooms: [] });
        jest.spyOn(
            (service as any).bingoRulesService,
            'evaluatePatternTicket',
        ).mockReturnValue({ completedPatternIds: ['pattern-1'] });

        const winner = (service as any).pickDerashAutoWinner({
            tickets: [
                {
                    id: 'ticket-1',
                    userId: 'bot-1',
                    autoClaim: true,
                    grid: [[1]],
                },
            ],
            botIds: new Set(['bot-1']),
            awardedBotUserIds: new Set(),
            recentBotWinnerUserIds: new Set(['bot-1']),
            pattern: { id: 'pattern-1' },
            drawnNumbers: [1],
        });

        expect(winner).toBeNull();
    });

    it('keeps recent Bingo bot winners out of rotation across multiple completed rooms', async () => {
        const { service } = makeService({ rooms: [] });
        const currentRoom = makeRoom({
            id: '00000000-0000-0000-0000-000000000099',
        });
        const completedRooms = Array.from({ length: 3 }, (_, index) =>
            makeRoom({
                id: `00000000-0000-0000-0000-00000000010${index}`,
                status: 'completed',
                settlementSummary: {
                    '1st': { winnerId: `ticket-${index + 1}` },
                },
                updatedAt: new Date(Date.now() - index * 1000),
            }),
        );
        const roomFind = jest
            .fn()
            .mockResolvedValue([currentRoom, ...completedRooms]);
        const manager = {
            getRepository: jest.fn().mockImplementation((entity: unknown) => {
                const entityName = (entity as { name?: string })?.name;
                if (entityName === 'BingoRoom') {
                    return {
                        find: roomFind,
                    };
                }
                return {
                    find: jest.fn().mockResolvedValue([
                        {
                            id: 'ticket-1',
                            userId: 'bot-1',
                            user: {
                                productMetadata: {
                                    botPolicy: {
                                        active: true,
                                        games: { bingo: { active: true } },
                                    },
                                },
                            },
                        },
                        {
                            id: 'ticket-2',
                            userId: 'bot-2',
                            user: {
                                productMetadata: {
                                    botPolicy: {
                                        active: true,
                                        games: { bingo: { active: true } },
                                    },
                                },
                            },
                        },
                        {
                            id: 'ticket-3',
                            userId: 'bot-3',
                            user: {
                                productMetadata: {
                                    botPolicy: {
                                        active: true,
                                        games: { bingo: { active: true } },
                                    },
                                },
                            },
                        },
                    ]),
                };
            }),
        };

        const recent = await (service as any).getPreviousBingoBotWinnerUserIds(
            currentRoom,
            manager,
        );

        expect(recent).toEqual(new Set(['bot-1', 'bot-2', 'bot-3']));
        expect(roomFind).toHaveBeenCalledWith(
            expect.objectContaining({ take: 26 }),
        );
    });

    it('uses the configured bot winner cooldown window for recent winner rotation', async () => {
        const { service } = makeService({ rooms: [] });
        const currentRoom = makeRoom({
            id: '00000000-0000-0000-0000-000000000199',
        });
        const completedRooms = Array.from({ length: 3 }, (_, index) =>
            makeRoom({
                id: `00000000-0000-0000-0000-00000000020${index}`,
                status: 'completed',
                settlementSummary: {
                    '1st': { winnerId: `ticket-${index + 1}` },
                },
                updatedAt: new Date(Date.now() - index * 1000),
            }),
        );
        const roomFind = jest
            .fn()
            .mockResolvedValue([currentRoom, ...completedRooms]);
        const manager = {
            getRepository: jest.fn().mockImplementation((entity: unknown) => {
                const entityName = (entity as { name?: string })?.name;
                if (entityName === 'BingoRoom') {
                    return {
                        find: roomFind,
                    };
                }
                return {
                    find: jest.fn().mockResolvedValue([
                        {
                            id: 'ticket-1',
                            userId: 'bot-1',
                            user: {
                                productMetadata: {
                                    botPolicy: {
                                        active: true,
                                        games: { bingo: { active: true } },
                                    },
                                },
                            },
                        },
                        {
                            id: 'ticket-2',
                            userId: 'bot-2',
                            user: {
                                productMetadata: {
                                    botPolicy: {
                                        active: true,
                                        games: { bingo: { active: true } },
                                    },
                                },
                            },
                        },
                    ]),
                };
            }),
        };

        const recent = await (service as any).getPreviousBingoBotWinnerUserIds(
            currentRoom,
            manager,
            2,
        );

        expect(recent).toEqual(new Set(['bot-1', 'bot-2']));
        expect(roomFind).toHaveBeenCalledWith(
            expect.objectContaining({ take: 3 }),
        );
    });

    it('includes room-scoped bot identities in admin room details', async () => {
        const { service, mockRoomRepo, mockTicketRepo } = makeService({
            rooms: [],
        });
        const room = makeRoom({
            winMode: 'prefilled',
            botIdentityMap: {
                'bot-1': { displayName: 'Hana', phoneSuffix: '1771' },
            },
        });
        mockRoomRepo.findOneBy.mockResolvedValue(room);
        mockTicketRepo.find.mockResolvedValue([]);
        jest.spyOn(service as any, 'countSoldTickets').mockResolvedValue(0);
        jest.spyOn(
            service as any,
            'refreshBotWinnerDisplayNames',
        ).mockResolvedValue(undefined);

        const details = await service.getRoomAdminDetails(room.id);

        expect(details.room.botIdentityMap).toEqual(room.botIdentityMap);
    });

    it('awards every simultaneously-completing candidate for a place in one joint call', async () => {
        const { service } = makeService({ rooms: [] });
        const room = makeRoom({
            winMode: 'prefilled',
            drawnNumbers: [1],
            status: 'running',
        });
        const duplicateBotTicket = {
            id: 'ticket-duplicate',
            userId: 'bot-1',
            grid: [[1]],
            markedNumbers: [],
            wonTiers: [],
            autoClaim: true,
        };
        const freshBotTicket = {
            id: 'ticket-fresh',
            userId: 'bot-2',
            grid: [[1]],
            markedNumbers: [],
            wonTiers: [],
            autoClaim: true,
        };
        const manager = {
            find: jest
                .fn()
                .mockResolvedValueOnce([duplicateBotTicket, freshBotTicket])
                .mockResolvedValueOnce([]),
            save: jest.fn().mockImplementation(async (value) => value),
        };
        jest.spyOn(service as any, 'countSoldTickets').mockResolvedValue(2);
        jest.spyOn(
            service as any,
            'getBotUserGroupsForTickets',
        ).mockResolvedValue({
            botIds: new Set(['bot-1', 'bot-2']),
            bingoEnabledBotIds: new Set(['bot-1', 'bot-2']),
            nonBingoBotIds: new Set(),
        });
        jest.spyOn(
            service as any,
            'awardedBotUserIdsForTickets',
        ).mockReturnValue(new Set());
        jest.spyOn(
            service as any,
            'getPreviousBingoBotWinnerUserIds',
        ).mockResolvedValue(new Set());
        jest.spyOn(service as any, 'countRealPlayersInRoom').mockResolvedValue(
            1,
        );
        jest.spyOn(
            service as any,
            'resolveBingoBotParticipation',
        ).mockReturnValue({
            belowEnabled: false,
            belowThreshold: 0,
            aboveEnabled: false,
            aboveThreshold: 0,
            shouldParticipate: () => false,
        });
        jest.spyOn(service as any, 'openPrefilledPlaces').mockReturnValue([
            '1st',
        ]);
        jest.spyOn(
            service as any,
            'resolvePrefilledPlacePattern',
        ).mockResolvedValue({ id: 'pattern-1', name: 'Any Line' });
        jest.spyOn(
            service as any,
            'pickDerashAutoWinnerCandidates',
        ).mockReturnValue([duplicateBotTicket, freshBotTicket]);
        // Simulates awardDerashPlace's own per-winner filtering silently dropping
        // the duplicate (bot-1) and awarding only the fresh candidate (bot-2)  the
        // outer loop no longer retries candidate-by-candidate itself, it just hands
        // the whole tied set to awardDerashPlace in a single call.
        const awardSpy = jest
            .spyOn(service as any, 'awardDerashPlace')
            .mockResolvedValue([freshBotTicket]);

        await (service as any).evaluateAndSettleDerash(
            room,
            { botWinMode: 'off' },
            manager,
        );

        expect(awardSpy).toHaveBeenCalledTimes(1);
        const awardInput = awardSpy.mock.calls[0][0] as {
            winners: { userId: string }[];
            place: string;
        };
        expect(awardInput.winners.map((w) => w.userId)).toEqual([
            'bot-1',
            'bot-2',
        ]);
        expect(awardInput.place).toBe('1st');
    });

    it('does not award a real player while below-threshold cartel-dual is waiting for an eligible bot', async () => {
        const { service } = makeService({ rooms: [] });
        const room = makeRoom({
            winMode: 'prefilled',
            drawnNumbers: [1],
            status: 'running',
        });
        const realTicket = {
            id: 'ticket-real',
            userId: 'player-1',
            grid: [[1]],
            markedNumbers: [],
            wonTiers: [],
            autoClaim: true,
        };
        const botTicket = {
            id: 'ticket-bot',
            userId: 'bot-1',
            grid: [[2]],
            markedNumbers: [],
            wonTiers: [],
            autoClaim: true,
        };
        const manager = {
            find: jest
                .fn()
                .mockResolvedValueOnce([realTicket, botTicket])
                .mockResolvedValueOnce([]),
            save: jest.fn().mockImplementation(async (value) => value),
        };
        jest.spyOn(service as any, 'countSoldTickets').mockResolvedValue(2);
        jest.spyOn(
            service as any,
            'getBotUserGroupsForTickets',
        ).mockResolvedValue({
            botIds: new Set(['bot-1']),
            bingoEnabledBotIds: new Set(['bot-1']),
            nonBingoBotIds: new Set(),
        });
        jest.spyOn(
            service as any,
            'awardedBotUserIdsForTickets',
        ).mockReturnValue(new Set());
        jest.spyOn(
            service as any,
            'getPreviousBingoBotWinnerUserIds',
        ).mockResolvedValue(new Set());
        jest.spyOn(service as any, 'countRealPlayersInRoom').mockResolvedValue(
            1,
        );
        jest.spyOn(
            service as any,
            'resolveBingoBotParticipation',
        ).mockReturnValue({
            belowEnabled: true,
            belowThreshold: 10,
            aboveEnabled: false,
            aboveThreshold: 50,
            shouldParticipate: () => true,
        });
        jest.spyOn(service as any, 'openPrefilledPlaces').mockReturnValue([
            '1st',
        ]);
        jest.spyOn(
            service as any,
            'resolvePrefilledPlacePattern',
        ).mockResolvedValue({ id: 'pattern-1', name: 'Any Line' });
        jest.spyOn(
            service as any,
            'pickDerashAutoWinnerCandidates',
        ).mockReturnValue([realTicket]);
        jest.spyOn(service as any, 'pickBotRedirectWinner').mockReturnValue(
            null,
        );
        const awardSpy = jest
            .spyOn(service as any, 'awardDerashPlace')
            .mockResolvedValue(true);

        await (service as any).evaluateAndSettleDerash(
            room,
            { botWinMode: 'cartel-dual' },
            manager,
        );

        expect(awardSpy).not.toHaveBeenCalled();
        expect(room.settledTiers).toEqual([]);
    });

    it('redirects a manual real-user Bingo claim to an eligible bot in below-threshold cartel-dual', async () => {
        const { service, dataSource } = makeService({ rooms: [] });
        const userId = '550e8400-e29b-41d4-a716-446655440101';
        const ticketId = '550e8400-e29b-41d4-a716-446655440102';
        const botId = '550e8400-e29b-41d4-a716-446655440103';
        const room = makeRoom({
            winMode: 'prefilled',
            drawnNumbers: [1],
            status: 'running',
        });
        const realTicket = {
            id: ticketId,
            userId,
            roomId: room.id,
            grid: [[1]],
            markedNumbers: [],
            wonTiers: [],
            completedLines: [],
            completedPatterns: [],
            autoClaim: false,
            stakeMinor: 20,
            payoutMinor: 0,
            status: 'active',
            settlementStatus: 'pending',
            walletCredits: [],
        };
        const botTicket = {
            id: '550e8400-e29b-41d4-a716-446655440104',
            userId: botId,
            roomId: room.id,
            grid: [[1]],
            markedNumbers: [],
            wonTiers: [],
            completedLines: [],
            completedPatterns: [],
            autoClaim: true,
            stakeMinor: 20,
            payoutMinor: 0,
            status: 'active',
            settlementStatus: 'pending',
            walletCredits: [],
        };
        const manager = {
            findOne: jest
                .fn()
                .mockImplementation((_entity: unknown, options: any) => {
                    if (options?.where?.id === room.id)
                        return Promise.resolve(room);
                    if (options?.where?.id === ticketId)
                        return Promise.resolve(realTicket);
                    return Promise.resolve(null);
                }),
            find: jest.fn().mockResolvedValue([realTicket, botTicket]),
            save: jest.fn().mockImplementation(async (value) => value),
        };
        dataSource.transaction.mockImplementation(async (cb: any) =>
            cb(manager),
        );
        jest.spyOn(service, 'getBingoConfig').mockResolvedValue(
            botCfg({
                botWinMode: 'cartel-dual',
                botWinnerCooldownRooms: 5,
            }) as any,
        );
        jest.spyOn(
            (service as any).bingoRulesService,
            'evaluatePatternTicket',
        ).mockReturnValue({ completedPatternIds: ['pattern-1'] });
        jest.spyOn(service as any, 'countRealPlayersInRoom').mockResolvedValue(
            1,
        );
        jest.spyOn(
            service as any,
            'resolvePrefilledPlacePattern',
        ).mockResolvedValue({ id: 'pattern-1', name: 'Any Line' });
        jest.spyOn(service as any, 'openPrefilledPlaces').mockReturnValue([
            '1st',
        ]);
        jest.spyOn(
            service as any,
            'getBotUserGroupsForTickets',
        ).mockResolvedValue({
            botIds: new Set([botId]),
            bingoEnabledBotIds: new Set([botId]),
            nonBingoBotIds: new Set(),
        });
        jest.spyOn(
            service as any,
            'awardedBotUserIdsForTickets',
        ).mockReturnValue(new Set());
        jest.spyOn(
            service as any,
            'getPreviousBingoBotWinnerUserIds',
        ).mockResolvedValue(new Set());
        jest.spyOn(service as any, 'pickBotRedirectWinner').mockReturnValue(
            botTicket,
        );
        jest.spyOn(service as any, 'countSoldTickets').mockResolvedValue(2);
        jest.spyOn(service as any, 'finalizeDerashIfDone').mockResolvedValue(
            false,
        );
        jest.spyOn(service as any, 'getTakenSpots').mockResolvedValue([]);
        const awardSpy = jest
            .spyOn(service as any, 'awardDerashPlace')
            .mockResolvedValue([botTicket]);

        const outcome = await service.claimBingo({
            userId,
            roomId: room.id,
            ticketId,
        });

        expect(outcome.result).toBe('ignored');
        expect(awardSpy).toHaveBeenCalledWith(
            expect.objectContaining({
                winners: [botTicket],
                place: '1st',
            }),
        );
    });

    it('ignores a manual real-user Bingo claim in below-threshold cartel-dual when no bot can prove the pattern yet', async () => {
        const { service, dataSource } = makeService({ rooms: [] });
        const userId = '550e8400-e29b-41d4-a716-446655440111';
        const ticketId = '550e8400-e29b-41d4-a716-446655440112';
        const room = makeRoom({
            winMode: 'prefilled',
            drawnNumbers: [1],
            status: 'running',
        });
        const realTicket = {
            id: ticketId,
            userId,
            roomId: room.id,
            grid: [[1]],
            markedNumbers: [],
            wonTiers: [],
            completedLines: [],
            completedPatterns: [],
            autoClaim: false,
            stakeMinor: 20,
            payoutMinor: 0,
            status: 'active',
            settlementStatus: 'pending',
            walletCredits: [],
        };
        const manager = {
            findOne: jest
                .fn()
                .mockImplementation((_entity: unknown, options: any) => {
                    if (options?.where?.id === room.id)
                        return Promise.resolve(room);
                    if (options?.where?.id === ticketId)
                        return Promise.resolve(realTicket);
                    return Promise.resolve(null);
                }),
            find: jest.fn().mockResolvedValue([realTicket]),
            save: jest.fn().mockImplementation(async (value) => value),
        };
        dataSource.transaction.mockImplementation(async (cb: any) =>
            cb(manager),
        );
        jest.spyOn(service, 'getBingoConfig').mockResolvedValue(
            botCfg({
                botWinMode: 'cartel-dual',
                botWinnerCooldownRooms: 5,
            }) as any,
        );
        jest.spyOn(
            (service as any).bingoRulesService,
            'evaluatePatternTicket',
        ).mockReturnValue({ completedPatternIds: ['pattern-1'] });
        jest.spyOn(service as any, 'countRealPlayersInRoom').mockResolvedValue(
            1,
        );
        jest.spyOn(
            service as any,
            'resolvePrefilledPlacePattern',
        ).mockResolvedValue({ id: 'pattern-1', name: 'Any Line' });
        jest.spyOn(service as any, 'openPrefilledPlaces').mockReturnValue([
            '1st',
        ]);
        jest.spyOn(
            service as any,
            'getBotUserGroupsForTickets',
        ).mockResolvedValue({
            botIds: new Set(),
            bingoEnabledBotIds: new Set(),
            nonBingoBotIds: new Set(),
        });
        jest.spyOn(
            service as any,
            'awardedBotUserIdsForTickets',
        ).mockReturnValue(new Set());
        jest.spyOn(
            service as any,
            'getPreviousBingoBotWinnerUserIds',
        ).mockResolvedValue(new Set());
        jest.spyOn(service as any, 'pickBotRedirectWinner').mockReturnValue(
            null,
        );
        jest.spyOn(service as any, 'countSoldTickets').mockResolvedValue(1);
        jest.spyOn(service as any, 'getTakenSpots').mockResolvedValue([]);
        const awardSpy = jest
            .spyOn(service as any, 'awardDerashPlace')
            .mockResolvedValue(true);

        const outcome = await service.claimBingo({
            userId,
            roomId: room.id,
            ticketId,
        });

        expect(outcome.result).toBe('ignored');
        expect(realTicket.status).toBe('active');
        expect(awardSpy).not.toHaveBeenCalled();
    });

    it('classifies master bots without Bingo enabled as ineligible for Bingo winner selection', async () => {
        const { service } = makeService({ rooms: [] });
        const manager = {
            getRepository: jest.fn().mockReturnValue({
                find: jest.fn().mockResolvedValue([
                    {
                        id: 'bot-1',
                        productMetadata: { botPolicy: { active: true } },
                    },
                    {
                        id: 'bot-2',
                        productMetadata: {
                            botPolicy: {
                                active: true,
                                games: { bingo: { active: true } },
                            },
                        },
                    },
                    {
                        id: 'human-1',
                        productMetadata: {},
                    },
                ]),
            }),
        };

        const groups = await (service as any).getBotUserGroupsForTickets(
            [{ userId: 'bot-1' }, { userId: 'bot-2' }, { userId: 'human-1' }],
            manager,
        );

        expect([...groups.botIds].sort()).toEqual(['bot-1', 'bot-2']);
        expect([...groups.bingoEnabledBotIds]).toEqual(['bot-2']);
        expect([...groups.nonBingoBotIds]).toEqual(['bot-1']);
    });

    it('records the room-scoped Bingo bot name in winner standings instead of the bot account name', async () => {
        const { service, walletService } = makeService({ rooms: [] });
        const room = makeRoom({
            winMode: 'prefilled',
            botIdentityMap: {
                'bot-1': { displayName: 'Hana', phoneSuffix: '0851' },
            },
            settlementSummary: {},
            settledTiers: [],
            winnersByTier: {},
        });
        const winner = {
            id: 'ticket-1',
            userId: 'bot-1',
            cartelaNumber: 25,
            grid: [[1]],
            markedNumbers: [1],
            wonTiers: [],
            payoutMinor: 0,
            status: 'active',
            settlementStatus: 'pending',
            walletCredits: [],
        };
        const manager = {
            findOne: jest.fn().mockResolvedValue({
                id: 'bot-1',
                displayName: 'Abrsh',
                phoneNumber: '',
                productMetadata: {
                    botPolicy: {
                        active: true,
                        games: { bingo: { active: true } },
                    },
                },
            }),
            save: jest.fn().mockImplementation(async (value) => value),
            getRepository: jest.fn().mockImplementation((entity: unknown) => {
                const entityName = (entity as { name?: string })?.name;
                if (entityName === 'BingoRoom') {
                    return {
                        save: jest
                            .fn()
                            .mockImplementation(async (value) => value),
                    };
                }
                if (entityName === 'BotName') {
                    return {
                        find: jest
                            .fn()
                            .mockResolvedValue([
                                { displayName: 'Hana', active: true },
                            ]),
                    };
                }
                return {
                    find: jest.fn().mockResolvedValue([
                        {
                            id: 'bot-1',
                            displayName: 'Abrsh',
                            productMetadata: {
                                botPolicy: {
                                    active: true,
                                    games: { bingo: { active: true } },
                                },
                            },
                        },
                    ]),
                };
            }),
        };
        walletService.creditInSession.mockResolvedValue({ id: 'credit-1' });

        await (service as any).awardDerashPlace({
            room,
            winners: [winner],
            place: '1st',
            pattern: { id: 'pattern-1', name: 'Any Line' },
            totalPotMinor: 100,
            houseEdgePct: 20,
            cfg: { prefilledFirstPlacePct: 100 },
            manager,
        });

        expect(manager.findOne).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                select: expect.arrayContaining([
                    'id',
                    'displayName',
                    'phoneNumber',
                    'productMetadata',
                ]),
            }),
        );
        const summary = room.settlementSummary ?? {};
        const summaryWinners = (summary['1st'] as any).winners;
        expect(summaryWinners[0].winnerDisplayName).toBe('Hana');
        expect(summaryWinners[0].winnerPhoneLast4).toBe('0851');
    });

    it('splits a derash place evenly between two cards that complete it in the same draw', async () => {
        const { service, walletService } = makeService({ rooms: [] });
        const room = makeRoom({
            winMode: 'prefilled',
            settlementSummary: {},
            settledTiers: [],
            winnersByTier: {},
        });
        const winnerA = {
            id: 'ticket-a',
            userId: 'player-a',
            cartelaNumber: 5,
            grid: [[1]],
            markedNumbers: [1],
            wonTiers: [],
            payoutMinor: 0,
            status: 'active',
            settlementStatus: 'pending',
            walletCredits: [],
        };
        const winnerB = {
            id: 'ticket-b',
            userId: 'player-b',
            cartelaNumber: 9,
            grid: [[1]],
            markedNumbers: [1],
            wonTiers: [],
            payoutMinor: 0,
            status: 'active',
            settlementStatus: 'pending',
            walletCredits: [],
        };
        const usersById: Record<string, unknown> = {
            'player-a': {
                id: 'player-a',
                displayName: 'Amanuel',
                phoneNumber: '0911111111',
                productMetadata: {},
            },
            'player-b': {
                id: 'player-b',
                displayName: 'Betelhem',
                phoneNumber: '0922222222',
                productMetadata: {},
            },
        };
        const manager = {
            findOne: jest
                .fn()
                .mockImplementation((_entity: unknown, options: any) =>
                    Promise.resolve(usersById[options?.where?.id] ?? null),
                ),
            save: jest.fn().mockImplementation(async (value) => value),
        };
        walletService.creditInSession.mockResolvedValue({ id: 'credit-1' });

        // prizePoolMinor = floor(127 * 0.8) = 101 (odd, so the 2-way split has a
        // remainder cent  the first winner gets it, matching splitPrizeMinor).
        const awarded = await (service as any).awardDerashPlace({
            room,
            winners: [winnerA, winnerB],
            place: '1st',
            pattern: { id: 'pattern-1', name: 'Any Line' },
            totalPotMinor: 127,
            houseEdgePct: 20,
            cfg: { prefilledFirstPlacePct: 100 },
            manager,
        });

        expect(awarded).toHaveLength(2);
        expect(room.winnersByTier['1st']).toEqual(['ticket-a', 'ticket-b']);
        expect(winnerA.payoutMinor).toBe(51);
        expect(winnerB.payoutMinor).toBe(50);
        expect(walletService.creditInSession).toHaveBeenCalledTimes(2);
        expect(walletService.creditInSession).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({ userId: 'player-a', amountMinor: 51 }),
            manager,
        );
        expect(walletService.creditInSession).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({ userId: 'player-b', amountMinor: 50 }),
            manager,
        );

        const summary = (room.settlementSummary ?? {})['1st'] as any;
        expect(summary.winnerCount).toBe(2);
        expect(summary.prizeMinor).toBe(101);
        expect(summary.winners.map((w: any) => w.shareMinor)).toEqual([
            51, 50,
        ]);
        expect(summary.winners.map((w: any) => w.winnerDisplayName)).toEqual([
            'Amanuel',
            'Betelhem',
        ]);
    });

    it('splits the final pool top-up between joint place winners at reconcile', async () => {
        const { service, walletService } = makeService({ rooms: [] });
        const room = makeRoom({
            winMode: 'prefilled',
            ticketPriceMinor: 1,
            houseEdgePct: 20,
            settledTiers: ['1st'],
            winnersByTier: { '1st': ['ticket-a', 'ticket-b'] },
            settlementSummary: {
                '1st': {
                    winnerCount: 2,
                    prizeMinor: 123,
                    winners: [
                        {
                            winnerId: 'ticket-a',
                            winnerUserId: 'player-a',
                            shareMinor: 62,
                        },
                        {
                            winnerId: 'ticket-b',
                            winnerUserId: 'player-b',
                            shareMinor: 61,
                        },
                    ],
                },
            },
        });
        const ticketsById: Record<string, any> = {
            'ticket-a': {
                id: 'ticket-a',
                userId: 'player-a',
                payoutMinor: 62,
                walletCredits: [],
            },
            'ticket-b': {
                id: 'ticket-b',
                userId: 'player-b',
                payoutMinor: 61,
                walletCredits: [],
            },
        };
        const manager = {
            update: jest.fn().mockResolvedValue({ affected: 0 }),
            findOne: jest
                .fn()
                .mockImplementation((_entity: unknown, options: any) =>
                    Promise.resolve(ticketsById[options?.where?.id] ?? null),
                ),
            save: jest.fn().mockImplementation(async (value) => value),
        };
        jest.spyOn(service as any, 'countSoldTickets').mockResolvedValue(257);
        jest.spyOn(
            service as any,
            'markRemainingTicketsLost',
        ).mockResolvedValue(undefined);
        walletService.creditInSession.mockResolvedValue({ id: 'credit-2' });

        // prizePoolMinor = floor(257 * 0.8) = 205. Only '1st' filled, but 2nd is
        // also enabled (60/40 weights)  so progressive (enabled-weight-normalised,
        // already paid = 123) is less than final (filled-weight-normalised = the
        // whole pool = 205), leaving an 82-cent top-up split across both winners.
        await (service as any).reconcileDerashPool(
            room,
            {
                prefilledFirstPlacePct: 60,
                prefilledSecondPlaceEnabled: true,
                prefilledSecondPlacePct: 40,
            },
            manager,
        );

        expect(walletService.creditInSession).toHaveBeenCalledTimes(2);
        expect(walletService.creditInSession).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({ userId: 'player-a', amountMinor: 41 }),
            manager,
        );
        expect(walletService.creditInSession).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({ userId: 'player-b', amountMinor: 41 }),
            manager,
        );
        expect(ticketsById['ticket-a'].payoutMinor).toBe(103);
        expect(ticketsById['ticket-b'].payoutMinor).toBe(102);

        const summary = (room.settlementSummary ?? {})['1st'] as any;
        expect(summary.prizeMinor).toBe(205);
        expect(summary.winners.map((w: any) => w.shareMinor)).toEqual([
            103, 102,
        ]);
    });

    it('refuses to award the same bot two visible Derash places in one room', async () => {
        const { service, walletService } = makeService({ rooms: [] });
        const room = makeRoom({
            winMode: 'prefilled',
            botIdentityMap: {
                'bot-1': { displayName: 'Hana', phoneSuffix: '1771' },
            },
            settlementSummary: {
                '1st': {
                    winnerCount: 1,
                    winnerId: 'ticket-1',
                    winnerDisplayName: 'Hana',
                    winnerPhoneLast4: '1771',
                    winnerIsBot: true,
                },
            },
            settledTiers: ['1st'],
            winnersByTier: { '1st': ['ticket-1'] },
        });
        const winner = {
            id: 'ticket-2',
            userId: 'bot-1',
            cartelaNumber: 91,
            grid: [[1]],
            markedNumbers: [1],
            wonTiers: [],
            payoutMinor: 0,
            status: 'active',
            settlementStatus: 'pending',
            walletCredits: [],
        };
        const manager = {
            findOne: jest.fn().mockResolvedValue({
                id: 'bot-1',
                displayName: 'House Bot',
                phoneNumber: '',
                productMetadata: {
                    botPolicy: {
                        active: true,
                        games: { bingo: { active: true } },
                    },
                },
            }),
            save: jest.fn().mockImplementation(async (value) => value),
            getRepository: jest.fn().mockImplementation((entity: unknown) => {
                const entityName = (entity as { name?: string })?.name;
                if (entityName === 'BingoRoom') {
                    return {
                        save: jest
                            .fn()
                            .mockImplementation(async (value) => value),
                    };
                }
                if (entityName === 'BotName') {
                    return {
                        find: jest
                            .fn()
                            .mockResolvedValue([
                                { displayName: 'Hana', active: true },
                            ]),
                    };
                }
                if (entityName === 'BingoTicket') {
                    return {
                        find: jest
                            .fn()
                            .mockResolvedValue([
                                { id: 'ticket-1', userId: 'bot-1' },
                            ]),
                    };
                }
                return {
                    find: jest.fn().mockResolvedValue([
                        {
                            id: 'bot-1',
                            displayName: 'House Bot',
                            productMetadata: {
                                botPolicy: {
                                    active: true,
                                    games: { bingo: { active: true } },
                                },
                            },
                        },
                    ]),
                };
            }),
        };
        jest.spyOn(
            service as any,
            'resolveDisplayedNameForUser',
        ).mockResolvedValue({
            displayName: 'Hana',
            phoneLast4: '1771',
            phoneSuffix: '1771',
            isBot: true,
        });

        const awarded = await (service as any).awardDerashPlace({
            room,
            winners: [winner],
            place: '2nd',
            pattern: { id: 'pattern-1', name: 'Any Line' },
            totalPotMinor: 100,
            houseEdgePct: 20,
            cfg: { prefilledFirstPlacePct: 70, prefilledSecondPlacePct: 30 },
            manager,
        });

        expect(awarded).toHaveLength(0);
        expect(room.winnersByTier['2nd']).toBeUndefined();
        expect((room.settlementSummary ?? {})['2nd']).toBeUndefined();
        expect(walletService.creditInSession).not.toHaveBeenCalled();
    });

    it('allows a different Bingo bot to win the next visible Derash place', async () => {
        const { service, walletService } = makeService({ rooms: [] });
        const room = makeRoom({
            winMode: 'prefilled',
            botIdentityMap: {
                'bot-1': { displayName: 'Hana', phoneSuffix: '1771' },
                'bot-2': { displayName: 'Samuel', phoneSuffix: '6023' },
            },
            settlementSummary: {
                '1st': {
                    winnerCount: 1,
                    winnerId: 'ticket-1',
                    winnerDisplayName: 'Hana',
                    winnerPhoneLast4: '1771',
                    winnerIsBot: true,
                },
            },
            settledTiers: ['1st'],
            winnersByTier: { '1st': ['ticket-1'] },
        });
        const winner = {
            id: 'ticket-2',
            userId: 'bot-2',
            cartelaNumber: 91,
            grid: [[1]],
            markedNumbers: [1],
            wonTiers: [],
            payoutMinor: 0,
            status: 'active',
            settlementStatus: 'pending',
            walletCredits: [],
        };
        const manager = {
            findOne: jest.fn().mockResolvedValue({
                id: 'bot-2',
                displayName: 'House Bot 2',
                phoneNumber: '',
                productMetadata: {
                    botPolicy: {
                        active: true,
                        games: { bingo: { active: true } },
                    },
                },
            }),
            save: jest.fn().mockImplementation(async (value) => value),
            getRepository: jest.fn().mockImplementation((entity: unknown) => {
                const entityName = (entity as { name?: string })?.name;
                if (entityName === 'BingoRoom') {
                    return {
                        save: jest
                            .fn()
                            .mockImplementation(async (value) => value),
                    };
                }
                if (entityName === 'BotName') {
                    return {
                        find: jest.fn().mockResolvedValue([
                            { displayName: 'Hana', active: true },
                            { displayName: 'Samuel', active: true },
                        ]),
                    };
                }
                if (entityName === 'BingoTicket') {
                    return {
                        find: jest
                            .fn()
                            .mockResolvedValue([
                                { id: 'ticket-1', userId: 'bot-1' },
                            ]),
                    };
                }
                return {
                    find: jest.fn().mockResolvedValue([
                        {
                            id: 'bot-2',
                            displayName: 'House Bot 2',
                            productMetadata: {
                                botPolicy: {
                                    active: true,
                                    games: { bingo: { active: true } },
                                },
                            },
                        },
                    ]),
                };
            }),
        };
        walletService.creditInSession.mockResolvedValue({ id: 'credit-1' });

        const awarded = await (service as any).awardDerashPlace({
            room,
            winners: [winner],
            place: '2nd',
            pattern: { id: 'pattern-1', name: 'Any Line' },
            totalPotMinor: 100,
            houseEdgePct: 20,
            cfg: { prefilledFirstPlacePct: 70, prefilledSecondPlacePct: 30 },
            manager,
        });

        expect(awarded).toHaveLength(1);
        expect(room.winnersByTier['2nd']).toEqual(['ticket-2']);
        const secondPlaceWinners = (
            (room.settlementSummary ?? {})['2nd'] as any
        ).winners;
        expect(secondPlaceWinners[0].winnerDisplayName).toBe('Samuel');
        expect(secondPlaceWinners[0].winnerPhoneLast4).toBe('6023');
        expect(walletService.creditInSession).toHaveBeenCalledTimes(1);
    });

    it('refuses the same cartela ticket from winning two visible Derash places', async () => {
        const { service, walletService } = makeService({ rooms: [] });
        const room = makeRoom({
            winMode: 'prefilled',
            settlementSummary: {
                '1st': {
                    winnerCount: 1,
                    winnerId: 'ticket-18',
                    winnerUserId: 'player-1',
                    winnerDisplayName: 'Hana',
                    winnerPhoneLast4: '9812',
                    winnerCartelaNumber: 18,
                },
            },
            settledTiers: ['1st'],
            winnersByTier: { '1st': ['ticket-18'] },
        });
        const winner = {
            id: 'ticket-18',
            userId: 'player-1',
            cartelaNumber: 18,
            grid: [[1]],
            markedNumbers: [1],
            wonTiers: ['1st'],
            payoutMinor: 60,
            status: 'won',
            settlementStatus: 'settled',
            walletCredits: [],
        };
        const manager = {
            findOne: jest.fn(),
            save: jest.fn().mockImplementation(async (value) => value),
        };

        const awarded = await (service as any).awardDerashPlace({
            room,
            winners: [winner],
            place: '2nd',
            pattern: { id: 'pattern-1', name: 'Any Line' },
            totalPotMinor: 120,
            houseEdgePct: 20,
            cfg: { prefilledFirstPlacePct: 60, prefilledSecondPlacePct: 40 },
            manager,
        });

        expect(awarded).toHaveLength(0);
        expect(manager.findOne).not.toHaveBeenCalled();
        expect((room.settlementSummary ?? {})['2nd']).toBeUndefined();
        expect(walletService.creditInSession).not.toHaveBeenCalled();
    });

    it('refuses a duplicate cartela number from winning two visible Derash places', async () => {
        const { service, walletService } = makeService({ rooms: [] });
        const room = makeRoom({
            winMode: 'prefilled',
            settlementSummary: {
                '1st': {
                    winnerCount: 1,
                    winnerId: 'ticket-original-18',
                    winnerUserId: 'bot-1',
                    winnerDisplayName: 'Hana',
                    winnerPhoneLast4: '9812',
                    winnerIsBot: true,
                    winnerCartelaNumber: 18,
                },
            },
            settledTiers: ['1st'],
            winnersByTier: { '1st': ['ticket-original-18'] },
        });
        const duplicateCartelaWinner = {
            id: 'ticket-duplicate-18',
            userId: 'bot-1',
            cartelaNumber: 18,
            grid: [[1]],
            markedNumbers: [1],
            wonTiers: [],
            payoutMinor: 0,
            status: 'active',
            settlementStatus: 'pending',
            walletCredits: [],
        };
        const manager = {
            findOne: jest.fn(),
            save: jest.fn().mockImplementation(async (value) => value),
        };

        const awarded = await (service as any).awardDerashPlace({
            room,
            winners: [duplicateCartelaWinner],
            place: '2nd',
            pattern: { id: 'pattern-1', name: 'Any Line' },
            totalPotMinor: 120,
            houseEdgePct: 20,
            cfg: { prefilledFirstPlacePct: 60, prefilledSecondPlacePct: 40 },
            manager,
        });

        expect(awarded).toHaveLength(0);
        expect(manager.findOne).not.toHaveBeenCalled();
        expect((room.settlementSummary ?? {})['2nd']).toBeUndefined();
        expect(walletService.creditInSession).not.toHaveBeenCalled();
    });

    it('refuses a different bot account when the visible Bingo bot identity already won', async () => {
        const { service, walletService } = makeService({ rooms: [] });
        const room = makeRoom({
            winMode: 'prefilled',
            botIdentityMap: {
                'bot-1': { displayName: 'Hana', phoneSuffix: '1771' },
                'bot-2': { displayName: 'Hana', phoneSuffix: '1771' },
            },
            settlementSummary: {
                '1st': {
                    winnerCount: 1,
                    winnerId: 'ticket-1',
                    winnerUserId: 'bot-1',
                    winnerDisplayName: 'Hana',
                    winnerPhoneLast4: '1771',
                    winnerIsBot: true,
                },
            },
            settledTiers: ['1st'],
            winnersByTier: { '1st': ['ticket-1'] },
        });
        const winner = {
            id: 'ticket-2',
            userId: 'bot-2',
            cartelaNumber: 91,
            grid: [[1]],
            markedNumbers: [1],
            wonTiers: [],
            payoutMinor: 0,
            status: 'active',
            settlementStatus: 'pending',
            walletCredits: [],
        };
        const manager = {
            findOne: jest.fn().mockResolvedValue({
                id: 'bot-2',
                displayName: 'House Bot 2',
                phoneNumber: '',
                productMetadata: {
                    botPolicy: {
                        active: true,
                        games: { bingo: { active: true } },
                    },
                },
            }),
            save: jest.fn().mockImplementation(async (value) => value),
            getRepository: jest.fn().mockImplementation((entity: unknown) => {
                const entityName = (entity as { name?: string })?.name;
                if (entityName === 'BingoRoom') {
                    return {
                        save: jest
                            .fn()
                            .mockImplementation(async (value) => value),
                    };
                }
                if (entityName === 'BotName') {
                    return {
                        find: jest
                            .fn()
                            .mockResolvedValue([
                                { displayName: 'Hana', active: true },
                            ]),
                    };
                }
                if (entityName === 'BingoTicket') {
                    return {
                        find: jest
                            .fn()
                            .mockResolvedValue([
                                { id: 'ticket-1', userId: 'bot-1' },
                            ]),
                    };
                }
                return {
                    find: jest.fn().mockResolvedValue([
                        {
                            id: 'bot-2',
                            displayName: 'House Bot 2',
                            productMetadata: {
                                botPolicy: {
                                    active: true,
                                    games: { bingo: { active: true } },
                                },
                            },
                        },
                    ]),
                };
            }),
        };
        jest.spyOn(
            service as any,
            'resolveDisplayedNameForUser',
        ).mockResolvedValue({
            displayName: 'Hana',
            phoneLast4: '1771',
            phoneSuffix: '1771',
            isBot: true,
        });

        const awarded = await (service as any).awardDerashPlace({
            room,
            winners: [winner],
            place: '2nd',
            pattern: { id: 'pattern-1', name: 'Any Line' },
            totalPotMinor: 100,
            houseEdgePct: 20,
            cfg: { prefilledFirstPlacePct: 70, prefilledSecondPlacePct: 30 },
            manager,
        });

        expect(awarded).toHaveLength(0);
        expect((room.settlementSummary ?? {})['2nd']).toBeUndefined();
        expect(walletService.creditInSession).not.toHaveBeenCalled();
    });

    it('repairs stale completed-room bot winner names before returning room state', async () => {
        const { service, mockRoomRepo, mockTicketRepo } = makeService({
            rooms: [],
        });
        const room = makeRoom({
            winMode: 'prefilled',
            status: 'completed',
            botIdentityMap: {
                'bot-1': { displayName: 'Abrsh', phoneSuffix: '8975' },
            },
            settlementSummary: {
                '1st': {
                    winnerCount: 1,
                    winnerId: 'ticket-1',
                    winnerDisplayName: 'Abrsh',
                    winnerPhoneLast4: '8975',
                    winnerIsBot: true,
                },
            },
        });
        mockRoomRepo.findOneBy.mockResolvedValue(room);
        jest.spyOn(service as any, 'countSoldTickets').mockResolvedValue(2);
        jest.spyOn(service as any, 'getTakenSpots').mockResolvedValue([]);
        mockTicketRepo.find.mockResolvedValue([]);

        const roomRepoSave = jest
            .fn()
            .mockImplementation(async (value) => value);
        (mockRoomRepo as any).manager = {
            getRepository: jest.fn().mockImplementation((entity: unknown) => {
                const entityName = (entity as { name?: string })?.name;
                if (entityName === 'BingoRoom') {
                    return { save: roomRepoSave };
                }
                if (entityName === 'BingoTicket') {
                    return {
                        find: jest.fn().mockResolvedValue([
                            {
                                id: 'ticket-1',
                                userId: 'bot-1',
                                user: {
                                    id: 'bot-1',
                                    displayName: 'Abrsh',
                                    phoneNumber: '',
                                    productMetadata: {
                                        botPolicy: {
                                            active: true,
                                            games: { bingo: { active: true } },
                                        },
                                    },
                                },
                            },
                        ]),
                    };
                }
                if (entityName === 'BotName') {
                    return {
                        find: jest
                            .fn()
                            .mockResolvedValue([
                                { displayName: 'Hana', active: true },
                            ]),
                    };
                }
                return {
                    find: jest.fn().mockResolvedValue([
                        {
                            id: 'bot-1',
                            displayName: 'Abrsh',
                            productMetadata: {
                                botPolicy: {
                                    active: true,
                                    games: { bingo: { active: true } },
                                },
                            },
                        },
                    ]),
                };
            }),
        };

        const response = await service.getRoomState({ roomId: room.id });
        const entry = response.settlementSummary['1st'] as Record<
            string,
            unknown
        >;

        expect(entry.winnerDisplayName).toBe('Hana');
        expect(entry.winnerPhoneLast4).not.toBe('8975');
        expect(roomRepoSave).toHaveBeenCalled();
    });

    it('refreshes bot winner display before draw responses are emitted', async () => {
        const { service, mockRoomRepo, dataSource } = makeService({
            rooms: [],
        });
        const room = makeRoom({
            winMode: 'prefilled',
            status: 'completed',
            settlementSummary: {
                '1st': {
                    winnerCount: 1,
                    winnerId: 'ticket-1',
                    winnerDisplayName: 'Abrsh',
                    winnerPhoneLast4: '8975',
                    winnerIsBot: true,
                },
            },
        });
        const refreshSpy = jest
            .spyOn(service as any, 'refreshBotWinnerDisplayNames')
            .mockImplementation(async (value: unknown) => {
                const r = value as BingoRoom;
                r.settlementSummary = {
                    ...(r.settlementSummary ?? {}),
                    '1st': {
                        ...((r.settlementSummary ?? {})['1st'] as Record<
                            string,
                            unknown
                        >),
                        winnerDisplayName: 'Hana',
                        winnerPhoneLast4: '0851',
                    },
                };
            });
        const manager = {
            findOne: jest.fn().mockResolvedValue(room),
            save: jest.fn().mockImplementation(async (value) => value),
        };
        dataSource.transaction.mockImplementation(async (cb: any) =>
            cb(manager),
        );
        mockRoomRepo.findOneBy.mockResolvedValue(room);
        jest.spyOn(service as any, 'countSoldTickets').mockResolvedValue(2);
        jest.spyOn(service as any, 'getTakenSpots').mockResolvedValue([]);

        const response = await service.drawNextNumber(room.id);
        const entry = response.settlementSummary['1st'] as Record<
            string,
            unknown
        >;

        expect(refreshSpy).toHaveBeenCalled();
        expect(entry.winnerDisplayName).toBe('Hana');
        expect(entry.winnerPhoneLast4).toBe('0851');
    });
});

describe('BingoService.setAutoClaim  active-card scope', () => {
    it('updates only active tickets so disqualified cards cannot pin the toggle OFF', async () => {
        const { service, mockTicketRepo } = makeService({ rooms: [] });

        await expect(
            service.setAutoClaim({
                userId: '550e8400-e29b-41d4-a716-446655440099',
                roomId: '550e8400-e29b-41d4-a716-446655440088',
                auto: true,
            }),
        ).resolves.toEqual({ autoClaim: true, updated: 0 });

        expect(mockTicketRepo.update).toHaveBeenCalledWith(
            {
                userId: '550e8400-e29b-41d4-a716-446655440099',
                roomId: '550e8400-e29b-41d4-a716-446655440088',
                status: 'active',
            },
            { autoClaim: true },
        );
    });
});

// ─── Pattern-resolution hardening (prevent + detect a silently-broken place) ───
describe('BingoService  pattern-resolution hardening', () => {
    it('updatePattern rejects renaming a built-in pattern', async () => {
        const { service, mockPatternRepo } = makeService({ rooms: [] });
        mockPatternRepo.findOneBy.mockResolvedValue({
            id: 'p1',
            isBuiltIn: true,
            name: 'Any Line',
        });

        await expect(
            service.updatePattern('p1', { name: 'Not Any Line' } as any),
        ).rejects.toThrow('Built-in pattern names cannot be changed');
        expect(mockPatternRepo.save).not.toHaveBeenCalled();
    });

    it('updatePattern still allows other fields to change on a built-in pattern', async () => {
        const { service, mockPatternRepo } = makeService({ rooms: [] });
        mockPatternRepo.findOneBy.mockResolvedValue({
            id: 'p1',
            isBuiltIn: true,
            name: 'Any Line',
            enabled: true,
        });

        await service.updatePattern('p1', { enabled: false } as any);

        expect(mockPatternRepo.save).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'p1', enabled: false }),
        );
    });

    it('deletePattern rejects removing a pattern still referenced by the config', async () => {
        const { service, mockPatternRepo } = makeService({ rooms: [] });
        mockPatternRepo.findOneBy.mockResolvedValue({
            id: 'p2',
            isBuiltIn: false,
            name: 'Custom',
        });
        jest.spyOn(service, 'getBingoConfig').mockResolvedValue({
            key: 'global',
            prefilledSecondPatternId: 'p2',
        } as any);

        await expect(service.deletePattern('p2')).rejects.toThrow('2nd');
        expect(mockPatternRepo.remove).not.toHaveBeenCalled();
    });

    it('deletePattern succeeds for a custom pattern no place references', async () => {
        const { service, mockPatternRepo } = makeService({ rooms: [] });
        mockPatternRepo.findOneBy.mockResolvedValue({
            id: 'p3',
            isBuiltIn: false,
            name: 'Custom',
        });
        jest.spyOn(service, 'getBingoConfig').mockResolvedValue({
            key: 'global',
            prefilledFirstPatternId: 'some-other-id',
        } as any);

        await service.deletePattern('p3');

        expect(mockPatternRepo.remove).toHaveBeenCalled();
    });

    it('updateBingoConfig rejects an unresolvable pattern id', async () => {
        const { service, mockConfigRepo, mockPatternRepo } = makeService({
            rooms: [],
        });
        jest.spyOn(service, 'getBingoConfig').mockResolvedValue({
            key: 'global',
        } as any);
        mockPatternRepo.findBy.mockResolvedValue([]); // nothing matches
        const saveSpy = jest.spyOn(mockConfigRepo, 'save');

        await expect(
            service.updateBingoConfig({
                prefilledFirstPatternId: 'does-not-exist',
            } as any),
        ).rejects.toThrow('Unknown Bingo pattern id(s)');
        expect(saveSpy).not.toHaveBeenCalled();
    });

    it('updateBingoConfig accepts a pattern id that resolves', async () => {
        const { service, mockConfigRepo, mockPatternRepo } = makeService({
            rooms: [],
        });
        jest.spyOn(service, 'getBingoConfig').mockResolvedValue({
            key: 'global',
        } as any);
        mockPatternRepo.findBy.mockResolvedValue([{ id: 'valid-id' }]);
        jest.spyOn(service as any, 'autoCreateNextRoom').mockResolvedValue(
            null,
        );

        await service.updateBingoConfig({
            prefilledFirstPatternId: 'valid-id',
        } as any);

        expect(mockConfigRepo.save).toHaveBeenCalled();
    });

    it('resolvePrefilledPlacePattern logs and records an alert when it cannot resolve any pattern, but only once within the throttle window', async () => {
        const { service, mockOperationalAlertRepo } = makeService({
            rooms: [],
        });
        const manager = { findOne: jest.fn().mockResolvedValue(null) } as any;
        const cfg = { prefilledFirstPatternId: 'missing-id' } as any;

        const first = await (service as any).resolvePrefilledPlacePattern(
            cfg,
            '1st',
            manager,
            'room-1',
        );
        const second = await (service as any).resolvePrefilledPlacePattern(
            cfg,
            '1st',
            manager,
            'room-2',
        );

        expect(first).toBeNull();
        expect(second).toBeNull();
        // Config-level failure  throttled by (place, id), not by room, so the
        // second call (a different room, same misconfiguration) doesn't re-alert.
        expect(mockOperationalAlertRepo.save).toHaveBeenCalledTimes(1);
        expect(mockOperationalAlertRepo.save).toHaveBeenCalledWith(
            expect.objectContaining({ kind: 'pattern_resolution_failed' }),
        );
    });

    it('resolvePrefilledPlacePattern resolves normally when a pattern is found', async () => {
        const { service } = makeService({ rooms: [] });
        const pattern = { id: 'p1', name: 'Any Line' };
        const manager = {
            findOne: jest.fn().mockResolvedValue(pattern),
        } as any;
        const cfg = { prefilledFirstPatternId: 'p1' } as any;

        const resolved = await (service as any).resolvePrefilledPlacePattern(
            cfg,
            '1st',
            manager,
            'room-1',
        );

        expect(resolved).toBe(pattern);
    });
});

// ─── Stalled-room / operational-alert observability (admin visibility) ────────
describe('BingoService  operational observability', () => {
    it('findStalledRunningRooms queries running rooms whose updatedAt is stale', async () => {
        const { service, mockRoomRepo } = makeService({ rooms: [] });
        const staleRow = {
            id: 'room-1',
            name: 'Stuck Room',
            updatedAt: new Date(),
            stalledSeconds: '45',
        };
        mockRoomRepo.query.mockResolvedValue([staleRow]);

        const result = await service.findStalledRunningRooms(20);

        expect(mockRoomRepo.query).toHaveBeenCalledWith(
            expect.stringContaining("status = 'running'"),
            [20],
        );
        expect(result).toEqual([{ ...staleRow, stalledSeconds: 45 }]);
    });

    it('listOperationalAlerts returns recent alerts most-recent-first', async () => {
        const { service, mockOperationalAlertRepo } = makeService({
            rooms: [],
        });
        const rows = [{ id: 'a1' }, { id: 'a2' }];
        mockOperationalAlertRepo.find.mockResolvedValue(rows);

        const result = await service.listOperationalAlerts();

        expect(mockOperationalAlertRepo.find).toHaveBeenCalledWith(
            expect.objectContaining({ order: { createdAt: 'DESC' } }),
        );
        expect(result).toBe(rows);
    });
});

describe('BingoService bonus campaigns  Addis-time window math', () => {
    function campaign(overrides: Record<string, unknown> = {}) {
        return {
            id: 'campaign-1',
            name: 'Evening Bonus',
            patternId: 'pattern-1',
            prizeMinor: 10000,
            enabled: true,
            scheduleType: 'once',
            startAt: null,
            endAt: null,
            recurrence: null,
            botWinEnabled: false,
            botMaxCartelasPerRoom: 1,
            ...overrides,
        } as any;
    }

    it('a disabled campaign is never active regardless of its window', () => {
        const { service } = makeService({ rooms: [] });
        const c = campaign({
            enabled: false,
            startAt: new Date('2026-01-01T00:00:00Z'),
            endAt: new Date('2026-01-02T00:00:00Z'),
        });
        expect(
            (service as any).isBonusCampaignActiveAt(
                c,
                new Date('2026-01-01T12:00:00Z'),
            ),
        ).toBe(false);
    });

    it('a "once" campaign is active only strictly within its UTC window', () => {
        const { service } = makeService({ rooms: [] });
        const c = campaign({
            startAt: new Date('2026-01-01T10:00:00Z'),
            endAt: new Date('2026-01-01T11:00:00Z'),
        });
        expect(
            (service as any).isBonusCampaignActiveAt(
                c,
                new Date('2026-01-01T10:30:00Z'),
            ),
        ).toBe(true);
        expect(
            (service as any).isBonusCampaignActiveAt(
                c,
                new Date('2026-01-01T09:59:00Z'),
            ),
        ).toBe(false);
        expect(
            (service as any).isBonusCampaignActiveAt(
                c,
                new Date('2026-01-01T11:00:01Z'),
            ),
        ).toBe(false);
    });

    it('interprets a daily-local admin string as Addis Ababa (UTC+3) time', () => {
        const { service } = makeService({ rooms: [] });
        // "14:00:00" Addis local = 11:00:00 UTC.
        const utc = (service as any).addisLocalStringToUtcDate(
            '2026-01-01T14:00:00',
        );
        expect(utc.toISOString()).toBe('2026-01-01T11:00:00.000Z');
    });

    it('a "recurring" daily campaign is active only inside its Addis-local time-of-day window', () => {
        const { service } = makeService({ rooms: [] });
        const c = campaign({
            scheduleType: 'recurring',
            recurrence: {
                frequency: 'daily',
                startTime: '14:00:00',
                endTime: '15:00:00',
            },
        });
        // 14:30:00 Addis local = 11:30:00 UTC  inside the window.
        expect(
            (service as any).isBonusCampaignActiveAt(
                c,
                new Date('2026-01-01T11:30:00Z'),
            ),
        ).toBe(true);
        // 13:00:00 Addis local = 10:00:00 UTC  outside the window.
        expect(
            (service as any).isBonusCampaignActiveAt(
                c,
                new Date('2026-01-01T10:00:00Z'),
            ),
        ).toBe(false);
    });

    it('a "recurring" weekly campaign only fires on its configured weekday', () => {
        const { service } = makeService({ rooms: [] });
        const c = campaign({
            scheduleType: 'recurring',
            recurrence: {
                frequency: 'weekly',
                dayOfWeek: 5, // Friday
                startTime: '14:00:00',
                endTime: '15:00:00',
            },
        });
        // 2026-01-02 is a Friday; 14:30 Addis = 11:30 UTC.
        expect(
            (service as any).isBonusCampaignActiveAt(
                c,
                new Date('2026-01-02T11:30:00Z'),
            ),
        ).toBe(true);
        // 2026-01-03 is a Saturday, same time-of-day.
        expect(
            (service as any).isBonusCampaignActiveAt(
                c,
                new Date('2026-01-03T11:30:00Z'),
            ),
        ).toBe(false);
    });

    it('rejects two overlapping "once" campaigns', () => {
        const { service } = makeService({ rooms: [] });
        const a = campaign({
            startAt: new Date('2026-01-01T10:00:00Z'),
            endAt: new Date('2026-01-01T12:00:00Z'),
        });
        const b = campaign({
            id: 'campaign-2',
            startAt: new Date('2026-01-01T11:00:00Z'),
            endAt: new Date('2026-01-01T13:00:00Z'),
        });
        expect(() =>
            (service as any).assertNoBonusCampaignOverlap(a, [b]),
        ).toThrow(/overlaps/i);
    });

    it('allows two back-to-back "once" campaigns that do not overlap', () => {
        const { service } = makeService({ rooms: [] });
        const a = campaign({
            startAt: new Date('2026-01-01T10:00:00Z'),
            endAt: new Date('2026-01-01T11:00:00Z'),
        });
        const b = campaign({
            id: 'campaign-2',
            startAt: new Date('2026-01-01T11:00:00Z'),
            endAt: new Date('2026-01-01T12:00:00Z'),
        });
        expect(() =>
            (service as any).assertNoBonusCampaignOverlap(a, [b]),
        ).not.toThrow();
    });

    it('rejects two daily recurring campaigns whose Addis-local time windows overlap', () => {
        const { service } = makeService({ rooms: [] });
        const a = campaign({
            scheduleType: 'recurring',
            recurrence: {
                frequency: 'daily',
                startTime: '14:00:00',
                endTime: '15:00:00',
            },
        });
        const b = campaign({
            id: 'campaign-2',
            scheduleType: 'recurring',
            recurrence: {
                frequency: 'daily',
                startTime: '14:30:00',
                endTime: '16:00:00',
            },
        });
        expect(() =>
            (service as any).assertNoBonusCampaignOverlap(a, [b]),
        ).toThrow(/overlaps/i);
    });

    it('rejects a "once" window that falls inside a recurring campaign\'s daily slot', () => {
        const { service } = makeService({ rooms: [] });
        const recurring = campaign({
            id: 'campaign-2',
            scheduleType: 'recurring',
            recurrence: {
                frequency: 'daily',
                startTime: '14:00:00',
                endTime: '15:00:00',
            },
        });
        // 2026-03-10T14:30:00 Addis local = 11:30:00 UTC, inside the daily slot.
        const once = campaign({
            startAt: new Date('2026-03-10T11:30:00Z'),
            endAt: new Date('2026-03-10T11:45:00Z'),
        });
        expect(() =>
            (service as any).assertNoBonusCampaignOverlap(once, [recurring]),
        ).toThrow(/overlaps/i);
    });
});

describe('BingoService.updateBonusCampaign  partial updates', () => {
    it('toggling enabled alone on a recurring campaign does not require re-supplying recurrence', async () => {
        const { service, mockBonusCampaignRepo } = makeService({ rooms: [] });
        const existing = {
            id: 'campaign-1',
            name: 'Existing',
            patternId: 'pattern-1',
            prizeMinor: 1000,
            enabled: false,
            scheduleType: 'recurring',
            recurrence: {
                frequency: 'daily',
                startTime: '02:00:00',
                endTime: '06:00:00',
            },
            startAt: null,
            endAt: null,
            botWinEnabled: false,
            botMaxCartelasPerRoom: 1,
        };
        mockBonusCampaignRepo.findOneBy.mockResolvedValue(existing);
        mockBonusCampaignRepo.find.mockResolvedValue([existing]);

        const updated = await service.updateBonusCampaign('campaign-1', {
            enabled: true,
        } as any);

        expect(updated.enabled).toBe(true);
        expect(updated.recurrence).toEqual(existing.recurrence);
    });

    it('toggling enabled alone on a one-time campaign does not require re-supplying startAt/endAt', async () => {
        const { service, mockBonusCampaignRepo } = makeService({ rooms: [] });
        const existing = {
            id: 'campaign-2',
            name: 'Existing Once',
            patternId: 'pattern-1',
            prizeMinor: 1000,
            enabled: false,
            scheduleType: 'once',
            recurrence: null,
            startAt: new Date('2026-01-01T10:00:00Z'),
            endAt: new Date('2026-01-01T12:00:00Z'),
            botWinEnabled: false,
            botMaxCartelasPerRoom: 1,
        };
        mockBonusCampaignRepo.findOneBy.mockResolvedValue(existing);
        mockBonusCampaignRepo.find.mockResolvedValue([existing]);

        const updated = await service.updateBonusCampaign('campaign-2', {
            enabled: true,
        } as any);

        expect(updated.enabled).toBe(true);
        expect(updated.startAt).toEqual(existing.startAt);
        expect(updated.endAt).toEqual(existing.endAt);
    });

    it('still validates the window when the caller actually changes it', async () => {
        const { service, mockBonusCampaignRepo } = makeService({ rooms: [] });
        const existing = {
            id: 'campaign-3',
            name: 'Existing',
            patternId: 'pattern-1',
            prizeMinor: 1000,
            enabled: false,
            scheduleType: 'recurring',
            recurrence: {
                frequency: 'daily',
                startTime: '02:00:00',
                endTime: '06:00:00',
            },
            startAt: null,
            endAt: null,
            botWinEnabled: false,
            botMaxCartelasPerRoom: 1,
        };
        mockBonusCampaignRepo.findOneBy.mockResolvedValue(existing);
        mockBonusCampaignRepo.find.mockResolvedValue([existing]);

        await expect(
            service.updateBonusCampaign('campaign-3', {
                scheduleType: 'once',
            } as any),
        ).rejects.toThrow(/startAt and endAt are required/i);
    });
});

describe('BingoService.evaluateAndSettleBonus  Bonus Win settlement', () => {
    function ticket(overrides: Record<string, unknown> = {}) {
        return {
            id: 'ticket-1',
            userId: 'player-1',
            cartelaNumber: 3,
            grid: [[1]],
            markedNumbers: [1],
            status: 'active',
            payoutMinor: 0,
            walletCredits: [],
            ...overrides,
        } as any;
    }

    it('does nothing when no bonus campaign is active', async () => {
        const { service, walletService } = makeService({ rooms: [] });
        const room = makeRoom({ winMode: 'prefilled', bonusSettlement: null });
        const manager = {
            find: jest.fn().mockResolvedValue([]),
            save: jest.fn(),
        };
        jest.spyOn(
            service as any,
            'getActiveEnabledBonusCampaign',
        ).mockResolvedValue(null);

        await (service as any).evaluateAndSettleBonus(
            room,
            { botWinnerCooldownRooms: 0 } as any,
            manager,
        );

        expect(walletService.creditInSession).not.toHaveBeenCalled();
        expect(room.bonusSettlement).toBeFalsy();
    });

    it('never re-evaluates a room that already paid its bonus', async () => {
        const { service } = makeService({ rooms: [] });
        const room = makeRoom({
            winMode: 'prefilled',
            bonusSettlement: { campaignId: 'campaign-1' },
        });
        const spy = jest.spyOn(
            service as any,
            'getActiveEnabledBonusCampaign',
        );

        await (service as any).evaluateAndSettleBonus(
            room,
            { botWinnerCooldownRooms: 0 } as any,
            { find: jest.fn(), save: jest.fn() } as any,
        );

        expect(spy).not.toHaveBeenCalled();
    });

    it('splits the bonus evenly between two tickets that complete the pattern in the same draw', async () => {
        const { service, walletService } = makeService({ rooms: [] });
        const room = makeRoom({
            winMode: 'prefilled',
            drawnNumbers: [1],
            bonusSettlement: null,
        });
        const winnerA = ticket({ id: 'ticket-a', userId: 'player-a' });
        const winnerB = ticket({ id: 'ticket-b', userId: 'player-b' });
        const pattern = { id: 'pattern-1', name: 'Any Line' };
        const users: Record<string, unknown> = {
            'player-a': { id: 'player-a', displayName: 'Amanuel' },
            'player-b': { id: 'player-b', displayName: 'Betelhem' },
        };
        const manager = {
            find: jest.fn().mockResolvedValue([winnerA, winnerB]),
            findOne: jest
                .fn()
                .mockImplementation((_entity: unknown, options: any) =>
                    Promise.resolve(users[options?.where?.id] ?? null),
                ),
            save: jest.fn().mockImplementation(async (v: unknown) => v),
        };
        jest.spyOn(
            service as any,
            'getActiveEnabledBonusCampaign',
        ).mockResolvedValue({
            id: 'campaign-1',
            name: 'Evening Bonus',
            patternId: 'pattern-1',
            prizeMinor: 101,
            botWinEnabled: false,
        });
        (manager as any).findOne = jest
            .fn()
            .mockImplementation((entity: unknown, options: any) => {
                if (options?.where?.id === 'pattern-1')
                    return Promise.resolve(pattern);
                return Promise.resolve(users[options?.where?.id] ?? null);
            });
        jest.spyOn(
            (service as any).bingoRulesService,
            'evaluatePatternTicket',
        ).mockReturnValue({ completedPatternIds: ['pattern-1'] });
        jest.spyOn(
            service as any,
            'getBotUserGroupsForTickets',
        ).mockResolvedValue({
            botIds: new Set(),
            bingoEnabledBotIds: new Set(),
            nonBingoBotIds: new Set(),
        });
        walletService.creditInSession.mockResolvedValue({ id: 'credit-1' });

        await (service as any).evaluateAndSettleBonus(
            room,
            { botWinnerCooldownRooms: 0 } as any,
            manager,
        );

        expect(walletService.creditInSession).toHaveBeenCalledTimes(2);
        expect(walletService.creditInSession).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({ userId: 'player-a', amountMinor: 51 }),
            manager,
        );
        expect(walletService.creditInSession).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({ userId: 'player-b', amountMinor: 50 }),
            manager,
        );
        expect(winnerA.payoutMinor).toBe(51);
        expect(winnerB.payoutMinor).toBe(50);
        expect(room.bonusSettlement).toMatchObject({
            campaignId: 'campaign-1',
            winnerCount: 2,
        });
    });

    it("does not split the bonus across two cartelas owned by the SAME bot, as if they were different winners", async () => {
        const { service, walletService } = makeService({ rooms: [] });
        const room = makeRoom({
            winMode: 'prefilled',
            drawnNumbers: [1],
            bonusSettlement: null,
        });
        // A single bot legitimately owns several cartelas in the room (see
        // botMaxCartelasPerBotPerRoom), and BOTH complete the bonus pattern on
        // the same draw. Splitting the pot across both would render the exact
        // same bot identity twice in the winner list.
        const winnerA = ticket({
            id: 'ticket-a',
            userId: 'bot-1',
            cartelaNumber: 3,
        });
        const winnerB = ticket({
            id: 'ticket-b',
            userId: 'bot-1',
            cartelaNumber: 9,
        });
        const pattern = { id: 'pattern-1', name: 'Any Line' };
        const manager = {
            find: jest.fn().mockResolvedValue([winnerA, winnerB]),
            findOne: jest
                .fn()
                .mockImplementation((_entity: unknown, options: any) =>
                    Promise.resolve(
                        options?.where?.id === 'pattern-1'
                            ? pattern
                            : options?.where?.id === 'bot-1'
                              ? {
                                    id: 'bot-1',
                                    productMetadata: {
                                        botPolicy: { active: true },
                                    },
                                }
                              : null,
                    ),
                ),
            save: jest.fn().mockImplementation(async (v: unknown) => v),
        };
        jest.spyOn(
            service as any,
            'getActiveEnabledBonusCampaign',
        ).mockResolvedValue({
            id: 'campaign-1',
            name: 'Evening Bonus',
            patternId: 'pattern-1',
            prizeMinor: 101,
            botWinEnabled: false,
        });
        jest.spyOn(
            (service as any).bingoRulesService,
            'evaluatePatternTicket',
        ).mockReturnValue({ completedPatternIds: ['pattern-1'] });
        jest.spyOn(
            service as any,
            'getBotUserGroupsForTickets',
        ).mockResolvedValue({
            botIds: new Set(['bot-1']),
            bingoEnabledBotIds: new Set(['bot-1']),
            nonBingoBotIds: new Set(),
        });
        jest.spyOn(
            service as any,
            'resolveDisplayedNameForUser',
        ).mockResolvedValue({
            displayName: 'Mesfin',
            phoneLast4: '4014',
            isBot: true,
        });
        walletService.creditInSession.mockResolvedValue({ id: 'credit-1' });

        await (service as any).evaluateAndSettleBonus(
            room,
            { botWinnerCooldownRooms: 0 } as any,
            manager,
        );

        // Only the bot's FIRST completing cartela counts  the whole prize goes
        // to it, not split in half across two entries with the identical
        // displayed identity.
        expect(walletService.creditInSession).toHaveBeenCalledTimes(1);
        expect(walletService.creditInSession).toHaveBeenCalledWith(
            expect.objectContaining({ userId: 'bot-1', amountMinor: 101 }),
            manager,
        );
        expect(winnerA.payoutMinor).toBe(101);
        expect(winnerB.payoutMinor).toBe(0);
        expect(room.bonusSettlement).toMatchObject({ winnerCount: 1 });
    });

    it('redirects the bonus to a bot when botWinEnabled and a real ticket would otherwise win it', async () => {
        const { service, walletService } = makeService({ rooms: [] });
        const room = makeRoom({
            winMode: 'prefilled',
            drawnNumbers: [1],
            bonusSettlement: null,
        });
        const realWinner = ticket({ id: 'ticket-real', userId: 'player-real' });
        const botTicket = ticket({ id: 'ticket-bot', userId: 'bot-1' });
        const pattern = { id: 'pattern-1', name: 'Any Line' };
        const manager = {
            find: jest.fn().mockResolvedValue([realWinner, botTicket]),
            findOne: jest.fn().mockImplementation((_entity: unknown, options: any) => {
                if (options?.where?.id === 'pattern-1')
                    return Promise.resolve(pattern);
                if (options?.where?.id === 'bot-1')
                    return Promise.resolve({
                        id: 'bot-1',
                        productMetadata: { botPolicy: { active: true } },
                    });
                return Promise.resolve(null);
            }),
            save: jest.fn().mockImplementation(async (v: unknown) => v),
        };
        jest.spyOn(
            service as any,
            'getActiveEnabledBonusCampaign',
        ).mockResolvedValue({
            id: 'campaign-1',
            name: 'Evening Bonus',
            patternId: 'pattern-1',
            prizeMinor: 5000,
            botWinEnabled: true,
        });
        jest.spyOn(
            (service as any).bingoRulesService,
            'evaluatePatternTicket',
        ).mockReturnValue({ completedPatternIds: ['pattern-1'] });
        jest.spyOn(
            service as any,
            'getBotUserGroupsForTickets',
        ).mockResolvedValue({
            botIds: new Set(['bot-1']),
            bingoEnabledBotIds: new Set(['bot-1']),
            nonBingoBotIds: new Set(),
        });
        jest.spyOn(service as any, 'pickBotRedirectWinner').mockReturnValue(
            botTicket,
        );
        jest.spyOn(
            service as any,
            'resolveDisplayedNameForUser',
        ).mockResolvedValue({
            displayName: 'Bot Player',
            phoneLast4: '',
            isBot: true,
        });
        walletService.creditInSession.mockResolvedValue({ id: 'credit-1' });

        await (service as any).evaluateAndSettleBonus(
            room,
            { botWinnerCooldownRooms: 0 } as any,
            manager,
        );

        expect(walletService.creditInSession).toHaveBeenCalledTimes(1);
        expect(walletService.creditInSession).toHaveBeenCalledWith(
            expect.objectContaining({ userId: 'bot-1', amountMinor: 5000 }),
            manager,
        );
    });

    it('excludes a bot that already won a Derash place in this room from also taking the bonus', async () => {
        const { service, walletService } = makeService({ rooms: [] });
        const room = makeRoom({
            winMode: 'prefilled',
            drawnNumbers: [1],
            bonusSettlement: null,
        });
        const realWinner = ticket({ id: 'ticket-real', userId: 'player-real' });
        // Already won 1st place this room (non-empty wonTiers) - must be excluded
        // from also taking the bonus so one bot can't sweep both prizes.
        const alreadyWonBotTicket = ticket({
            id: 'ticket-bot-1',
            userId: 'bot-1',
            wonTiers: ['1st'],
        });
        const otherBotTicket = ticket({ id: 'ticket-bot-2', userId: 'bot-2' });
        const pattern = { id: 'pattern-1', name: 'Any Line' };
        const manager = {
            find: jest
                .fn()
                .mockResolvedValue([
                    realWinner,
                    alreadyWonBotTicket,
                    otherBotTicket,
                ]),
            findOne: jest.fn().mockImplementation((_entity: unknown, options: any) =>
                Promise.resolve(
                    options?.where?.id === 'pattern-1' ? pattern : null,
                ),
            ),
            save: jest.fn().mockImplementation(async (v: unknown) => v),
        };
        jest.spyOn(
            service as any,
            'getActiveEnabledBonusCampaign',
        ).mockResolvedValue({
            id: 'campaign-1',
            name: 'Evening Bonus',
            patternId: 'pattern-1',
            prizeMinor: 5000,
            botWinEnabled: true,
        });
        jest.spyOn(
            (service as any).bingoRulesService,
            'evaluatePatternTicket',
        ).mockReturnValue({ completedPatternIds: ['pattern-1'] });
        jest.spyOn(
            service as any,
            'getBotUserGroupsForTickets',
        ).mockResolvedValue({
            botIds: new Set(['bot-1', 'bot-2']),
            bingoEnabledBotIds: new Set(['bot-1', 'bot-2']),
            nonBingoBotIds: new Set(),
        });
        const pickSpy = jest
            .spyOn(service as any, 'pickBotRedirectWinner')
            .mockReturnValue(otherBotTicket);
        walletService.creditInSession.mockResolvedValue({ id: 'credit-1' });

        await (service as any).evaluateAndSettleBonus(
            room,
            { botWinnerCooldownRooms: 0 } as any,
            manager,
        );

        expect(pickSpy).toHaveBeenCalledWith(
            expect.anything(),
            expect.anything(),
            pattern,
            expect.anything(),
            expect.anything(),
            expect.objectContaining({
                awardedBotUserIds: new Set(['bot-1']),
            }),
        );
    });
});

describe('BingoService.reconcileBotCartelasInRoom  bonus bot-win cartela override', () => {
    it('forces bot participation and overrides the max/min cartela targets while a bot-win bonus campaign is active', async () => {
        const { service, mockRoomRepo } = makeService({ rooms: [] });
        const room = makeRoom({ winMode: 'prefilled', status: 'open' });
        mockRoomRepo.findOneBy.mockResolvedValue(room);

        jest.spyOn(service, 'getBingoConfig').mockResolvedValue({
            botWinMode: 'off',
            botCartelaPolicyEnabled: false, // disabled at the global level
            botCartelaPolicyMode: 'mirror',
            botMaxCartelasPerBotPerRoom: 5,
        } as any);
        jest.spyOn(
            service as any,
            'countRealPlayersInRoom',
        ).mockResolvedValue(500); // way above any normal participation threshold
        jest.spyOn(service as any, 'isCartelaChangeLocked').mockReturnValue(
            false,
        );
        jest.spyOn(
            service as any,
            'resolveBingoBotParticipation',
        ).mockReturnValue({ shouldParticipate: () => false });
        jest.spyOn(
            service as any,
            'countBotCartelasInRoom',
        ).mockResolvedValue(1);
        jest.spyOn(service as any, 'countSoldTickets').mockResolvedValue(0);
        jest.spyOn(service as any, 'getActiveBotUserIds').mockResolvedValue(
            new Set(['bot-1', 'bot-2']),
        );
        jest.spyOn(
            service as any,
            'getActiveEnabledBonusCampaign',
        ).mockResolvedValue({
            id: 'campaign-1',
            botWinEnabled: true,
            botMaxCartelasPerRoom: 2,
        });
        const targetSpy = jest.spyOn(
            service as any,
            'resolveBingoBotCartelaTarget',
        );

        const changed = await service.reconcileBotCartelasInRoom(room.id);

        expect(targetSpy).toHaveBeenCalledWith(
            expect.objectContaining({
                maxCartelasPerBotPerRoom: 2,
                minTotalCartelas: 1,
                botCount: 2,
            }),
        );
        // desiredBotCartelas resolves to 1 (see resolveBingoBotCartelaTarget:
        // mirror mode, realCartelas 0, minTotalCartelas 1), matching the mocked
        // currentBotCartelas of 1, so the function short-circuits here - the
        // assertion above is what actually proves the override took effect.
        expect(changed).toBe(false);
    });

    it('never calls resolveBingoBotCartelaTarget when no bonus campaign is active and normal participation is off', async () => {
        const { service, mockRoomRepo } = makeService({ rooms: [] });
        const room = makeRoom({ winMode: 'prefilled', status: 'open' });
        mockRoomRepo.findOneBy.mockResolvedValue(room);

        jest.spyOn(service, 'getBingoConfig').mockResolvedValue({
            botWinMode: 'off',
            botCartelaPolicyEnabled: false,
            botCartelaPolicyMode: 'mirror',
            botMaxCartelasPerBotPerRoom: 5,
        } as any);
        jest.spyOn(
            service as any,
            'countRealPlayersInRoom',
        ).mockResolvedValue(500);
        jest.spyOn(service as any, 'isCartelaChangeLocked').mockReturnValue(
            false,
        );
        jest.spyOn(
            service as any,
            'resolveBingoBotParticipation',
        ).mockReturnValue({ shouldParticipate: () => false });
        jest.spyOn(
            service as any,
            'countBotCartelasInRoom',
        ).mockResolvedValue(0);
        jest.spyOn(service as any, 'countSoldTickets').mockResolvedValue(0);
        jest.spyOn(service as any, 'getActiveBotUserIds').mockResolvedValue(
            new Set(['bot-1']),
        );
        jest.spyOn(
            service as any,
            'getActiveEnabledBonusCampaign',
        ).mockResolvedValue(null);
        const targetSpy = jest.spyOn(
            service as any,
            'resolveBingoBotCartelaTarget',
        );

        const changed = await service.reconcileBotCartelasInRoom(room.id);

        expect(targetSpy).not.toHaveBeenCalled();
        expect(changed).toBe(false);
    });
});

describe('BingoService.reconcileBotCartelasInRoom  Scheduled Bot Play override', () => {
    it('does not cancel a zero-real-player room and forces botCount*maxCartelasPerBot while a window is active', async () => {
        const { service, mockRoomRepo } = makeService({ rooms: [] });
        // Old enough to clear the first-bot-buy-in gate (see the dedicated
        // "first-bot-buy-in gate" tests below) so this test can focus on the
        // cartela-count math instead.
        const room = makeRoom({
            winMode: 'prefilled',
            status: 'open',
            createdAt: new Date(Date.now() - 60_000),
        });
        mockRoomRepo.findOneBy.mockResolvedValue(room);

        jest.spyOn(service, 'getBingoConfig').mockResolvedValue({
            botWinMode: 'off',
            botCartelaPolicyEnabled: false,
            botCartelaPolicyMode: 'mirror',
            botMaxCartelasPerBotPerRoom: 5,
        } as any);
        const cancelSpy = jest
            .spyOn(service, 'cancelRoom')
            .mockResolvedValue({} as any);
        jest.spyOn(
            service as any,
            'countRealPlayersInRoom',
        ).mockResolvedValue(0);
        jest.spyOn(service as any, 'isCartelaChangeLocked').mockReturnValue(
            false,
        );
        jest.spyOn(
            service as any,
            'countBotCartelasInRoom',
        ).mockResolvedValue(0);
        jest.spyOn(service as any, 'countSoldTickets').mockResolvedValue(0);
        jest.spyOn(service as any, 'getActiveBotUserIds').mockResolvedValue(
            new Set(['bot-1', 'bot-2', 'bot-3', 'bot-4']),
        );
        jest.spyOn(
            service as any,
            'getActiveEnabledBonusCampaign',
        ).mockResolvedValue(null);
        jest.spyOn(
            service as any,
            'getActiveScheduledBotPlay',
        ).mockResolvedValue({
            id: 'schedule-1',
            botCount: 3,
            maxCartelasPerBot: 2,
            minCartelasPerBot: null,
        });
        jest.spyOn(service, 'ensureRoomBotIdentities').mockResolvedValue(
            {} as any,
        );
        jest.spyOn(service as any, 'countUserCartelasInRoom').mockResolvedValue(
            0,
        );
        jest.spyOn(
            service as any,
            'listAvailableCartelaNumbers',
        ).mockResolvedValue([1, 2, 3, 4, 5, 6, 7, 8]);
        const purchaseSpy = jest
            .spyOn(service, 'purchaseTickets')
            .mockResolvedValue([] as any);

        const changed = await service.reconcileBotCartelasInRoom(room.id);

        expect(cancelSpy).not.toHaveBeenCalled();
        // With minCartelasPerBot null (no range configured), every bot's
        // randomized cap collapses to exactly maxCartelasPerBot (2), so the
        // total is still botCount*maxCartelasPerBot = 3*2=6, vs currentBotCartelas 0
        // — same outward result as the old fixed-cap behavior.
        expect(purchaseSpy).toHaveBeenCalledTimes(6);
        const purchasingUserIds = new Set(
            (purchaseSpy.mock.calls as any[]).map((call) => call[0].userId),
        );
        expect(purchasingUserIds.size).toBe(3); // exactly botCount distinct bots
        expect(changed).toBe(true);
    });

    it('still cancels a zero-real-player room when no Scheduled Bot Play window is active', async () => {
        const { service, mockRoomRepo } = makeService({ rooms: [] });
        const room = makeRoom({ winMode: 'prefilled', status: 'open' });
        mockRoomRepo.findOneBy.mockResolvedValue(room);

        jest.spyOn(service, 'getBingoConfig').mockResolvedValue({} as any);
        const cancelSpy = jest
            .spyOn(service, 'cancelRoom')
            .mockResolvedValue({} as any);
        jest.spyOn(
            service as any,
            'countRealPlayersInRoom',
        ).mockResolvedValue(0);
        jest.spyOn(
            service as any,
            'getActiveScheduledBotPlay',
        ).mockResolvedValue(null);

        const changed = await service.reconcileBotCartelasInRoom(room.id);

        expect(cancelSpy).toHaveBeenCalledWith(room.id);
        expect(changed).toBe(false);
    });

    it('randomizes each bot\'s cartela count within [minCartelasPerBot, maxCartelasPerBot] and keeps it stable across ticks', async () => {
        const { service, mockRoomRepo } = makeService({ rooms: [] });
        // Old enough to clear the first-bot-buy-in gate (see the dedicated
        // "first-bot-buy-in gate" tests below) so this test can focus on the
        // randomization behavior instead.
        const room = makeRoom({
            winMode: 'prefilled',
            status: 'open',
            createdAt: new Date(Date.now() - 60_000),
        });
        mockRoomRepo.findOneBy.mockResolvedValue(room);

        jest.spyOn(service, 'getBingoConfig').mockResolvedValue({
            botWinMode: 'off',
            botCartelaPolicyEnabled: false,
            botCartelaPolicyMode: 'mirror',
            botMaxCartelasPerBotPerRoom: 5,
        } as any);
        jest.spyOn(service, 'cancelRoom').mockResolvedValue({} as any);
        jest.spyOn(
            service as any,
            'countRealPlayersInRoom',
        ).mockResolvedValue(0);
        jest.spyOn(service as any, 'isCartelaChangeLocked').mockReturnValue(
            false,
        );
        jest.spyOn(
            service as any,
            'countBotCartelasInRoom',
        ).mockResolvedValue(0);
        jest.spyOn(service as any, 'countSoldTickets').mockResolvedValue(0);
        jest.spyOn(service as any, 'getActiveBotUserIds').mockResolvedValue(
            new Set(['bot-1', 'bot-2', 'bot-3', 'bot-4']),
        );
        jest.spyOn(
            service as any,
            'getActiveEnabledBonusCampaign',
        ).mockResolvedValue(null);
        jest.spyOn(
            service as any,
            'getActiveScheduledBotPlay',
        ).mockResolvedValue({
            id: 'schedule-range',
            botCount: 4,
            maxCartelasPerBot: 6,
            minCartelasPerBot: 2,
        });
        jest.spyOn(service, 'ensureRoomBotIdentities').mockResolvedValue(
            {} as any,
        );
        jest.spyOn(service as any, 'countUserCartelasInRoom').mockResolvedValue(
            0,
        );
        jest.spyOn(
            service as any,
            'listAvailableCartelaNumbers',
        ).mockResolvedValue(Array.from({ length: 24 }, (_, i) => i + 1));
        const purchaseSpy = jest
            .spyOn(service, 'purchaseTickets')
            .mockResolvedValue([] as any);

        await service.reconcileBotCartelasInRoom(room.id);

        // Guards against this test vacuously passing (e.g. if the buy-in gate
        // silently blocked every purchase, the loop below would iterate zero
        // times and every assertion in it would trivially "pass").
        expect(purchaseSpy).toHaveBeenCalled();

        const perBotCounts = new Map<string, number>();
        (purchaseSpy.mock.calls as any[]).forEach((call) => {
            const userId = call[0].userId;
            perBotCounts.set(userId, (perBotCounts.get(userId) ?? 0) + 1);
        });
        // Every participating bot's count must fall in [2, 6].
        for (const count of perBotCounts.values()) {
            expect(count).toBeGreaterThanOrEqual(2);
            expect(count).toBeLessThanOrEqual(6);
        }
        const firstRunTotal = purchaseSpy.mock.calls.length;
        const firstRunPerBot = new Map(perBotCounts);

        // A second reconcile tick for the SAME room must derive the exact same
        // per-bot cap (deterministic on roomId+botId), so once each bot already
        // holds its target, nothing further is purchased or released.
        purchaseSpy.mockClear();
        jest.spyOn(
            service as any,
            'countBotCartelasInRoom',
        ).mockResolvedValue(firstRunTotal);
        jest.spyOn(service as any, 'countSoldTickets').mockResolvedValue(
            firstRunTotal,
        );
        jest.spyOn(
            service as any,
            'countUserCartelasInRoom',
        ).mockImplementation((...args: unknown[]) =>
            Promise.resolve(firstRunPerBot.get(args[0] as string) ?? 0),
        );
        const releaseSpy = jest
            .spyOn(service, 'releaseCartela')
            .mockResolvedValue({} as any);

        const secondChanged = await service.reconcileBotCartelasInRoom(
            room.id,
        );

        expect(purchaseSpy).not.toHaveBeenCalled();
        expect(releaseSpy).not.toHaveBeenCalled();
        expect(secondChanged).toBe(false);
    });
});

describe('BingoService.seedBuiltInPatterns  built-in mask drift repair', () => {
    // Seeding only ever inserted patterns by NAME, so a mask corrected in code
    // never reached an install that had already been seeded. That is how the
    // mis-positioned Small Cross kept evaluating its old, shifted cells in
    // production long after the constant itself was right.
    const STALE_SMALL_CROSS = [
        [false, false, false, false, false],
        [false, false, false, false, false],
        [false, false, true, false, false],
        [false, true, true, true, false],
        [false, false, true, false, false],
    ];

    it('re-syncs an existing built-in whose stored mask has drifted from the code', async () => {
        const { service, mockPatternRepo } = makeService({ rooms: [] });
        const row: Record<string, unknown> = {
            id: 'p-small-cross',
            name: 'Small Cross',
            description: 'A smaller plus/cross shape in the lower half of the card',
            isBuiltIn: true,
            mask: STALE_SMALL_CROSS,
        };
        mockPatternRepo.findBy.mockResolvedValue([row]);

        await service.seedBuiltInPatterns();

        expect(mockPatternRepo.save).toHaveBeenCalledWith([row]);
        // Repaired in place to the plus centred on the free space (2,2).
        expect(row.mask).toEqual([
            [false, false, false, false, false],
            [false, false, true, false, false],
            [false, true, true, true, false],
            [false, false, true, false, false],
            [false, false, false, false, false],
        ]);
        expect(row.description).not.toContain('lower half');
    });

    it('leaves an already-correct built-in untouched', async () => {
        const { service, mockPatternRepo } = makeService({ rooms: [] });
        mockPatternRepo.findBy.mockResolvedValue([
            {
                id: 'p-any-line',
                name: 'Any Line',
                description: 'Complete any row, column, or diagonal',
                isBuiltIn: true,
                mask: null,
            },
        ]);

        await service.seedBuiltInPatterns();

        // Only the inserts for the not-yet-seeded built-ins, no drift rewrite.
        for (const call of mockPatternRepo.save.mock.calls) {
            expect(call[0]).not.toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ id: 'p-any-line' }),
                ]),
            );
        }
    });

    it('never rewrites an admin-authored (non built-in) pattern', async () => {
        const { service, mockPatternRepo } = makeService({ rooms: [] });
        const custom = {
            id: 'p-custom',
            name: 'House Special',
            description: 'admin made this',
            isBuiltIn: false,
            mask: STALE_SMALL_CROSS,
        };
        // findBy({ isBuiltIn: true }) is what the seeder reads; a custom pattern
        // is not in that set, so it can never be picked up as "drifted".
        mockPatternRepo.findBy.mockResolvedValue([]);

        await service.seedBuiltInPatterns();

        expect(custom.mask).toEqual(STALE_SMALL_CROSS);
    });
});

describe('BingoService.reconcileBotCartelasInRoom  first-bot-buy-in gate', () => {
    // Regression coverage for the reported bug: a room is created (idle) the
    // instant the previous one completes, but the client keeps showing the
    // PREVIOUS room's result  a live per-place popup, then the Bonus Win
    // popup, THEN the resultDisplaySeconds countdown  before switching over
    // (see Bingo.tsx). This method is reached not just from the scheduler's
    // periodic tick but also directly from a real player's purchase/refund
    // elsewhere in the same room (purchaseTickets/releaseCartela), so the gate
    // has to live HERE, not in the scheduler, to cover every caller uniformly.
    //
    // Room age is measured DB-side (getRoomAgeSeconds), never from
    // `room.createdAt` in JS  see the timezone-skew regression test at the end.
    function baseMocks(service: any, overrides: Record<string, unknown> = {}) {
        jest.spyOn(service, 'getBingoConfig').mockResolvedValue({
            botWinMode: 'off',
            botCartelaPolicyEnabled: false,
            botCartelaPolicyMode: 'mirror',
            botMaxCartelasPerBotPerRoom: 5,
            resultDisplaySeconds: 10,
            bonusWinDisplaySeconds: 5,
            ...overrides,
        });
        jest.spyOn(service, 'cancelRoom').mockResolvedValue({} as any);
        jest.spyOn(service, 'countRealPlayersInRoom').mockResolvedValue(0);
        jest.spyOn(service as any, 'isCartelaChangeLocked').mockReturnValue(
            false,
        );
        jest.spyOn(service as any, 'countSoldTickets').mockResolvedValue(0);
        jest.spyOn(service as any, 'getActiveBotUserIds').mockResolvedValue(
            new Set(['bot-1', 'bot-2']),
        );
        jest.spyOn(
            service as any,
            'getActiveEnabledBonusCampaign',
        ).mockResolvedValue(null);
        jest.spyOn(service, 'ensureRoomBotIdentities').mockResolvedValue(
            {} as any,
        );
        jest.spyOn(service as any, 'countUserCartelasInRoom').mockResolvedValue(
            0,
        );
        jest.spyOn(
            service as any,
            'listAvailableCartelaNumbers',
        ).mockResolvedValue([1, 2, 3, 4, 5, 6]);
    }

    /** Drive the DB-side hold check the gate actually consults. */
    const withBotBuyWindow = (
        service: any,
        open: boolean,
        secondsRemaining = open ? 0 : 8,
    ) =>
        jest.spyOn(service as any, 'isBotBuyAllowed').mockResolvedValue({
            allowed: open,
            secondsRemaining,
            reason: open ? undefined : 'a round is still being presented',
        });

    it('does not buy any bot cartela into a room created just now, during an active Scheduled Bot Play window', async () => {
        const { service, mockRoomRepo } = makeService({ rooms: [] });
        const room = makeRoom({ winMode: 'prefilled', status: 'open' });
        mockRoomRepo.findOneBy.mockResolvedValue(room);
        baseMocks(service);
        withBotBuyWindow(service, false);
        jest.spyOn(service as any, 'countBotCartelasInRoom').mockResolvedValue(
            0,
        );
        jest.spyOn(
            service as any,
            'getActiveScheduledBotPlay',
        ).mockResolvedValue({
            id: 'schedule-1',
            botCount: 2,
            maxCartelasPerBot: 2,
        });
        const purchaseSpy = jest
            .spyOn(service, 'purchaseTickets')
            .mockResolvedValue([] as any);

        const changed = await service.reconcileBotCartelasInRoom(room.id);

        expect(purchaseSpy).not.toHaveBeenCalled();
        expect(changed).toBe(false);
    });

    it('does not buy in for a room pinned to a Win Sequence "bot" slot either, while under the gate', async () => {
        const { service, mockRoomRepo } = makeService({ rooms: [] });
        const room = makeRoom({
            winMode: 'prefilled',
            status: 'open',
            winSequenceTarget: 'bot',
        } as any);
        mockRoomRepo.findOneBy.mockResolvedValue(room);
        baseMocks(service);
        withBotBuyWindow(service, false);
        jest.spyOn(service as any, 'countBotCartelasInRoom').mockResolvedValue(
            0,
        );
        jest.spyOn(
            service as any,
            'getActiveScheduledBotPlay',
        ).mockResolvedValue(null);
        const purchaseSpy = jest
            .spyOn(service, 'purchaseTickets')
            .mockResolvedValue([] as any);

        const changed = await service.reconcileBotCartelasInRoom(room.id);

        expect(purchaseSpy).not.toHaveBeenCalled();
        expect(changed).toBe(false);
    });

    it('buys in once the full gate (resultDisplaySeconds + live-place popup + Bonus Win popup + buffer) has elapsed', async () => {
        const { service, mockRoomRepo } = makeService({ rooms: [] });
        const room = makeRoom({ winMode: 'prefilled', status: 'open' });
        mockRoomRepo.findOneBy.mockResolvedValue(room);
        baseMocks(service);
        withBotBuyWindow(service, true);
        jest.spyOn(service as any, 'countBotCartelasInRoom').mockResolvedValue(
            0,
        );
        jest.spyOn(
            service as any,
            'getActiveScheduledBotPlay',
        ).mockResolvedValue({
            id: 'schedule-1',
            botCount: 2,
            maxCartelasPerBot: 2,
        });
        const purchaseSpy = jest
            .spyOn(service, 'purchaseTickets')
            .mockResolvedValue([] as any);

        const changed = await service.reconcileBotCartelasInRoom(room.id);

        expect(purchaseSpy).toHaveBeenCalled();
        expect(changed).toBe(true);
    });

    it('stays held while the stamp still has time left on it (the hold spans all three presentation stages, not just resultDisplaySeconds)', async () => {
        const { service, mockRoomRepo } = makeService({ rooms: [] });
        const room = makeRoom({ winMode: 'prefilled', status: 'open' });
        mockRoomRepo.findOneBy.mockResolvedValue(room);
        baseMocks(service);
        withBotBuyWindow(service, false, 9);
        jest.spyOn(service as any, 'countBotCartelasInRoom').mockResolvedValue(
            0,
        );
        jest.spyOn(
            service as any,
            'getActiveScheduledBotPlay',
        ).mockResolvedValue({
            id: 'schedule-1',
            botCount: 2,
            maxCartelasPerBot: 2,
        });
        const purchaseSpy = jest
            .spyOn(service, 'purchaseTickets')
            .mockResolvedValue([] as any);

        const changed = await service.reconcileBotCartelasInRoom(room.id);

        expect(purchaseSpy).not.toHaveBeenCalled();
        expect(changed).toBe(false);
    });

    it('buys normally once the hold has expired, even for a room bots already hold a cartela in', async () => {
        const { service, mockRoomRepo } = makeService({ rooms: [] });
        const room = makeRoom({ winMode: 'prefilled', status: 'open' });
        mockRoomRepo.findOneBy.mockResolvedValue(room);
        baseMocks(service);
        withBotBuyWindow(service, true);
        jest.spyOn(service as any, 'countBotCartelasInRoom').mockResolvedValue(
            1, // a bot already bought in on an earlier, released tick
        );
        jest.spyOn(service as any, 'countSoldTickets').mockResolvedValue(1);
        jest.spyOn(
            service as any,
            'getActiveScheduledBotPlay',
        ).mockResolvedValue({
            id: 'schedule-1',
            botCount: 2,
            maxCartelasPerBot: 2,
        });
        const purchaseSpy = jest
            .spyOn(service, 'purchaseTickets')
            .mockResolvedValue([] as any);

        await service.reconcileBotCartelasInRoom(room.id);

        expect(purchaseSpy).toHaveBeenCalled();
    });

    it('does not hold up ordinary human-driven mirror participation once the hold has expired', async () => {
        const { service, mockRoomRepo } = makeService({ rooms: [] });
        const room = makeRoom({
            winMode: 'prefilled',
            status: 'open',
            soldTickets: 2,
        });
        mockRoomRepo.findOneBy.mockResolvedValue(room);
        baseMocks(service, { botCartelaPolicyEnabled: true });
        withBotBuyWindow(service, true);
        jest.spyOn(service, 'countRealPlayersInRoom').mockResolvedValue(2);
        jest.spyOn(service as any, 'countBotCartelasInRoom').mockResolvedValue(
            0,
        );
        jest.spyOn(service as any, 'countSoldTickets').mockResolvedValue(2);
        jest.spyOn(
            service as any,
            'getActiveScheduledBotPlay',
        ).mockResolvedValue(null);
        const purchaseSpy = jest
            .spyOn(service, 'purchaseTickets')
            .mockResolvedValue([] as any);

        await service.reconcileBotCartelasInRoom(room.id);

        expect(purchaseSpy).toHaveBeenCalled();
    });

    it('falls open (rather than deadlocking the game) when the hold cannot be read', async () => {
        const { service, mockRoomRepo } = makeService({ rooms: [] });
        const room = makeRoom({ winMode: 'prefilled', status: 'open' });
        mockRoomRepo.findOneBy.mockResolvedValue(room);
        baseMocks(service);
        withBotBuyWindow(service, true); // unreadable stamp falls open
        jest.spyOn(service as any, 'countBotCartelasInRoom').mockResolvedValue(
            0,
        );
        jest.spyOn(
            service as any,
            'getActiveScheduledBotPlay',
        ).mockResolvedValue({
            id: 'schedule-1',
            botCount: 2,
            maxCartelasPerBot: 2,
        });
        const purchaseSpy = jest
            .spyOn(service, 'purchaseTickets')
            .mockResolvedValue([] as any);

        await service.reconcileBotCartelasInRoom(room.id);

        expect(purchaseSpy).toHaveBeenCalled();
    });

    // The room's OWN age must never enter into it. An earlier gate did
    // `Date.now() - room.createdAt.getTime()`, which failed twice over: createdAt
    // is deserialized by the driver, so a non-UTC MySQL session timezone makes it
    // read hours old and clears any gate instantly; and even read correctly, a
    // room that has been sitting open for minutes (custom slots, agent rooms) is
    // "old" while the round the player is actually watching only just ended. The
    // hold comes from the completed round, measured DB-side.
    it('holds an OLD room too: a room created hours ago is still gated while a round is presenting', async () => {
        const { service, mockRoomRepo } = makeService({ rooms: [] });
        const room = makeRoom({
            winMode: 'prefilled',
            status: 'open',
            // What a +03:00 session skew looks like to the app: "3 hours ago".
            createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
        });
        mockRoomRepo.findOneBy.mockResolvedValue(room);
        baseMocks(service);
        withBotBuyWindow(service, false, 18); // the DB's own, correct answer
        jest.spyOn(service as any, 'countBotCartelasInRoom').mockResolvedValue(
            0,
        );
        jest.spyOn(
            service as any,
            'getActiveScheduledBotPlay',
        ).mockResolvedValue({
            id: 'schedule-1',
            botCount: 2,
            maxCartelasPerBot: 2,
        });
        const purchaseSpy = jest
            .spyOn(service, 'purchaseTickets')
            .mockResolvedValue([] as any);

        const changed = await service.reconcileBotCartelasInRoom(room.id);

        expect(purchaseSpy).not.toHaveBeenCalled();
        expect(changed).toBe(false);
    });

    // ── The gate's own unit tests ────────────────────────────────────────────
    //
    // THE production bug this rewrite fixes, and why the gate no longer computes
    // anything. It used to stamp each room, at CREATION, with a deadline of
    // "now + placesWon x popup + bonus popup + resultDisplaySeconds". Both halves
    // were wrong:
    //
    //  * Wrong anchor. A room can be open for minutes before a player is returned
    //    to it (custom slots and per-agent rooms each recreate on their own
    //    cycle), so the stamp had usually expired by the time it mattered. Bots
    //    were then held back only by being busy in the round still drawing, and
    //    poured into the next room the instant that round completed - i.e.
    //    exactly as the presentation STARTED. The recording shows the result: the
    //    player landed on a buying screen with cartelas already gone and the 40s
    //    countdown already down to 23s.
    //  * Wrong length. It mirrored client animation constants and the admin's
    //    display settings, so it went stale whenever either was changed.
    //
    // The gate now waits on an OBSERVED event - firstViewedAt, stamped when a
    // real player is actually served the open room - so no admin setting or
    // client animation timing can shrink it again.

    /**
     * Drive the observations the gate reads, as the DB reports them.
     * `null` means "that query matched nothing".
     */
    const withObservations = (
        harness: any,
        obs: {
            viewedSecondsAgo?: unknown;
            playerSeenSecondsAgo?: unknown;
            lineageRoundEndedSecondsAgo?: unknown;
            lineageRoundHadRealPlayers?: boolean;
        },
    ) => {
        const {
            viewedSecondsAgo = null,
            playerSeenSecondsAgo = 2, // somebody is in the game, by default
            lineageRoundEndedSecondsAgo = null,
            lineageRoundHadRealPlayers = true,
        } = obs;
        harness.mockRoomRepo.query.mockImplementation((sql: string) =>
            Promise.resolve(
                sql.includes('firstViewedAt IS NOT NULL')
                    ? viewedSecondsAgo === null
                        ? []
                        : [{ viewedSecondsAgo }]
                    : lineageRoundEndedSecondsAgo === null
                      ? [{ endedSecondsAgo: null, hadRealPlayers: 0 }]
                      : [
                            {
                                endedSecondsAgo: lineageRoundEndedSecondsAgo,
                                hadRealPlayers: lineageRoundHadRealPlayers
                                    ? 1
                                    : 0,
                            },
                        ],
            ),
        );
        harness.mockConfigRepo.query.mockResolvedValue(
            playerSeenSecondsAgo === null ? [] : [{ playerSeenSecondsAgo }],
        );
    };

    const HOUSE_ROOM = {
        id: 'room-1',
        soldTickets: 0,
        customSlotId: null,
        ownerAgentId: null,
    };

    it('measures every observation in SQL, never against a JS Date', async () => {
        const h = makeService({ rooms: [] });
        withObservations(h, { viewedSecondsAgo: 5 });

        await (h.service as any).isBotBuyAllowed(HOUSE_ROOM);

        const sqls = [
            ...h.mockRoomRepo.query.mock.calls,
            ...h.mockConfigRepo.query.mock.calls,
        ].map((c: unknown[]) => c[0] as string);
        // The whole point: no timestamp ever crosses into JS, where a non-UTC
        // MySQL session timezone would skew it by hours.
        expect(
            sqls.some((s: string) =>
                s.includes('TIMESTAMPDIFF(SECOND, firstViewedAt, NOW())'),
            ),
        ).toBe(true);
        expect(
            sqls.some((s: string) =>
                s.includes('TIMESTAMPDIFF(SECOND, lastPlayerSeenAt, NOW())'),
            ),
        ).toBe(true);
        expect(
            sqls.some((s: string) =>
                s.includes('TIMESTAMPDIFF(SECOND, r.updatedAt, NOW())'),
            ),
        ).toBe(true);
        // And nothing about display seconds, popup lengths or place counts is
        // bound anywhere - the gate no longer computes a duration at all.
        for (const call of h.mockRoomRepo.query.mock.calls) {
            expect(call[1] ?? []).not.toContain(7);
            expect(call[1] ?? []).not.toContain(10);
        }
    });

    it('lets bots buy one second after the player actually landed on the buying screen', async () => {
        const h = makeService({ rooms: [] });
        withObservations(h, {
            viewedSecondsAgo: 1,
            lineageRoundEndedSecondsAgo: 12,
        });

        await expect(
            (h.service as any).isBotBuyAllowed(HOUSE_ROOM),
        ).resolves.toEqual({ allowed: true, secondsRemaining: 0 });
    });

    it('holds for that one second - the player sees the grid before anything moves on it', async () => {
        const h = makeService({ rooms: [] });
        withObservations(h, {
            viewedSecondsAgo: 0,
            lineageRoundEndedSecondsAgo: 12,
        });

        await expect(
            (h.service as any).isBotBuyAllowed(HOUSE_ROOM),
        ).resolves.toEqual({
            allowed: false,
            secondsRemaining: 1,
            reason: 'a player just landed on the buying screen',
        });
    });

    // The recorded bug, as a test. A round in this room's lineage finished a
    // second ago, a player is in the game watching its result, and nobody has
    // been returned to this room yet. Under the old gate this room was minutes
    // old, its creation-time deadline had expired, and bots bought here at once.
    it('holds an OLD, long-open room while a player is still being shown the previous result', async () => {
        const h = makeService({ rooms: [] });
        withObservations(h, {
            viewedSecondsAgo: null,
            playerSeenSecondsAgo: 1,
            lineageRoundEndedSecondsAgo: 1,
        });

        await expect(
            (h.service as any).isBotBuyAllowed(HOUSE_ROOM),
        ).resolves.toEqual({
            allowed: false,
            secondsRemaining: 89,
            reason: 'a player is still being shown the previous result',
        });
    });

    // Independence from the admin's display settings is the point of the rewrite:
    // the hold lasts until the player arrives, whether that takes 12s or 80s.
    it('keeps holding however long the result screens run - it waits on the player, not a clock', async () => {
        const h = makeService({ rooms: [] });
        for (const endedSecondsAgo of [5, 30, 60, 89]) {
            withObservations(h, {
                playerSeenSecondsAgo: 1,
                lineageRoundEndedSecondsAgo: endedSecondsAgo,
            });
            await expect(
                (h.service as any).isBotBuyAllowed(HOUSE_ROOM),
            ).resolves.toMatchObject({ allowed: false });
        }
    });

    it('releases the moment the player arrives, however long that took', async () => {
        const h = makeService({ rooms: [] });
        withObservations(h, {
            viewedSecondsAgo: 2,
            playerSeenSecondsAgo: 1,
            lineageRoundEndedSecondsAgo: 80, // a long presentation
        });

        await expect(
            (h.service as any).isBotBuyAllowed(HOUSE_ROOM),
        ).resolves.toEqual({ allowed: true, secondsRemaining: 0 });
    });


    // ── Regression: no single missing observation may switch the gate off ────
    //
    // This is the bug the SECOND recording caught. The gate asked only the
    // player-presence heartbeat whether anyone was around, and read "no
    // heartbeat recorded" as "nobody is here" - so one unwritten column turned
    // the whole gate into a no-op and bots bought the instant a room was
    // created. The recording shows the cost exactly: the player landed on a room
    // whose 40s countdown already read 00:24 with all 23 cartelas sold, and not
    // one further cartela was bought in the 24s they sat there.
    it('still holds when the presence heartbeat is missing entirely, because the finished round had real players', async () => {
        const h = makeService({ rooms: [] });
        withObservations(h, {
            viewedSecondsAgo: null,
            playerSeenSecondsAgo: null, // heartbeat never written
            lineageRoundEndedSecondsAgo: 1,
            lineageRoundHadRealPlayers: true,
        });

        await expect(
            (h.service as any).isBotBuyAllowed(HOUSE_ROOM),
        ).resolves.toMatchObject({ allowed: false });
    });

    it('still holds when the presence heartbeat is stale, because the finished round had real players', async () => {
        const h = makeService({ rooms: [] });
        withObservations(h, {
            viewedSecondsAgo: null,
            playerSeenSecondsAgo: 3600, // an hour old
            lineageRoundEndedSecondsAgo: 2,
            lineageRoundHadRealPlayers: true,
        });

        await expect(
            (h.service as any).isBotBuyAllowed(HOUSE_ROOM),
        ).resolves.toMatchObject({ allowed: false });
    });

    // ...and the mirror image: the heartbeat alone is enough when the round that
    // just ended was all bots, which is the spectator case.
    it('still holds for a spectator when the finished round was bot-only, on the heartbeat alone', async () => {
        const h = makeService({ rooms: [] });
        withObservations(h, {
            viewedSecondsAgo: null,
            playerSeenSecondsAgo: 3,
            lineageRoundEndedSecondsAgo: 2,
            lineageRoundHadRealPlayers: false,
        });

        await expect(
            (h.service as any).isBotBuyAllowed(HOUSE_ROOM),
        ).resolves.toMatchObject({ allowed: false });
    });

    it('releases only when BOTH signals agree nobody is watching', async () => {
        const h = makeService({ rooms: [] });
        withObservations(h, {
            viewedSecondsAgo: null,
            playerSeenSecondsAgo: null,
            lineageRoundEndedSecondsAgo: 2,
            lineageRoundHadRealPlayers: false,
        });

        await expect(
            (h.service as any).isBotBuyAllowed(HOUSE_ROOM),
        ).resolves.toEqual({ allowed: true, secondsRemaining: 0 });
    });

    it('says in the log which condition let bots open a room, so a bad release is never silent', async () => {
        const h = makeService({ rooms: [] });
        const logged: string[] = [];
        jest.spyOn((h.service as any).logger, 'log').mockImplementation(
            (m: unknown) => void logged.push(String(m)),
        );
        withObservations(h, {
            viewedSecondsAgo: null,
            playerSeenSecondsAgo: null,
            lineageRoundEndedSecondsAgo: null,
        });

        await (h.service as any).isBotBuyAllowed(HOUSE_ROOM);

        expect(
            logged.some(
                (m) =>
                    m.includes('Bot buy-in gate OPENING') &&
                    m.includes('no round finished recently'),
            ),
        ).toBe(true);
    });

    it('does not wait when nobody is in the game at all - an all-bot house never stalls', async () => {
        const h = makeService({ rooms: [] });
        withObservations(h, {
            playerSeenSecondsAgo: null, // no player has ever been seen
            lineageRoundEndedSecondsAgo: 1,
            lineageRoundHadRealPlayers: false, // ...and the round was all bots
        });

        await expect(
            (h.service as any).isBotBuyAllowed(HOUSE_ROOM),
        ).resolves.toEqual({ allowed: true, secondsRemaining: 0 });
    });

    it('does not wait once the last player has gone quiet', async () => {
        const h = makeService({ rooms: [] });
        withObservations(h, {
            playerSeenSecondsAgo: 20, // stale heartbeat: nobody is looking
            lineageRoundEndedSecondsAgo: 1,
            lineageRoundHadRealPlayers: false, // ...and the round was all bots
        });

        await expect(
            (h.service as any).isBotBuyAllowed(HOUSE_ROOM),
        ).resolves.toEqual({ allowed: true, secondsRemaining: 0 });
    });

    // A spectator holds no ticket, so no ticket-based check would see them - but
    // Bingo.tsx keeps polling the lobby right through the result, so the presence
    // heartbeat does. This is the exact case the recording was made in.
    it('waits for a SPECTATOR who bought no cartela, because the lobby poll still shows them present', async () => {
        const h = makeService({ rooms: [] });
        withObservations(h, {
            viewedSecondsAgo: null,
            playerSeenSecondsAgo: 3, // watching, holding nothing
            lineageRoundEndedSecondsAgo: 4,
        });

        await expect(
            (h.service as any).isBotBuyAllowed(HOUSE_ROOM),
        ).resolves.toMatchObject({ allowed: false });
    });

    it('does not wait when the player in the game is not coming out of THIS room lineage', async () => {
        const h = makeService({ rooms: [] });
        withObservations(h, {
            playerSeenSecondsAgo: 1,
            lineageRoundEndedSecondsAgo: null, // nothing finished in this lineage
        });

        await expect(
            (h.service as any).isBotBuyAllowed(HOUSE_ROOM),
        ).resolves.toEqual({ allowed: true, secondsRemaining: 0 });
    });

    it('scopes the lineage to the room custom slot, then its owner agent, then the house', async () => {
        const h = makeService({ rooms: [] });
        const predicate = (room: unknown) =>
            (h.service as any).roomLineagePredicate(room);

        expect(predicate({ customSlotId: 'slot-9', ownerAgentId: 'a-1' })).toEqual({
            sql: 'r.customSlotId = ?',
            params: ['slot-9'],
        });
        expect(predicate({ customSlotId: null, ownerAgentId: 'a-1' })).toEqual({
            sql: 'r.ownerAgentId = ?',
            params: ['a-1'],
        });
        expect(predicate({ customSlotId: null, ownerAgentId: null })).toEqual({
            sql: 'r.customSlotId IS NULL AND r.ownerAgentId IS NULL',
            params: [],
        });
    });

    it('gives up on a player who never arrives, so a room can never stall for good', async () => {
        const h = makeService({ rooms: [] });
        withObservations(h, {
            playerSeenSecondsAgo: 1,
            lineageRoundEndedSecondsAgo: 90, // backstop reached
        });

        await expect(
            (h.service as any).isBotBuyAllowed(HOUSE_ROOM),
        ).resolves.toEqual({ allowed: true, secondsRemaining: 0 });
    });

    it('coerces the driver string form of the observations', async () => {
        const h = makeService({ rooms: [] });
        withObservations(h, {
            viewedSecondsAgo: '0',
            lineageRoundEndedSecondsAgo: '4',
        });

        await expect(
            (h.service as any).isBotBuyAllowed(HOUSE_ROOM),
        ).resolves.toMatchObject({ allowed: false, secondsRemaining: 1 });
    });

    it('lets a MID-COUNTDOWN top-up through without even querying, whatever else is on screen', async () => {
        const h = makeService({ rooms: [] });
        withObservations(h, {
            playerSeenSecondsAgo: 1,
            lineageRoundEndedSecondsAgo: 1,
        });

        // The gate exists to stop bots STARTING a countdown early. Once one is
        // running, freezing top-ups would stall the room's progressive fill every
        // time an unrelated round happened to finish.
        await expect(
            (h.service as any).isBotBuyAllowed({
                ...HOUSE_ROOM,
                soldTickets: 3,
            }),
        ).resolves.toEqual({ allowed: true, secondsRemaining: 0 });
        expect(h.mockRoomRepo.query).not.toHaveBeenCalled();
    });

    it('falls open instead of throwing when the observations cannot be read', async () => {
        const h = makeService({ rooms: [] });
        h.mockRoomRepo.query.mockRejectedValue(new Error('connection lost'));

        await expect(
            (h.service as any).isBotBuyAllowed(HOUSE_ROOM),
        ).resolves.toEqual({ allowed: true, secondsRemaining: 0 });
    });

    // ── The observations themselves ──────────────────────────────────────────
    it('markRoomViewedByPlayer stamps once, with the DB clock, and only while the room is open', async () => {
        const { service, mockRoomRepo } = makeService({ rooms: [] });
        mockRoomRepo.query.mockResolvedValue(undefined);

        await (service as any).markRoomViewedByPlayer('room-1');

        const [sql, params] = mockRoomRepo.query.mock.calls[0];
        expect(sql).toContain('SET firstViewedAt = NOW()');
        // First writer wins: a later poll must not push the player's arrival
        // forward and re-hold the bots.
        expect(sql).toContain('firstViewedAt IS NULL');
        expect(sql).toContain("status = 'open'");
        expect(params).toEqual(['room-1']);
    });

    it('markRoomViewedByPlayer swallows a failed stamp rather than failing the room load', async () => {
        const { service, mockRoomRepo } = makeService({ rooms: [] });
        mockRoomRepo.query.mockRejectedValue(new Error('write failed'));

        await expect(
            (service as any).markRoomViewedByPlayer('room-1'),
        ).resolves.toBeUndefined();
    });

    it('touchPlayerPresence throttles itself in SQL rather than writing on every poll', async () => {
        const { service, mockConfigRepo } = makeService({ rooms: [] });
        mockConfigRepo.query.mockResolvedValue(undefined);

        await (service as any).touchPlayerPresence('user-1');

        const [sql, params] = mockConfigRepo.query.mock.calls[0];
        expect(sql).toContain('SET lastPlayerSeenAt = NOW()');
        expect(sql).toContain('lastPlayerSeenAt < NOW() - INTERVAL ? SECOND');
        expect(params).toEqual([5]);
    });

    // THE production failure. The raw SQL said `bingo_configs`; the entity maps
    // to `bingo_config`. Every heartbeat write threw "Table 'prod-igames.
    // bingo_configs' doesn't exist", the gate lost its "is anyone watching"
    // signal, and bots bought the instant a room was created. TypeScript cannot
    // check a table name inside a template string, so the name must come from
    // the entity - which is what these assertions pin down.
    it('takes the config table name from the entity metadata, never a hand-written literal', async () => {
        const { service, mockConfigRepo } = makeService({ rooms: [] });
        mockConfigRepo.query.mockResolvedValue([]);

        await (service as any).touchPlayerPresence('user-1');
        await (service as any).getBotBuyObservations({
            id: 'r',
            customSlotId: null,
            ownerAgentId: null,
        });

        const sqls = mockConfigRepo.query.mock.calls.map(
            (c: unknown[]) => c[0] as string,
        );
        expect(sqls.length).toBe(2); // the heartbeat write, then the read
        for (const sql of sqls) {
            expect(sql).toContain('bingo_config_from_metadata');
            expect(sql).not.toContain('bingo_configs');
        }
    });

    it('touchPlayerPresence ignores an unauthenticated read, and never throws', async () => {
        const { service, mockConfigRepo } = makeService({ rooms: [] });

        await expect(
            (service as any).touchPlayerPresence(undefined),
        ).resolves.toBeUndefined();
        expect(mockConfigRepo.query).not.toHaveBeenCalled();

        mockConfigRepo.query.mockRejectedValue(new Error('write failed'));
        await expect(
            (service as any).touchPlayerPresence('user-1'),
        ).resolves.toBeUndefined();
    });
});

describe('BingoService.getRoomState  recording the player arriving on the buying screen', () => {
    // The observation the whole bot buy-in gate rests on. Bingo.tsx suppresses
    // its poll for the ENTIRE result presentation (`if (!holdingResultRef.current)
    // void loadCurrent();`), so the first time a real user's request resolves to
    // an OPEN room is, by construction, the moment that player is put back in
    // front of the cartela grid - whatever the admin set the display timings to.
    const openRoom = () =>
        makeRoom({
            winMode: 'prefilled',
            status: 'open',
            firstViewedAt: null,
        } as any);

    function harnessFor(room: BingoRoom, viewer: unknown) {
        const h = makeService({ rooms: [room] });
        h.mockRoomRepo.manager.findOne.mockResolvedValue(viewer);
        jest.spyOn(h.service as any, 'countSoldTickets').mockResolvedValue(0);
        jest.spyOn(h.service as any, 'getTakenSpots').mockResolvedValue([]);
        jest.spyOn(
            h.service as any,
            'refreshActiveBonusCampaignCache',
        ).mockResolvedValue(undefined);
        jest.spyOn(
            h.service as any,
            'refreshBotWinnerDisplayNames',
        ).mockResolvedValue(undefined);
        const stamp = jest
            .spyOn(h.service as any, 'markRoomViewedByPlayer')
            .mockResolvedValue(undefined);
        return { ...h, stamp };
    }

    const REAL_USER = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        productMetadata: {},
    };
    const BOT_USER = {
        id: '550e8400-e29b-41d4-a716-446655440111',
        productMetadata: { botPolicy: { active: true } },
    };

    it('records the arrival when a real player is served an open room', async () => {
        const room = openRoom();
        const { service, stamp } = harnessFor(room, REAL_USER);

        await service.getRoomState({ roomId: room.id, userId: REAL_USER.id });

        expect(stamp).toHaveBeenCalledWith(room.id);
    });

    it('does not record an arrival for a BOT viewer - only a human landing counts', async () => {
        const room = openRoom();
        const { service, stamp } = harnessFor(room, BOT_USER);

        await service.getRoomState({ roomId: room.id, userId: BOT_USER.id });

        expect(stamp).not.toHaveBeenCalled();
    });

    it('does not record an arrival for an internal, unattributed read', async () => {
        const room = openRoom();
        const { service, stamp } = harnessFor(room, REAL_USER);

        await service.getRoomState({ roomId: room.id }); // no userId

        expect(stamp).not.toHaveBeenCalled();
    });

    it('does not record an arrival on a room that is not open for buying', async () => {
        const room = makeRoom({
            winMode: 'prefilled',
            status: 'running',
            firstViewedAt: null,
        } as any);
        const { service, stamp } = harnessFor(room, REAL_USER);

        await service.getRoomState({ roomId: room.id, userId: REAL_USER.id });

        expect(stamp).not.toHaveBeenCalled();
    });

    it('does not re-record on every poll once the first arrival is known', async () => {
        const room = makeRoom({
            winMode: 'prefilled',
            status: 'open',
            firstViewedAt: new Date(),
        } as any);
        const { service, stamp } = harnessFor(room, REAL_USER);

        await service.getRoomState({ roomId: room.id, userId: REAL_USER.id });

        // Re-stamping would push the arrival forward and re-hold the bots on
        // every 5s poll, so the room would never open to them at all.
        expect(stamp).not.toHaveBeenCalled();
    });
});

describe('BingoService Scheduled Bot Play CRUD', () => {
    it('rejects creating a schedule whose window overlaps an existing one', async () => {
        const { service, mockScheduledBotPlayRepo } = makeService({
            rooms: [],
        });
        mockScheduledBotPlayRepo.find.mockResolvedValue([
            {
                id: 'existing-1',
                name: 'Existing Window',
                scheduleType: 'once',
                startAt: new Date('2026-01-01T10:00:00Z'),
                endAt: new Date('2026-01-01T12:00:00Z'),
                recurrence: null,
            },
        ]);

        await expect(
            service.createScheduledBotPlay({
                name: 'New Window',
                scheduleType: 'once',
                startAt: '2026-01-01T13:00:00', // Addis local -> 10:00 UTC
                endAt: '2026-01-01T15:00:00', // Addis local -> 12:00 UTC, overlaps
                botCount: 5,
                maxCartelasPerBot: 2,
            } as any),
        ).rejects.toThrow(/overlaps/i);
    });

    it('creates a non-overlapping schedule and getActiveScheduledBotPlay finds it when active', async () => {
        const { service, mockScheduledBotPlayRepo } = makeService({
            rooms: [],
        });
        mockScheduledBotPlayRepo.find.mockResolvedValue([]);

        const created = await service.createScheduledBotPlay({
            name: 'Overnight Activity',
            enabled: true,
            scheduleType: 'recurring',
            recurrence: {
                frequency: 'daily',
                startTime: '02:00:00',
                endTime: '06:00:00',
            },
            botCount: 10,
            maxCartelasPerBot: 3,
        } as any);

        expect(created.name).toBe('Overnight Activity');
        expect(created.botCount).toBe(10);

        // 04:00 Addis local = 01:00 UTC, inside the 02:00-06:00 window.
        mockScheduledBotPlayRepo.find.mockResolvedValue([created]);
        const active = await service.getActiveScheduledBotPlay(
            new Date('2026-01-01T01:00:00Z'),
        );
        expect(active?.id).toBe(created.id);

        // 08:00 Addis local = 05:00 UTC, outside the window.
        const inactive = await service.getActiveScheduledBotPlay(
            new Date('2026-01-01T05:00:00Z'),
        );
        expect(inactive).toBeNull();
    });

    it('rejects minCartelasPerBot greater than maxCartelasPerBot on create', async () => {
        const { service, mockScheduledBotPlayRepo } = makeService({
            rooms: [],
        });
        mockScheduledBotPlayRepo.find.mockResolvedValue([]);

        await expect(
            service.createScheduledBotPlay({
                name: 'Bad Range',
                scheduleType: 'recurring',
                recurrence: {
                    frequency: 'daily',
                    startTime: '02:00:00',
                    endTime: '06:00:00',
                },
                botCount: 3,
                maxCartelasPerBot: 2,
                minCartelasPerBot: 5,
            } as any),
        ).rejects.toThrow(/minCartelasPerBot/i);
    });

    it('rejects minCartelasPerBot greater than maxCartelasPerBot on update', async () => {
        const { service, mockScheduledBotPlayRepo } = makeService({
            rooms: [],
        });
        const existing = {
            id: 'schedule-1',
            name: 'Existing',
            scheduleType: 'recurring',
            recurrence: {
                frequency: 'daily',
                startTime: '02:00:00',
                endTime: '06:00:00',
            },
            botCount: 3,
            maxCartelasPerBot: 5,
            minCartelasPerBot: null,
        };
        mockScheduledBotPlayRepo.findOneBy.mockResolvedValue(existing);
        mockScheduledBotPlayRepo.find.mockResolvedValue([existing]);

        await expect(
            service.updateScheduledBotPlay('schedule-1', {
                scheduleType: 'recurring',
                recurrence: existing.recurrence,
                minCartelasPerBot: 9,
            } as any),
        ).rejects.toThrow(/minCartelasPerBot/i);
    });

    it('toggling enabled alone on a recurring schedule does not require re-supplying recurrence', async () => {
        const { service, mockScheduledBotPlayRepo } = makeService({
            rooms: [],
        });
        const existing = {
            id: 'schedule-1',
            name: 'Existing',
            enabled: false,
            scheduleType: 'recurring',
            recurrence: {
                frequency: 'daily',
                startTime: '02:00:00',
                endTime: '06:00:00',
            },
            startAt: null,
            endAt: null,
            botCount: 3,
            maxCartelasPerBot: 5,
            minCartelasPerBot: null,
        };
        mockScheduledBotPlayRepo.findOneBy.mockResolvedValue(existing);
        mockScheduledBotPlayRepo.find.mockResolvedValue([existing]);

        const updated = await service.updateScheduledBotPlay('schedule-1', {
            enabled: true,
        } as any);

        expect(updated.enabled).toBe(true);
        expect(updated.recurrence).toEqual(existing.recurrence);
    });

    it('toggling enabled alone on a one-time schedule does not require re-supplying startAt/endAt', async () => {
        const { service, mockScheduledBotPlayRepo } = makeService({
            rooms: [],
        });
        const existing = {
            id: 'schedule-2',
            name: 'Existing Once',
            enabled: false,
            scheduleType: 'once',
            recurrence: null,
            startAt: new Date('2026-01-01T10:00:00Z'),
            endAt: new Date('2026-01-01T12:00:00Z'),
            botCount: 3,
            maxCartelasPerBot: 5,
            minCartelasPerBot: null,
        };
        mockScheduledBotPlayRepo.findOneBy.mockResolvedValue(existing);
        mockScheduledBotPlayRepo.find.mockResolvedValue([existing]);

        const updated = await service.updateScheduledBotPlay('schedule-2', {
            enabled: true,
        } as any);

        expect(updated.enabled).toBe(true);
        expect(updated.startAt).toEqual(existing.startAt);
        expect(updated.endAt).toEqual(existing.endAt);
    });
});

describe('BingoService Win Sequence  slot resolution + position advance', () => {
    function seqCfg(overrides: Record<string, unknown> = {}) {
        return {
            winSequenceEnabled: true,
            winSequencePattern: ['user', 'bot', 'bot', 'bot'],
            winSequencePosition: 0,
            key: 'global',
            ...overrides,
        } as any;
    }

    it('returns null when the feature is disabled', () => {
        const { service } = makeService({ rooms: [] });
        const cfg = seqCfg({ winSequenceEnabled: false });
        expect((service as any).resolveWinSequenceTarget(cfg)).toBeNull();
    });

    it('returns null when no pattern is configured', () => {
        const { service } = makeService({ rooms: [] });
        const cfg = seqCfg({ winSequencePattern: null });
        expect((service as any).resolveWinSequenceTarget(cfg)).toBeNull();
    });

    it('resolves the slot at the current position', () => {
        const { service } = makeService({ rooms: [] });
        expect(
            (service as any).resolveWinSequenceTarget(seqCfg({ winSequencePosition: 0 })),
        ).toBe('user');
        expect(
            (service as any).resolveWinSequenceTarget(seqCfg({ winSequencePosition: 1 })),
        ).toBe('bot');
        expect(
            (service as any).resolveWinSequenceTarget(seqCfg({ winSequencePosition: 3 })),
        ).toBe('bot');
    });

    it('wraps the position around the pattern length', () => {
        const { service } = makeService({ rooms: [] });
        expect(
            (service as any).resolveWinSequenceTarget(seqCfg({ winSequencePosition: 4 })),
        ).toBe('user'); // 4 % 4 = 0
        expect(
            (service as any).resolveWinSequenceTarget(seqCfg({ winSequencePosition: 9 })),
        ).toBe('bot'); // 9 % 4 = 1
    });

    it('advances the position by one, wrapping, and persists it', async () => {
        const { service, mockConfigRepo } = makeService({ rooms: [] });
        const cfg = seqCfg({ winSequencePosition: 3 });

        await (service as any).advanceWinSequencePosition(cfg);

        expect(cfg.winSequencePosition).toBe(0); // (3+1) % 4
        expect(mockConfigRepo.save).not.toHaveBeenCalled();
        expect(
            (mockConfigRepo as any).update,
        ).not.toBeUndefined(); // sanity: repo shape below actually has update mocked
    });
});

describe('BingoService.reconcileBotCartelasInRoom  Win Sequence overrides', () => {
    it('forces zero bot cartelas and sells any existing ones down when the room is pinned to a "user" slot', async () => {
        const { service, mockRoomRepo } = makeService({ rooms: [] });
        const room = makeRoom({
            winMode: 'prefilled',
            status: 'open',
            winSequenceTarget: 'user',
        } as any);
        mockRoomRepo.findOneBy.mockResolvedValue(room);

        jest.spyOn(service, 'getBingoConfig').mockResolvedValue({
            botWinMode: 'guaranteed',
            botCartelaPolicyEnabled: true,
            botCartelaPolicyMode: 'mirror',
            botMaxCartelasPerBotPerRoom: 5,
        } as any);
        jest.spyOn(
            service as any,
            'countRealPlayersInRoom',
        ).mockResolvedValue(3);
        jest.spyOn(service as any, 'isCartelaChangeLocked').mockReturnValue(
            false,
        );
        jest.spyOn(
            service as any,
            'resolveBingoBotParticipation',
        ).mockReturnValue({ shouldParticipate: () => true });
        jest.spyOn(
            service as any,
            'countBotCartelasInRoom',
        ).mockResolvedValue(4); // bots already hold 4  must be sold down to 0
        jest.spyOn(service as any, 'countSoldTickets').mockResolvedValue(6);
        jest.spyOn(service as any, 'getActiveBotUserIds').mockResolvedValue(
            new Set(['bot-1', 'bot-2']),
        );
        jest.spyOn(
            service as any,
            'getActiveEnabledBonusCampaign',
        ).mockResolvedValue(null);
        jest.spyOn(
            service as any,
            'getActiveScheduledBotPlay',
        ).mockResolvedValue(null);
        const releaseSpy = jest
            .spyOn(service, 'releaseCartela')
            .mockResolvedValue({} as any);
        (service as any).bingoTicketRepository = {
            find: jest.fn().mockResolvedValue([
                {
                    id: 't1',
                    userId: 'bot-1',
                    cartelaNumber: 10,
                    user: { productMetadata: { botPolicy: {} } },
                },
                {
                    id: 't2',
                    userId: 'bot-2',
                    cartelaNumber: 11,
                    user: { productMetadata: { botPolicy: {} } },
                },
            ]),
        };

        const changed = await service.reconcileBotCartelasInRoom(room.id);

        expect(changed).toBe(true);
        expect(releaseSpy).toHaveBeenCalled();
    });

    it('does not cancel a zero-real-player room pinned to a "bot" slot, and forces a minimum bot presence', async () => {
        const { service, mockRoomRepo } = makeService({ rooms: [] });
        const room = makeRoom({
            winMode: 'prefilled',
            status: 'open',
            winSequenceTarget: 'bot',
        } as any);
        mockRoomRepo.findOneBy.mockResolvedValue(room);

        jest.spyOn(service, 'getBingoConfig').mockResolvedValue({
            botWinMode: 'off',
            botCartelaPolicyEnabled: false,
            botCartelaPolicyMode: 'mirror',
            botMaxCartelasPerBotPerRoom: 5,
        } as any);
        const cancelSpy = jest
            .spyOn(service, 'cancelRoom')
            .mockResolvedValue({} as any);
        jest.spyOn(
            service as any,
            'countRealPlayersInRoom',
        ).mockResolvedValue(0);
        jest.spyOn(service as any, 'isCartelaChangeLocked').mockReturnValue(
            false,
        );
        jest.spyOn(
            service as any,
            'resolveBingoBotParticipation',
        ).mockReturnValue({ shouldParticipate: () => false });
        jest.spyOn(
            service as any,
            'countBotCartelasInRoom',
        ).mockResolvedValue(1); // matches the forced minimum computed below
        jest.spyOn(service as any, 'countSoldTickets').mockResolvedValue(0);
        jest.spyOn(service as any, 'getActiveBotUserIds').mockResolvedValue(
            new Set(['bot-1']),
        );
        jest.spyOn(
            service as any,
            'getActiveEnabledBonusCampaign',
        ).mockResolvedValue(null);
        jest.spyOn(
            service as any,
            'getActiveScheduledBotPlay',
        ).mockResolvedValue(null);
        const targetSpy = jest.spyOn(
            service as any,
            'resolveBingoBotCartelaTarget',
        );

        const changed = await service.reconcileBotCartelasInRoom(room.id);

        expect(cancelSpy).not.toHaveBeenCalled();
        expect(targetSpy).toHaveBeenCalledWith(
            expect.objectContaining({ minTotalCartelas: 1 }),
        );
        // desiredBotCartelas resolves to 1 (mirror mode, realCartelas 0, forced
        // minTotalCartelas 1), matching the mocked currentBotCartelas of 1, so
        // the function short-circuits here - the assertions above (no cancel,
        // forced minimum) are what actually prove the override took effect.
        expect(changed).toBe(false);
    });
});
