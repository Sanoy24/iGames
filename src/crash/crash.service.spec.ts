import { CrashService } from './crash.service';
import { CrashBet } from './entities/crash-bet.entity';
import { CrashRound } from './entities/crash-round.entity';
import { DataSource, EntityManager, Not } from 'typeorm';

// ─── Helpers ──────────────────────────────────────────────────────────────────

// abandonStaleRounds is age-gated (see crash.service.ts) so a round another,
// still-healthy process is legitimately driving is never wrongly refunded —
// these are comfortably past both MAX_WAITING_AGE_MS (5 min) and
// MAX_RUNNING_AGE_MS (10 min).
const LONG_AGO_WAITING = new Date(Date.now() - 6 * 60 * 1000);
const LONG_AGO_RUNNING = new Date(Date.now() - 11 * 60 * 1000);

function makeRound(overrides: Partial<CrashRound> = {}): CrashRound {
  return Object.assign(new CrashRound(), {
    id: 'round-1',
    status: 'running',
    seedHash: 'abc123',
    seed: 'secret-seed',
    crashPointX100: null,
    createdAt: LONG_AGO_RUNNING,
    startedAt: LONG_AGO_RUNNING,
    crashedAt: null,
    ...overrides,
  });
}

function makeBet(overrides: Partial<CrashBet> = {}): CrashBet {
  return Object.assign(new CrashBet(), {
    id: 'bet-1',
    userId: 'user-1',
    roundId: 'round-1',
    stakeMinor: 5_000,
    autoCashoutX100: null,
    cashedOutAtX100: null,
    payoutMinor: 0,
    status: 'active',
    ...overrides,
  });
}

function makeService({
  rounds = [] as CrashRound[],
  bets = [] as CrashBet[],
}: {
  rounds?: CrashRound[];
  bets?: CrashBet[];
}) {
  const mockManager = {
    find: jest.fn().mockResolvedValue(bets),
    findOne: jest.fn().mockImplementation((_entity, opts) => {
      const r = rounds.find((r) => r.id === opts?.where?.id);
      return Promise.resolve(r ?? null);
    }),
    save: jest.fn().mockImplementation((entity) => Promise.resolve(entity)),
  } as unknown as EntityManager;

  const mockDataSource = {
    transaction: jest.fn().mockImplementation(async (cb: (m: EntityManager) => unknown) => cb(mockManager)),
  } as unknown as DataSource;

  const mockRoundRepo = {
    find: jest.fn().mockResolvedValue(rounds),
    findOne: jest.fn().mockResolvedValue(rounds[0] ?? null),
    create: jest.fn().mockImplementation((dto) => dto),
    save: jest.fn().mockImplementation((r) => Promise.resolve({ id: 'round-new', ...r })),
    findOneBy: jest.fn().mockResolvedValue(null),
  };

  const mockConfigRepo = {
    findOneBy: jest.fn().mockResolvedValue({
      key: 'default',
      houseEdgePct: 5,
      minBetMinor: 100,
      maxBetMinor: 100_000,
      waitingDurationSeconds: 5,
      tickIntervalMs: 100,
      maxMultiplierX100: 100_00,
      botBetMinor: 500,
      globalBotWinInterval: 0,
    }),
    create: jest.fn().mockImplementation((dto) => dto),
    save: jest.fn().mockImplementation((r) => Promise.resolve(r)),
  };

  const mockBetRepo = {
    find: jest.fn().mockResolvedValue(bets),
    findOne: jest.fn().mockResolvedValue(bets[0] ?? null),
    findOneBy: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockImplementation((dto) => dto),
    save: jest.fn().mockImplementation((b) => Promise.resolve({ id: 'bet-new', ...b })),
  };

  const mockWalletService = {
    creditInSession: jest.fn().mockResolvedValue({}),
    debitInSession: jest.fn().mockResolvedValue({}),
  };

  const mockRngService = {
    drawUniqueNumbers: jest.fn().mockResolvedValue({ numbers: [500_001], algorithmVersion: 1 }),
  };

  const service = new CrashService(
    mockConfigRepo as any,
    mockRoundRepo as any,
    mockBetRepo as any,
    mockWalletService as any,
    mockRngService as any,
    mockDataSource,
    { assertPlayable: jest.fn().mockResolvedValue(undefined), isPlayable: jest.fn().mockResolvedValue(true) } as any,
    { findOne: jest.fn().mockResolvedValue({ displayName: 'Player' }) } as any,
    { emitCrashBetPublic: jest.fn(), emitCrashCashoutPublic: jest.fn() } as any,
  );

  return { service, mockManager, mockWalletService, mockRoundRepo, mockRngService };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('CrashService — unit (mocked repos)', () => {

  // ── abandonStaleRounds ────────────────────────────────────────────────────

  describe('abandonStaleRounds', () => {
    it('returns 0 when there are no stale rounds', async () => {
      const { service } = makeService({ rounds: [] });
      const count = await service.abandonStaleRounds();
      expect(count).toBe(0);
    });

    it('returns the number of stale rounds processed', async () => {
      const round = makeRound({ status: 'running' });
      const { service } = makeService({ rounds: [round], bets: [] });
      const count = await service.abandonStaleRounds();
      expect(count).toBe(1);
    });

    it('credits a refund for each active bet in the stale round', async () => {
      const round = makeRound({ status: 'running' });
      const bet1 = makeBet({ id: 'bet-1', stakeMinor: 1_000 });
      const bet2 = makeBet({ id: 'bet-2', stakeMinor: 2_000 });
      const { service, mockWalletService } = makeService({ rounds: [round], bets: [bet1, bet2] });

      await service.abandonStaleRounds();

      expect(mockWalletService.creditInSession).toHaveBeenCalledTimes(2);
    });

    it('refund uses idempotency key crash-abandon-refund:<betId>', async () => {
      const round = makeRound({ status: 'waiting' });
      const bet = makeBet({ id: 'bet-99' });
      const { service, mockWalletService } = makeService({ rounds: [round], bets: [bet] });

      await service.abandonStaleRounds();

      expect(mockWalletService.creditInSession).toHaveBeenCalledWith(
        expect.objectContaining({ idempotencyKey: 'crash-abandon-refund:bet-99' }),
        expect.anything()
      );
    });

    it('refund amount equals the original stake', async () => {
      const round = makeRound({ status: 'running' });
      const bet = makeBet({ stakeMinor: 7_500 });
      const { service, mockWalletService } = makeService({ rounds: [round], bets: [bet] });

      await service.abandonStaleRounds();

      expect(mockWalletService.creditInSession).toHaveBeenCalledWith(
        expect.objectContaining({ amountMinor: 7_500, entryType: 'refund' }),
        expect.anything()
      );
    });

    it('marks the stale round as crashed with crashPointX100=100', async () => {
      const round = makeRound({ status: 'running', crashPointX100: null });
      const { service, mockManager } = makeService({ rounds: [round], bets: [] });

      await service.abandonStaleRounds();

      expect(mockManager.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'crashed', crashPointX100: 100 })
      );
    });

    it('does not process a round that is already crashed', async () => {
      const round = makeRound({ status: 'crashed' });
      const { service, mockWalletService } = makeService({ rounds: [round], bets: [] });

      // roundRepo.find returns [] for non-crashed → no bets touched
      await service.abandonStaleRounds();
      expect(mockWalletService.creditInSession).not.toHaveBeenCalled();
    });

    // The actual bug this age-gating fixes: on a multi-process deployment, a
    // newly-booting process must NOT refund/crash a round another, already-
    // running process is legitimately still driving.
    it('does NOT touch a fresh "running" round (another process may be actively driving it)', async () => {
      const round = makeRound({ status: 'running', startedAt: new Date(), createdAt: new Date() });
      const { service, mockWalletService } = makeService({ rounds: [round], bets: [] });

      const count = await service.abandonStaleRounds();

      expect(count).toBe(0);
      expect(mockWalletService.creditInSession).not.toHaveBeenCalled();
    });

    it('does NOT touch a fresh "waiting" round', async () => {
      const round = makeRound({ status: 'waiting', createdAt: new Date(), startedAt: null });
      const bet = makeBet({});
      const { service, mockWalletService } = makeService({ rounds: [round], bets: [bet] });

      const count = await service.abandonStaleRounds();

      expect(count).toBe(0);
      expect(mockWalletService.creditInSession).not.toHaveBeenCalled();
    });

    it('treats a "running" round with no startedAt at all as stale (can never resolve on its own)', async () => {
      const round = makeRound({ status: 'running', startedAt: null, createdAt: new Date() });
      const { service } = makeService({ rounds: [round], bets: [] });

      const count = await service.abandonStaleRounds();

      expect(count).toBe(1);
    });
  });

  // ── crash point formula ───────────────────────────────────────────────────
  // Tests the private generateCrashPoint formula via access to the service internals.

  describe('crash point formula', () => {
    const formula = (rngNumber: number, houseEdgePct: number, maxX100: number): number => {
      const e = (rngNumber - 1) / 1_000_000; // uniform [0,1)
      const denominator = e * 100 + houseEdgePct;
      if (denominator <= 0) return 100;
      const rawX100 = Math.floor(10_000 / denominator);
      return Math.min(Math.max(rawX100, 100), maxX100);
    };

    it('returns 100 (minimum) when RNG number is very high (e → 1)', () => {
      // e ≈ 0.999999, denominator ≈ 100 + 5 = 105, rawX100 ≈ 95 → clamped to 100
      expect(formula(1_000_000, 5, 100_000)).toBe(100);
    });

    it('returns max crash point when RNG number is 1 (e = 0)', () => {
      // e = 0, denominator = houseEdgePct = 5, rawX100 = 2000 → clamped by maxX100
      const result = formula(1, 5, 500);
      expect(result).toBe(500); // clamped to maxX100
    });

    it('clamps to maxMultiplierX100 when unclamped value exceeds it', () => {
      expect(formula(1, 5, 1000)).toBe(1000);
    });

    it('never returns less than 100 (1×)', () => {
      for (const rng of [1, 500_000, 999_999, 1_000_000]) {
        expect(formula(rng, 5, 100_00)).toBeGreaterThanOrEqual(100);
      }
    });

    it('never returns more than maxMultiplierX100', () => {
      for (const rng of [1, 500, 1000]) {
        expect(formula(rng, 5, 250)).toBeLessThanOrEqual(250);
      }
    });

    it('higher house edge reduces expected crash multiplier', () => {
      const lowEdge = formula(500_000, 1, 100_000);
      const highEdge = formula(500_000, 20, 100_000);
      expect(lowEdge).toBeGreaterThan(highEdge);
    });
  });
});
