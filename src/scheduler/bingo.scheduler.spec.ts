import { BingoScheduler } from './bingo.scheduler';

// Covers only the "don't top up a brand-new idle room's bot cartelas until the
// client would actually be showing it" gate. Everything else `drawNextNumbers`
// touches is mocked to a no-op so these tests isolate that one behavior.
//
// Root cause this guards against: a room is created (status='open', idle) the
// instant the previous one completes, but the client keeps showing the
// PREVIOUS room's win popup for `resultDisplaySeconds` (see
// BingoService.getCurrentRoom). Without this gate, a Scheduled Bot Play /
// Win Sequence 'bot' window let bots buy into the brand-new room immediately,
// so by the time the client switched over, cartelas already looked pre-sold
// and the buy-window countdown already looked partially elapsed.
function makeScheduler(overrides: {
    idleRooms?: Array<{
        id: string;
        createdAt: Date;
        winSequenceTarget?: string | null;
    }>;
    countdownRooms?: Array<{ id: string }>;
    activeBotPlaySchedule?: unknown;
    winSequenceEnabled?: boolean;
    resultDisplaySeconds?: number;
} = {}) {
    const cfg = {
        drawIntervalSeconds: 2,
        resultDisplaySeconds: overrides.resultDisplaySeconds ?? 10,
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

describe('BingoScheduler.drawNextNumbers  bot buy-in gate for freshly-created idle rooms', () => {
    it('does not top up an idle room created just now during an active Scheduled Bot Play window', async () => {
        const { scheduler, botsService } = makeScheduler({
            idleRooms: [{ id: 'room-new', createdAt: new Date() }],
            activeBotPlaySchedule: { id: 'schedule-1' },
            resultDisplaySeconds: 10,
        });

        await scheduler.drawNextNumbers();

        expect(botsService.topUpBotsForOpenRoom).not.toHaveBeenCalledWith(
            'room-new',
        );
    });

    it('tops up an idle room once it is older than resultDisplaySeconds', async () => {
        const { scheduler, botsService } = makeScheduler({
            idleRooms: [
                {
                    id: 'room-old',
                    createdAt: new Date(Date.now() - 11_000),
                },
            ],
            activeBotPlaySchedule: { id: 'schedule-1' },
            resultDisplaySeconds: 10,
        });

        await scheduler.drawNextNumbers();

        expect(botsService.topUpBotsForOpenRoom).toHaveBeenCalledWith(
            'room-old',
        );
    });

    it('applies the same gate to an idle room pinned to a Win Sequence bot slot', async () => {
        const { scheduler, botsService } = makeScheduler({
            idleRooms: [
                {
                    id: 'room-seq-new',
                    createdAt: new Date(),
                    winSequenceTarget: 'bot',
                },
            ],
            winSequenceEnabled: true,
            resultDisplaySeconds: 10,
        });

        await scheduler.drawNextNumbers();

        expect(botsService.topUpBotsForOpenRoom).not.toHaveBeenCalledWith(
            'room-seq-new',
        );
    });

    it('never touches an idle room NOT pinned to a bot slot, regardless of age', async () => {
        const { scheduler, botsService } = makeScheduler({
            idleRooms: [
                {
                    id: 'room-seq-user',
                    createdAt: new Date(Date.now() - 60_000),
                    winSequenceTarget: 'user',
                },
            ],
            winSequenceEnabled: true,
            resultDisplaySeconds: 10,
        });

        await scheduler.drawNextNumbers();

        expect(botsService.topUpBotsForOpenRoom).not.toHaveBeenCalledWith(
            'room-seq-user',
        );
    });

    it('still tops up rooms whose countdown already started, regardless of the gate', async () => {
        const { scheduler, botsService } = makeScheduler({
            countdownRooms: [{ id: 'room-in-progress' }],
        });

        await scheduler.drawNextNumbers();

        expect(botsService.topUpBotsForOpenRoom).toHaveBeenCalledWith(
            'room-in-progress',
        );
    });
});
