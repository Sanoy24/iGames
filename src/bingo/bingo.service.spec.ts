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
    rooms.filter((r) => r.status === status).sort((a, b) =>
      (a.scheduledStartAt?.getTime() ?? 0) - (b.scheduledStartAt?.getTime() ?? 0)
    )[0] ?? null;

  const getLastCompleted = () =>
    rooms
      .filter((r) => r.status === 'completed')
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0] ?? null;

  const mockRoomRepo = {
    findOne: jest.fn().mockImplementation(({ where }: any) => {
      if (where.status === 'running') return Promise.resolve(getByStatus('running'));
      if (where.status === 'open') return Promise.resolve(getByStatus('open'));
      if (where.status === 'completed') return Promise.resolve(getLastCompleted());
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
  };

  const mockPatternRepo = {
    find: jest.fn().mockResolvedValue([]),
    findOneBy: jest.fn().mockResolvedValue(null),
    save: jest.fn().mockImplementation((p) => Promise.resolve(p)),
    create: jest.fn().mockImplementation((dto) => dto),
  };

  const mockCustomRoomSlotRepo = {
    find: jest.fn().mockResolvedValue([]),
    findBy: jest.fn().mockResolvedValue([]),
    findOneBy: jest.fn().mockResolvedValue(null),
    save: jest.fn().mockImplementation((s) => Promise.resolve(s)),
    create: jest.fn().mockImplementation((dto) => dto),
    delete: jest.fn().mockResolvedValue({ affected: 1 }),
  };

  const walletService = { debitInSession: jest.fn(), creditInSession: jest.fn() };
  const dataSource = { transaction: jest.fn() as any };

  const service = new BingoService(
    dataSource as any,
    mockRoomRepo as any,
    mockBotNameRepo as any,
    mockTicketRepo as any,
    mockCardRepo as any,
    mockConfigRepo as any,
    mockCustomRoomSlotRepo as any,
    mockPatternRepo as any,
    new (require('./bingo-rules.service').BingoRulesService)(),
    { drawUniqueNumbers: jest.fn() } as any,
    walletService as any,
    { safeCreate: jest.fn(), create: jest.fn() } as any,
    { assertPlayable: jest.fn().mockResolvedValue(undefined), isPlayable: jest.fn().mockResolvedValue(true) } as any,
  );

  return { service, mockRoomRepo, mockBotNameRepo, mockTicketRepo, mockCardRepo, mockConfigRepo, mockPatternRepo, walletService, dataSource };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('BingoService.getCurrentRoom — unit (mocked repos)', () => {
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
    const old = makeRoom({ status: 'completed', updatedAt: new Date('2026-01-01') });
    const recent = makeRoom({ status: 'completed', updatedAt: new Date('2026-06-01') });
    const { service, mockRoomRepo } = makeService({ rooms: [old, recent] });
    mockRoomRepo.query.mockResolvedValueOnce([{ id: recent.id }]);

    const result = await service.getCurrentRoom();
    expect(result?.id).toBe(recent.id);
  });

  it('does not return an old completed room after the result window has expired', async () => {
    const completed = makeRoom({ status: 'completed', updatedAt: new Date('2026-06-01') });
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
    const completed = makeRoom({ status: 'completed', updatedAt: new Date() });
    const { service } = makeService({ rooms: [completed, open, running] });

    const result = await service.getCurrentRoom();
    expect(result?.id).toBe(running.id);
  });

  it('prefers open over completed', async () => {
    const open = makeRoom({ status: 'open' });
    const completed = makeRoom({ status: 'completed', updatedAt: new Date() });
    const { service } = makeService({ rooms: [completed, open] });

    const result = await service.getCurrentRoom();
    expect(result?.id).toBe(open.id);
  });
});

// ─── computePrefilledPrizeMinor (derash payout math) ─────────────────────────

describe('BingoService.computePrefilledPrizeMinor — derash payout', () => {
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
    expect(service.computePrefilledPrizeMinor(40, '1st', 20, cfg() as any)).toBe(32);
    // pot 100 → pool 80. Regression: must be 80, NOT 64.
    expect(service.computePrefilledPrizeMinor(100, '1st', 20, cfg() as any)).toBe(80);
  });

  it('is independent of the configured 1st-place percentage when it is the only place', () => {
    const { service } = makeService({ rooms: [] });
    // Whether the weight is 80 or 100, a single enabled place gets the whole pool.
    expect(service.computePrefilledPrizeMinor(100, '1st', 20, cfg({ prefilledFirstPlacePct: 100 }) as any)).toBe(80);
    expect(service.computePrefilledPrizeMinor(100, '1st', 20, cfg({ prefilledFirstPlacePct: 50 }) as any)).toBe(80);
  });

  it('splits the pool by weight across enabled places', () => {
    const { service } = makeService({ rooms: [] });
    const c = cfg({ prefilledSecondPlaceEnabled: true, prefilledSecondPlacePct: 20 });
    // pool 80, weights 80/20 (total 100) → 1st 64, 2nd 16.
    expect(service.computePrefilledPrizeMinor(100, '1st', 20, c as any)).toBe(64);
    expect(service.computePrefilledPrizeMinor(100, '2nd', 20, c as any)).toBe(16);
  });

  it('returns 0 when no enabled place has any weight', () => {
    const { service } = makeService({ rooms: [] });
    expect(service.computePrefilledPrizeMinor(100, '1st', 20, cfg({ prefilledFirstPlacePct: 0 }) as any)).toBe(0);
  });

  it('splits the pool across all five enabled places by weight', () => {
    const { service } = makeService({ rooms: [] });
    // No house edge → pool == pot. Weights 50/25/15/6/4 (total 100).
    const c = cfg({
      prefilledFirstPlacePct: 50,
      prefilledSecondPlaceEnabled: true, prefilledSecondPlacePct: 25,
      prefilledThirdPlaceEnabled: true,  prefilledThirdPlacePct: 15,
      prefilledFourthPlaceEnabled: true, prefilledFourthPlacePct: 6,
      prefilledFifthPlaceEnabled: true,  prefilledFifthPlacePct: 4,
    });
    expect(service.computePrefilledPrizeMinor(100, '1st', 0, c as any)).toBe(50);
    expect(service.computePrefilledPrizeMinor(100, '2nd', 0, c as any)).toBe(25);
    expect(service.computePrefilledPrizeMinor(100, '3rd', 0, c as any)).toBe(15);
    expect(service.computePrefilledPrizeMinor(100, '4th', 0, c as any)).toBe(6);
    expect(service.computePrefilledPrizeMinor(100, '5th', 0, c as any)).toBe(4);
  });

  it('does not let a DISABLED place dilute the enabled places', () => {
    const { service } = makeService({ rooms: [] });
    // 4th carries a weight but is NOT enabled, so its 50 must be excluded from the
    // denominator — the enabled 1st/2nd keep their full 80/20 share of the pool.
    // (computePrefilledPrizeMinor is only ever called for ENABLED places in the
    // settlement loop via nextOpenPrefilledPlace, so 4th is never requested here.)
    const c = cfg({
      prefilledSecondPlaceEnabled: true, prefilledSecondPlacePct: 20,
      prefilledFourthPlaceEnabled: false, prefilledFourthPlacePct: 50,
    });
    expect(service.computePrefilledPrizeMinor(100, '1st', 20, c as any)).toBe(64); // 80/100 of pool 80
    expect(service.computePrefilledPrizeMinor(100, '2nd', 20, c as any)).toBe(16); // 20/100 of pool 80
  });
});

// ─── findRunningRoomIdsDue ────────────────────────────────────────────────────

// ─── computePrefilledFinalPrizeMinor (end-of-game pool reconciliation) ────────

describe('BingoService.computePrefilledFinalPrizeMinor — filled-place reconciliation', () => {
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
    expect(service.computePrefilledFinalPrizeMinor(100, '1st', 20, ['1st'], cfg() as any)).toBe(80);
  });

  it('equals the progressive prize when every enabled place is filled', () => {
    const { service } = makeService({ rooms: [] });
    const c = cfg({
      prefilledSecondPlaceEnabled: true, prefilledSecondPlacePct: 20,
      prefilledThirdPlaceEnabled: true, prefilledThirdPlacePct: 0, // 3rd enabled, weight 0
    });
    // Enabled weights 80/20/0 = 100. All three filled → 1st 64, 2nd 16, 3rd 0.
    const filled = ['1st', '2nd', '3rd'] as any;
    expect(service.computePrefilledFinalPrizeMinor(100, '1st', 20, filled, c as any)).toBe(64);
    expect(service.computePrefilledFinalPrizeMinor(100, '2nd', 20, filled, c as any)).toBe(16);
  });

  it('redistributes an UNFILLED place’s share to the filled places (no house leak)', () => {
    const { service } = makeService({ rooms: [] });
    // Enabled 1st/2nd/3rd = 50/30/20. But only 1st and 2nd actually filled.
    const c = cfg({
      prefilledFirstPlacePct: 50,
      prefilledSecondPlaceEnabled: true, prefilledSecondPlacePct: 30,
      prefilledThirdPlaceEnabled: true, prefilledThirdPlacePct: 20,
    });
    const filled = ['1st', '2nd'] as any; // 3rd never filled
    // Pool 80 split by FILLED weights 50/30 (total 80): 1st = 80*50/80 = 50, 2nd = 30.
    // The unfilled 3rd's 20 share is NOT kept by the house — it lifts 1st+2nd.
    expect(service.computePrefilledFinalPrizeMinor(100, '1st', 20, filled, c as any)).toBe(50);
    expect(service.computePrefilledFinalPrizeMinor(100, '2nd', 20, filled, c as any)).toBe(30);
    // Filled prizes sum to the whole pool (50 + 30 = 80).
  });

  it('returns 0 when there are no filled places', () => {
    const { service } = makeService({ rooms: [] });
    expect(service.computePrefilledFinalPrizeMinor(100, '1st', 20, [], cfg() as any)).toBe(0);
  });
});

describe('BingoService.findRunningRoomIdsDue — unit', () => {
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
      { find: jest.fn().mockResolvedValue([]), createQueryBuilder: jest.fn().mockReturnValue({ select: jest.fn().mockReturnThis(), addSelect: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(), groupBy: jest.fn().mockReturnThis(), getRawMany: jest.fn().mockResolvedValue([]) }) } as any,
      { countBy: jest.fn().mockResolvedValue(0), query: jest.fn().mockResolvedValue([]), find: jest.fn().mockResolvedValue([]), findOne: jest.fn(), save: jest.fn(), create: jest.fn() } as any,
      { findOneBy: jest.fn().mockResolvedValue({ drawIntervalSeconds: 2, salesWindowSeconds: 40, resultDisplaySeconds: 10, enabled: true, defaultTicketPriceMinor: 100, defaultMaxTickets: 100, defaultOneLineMinor: 5000, defaultTwoLinesMinor: 10000, defaultFullHouseMinor: 20000, autoRepeatIntervalMinutes: 5, minTicketsToStart: 1 }), create: jest.fn().mockImplementation((d) => d), save: jest.fn().mockImplementation((d) => d) } as any,
      { find: jest.fn().mockResolvedValue([]), findBy: jest.fn().mockResolvedValue([]), findOneBy: jest.fn(), save: jest.fn(), create: jest.fn(), delete: jest.fn() } as any,
      { find: jest.fn().mockResolvedValue([]), findOneBy: jest.fn(), save: jest.fn(), create: jest.fn() } as any,
      new (require('./bingo-rules.service').BingoRulesService)(),
      { drawUniqueNumbers: jest.fn() } as any,
      { debitInSession: jest.fn(), creditInSession: jest.fn() } as any,
      { safeCreate: jest.fn(), create: jest.fn() } as any,
      {} as any,
      { assertPlayable: jest.fn().mockResolvedValue(undefined), isPlayable: jest.fn().mockResolvedValue(true) } as any,
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
      { find: jest.fn().mockResolvedValue([]), createQueryBuilder: jest.fn().mockReturnValue({ select: jest.fn().mockReturnThis(), addSelect: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(), groupBy: jest.fn().mockReturnThis(), getRawMany: jest.fn().mockResolvedValue([]) }) } as any,
      { countBy: jest.fn().mockResolvedValue(0), query: jest.fn().mockResolvedValue([]), find: jest.fn().mockResolvedValue([]), findOne: jest.fn(), save: jest.fn(), create: jest.fn() } as any,
      { findOneBy: jest.fn().mockResolvedValue({ drawIntervalSeconds: 2, salesWindowSeconds: 40 }), create: jest.fn().mockImplementation((d) => d), save: jest.fn().mockImplementation((d) => d) } as any,
      { find: jest.fn().mockResolvedValue([]), findBy: jest.fn().mockResolvedValue([]), findOneBy: jest.fn(), save: jest.fn(), create: jest.fn(), delete: jest.fn() } as any,
      { find: jest.fn().mockResolvedValue([]), findOneBy: jest.fn(), save: jest.fn(), create: jest.fn() } as any,
      new (require('./bingo-rules.service').BingoRulesService)(),
      { drawUniqueNumbers: jest.fn() } as any,
      { debitInSession: jest.fn(), creditInSession: jest.fn() } as any,
      { safeCreate: jest.fn(), create: jest.fn() } as any,
      {} as any,
      { assertPlayable: jest.fn().mockResolvedValue(undefined), isPlayable: jest.fn().mockResolvedValue(true) } as any,
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
      findOne: jest.fn().mockImplementation((entity: unknown, options: any) => {
        if (options?.where?.id === room.id) return Promise.resolve(room);
        return Promise.resolve(ticket);
      }),
      find: jest.fn(),
      save: jest.fn().mockResolvedValue(undefined),
      update: jest.fn().mockResolvedValue(undefined),
      query: jest.fn().mockResolvedValue([{ c: 1 }]),
      countBy: jest.fn().mockResolvedValue(1),
    };
    (dataSource.transaction as jest.Mock).mockImplementation((cb: (m: unknown) => Promise<unknown>) => cb(manager));

    await expect(
      service.releaseCartela({ userId, roomId: room.id, cartelaNumber: 7 }),
    ).rejects.toThrow('Cartela changes are locked near the draw start');

    expect(manager.findOne).toHaveBeenCalledTimes(1);
  });

  it('cancels the room and returns bot cartelas when the last real player leaves', async () => {
    const { service, dataSource, walletService } = makeService({ rooms: [] });
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
      findOne: jest.fn().mockImplementation((entity: unknown, options: any) => {
        if (options?.where?.id === room.id) return Promise.resolve(room);
        return Promise.resolve(realTicket);
      }),
      find: jest.fn().mockResolvedValue([botTicket]),
      save: jest.fn().mockImplementation(async (value: any) => value),
      update: jest.fn().mockResolvedValue(undefined),
      query: jest.fn().mockResolvedValue([{ c: 0 }]),
      countBy: jest.fn().mockResolvedValue(1),
    };
    (dataSource.transaction as jest.Mock).mockImplementation((cb: (m: unknown) => Promise<unknown>) => cb(manager));
    walletService.creditInSession = jest.fn().mockResolvedValue({ id: 'credit-1' });

    const result = await service.releaseCartela({ userId, roomId: room.id, cartelaNumber: 7 });

    expect(result).toEqual({ cartelaNumber: 7, refundedMinor: 100, roomCancelled: true });
    expect(room.status).toBe('cancelled');
    expect(room.soldTickets).toBe(0);
    expect(room.settlementSummary).toMatchObject({ reason: 'bingo_room_no_real_players' });
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
    const { service, dataSource, walletService } = makeService({ rooms: [] });
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
    (dataSource.transaction as jest.Mock).mockImplementation((cb: (m: unknown) => Promise<unknown>) => cb(manager));
    walletService.creditInSession = jest.fn().mockResolvedValue({ id: 'credit-1' });

    const result = await service.drawNextNumber(room.id);

    expect(result.status).toBe('cancelled');
    expect(room.status).toBe('cancelled');
    expect(walletService.creditInSession).toHaveBeenCalledTimes(1);
  });

  it('rejects cartela purchases in the freeze window before the draw', async () => {
    const { service, dataSource, walletService } = makeService({ rooms: [] });
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
    (dataSource.transaction as jest.Mock).mockImplementation((cb: (m: unknown) => Promise<unknown>) => cb(manager));

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
    const purchaseSpy = jest.spyOn(service, 'purchaseTickets').mockResolvedValue([] as any);
    const releaseSpy = jest.spyOn(service, 'releaseCartela').mockResolvedValue({ cartelaNumber: 1, refundedMinor: 100 } as any);

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
    jest.spyOn(service as any, 'isCartelaChangeLocked').mockReturnValue(false);
    jest.spyOn(service, 'getBingoConfig').mockResolvedValue(botCfg() as any);
    jest.spyOn(service, 'countRealPlayersInRoom').mockResolvedValue(2);
    jest.spyOn(service, 'countBotCartelasInRoom').mockResolvedValue(0);
    jest.spyOn(service as any, 'countSoldTickets' as any).mockResolvedValue(2 as any);
    jest.spyOn(service as any, 'getActiveBotUserIds').mockResolvedValue(new Set(['bot-1']));
    jest.spyOn(service, 'ensureRoomBotIdentities').mockResolvedValue({} as any);
    jest.spyOn(service as any, 'countUserCartelasInRoom').mockResolvedValue(0);
    jest.spyOn(service as any, 'listAvailableCartelaNumbers').mockResolvedValue([1, 2, 3]);
    jest.spyOn(service as any, 'shuffle' as any).mockImplementation((...args: any[]) => [...args[0]].reverse());
    const purchaseSpy = jest.spyOn(service, 'purchaseTickets').mockResolvedValue([] as any);

    await expect(service.reconcileBotCartelasInRoom(room.id)).resolves.toBe(true);

    expect((purchaseSpy.mock.calls as any[]).map((call) => call[0].cartelaNumbers[0])).toEqual([3, 2]);
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
    jest.spyOn(service as any, 'isCartelaChangeLocked').mockReturnValue(false);
    jest.spyOn(service, 'getBingoConfig').mockResolvedValue(botCfg({
      botCartelaPolicyMode: 'fixed_cap',
      botMaxCartelasPerBotPerRoom: 1,
      botBelowThresholdEnabled: false,
      botAboveThresholdEnabled: true,
      botAboveThresholdRealPlayers: 50,
    }) as any);
    jest.spyOn(service, 'countRealPlayersInRoom').mockResolvedValue(60);
    jest.spyOn(service, 'countBotCartelasInRoom').mockResolvedValue(0);
    jest.spyOn(service as any, 'countSoldTickets' as any).mockResolvedValue(3 as any);
    jest.spyOn(service as any, 'getActiveBotUserIds').mockResolvedValue(new Set(['bot-1']));
    jest.spyOn(service, 'ensureRoomBotIdentities').mockResolvedValue({} as any);
    jest.spyOn(service as any, 'countUserCartelasInRoom').mockResolvedValue(0);
    jest.spyOn(service as any, 'listAvailableCartelaNumbers').mockResolvedValue([1, 2, 3]);
    jest.spyOn(service as any, 'shuffle' as any).mockImplementation((...args: any[]) => [...args[0]]);
    const purchaseSpy = jest.spyOn(service, 'purchaseTickets').mockResolvedValue([] as any);

    await expect(service.reconcileBotCartelasInRoom(room.id)).resolves.toBe(true);

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
    jest.spyOn(service as any, 'isCartelaChangeLocked').mockReturnValue(false);
    jest.spyOn(service, 'getBingoConfig').mockResolvedValue(botCfg({
      botBelowThresholdEnabled: false,
      botAboveThresholdEnabled: true,
      botAboveThresholdRealPlayers: 50,
    }) as any);
    jest.spyOn(service, 'countRealPlayersInRoom').mockResolvedValue(5);
    jest.spyOn(service, 'countBotCartelasInRoom').mockResolvedValue(0);
    jest.spyOn(service as any, 'countSoldTickets' as any).mockResolvedValue(1 as any);
    jest.spyOn(service as any, 'getActiveBotUserIds').mockResolvedValue(new Set(['bot-1']));
    const purchaseSpy = jest.spyOn(service, 'purchaseTickets').mockResolvedValue([] as any);

    await expect(service.reconcileBotCartelasInRoom(room.id)).resolves.toBe(false);

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
    jest.spyOn((service as any).bingoRulesService, 'evaluatePatternTicket')
      .mockReturnValue({ completedPatternIds: ['pattern-1'] });

    const winner = (service as any).pickBotRedirectWinner(
      [
        { id: 'ticket-1', userId: 'bot-1', grid: [[1]] },
        { id: 'ticket-2', userId: 'bot-2', grid: [[2]] },
      ],
      new Set(['bot-1', 'bot-2']),
      { id: 'pattern-1' },
      [1],
      new Set(['bot-1']),
    );

    expect(winner?.userId).toBe('bot-2');
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
        productMetadata: { botPolicy: { active: true, games: { bingo: { active: true } } } },
      }),
      save: jest.fn().mockImplementation(async (value) => value),
    };
    walletService.creditInSession.mockResolvedValue({ id: 'credit-1' });

    await (service as any).awardDerashPlace({
      room,
      winner,
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
        select: expect.arrayContaining(['id', 'displayName', 'phoneNumber', 'productMetadata']),
      }),
    );
    const summary = room.settlementSummary ?? {};
    expect((summary['1st'] as any).winnerDisplayName).toBe('Hana');
    expect((summary['1st'] as any).winnerPhoneLast4).toBe('0851');
  });
});

describe('BingoService.setAutoClaim — active-card scope', () => {
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
      { userId: '550e8400-e29b-41d4-a716-446655440099', roomId: '550e8400-e29b-41d4-a716-446655440088', status: 'active' },
      { autoClaim: true },
    );
  });
});
