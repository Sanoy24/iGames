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
  };
  const userRepository = { createQueryBuilder: jest.fn().mockReturnValue(queryBuilder) };

  const walletService = {
    ensureDefaultWallet: jest.fn().mockResolvedValue(undefined),
    getDefaultWalletSummary: jest.fn().mockResolvedValue({ availableMinor: 0 }),
  };

  const service = new BotsService(
    dataSource as any,
    userRepository as any,
    walletService as any,
    adminService as any,
    {} as any, // kenoService
    {} as any, // bingoService
    {} as any, // crashService
  );

  return { service, adminService, userRepoInManager };
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
});
