import { BingoScheduler } from './bingo.scheduler';

// Covers only which rooms the scheduler's periodic tick decides to visit for
// bot cartela top-up during a Scheduled Bot Play / Win Sequence 'bot' window.
// Whether it's actually too early for a room's FIRST bot cartela is decided
// centrally inside BingoService.reconcileBotCartelasInRoom (see
// bingo.service.spec.ts's "first-bot-buy-in gate" tests) - reconcile is also
// reached directly from a real player's purchase/refund, not just from here,
// so gating only at this scheduler layer previously left a hole where an
// unrelated purchase could still trigger an immediate bot pile-on.
function makeScheduler(overrides: {
    idleRooms?: Array<{
        id: string;
        winSequenceTarget?: string | null;
    }>;
    countdownRooms?: Array<{ id: string }>;
    activeBotPlaySchedule?: unknown;
    winSequenceEnabled?: boolean;
} = {}) {
    const cfg = {
        drawIntervalSeconds: 2,
        resultDisplaySeconds: 10,
        bonusWinDisplaySeconds: 5,
        winSequenceEnabled: overrides.winSequenceEnabled ?? false,
    };
    const bingoService = {
        getBingoConfig: jest.fn().mockResolvedValue(cfg),
        isAgentRoomsEnabled: jest.fn().mockResolvedValue(false),
        reconcileActiveRooms: jest.fn().mockResolvedValue(null),
        findRunningRoomIdsDue: jest.fn().mockResolvedValue([]),
        findOpenRoomsWithCountdown: jest
            .fn()
            .mockResolvedValue(overrides.countdownRooms ?? []),
        getActiveScheduledBotPlay: jest
            .fn()
            .mockResolvedValue(overrides.activeBotPlaySchedule ?? null),
        findIdleOpenRooms: jest
            .fn()
            .mockResolvedValue(overrides.idleRooms ?? []),
        findRoomsToStart: jest.fn().mockResolvedValue([]),
        findAgentRoomsToStart: jest.fn().mockResolvedValue([]),
        autoCreateNextRoom: jest.fn().mockResolvedValue(null),
        ensureCustomRoomSlots: jest.fn().mockResolvedValue(undefined),
        getRoomState: jest.fn().mockResolvedValue({}),
    };
    const botsService = {
        topUpBotsForOpenRoom: jest.fn().mockResolvedValue(false),
    };
    const gameEventsGateway = {
        emitBingoNumberDrawn: jest.fn(),
        emitBingoRoomUpdated: jest.fn(),
        emitBingoRoomCompleted: jest.fn(),
    };
    const lockService = {
        acquireLock: jest.fn().mockResolvedValue({ resource: 'lock' }),
        releaseLock: jest.fn().mockResolvedValue(undefined),
        getStatus: jest.fn().mockReturnValue('ready'),
    };
    const telegramBotService = {};
    const gamesService = {
        isPlayable: jest.fn().mockResolvedValue(true),
    };

    const scheduler = new BingoScheduler(
        bingoService as any,
        botsService as any,
        gameEventsGateway as any,
        lockService as any,
        telegramBotService as any,
        gamesService as any,
    );
    return {
        scheduler,
        bingoService,
        botsService,
        gameEventsGateway,
        lockService,
        gamesService,
    };
}

describe('BingoScheduler.drawNextNumbers  idle-room bot top-up visiting', () => {
    it('visits an idle room during an active Scheduled Bot Play window (age is not decided here)', async () => {
        const { scheduler, botsService } = makeScheduler({
            idleRooms: [{ id: 'room-new' }],
            activeBotPlaySchedule: { id: 'schedule-1' },
        });

        await scheduler.drawNextNumbers();

        expect(botsService.topUpBotsForOpenRoom).toHaveBeenCalledWith(
            'room-new',
        );
    });

    it('visits an idle room pinned to a Win Sequence bot slot', async () => {
        const { scheduler, botsService } = makeScheduler({
            idleRooms: [{ id: 'room-seq-bot', winSequenceTarget: 'bot' }],
            winSequenceEnabled: true,
        });

        await scheduler.drawNextNumbers();

        expect(botsService.topUpBotsForOpenRoom).toHaveBeenCalledWith(
            'room-seq-bot',
        );
    });

    it('never visits an idle room pinned to a Win Sequence USER slot', async () => {
        const { scheduler, botsService } = makeScheduler({
            idleRooms: [{ id: 'room-seq-user', winSequenceTarget: 'user' }],
            winSequenceEnabled: true,
        });

        await scheduler.drawNextNumbers();

        expect(botsService.topUpBotsForOpenRoom).not.toHaveBeenCalledWith(
            'room-seq-user',
        );
    });

    it('never visits idle rooms when neither Scheduled Bot Play nor Win Sequence is active', async () => {
        const { scheduler, botsService } = makeScheduler({
            idleRooms: [{ id: 'room-idle' }],
        });

        await scheduler.drawNextNumbers();

        expect(botsService.topUpBotsForOpenRoom).not.toHaveBeenCalledWith(
            'room-idle',
        );
    });

    it('always tops up rooms whose countdown already started', async () => {
        const { scheduler, botsService } = makeScheduler({
            countdownRooms: [{ id: 'room-in-progress' }],
        });

        await scheduler.drawNextNumbers();

        expect(botsService.topUpBotsForOpenRoom).toHaveBeenCalledWith(
            'room-in-progress',
        );
    });
});
