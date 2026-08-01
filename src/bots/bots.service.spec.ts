import { BotsService } from './bots.service';
import { User } from '../users/entities/user.entity';

// Covers only createBot/topupBot's Master Wallet wiring (BE-WALLET-01 follow-up:
// a bot's bankroll is still real ETB liability sitting in the system — it can be
// won by a real player — so it must be funded from the Master Wallet, not minted).
// The rest of BotsService is exercised at the integration level elsewhere.
function makeService(input: { creditFromMasterWallet?: jest.Mock; existingBot?: Partial<User> }) {
  const creditFromMasterWallet = input.creditFromMasterWallet
    ?? jest.fn().mockResolvedValue({ wallet: {}, ledgerEntry: { id: 'ledger-1' } });
  const adminService = { creditFromMasterWallet };
  const botNameRepository = {
    find: jest.fn().mockResolvedValue([]),
    findOneBy: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockImplementation((x: unknown) => ({ id: 'name-1', createdAt: new Date('2026-08-01T00:00:00.000Z'), updatedAt: new Date('2026-08-01T00:00:00.000Z'), ...x as object })),
    save: jest.fn().mockImplementation((x: unknown) => Promise.resolve(x)),
    remove: jest.fn().mockResolvedValue(undefined),
  };
  const botActionLogRepository = {
    create: jest.fn().mockImplementation((x: unknown) => ({ id: 'log-1', createdAt: new Date('2026-08-02T00:00:00.000Z'), ...x as object })),
    save: jest.fn().mockImplementation((x: unknown) => Promise.resolve(x)),
    createQueryBuilder: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({ total: 0 }),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    }),
  };

  const userRepoInManager = {
    create: jest.fn().mockImplementation((x: unknown) => ({ id: 'bot-1', ...x as object })),
    save: jest.fn().mockImplementation((x: unknown) => Promise.resolve(x)),
  };

  const manager = { getRepository: jest.fn().mockReturnValue(userRepoInManager) };
  const dataSource = {
    transaction: jest.fn().mockImplementation((cb: (m: unknown) => Promise<unknown>) => cb(manager)),
  };

  const bot = { id: 'bot-1', displayName: 'Bot One', productMetadata: { botPolicy: {} }, ...input.existingBot };
  const queryBuilder = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getOne: jest.fn().mockResolvedValue(bot),
    getMany: jest.fn().mockResolvedValue([bot]),
  };
  const userRepository = {
    createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
    save: jest.fn().mockImplementation((x: unknown) => Promise.resolve(x)),
  };

  const walletService = {
    ensureDefaultWallet: jest.fn().mockResolvedValue(undefined),
    getDefaultWalletSummary: jest.fn().mockResolvedValue({ availableMinor: 0 }),
  };
  const bingoService = {};

  const service = new BotsService(
    dataSource as any,
    userRepository as any,
    botNameRepository as any,
    botActionLogRepository as any,
    walletService as any,
    adminService as any,
    {} as any, // kenoService
    bingoService as any, // bingoService
    {} as any, // crashService
  );

  return { service, adminService, userRepoInManager, userRepository, botNameRepository, botActionLogRepository, bingoService };
}

describe('BotsService — bot funding is Master-Wallet-backed', () => {
  describe('createBot', () => {
    it('funds the initial balance from the Master Wallet, inside the creation transaction', async () => {
      const { service, adminService } = makeService({});

      await service.createBot({ displayName: 'Bot One', initialBalanceMinor: 250_000 } as any);

      expect(adminService.creditFromMasterWallet).toHaveBeenCalledWith(
        expect.objectContaining({
          targetUserId: 'bot-1',
          amountMinor: 250_000,
          entryType: 'bonus',
          sourceType: 'bot_init',
        }),
        expect.anything(),
      );
    });

    it('defaults the initial balance to 100000 minor units when not specified', async () => {
      const { service, adminService } = makeService({});

      await service.createBot({ displayName: 'Bot Two' } as any);

      expect(adminService.creditFromMasterWallet).toHaveBeenCalledWith(
        expect.objectContaining({ amountMinor: 100000 }),
        expect.anything(),
      );
    });

    it('creates a normalized per-game policy with all games enabled by default', async () => {
      const { service, userRepoInManager } = makeService({});

      await service.createBot({ displayName: 'Bot Three', ticketsPerRound: 2, spotCount: 4 } as any);

      expect(userRepoInManager.create).toHaveBeenCalledWith(expect.objectContaining({
        productMetadata: {
          botPolicy: expect.objectContaining({
            active: true,
            ticketsPerRound: 2,
            spotCount: 4,
            games: expect.objectContaining({
              keno: expect.objectContaining({ active: true, ticketsPerRound: 2, spotCount: 4, strategy: 'normal' }),
              bingo: expect.objectContaining({ active: true, strategy: 'mirror-human' }),
              crash: expect.objectContaining({ active: true, participationRatePct: 60 }),
            }),
          }),
        },
      }));
    });
  });

  describe('updatePolicy', () => {
    it('updates one game flag without disabling the global bot account or other games', async () => {
      const { service, userRepository } = makeService({
        existingBot: {
          id: 'bot-1',
          productMetadata: {
            botPolicy: {
              active: true,
              ticketsPerRound: 1,
              spotCount: 3,
              drawParticipationCount: 0,
              games: {
                keno: { active: true, ticketsPerRound: 1, spotCount: 3, drawParticipationCount: 0 },
                bingo: { active: true },
                crash: { active: true },
              },
            },
          } as any,
        },
      });

      const result = await service.updatePolicy('550e8400-e29b-41d4-a716-446655440000', { bingoActive: false } as any);

      expect(result.botPolicy.active).toBe(true);
      expect(result.botPolicy.games?.keno?.active).toBe(true);
      expect(result.botPolicy.games?.bingo?.active).toBe(false);
      expect(result.botPolicy.games?.crash?.active).toBe(true);
      expect(userRepository.save).toHaveBeenCalledWith(expect.objectContaining({
        productMetadata: expect.objectContaining({
          botPolicy: expect.objectContaining({
            active: true,
            games: expect.objectContaining({
              bingo: expect.objectContaining({ active: false }),
            }),
          }),
        }),
      }));
    });

    it('keeps legacy Keno fields mirrored when Keno policy is edited', async () => {
      const { service } = makeService({
        existingBot: {
          id: 'bot-1',
          productMetadata: {
            botPolicy: {
              active: true,
              ticketsPerRound: 1,
              spotCount: 3,
              drawParticipationCount: 7,
            },
          } as any,
        },
      });

      const result = await service.updatePolicy('550e8400-e29b-41d4-a716-446655440000', {
        ticketsPerRound: 5,
        spotCount: 6,
        kenoActive: false,
      } as any);

      expect(result.botPolicy).toEqual(expect.objectContaining({
        ticketsPerRound: 5,
        spotCount: 6,
        active: true,
      }));
      expect(result.botPolicy.games?.keno).toEqual(expect.objectContaining({
        active: false,
        ticketsPerRound: 5,
        spotCount: 6,
        drawParticipationCount: 7,
      }));
      expect(result.botPolicy.games?.bingo?.active).toBe(true);
      expect(result.botPolicy.games?.crash?.active).toBe(true);
    });
  });

  describe('topupBot', () => {
    it('funds the top-up from the Master Wallet', async () => {
      // findBot's own lookup (a mocked queryBuilder) ignores the requested id and
      // always resolves to the fixture bot below — validateUuid only cares that
      // the INPUT is UUID-shaped, so any valid UUID works as the call argument.
      const { service, adminService } = makeService({ existingBot: { id: 'bot-1' } });

      await service.topupBot('550e8400-e29b-41d4-a716-446655440000', 5000);

      expect(adminService.creditFromMasterWallet).toHaveBeenCalledWith(
        expect.objectContaining({
          targetUserId: 'bot-1',
          amountMinor: 5000,
          entryType: 'bonus',
          sourceType: 'bot_topup',
        }),
        expect.anything(),
      );
    });
  });

  describe('listBotActions', () => {
    it('returns paginated bot activity rows', async () => {
      const { service, botActionLogRepository } = makeService({});
      const createdAt = new Date('2026-08-02T12:00:00.000Z');
      botActionLogRepository.createQueryBuilder.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ total: 0 }),
        getManyAndCount: jest.fn().mockResolvedValue([[
          {
            id: 'log-1',
            botId: 'bot-1',
            game: 'admin',
            action: 'bot_created',
            sourceId: 'bot-1',
            amountMinor: '250000',
            metadata: { reason: 'bot_initial_balance' },
            createdAt,
          },
        ], 1]),
      });

      const result = await service.listBotActions({ botId: '550e8400-e29b-41d4-a716-446655440000', page: 1, limit: 20 });

      expect(result.total).toBe(1);
      expect(result.data[0]).toEqual(expect.objectContaining({
        id: 'log-1',
        botId: 'bot-1',
        game: 'admin',
        action: 'bot_created',
        amountMinor: 250000,
      }));
      expect(botActionLogRepository.createQueryBuilder).toHaveBeenCalled();
    });
  });
});

describe('BotsService — Bingo bot names', () => {
  it('creates trimmed active bot names', async () => {
    const { service, botNameRepository } = makeService({});
    botNameRepository.findOneBy.mockResolvedValue(null);
    botNameRepository.save.mockImplementation(async (value) => value);

    const result = await service.createBotName({ displayName: '  Abebe  ', active: false } as any);

    expect(botNameRepository.create).toHaveBeenCalledWith(expect.objectContaining({ displayName: 'Abebe', active: false }));
    expect(result).toEqual(expect.objectContaining({ displayName: 'Abebe', active: false }));
  });

  it('imports many names while skipping duplicates and blanks', async () => {
    const { service, botNameRepository } = makeService({});
    botNameRepository.find.mockResolvedValue([{ displayName: 'Abebe' }]);
    botNameRepository.save.mockImplementation(async (values) => values);

    const result = await service.importBotNames({ names: ['Abebe', ' Hana ', '', 'Samuel', 'Samuel'] } as any);

    expect(botNameRepository.create).toHaveBeenCalledTimes(2);
    expect(result.map((row) => row.displayName)).toEqual(['Hana', 'Samuel']);
  });

  it('toggles a bot name active state', async () => {
    const { service, botNameRepository } = makeService({});
    botNameRepository.findOneBy.mockResolvedValue({ id: 'name-1', displayName: 'Abebe', active: true });
    botNameRepository.save.mockImplementation(async (value) => value);

    const result = await service.updateBotName('name-1', { active: false } as any);

    expect(result.active).toBe(false);
  });
});

describe('BotsService — Bingo room top-up guard', () => {
  it('cancels bot-only rooms instead of buying into them', async () => {
    const { service, bingoService } = makeService({});
    (service as any).getActiveBots = jest.fn().mockResolvedValue([
      { id: 'bot-1', displayName: 'Bot One', productMetadata: { botPolicy: { ticketsPerRound: 1 } } },
    ]);
    (bingoService as any).getBingoConfig = jest.fn().mockResolvedValue({
      botMaxRealPlayers: 10,
      botWinMode: 'statistical',
    });
    (bingoService as any).countRealPlayersInRoom = jest.fn().mockResolvedValue(0);
    (bingoService as any).cancelRoom = jest.fn().mockResolvedValue(undefined);

    const changed = await service.topUpBotsForOpenRoom('550e8400-e29b-41d4-a716-446655440000');

    expect(changed).toBe(true);
    expect((bingoService as any).cancelRoom).toHaveBeenCalledWith('550e8400-e29b-41d4-a716-446655440000');
  });
});
