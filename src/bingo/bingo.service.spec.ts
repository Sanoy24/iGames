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
    mockConfigRepo as any,
    mockPatternRepo as any,
    { drawUniqueNumbers: jest.fn() } as any,
    { debitInSession: jest.fn(), creditInSession: jest.fn() } as any,
    new (require('./bingo-rules.service').BingoRulesService)(),
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

// ─── findRunningRoomIdsDue ────────────────────────────────────────────────────

describe('BingoService.findRunningRoomIdsDue — unit', () => {
  it('returns room IDs whose updatedAt is older than the interval', async () => {
    const oldRoom = makeRoom({
      status: 'running',
      updatedAt: new Date(Date.now() - 10_000),
    });

    const mockRoomRepo = {
      find: jest.fn().mockResolvedValue([oldRoom]),
      findOne: jest.fn(),
      findOneBy: jest.fn(),
    } as any;

    const service = new BingoService(
      { transaction: jest.fn() } as any,
      mockRoomRepo,
      { find: jest.fn().mockResolvedValue([]), createQueryBuilder: jest.fn().mockReturnValue({ select: jest.fn().mockReturnThis(), addSelect: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(), groupBy: jest.fn().mockReturnThis(), getRawMany: jest.fn().mockResolvedValue([]) }) } as any,
      { findOneBy: jest.fn().mockResolvedValue({ drawIntervalSeconds: 2, salesWindowSeconds: 40, resultDisplaySeconds: 10, enabled: true, defaultTicketPriceMinor: 100, defaultMaxTickets: 100, defaultOneLineMinor: 5000, defaultTwoLinesMinor: 10000, defaultFullHouseMinor: 20000, autoRepeatIntervalMinutes: 5, minTicketsToStart: 1 }), create: jest.fn().mockImplementation((d) => d), save: jest.fn().mockImplementation((d) => d) } as any,
      { find: jest.fn().mockResolvedValue([]), findOneBy: jest.fn(), save: jest.fn(), create: jest.fn() } as any,
      { drawUniqueNumbers: jest.fn() } as any,
      { debitInSession: jest.fn(), creditInSession: jest.fn() } as any,
      new (require('./bingo-rules.service').BingoRulesService)(),
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
      findOne: jest.fn(),
      findOneBy: jest.fn(),
    } as any;

    const service = new BingoService(
      { transaction: jest.fn() } as any,
      mockRoomRepo,
      { find: jest.fn().mockResolvedValue([]), createQueryBuilder: jest.fn().mockReturnValue({ select: jest.fn().mockReturnThis(), addSelect: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(), groupBy: jest.fn().mockReturnThis(), getRawMany: jest.fn().mockResolvedValue([]) }) } as any,
      { findOneBy: jest.fn().mockResolvedValue({ drawIntervalSeconds: 2, salesWindowSeconds: 40 }), create: jest.fn().mockImplementation((d) => d), save: jest.fn().mockImplementation((d) => d) } as any,
      { find: jest.fn().mockResolvedValue([]), findOneBy: jest.fn(), save: jest.fn(), create: jest.fn() } as any,
      { drawUniqueNumbers: jest.fn() } as any,
      { debitInSession: jest.fn(), creditInSession: jest.fn() } as any,
      new (require('./bingo-rules.service').BingoRulesService)(),
    );

    const ids = await service.findRunningRoomIdsDue(2);
    expect(ids).toHaveLength(0);

    void freshRoom; // referenced to avoid unused warning
  });
});
