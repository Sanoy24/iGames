import { BingoService } from './bingo.service';
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
      a.scheduledStartAt.getTime() - b.scheduledStartAt.getTime()
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

  const mockTicketRepo = {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    findOneBy: jest.fn().mockResolvedValue(null),
    count: jest.fn().mockResolvedValue(0),
    countBy: jest.fn().mockResolvedValue(0),
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

  const service = new BingoService(
    { transaction: jest.fn() } as any,
    mockRoomRepo as any,
    mockTicketRepo as any,
    mockCardRepo as any,
    mockConfigRepo as any,
    mockPatternRepo as any,
    new (require('./bingo-rules.service').BingoRulesService)(),
    { drawUniqueNumbers: jest.fn() } as any,
    { debitInSession: jest.fn(), creditInSession: jest.fn() } as any,
    { safeCreate: jest.fn(), create: jest.fn() } as any,
  );

  return { service, mockRoomRepo };
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

  it('returns the most recently completed room when nothing is live', async () => {
    const old = makeRoom({ status: 'completed', updatedAt: new Date('2026-01-01') });
    const recent = makeRoom({ status: 'completed', updatedAt: new Date('2026-06-01') });
    const { service } = makeService({ rooms: [old, recent] });

    const result = await service.getCurrentRoom();
    expect(result?.id).toBe(recent.id);
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
});

// ─── findRunningRoomIdsDue ────────────────────────────────────────────────────

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
      { find: jest.fn().mockResolvedValue([]), findOneBy: jest.fn(), save: jest.fn(), create: jest.fn() } as any,
      new (require('./bingo-rules.service').BingoRulesService)(),
      { drawUniqueNumbers: jest.fn() } as any,
      { debitInSession: jest.fn(), creditInSession: jest.fn() } as any,
      { safeCreate: jest.fn(), create: jest.fn() } as any,
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
      { find: jest.fn().mockResolvedValue([]), findOneBy: jest.fn(), save: jest.fn(), create: jest.fn() } as any,
      new (require('./bingo-rules.service').BingoRulesService)(),
      { drawUniqueNumbers: jest.fn() } as any,
      { debitInSession: jest.fn(), creditInSession: jest.fn() } as any,
      { safeCreate: jest.fn(), create: jest.fn() } as any,
    );

    const ids = await service.findRunningRoomIdsDue(2);
    expect(ids).toHaveLength(0);

    void freshRoom; // referenced to avoid unused warning
  });
});
