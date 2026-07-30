import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { WalletService } from './wallet.service';
import { LedgerService } from '../ledger/ledger.service';
import { Wallet } from './entities/wallet.entity';

// ─── Shared mock builder ──────────────────────────────────────────────────────

function makeWallet(overrides: Partial<Wallet> = {}): Wallet {
  return Object.assign(new Wallet(), {
    id: 'wallet-1',
    userId: 'user-1',
    currencyCode: 'CREDIT',
    availableMinor: 10_000,
    reservedMinor: 0,
    status: 'active',
    ...overrides,
  });
}

function makeIdempotencyRecord(response: object) {
  return {
    id: 'idem-1',
    status: 'completed',
    requestHash: 'hash-abc',
    response,
  };
}

function makeService({
  wallet,
  existingIdempotency = null,
}: {
  wallet?: Wallet;
  existingIdempotency?: object | null;
}) {
  const savedWallet = wallet ?? makeWallet();

  // The manager returned inside dataSource.transaction
  const mockManager = {
    getRepository: jest.fn().mockImplementation((entity) => {
      // WagerLimit — enforceWagerLimit reads and saves this
      if (entity?.name === 'WagerLimit' || String(entity) === String(require('./entities/wager-limit.entity').WagerLimit)) {
        return {
          findOneBy: jest.fn().mockResolvedValue(null), // no limit set → allow
          save: jest.fn().mockImplementation((x: unknown) => Promise.resolve(x)),
          create: jest.fn().mockImplementation((x: unknown) => x),
        };
      }
      // Wallet (default)
      return {
        findOne: jest.fn().mockResolvedValue(savedWallet),
        save: jest.fn().mockImplementation((w: Wallet) => Promise.resolve(w)),
      };
    }),
    query: jest.fn().mockResolvedValue(undefined),
  } as unknown as EntityManager;

  const mockDataSource = {
    transaction: jest.fn().mockImplementation(async (cb: (m: EntityManager) => Promise<unknown>) =>
      cb(mockManager)
    ),
  } as unknown as DataSource;

  const mockLedgerService = {
    findIdempotencyRecord: jest.fn().mockResolvedValue(existingIdempotency),
    createPendingIdempotencyRecord: jest.fn().mockResolvedValue({ id: 'idem-new', requestHash: 'hash-abc' }),
    createEntry: jest.fn().mockResolvedValue({
      id: 'ledger-1',
      walletId: savedWallet.id,
      currencyCode: 'CREDIT',
      amountMinor: 1_000,
      direction: 'debit',
      entryType: 'stake',
      sourceType: 'keno_ticket',
      sourceId: 'ticket-1',
      idempotencyKey: 'key-1',
      balanceAfterMinor: savedWallet.availableMinor - 1_000,
      metadata: {},
      createdAt: new Date(),
    }),
    assertIdempotentRequestMatches: jest.fn(),
    completeIdempotencyRecord: jest.fn().mockResolvedValue(undefined),
  } as unknown as LedgerService;

  const mockEventsGateway = { emitWalletUpdated: jest.fn(), emitUserNotification: jest.fn() } as any;
  const mockNotificationsService = { create: jest.fn(), safeCreate: jest.fn() } as any;

  const service = new WalletService(
    mockDataSource,
    { findOneBy: jest.fn(), create: jest.fn(), save: jest.fn() } as any,
    { findOneBy: jest.fn() } as any,
    { findOneBy: jest.fn() } as any,
    { findOneBy: jest.fn() } as any,
    mockLedgerService,
    mockEventsGateway,
    mockNotificationsService,
  );

  return { service, mockManager, mockDataSource, mockLedgerService };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('WalletService — unit (mocked repos)', () => {
  const baseInput = {
    userId: 'user-1',
    amountMinor: 1_000,
    entryType: 'stake' as const,
    sourceType: 'keno_ticket',
    sourceId: 'ticket-1',
    idempotencyKey: 'idem-key-001',
  };

  // ── debit ────────────────────────────────────────────────────────────────

  describe('debit', () => {
    it('returns a WalletMutationResult with idempotent=false on first call', async () => {
      const { service } = makeService({});
      const result = await service.debit(baseInput);
      expect(result.idempotent).toBe(false);
      expect(result.wallet).toBeDefined();
      expect(result.ledgerEntry).toBeDefined();
    });

    it('creates a ledger entry on each unique debit', async () => {
      const { service, mockLedgerService } = makeService({});
      await service.debit(baseInput);
      expect(mockLedgerService.createEntry).toHaveBeenCalledTimes(1);
    });

    it('throws ConflictException when balance is insufficient', async () => {
      const brokeWallet = makeWallet({ availableMinor: 500 });
      const { service } = makeService({ wallet: brokeWallet });
      await expect(service.debit({ ...baseInput, amountMinor: 1_000 })).rejects.toThrow(
        ConflictException
      );
    });

    it('throws on inactive wallet', async () => {
      const frozenWallet = makeWallet({ status: 'locked' });
      const { service } = makeService({ wallet: frozenWallet });
      await expect(service.debit(baseInput)).rejects.toThrow(ConflictException);
    });

    it('returns cached result and skips ledger write on duplicate idempotency key', async () => {
      const cachedResult = {
        wallet: { id: 'wallet-1', userId: 'user-1', availableMinor: 9_000, reservedMinor: 0, currencyCode: 'CREDIT', status: 'active' },
        ledgerEntry: { id: 'ledger-old', walletId: 'wallet-1', currencyCode: 'CREDIT', amountMinor: 1_000, direction: 'debit', entryType: 'stake', sourceType: 'keno_ticket', sourceId: 'ticket-1', idempotencyKey: 'idem-key-001', balanceAfterMinor: 9_000, metadata: {} },
        idempotent: false,
      };
      const { service, mockLedgerService } = makeService({
        existingIdempotency: makeIdempotencyRecord(cachedResult),
      });
      const result = await service.debit(baseInput);
      expect(result.idempotent).toBe(true);
      expect(mockLedgerService.createEntry).not.toHaveBeenCalled();
    });
  });

  // ── credit ───────────────────────────────────────────────────────────────

  describe('credit', () => {
    it('returns a WalletMutationResult with idempotent=false on first call', async () => {
      const { service } = makeService({});
      const result = await service.credit({
        ...baseInput,
        entryType: 'win',
        idempotencyKey: 'credit-key-001',
      });
      expect(result.idempotent).toBe(false);
    });

    it('creates a ledger entry on each unique credit', async () => {
      const { service, mockLedgerService } = makeService({});
      await service.credit({ ...baseInput, entryType: 'win', idempotencyKey: 'credit-key-002' });
      expect(mockLedgerService.createEntry).toHaveBeenCalledTimes(1);
    });

    it('returns cached result on duplicate idempotency key', async () => {
      const cachedResult = {
        wallet: { id: 'wallet-1', userId: 'user-1', availableMinor: 11_000, reservedMinor: 0, currencyCode: 'CREDIT', status: 'active' },
        ledgerEntry: { id: 'ledger-old', walletId: 'wallet-1', currencyCode: 'CREDIT', amountMinor: 1_000, direction: 'credit', entryType: 'win', sourceType: 'keno_ticket', sourceId: 'ticket-1', idempotencyKey: 'credit-key-003', balanceAfterMinor: 11_000, metadata: {} },
        idempotent: false,
      };
      const { service, mockLedgerService } = makeService({
        existingIdempotency: makeIdempotencyRecord(cachedResult),
      });
      const result = await service.credit({ ...baseInput, entryType: 'win', idempotencyKey: 'credit-key-003' });
      expect(result.idempotent).toBe(true);
      expect(mockLedgerService.createEntry).not.toHaveBeenCalled();
    });
  });

  // ── amount validation ─────────────────────────────────────────────────────

  describe('amount validation', () => {
    it('throws BadRequestException on amount = 0', async () => {
      const { service } = makeService({});
      await expect(service.debit({ ...baseInput, amountMinor: 0 })).rejects.toThrow();
    });

    it('throws BadRequestException on negative amount', async () => {
      const { service } = makeService({});
      await expect(service.debit({ ...baseInput, amountMinor: -100 })).rejects.toThrow();
    });
  });

  // ── debitInSession / creditInSession ──────────────────────────────────────

  describe('debitInSession', () => {
    it('uses the supplied manager instead of opening a new transaction', async () => {
      const { service, mockDataSource, mockLedgerService } = makeService({});

      const savedWallet2 = makeWallet();
      const externalManager = {
        getRepository: jest.fn().mockImplementation((entity) => {
          if (entity?.name === 'WagerLimit') {
            return { findOneBy: jest.fn().mockResolvedValue(null), save: jest.fn().mockImplementation((x: unknown) => Promise.resolve(x)), create: jest.fn().mockImplementation((x: unknown) => x) };
          }
          return {
            findOne: jest.fn().mockResolvedValue(savedWallet2),
            save: jest.fn().mockImplementation((w: Wallet) => Promise.resolve(w)),
          };
        }),
        query: jest.fn().mockResolvedValue(undefined),
      } as unknown as EntityManager;

      mockLedgerService.findIdempotencyRecord = jest.fn().mockResolvedValue(null);
      mockLedgerService.createPendingIdempotencyRecord = jest.fn().mockResolvedValue({ id: 'idem-x', requestHash: 'hash-x' });

      await service.debitInSession(baseInput, externalManager);

      // The DataSource.transaction method must NOT be called — caller owns the transaction
      expect(mockDataSource.transaction).not.toHaveBeenCalled();
    });
  });

  // Regression: agents typing a player's phone in national "09…"/"07…" form got a
  // silent "user not found" because the lookup ran on the raw, unnormalized string
  // while users.phoneNumber is always stored as +2519…/+2517… — see phone.util.ts.
  describe('transferAgentToUser', () => {
    it('rejects a malformed phone before opening a transaction', async () => {
      const { service, mockDataSource } = makeService({});

      await expect(service.transferAgentToUser('agent-1', 'not-a-phone', 1_000))
        .rejects.toBeInstanceOf(BadRequestException);
      expect(mockDataSource.transaction).not.toHaveBeenCalled();
    });

    it('normalizes a national "09…" phone to +2519… before looking up the recipient', async () => {
      const userRepo = { findOneBy: jest.fn().mockResolvedValue(null) };
      const { service, mockManager } = makeService({});
      (mockManager.getRepository as jest.Mock).mockImplementation((entity) => {
        if (entity?.name === 'User') return userRepo;
        if (entity?.name === 'WagerLimit') {
          return { findOneBy: jest.fn().mockResolvedValue(null), save: jest.fn(), create: jest.fn((x: unknown) => x) };
        }
        return { findOne: jest.fn().mockResolvedValue(makeWallet()), save: jest.fn() };
      });

      await expect(service.transferAgentToUser('agent-1', '0912345678', 1_000))
        .rejects.toBeInstanceOf(NotFoundException);

      expect(userRepo.findOneBy).toHaveBeenCalledWith({ phoneNumber: '+251912345678' });
    });

    it('also normalizes a bare 9-digit phone', async () => {
      const userRepo = { findOneBy: jest.fn().mockResolvedValue(null) };
      const { service, mockManager } = makeService({});
      (mockManager.getRepository as jest.Mock).mockImplementation((entity) => {
        if (entity?.name === 'User') return userRepo;
        return { findOneBy: jest.fn().mockResolvedValue(null), save: jest.fn(), create: jest.fn((x: unknown) => x), findOne: jest.fn().mockResolvedValue(makeWallet()) };
      });

      await expect(service.transferAgentToUser('agent-1', '912345678', 1_000))
        .rejects.toBeInstanceOf(NotFoundException);

      expect(userRepo.findOneBy).toHaveBeenCalledWith({ phoneNumber: '+251912345678' });
    });
  });
});
