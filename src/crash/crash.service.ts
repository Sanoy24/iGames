import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Not, Repository } from 'typeorm';
import { createHash, randomBytes } from 'crypto';
import { WalletService } from '../wallet/wallet.service';
import { RngService } from '../rng/rng.service';
import { GamesService } from '../games/games.service';
import { GameEventsGateway } from '../events/game-events.gateway';
import { User } from '../users/entities/user.entity';
import { CrashConfig } from './entities/crash-config.entity';
import { CrashRound } from './entities/crash-round.entity';
import { CrashBet } from './entities/crash-bet.entity';
import { PlaceCrashBetDto } from './dto/place-crash-bet.dto';

export type CrashRoundResponse = {
  id: string;
  status: string;
  seedHash: string;
  seed?: string;
  crashPointX100: number | null;
  startedAt: string | null;
  crashedAt: string | null;
  elapsedMs: number | null;
  settlementSummary: Record<string, unknown> | null;
  bets?: CrashBetResponse[];
};

export type CrashBetResponse = {
  id: string;
  userId: string;
  roundId: string;
  stakeMinor: number;
  autoCashoutX100: number | null;
  cashedOutAtX100: number | null;
  payoutMinor: number;
  status: string;
};

@Injectable()
export class CrashService {
  private readonly logger = new Logger(CrashService.name);

  constructor(
    @InjectRepository(CrashConfig)
    private readonly configRepo: Repository<CrashConfig>,
    @InjectRepository(CrashRound)
    private readonly roundRepo: Repository<CrashRound>,
    @InjectRepository(CrashBet)
    private readonly betRepo: Repository<CrashBet>,
    private readonly walletService: WalletService,
    private readonly rngService: RngService,
    private readonly dataSource: DataSource,
    private readonly gamesService: GamesService,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly gateway: GameEventsGateway,
  ) {}

  // Cache of masked display names for the live "All Bets" feed (avoids a DB
  // hit per bot bet every round). Bounded by distinct bettors.
  private readonly maskedNameCache = new Map<string, string>();

  /** Aviator-style privacy masking: "Abebe" → "A***e". */
  private maskName(name: string): string {
    const n = (name ?? '').trim();
    if (n.length <= 1) return n || 'Player';
    if (n.length === 2) return `${n[0]}*`;
    return `${n[0]}***${n[n.length - 1]}`;
  }

  private async resolveMaskedName(userId: string): Promise<string> {
    const cached = this.maskedNameCache.get(userId);
    if (cached) return cached;
    const user = await this.userRepo.findOne({ where: { id: userId }, select: ['displayName'] });
    const masked = this.maskName(user?.displayName ?? 'Player');
    this.maskedNameCache.set(userId, masked);
    return masked;
  }

  /** Best-effort broadcast of a bet to the public live feed (never throws). */
  private async broadcastBetPlaced(bet: CrashBetResponse): Promise<void> {
    try {
      const name = await this.resolveMaskedName(bet.userId);
      this.gateway.emitCrashBetPublic({
        betId: bet.id,
        roundId: bet.roundId,
        name,
        stakeMinor: bet.stakeMinor,
        autoCashoutX100: bet.autoCashoutX100,
      });
    } catch (err) {
      this.logger.debug(`Crash bet broadcast skipped: ${err instanceof Error ? err.message : err}`);
    }
  }

  private broadcastCashout(bet: CrashBetResponse): void {
    try {
      this.gateway.emitCrashCashoutPublic({
        betId: bet.id,
        roundId: bet.roundId,
        cashedOutAtX100: bet.cashedOutAtX100,
        payoutMinor: bet.payoutMinor,
      });
    } catch (err) {
      this.logger.debug(`Crash cashout broadcast skipped: ${err instanceof Error ? err.message : err}`);
    }
  }

  // ── Config ────────────────────────────────────────────────────────────────

  async getConfig(): Promise<CrashConfig> {
    let cfg = await this.configRepo.findOneBy({ key: 'default' });
    if (!cfg) {
      cfg = this.configRepo.create({ key: 'default' });
      await this.configRepo.save(cfg);
    }
    return cfg;
  }

  async updateConfig(dto: Partial<Omit<CrashConfig, 'key' | 'createdAt' | 'updatedAt'>>): Promise<CrashConfig> {
    let cfg = await this.configRepo.findOneBy({ key: 'default' });
    if (!cfg) cfg = this.configRepo.create({ key: 'default' });
    Object.assign(cfg, dto);
    return this.configRepo.save(cfg);
  }

  // ── Round lifecycle ───────────────────────────────────────────────────────

  /**
   * Marks GENUINELY stuck rounds as crashed and refunds still-active bets, so a
   * newly-booting scheduler doesn't dead-lock on a round abandoned by a process
   * that crashed without cleaning up. Deliberately age-gated rather than "any
   * non-crashed round" — on a multi-process deployment (e.g. Phusion Passenger
   * running more than one worker), a round can be perfectly healthy and being
   * actively driven by ANOTHER already-running process at the exact moment this
   * one boots; wrongly abandoning it would refund live bets out from under a
   * round that's still legitimately in progress. A 'waiting' round is normally
   * resolved within `waitingDurationSeconds` (a few seconds); a 'running' round
   * within roughly a minute even at the max configured multiplier — so anything
   * far beyond either window is safe to call genuinely orphaned.
   */
  async abandonStaleRounds(): Promise<number> {
    const MAX_WAITING_AGE_MS = 5 * 60 * 1000;
    const MAX_RUNNING_AGE_MS = 10 * 60 * 1000;
    const now = Date.now();

    const candidates = await this.roundRepo.find({ where: { status: Not('crashed') as any } });
    const stale = candidates.filter((round) => {
      if (round.status === 'waiting') return now - round.createdAt.getTime() > MAX_WAITING_AGE_MS;
      if (round.status === 'running') return !round.startedAt || now - round.startedAt.getTime() > MAX_RUNNING_AGE_MS;
      return false;
    });
    if (stale.length === 0) return 0;

    for (const round of stale) {
      await this.dataSource.transaction(async (manager) => {
        const activeBets = await manager.find(CrashBet, { where: { roundId: round.id, status: 'active' } });
        for (const bet of activeBets) {
          // Full refund — the round never completed, so the stake is returned.
          await this.walletService.creditInSession(
            {
              userId: bet.userId,
              amountMinor: bet.stakeMinor,
              entryType: 'refund',
              sourceType: 'crash_bet',
              sourceId: bet.id,
              idempotencyKey: `crash-abandon-refund:${bet.id}`,
              metadata: { roundId: round.id, reason: 'round_abandoned' },
            },
            manager,
          );
          bet.status = 'won';
          bet.cashedOutAtX100 = 100;
          bet.payoutMinor = bet.stakeMinor;
          bet.walletCredit = { reason: 'round_abandoned_refund' };
          await manager.save(bet);
        }

        const fresh = await manager.findOne(CrashRound, { where: { id: round.id } });
        if (fresh && fresh.status !== 'crashed') {
          fresh.status = 'crashed';
          fresh.crashedAt = new Date();
          if (fresh.crashPointX100 == null) fresh.crashPointX100 = 100;
          await manager.save(fresh);
        }
      });
    }

    this.logger.warn(`Abandoned ${stale.length} stale crash round(s) on startup`);
    return stale.length;
  }

  async getActiveRound(): Promise<CrashRoundResponse | null> {
    const round = await this.roundRepo.findOne({
      where: { status: Not('crashed') as any },
      order: { createdAt: 'DESC' },
    });
    return round ? this.toRoundResponse(round) : null;
  }

  /**
   * Scheduler-internal only — unlike getActiveRound(), this exposes the REAL
   * crashPointX100 even while the round is still running (the scheduler needs
   * it to detect the crash threshold). NEVER return this from a public
   * endpoint; toRoundResponse's crashed-only reveal is the anti-cheat boundary.
   */
  async getActiveRoundEntity(): Promise<CrashRound | null> {
    return this.roundRepo.findOne({
      where: { status: Not('crashed') as any },
      order: { createdAt: 'DESC' },
    });
  }

  async getRecentRounds(limit = 20): Promise<CrashRoundResponse[]> {
    const safeLimit = Math.min(Math.max(limit, 1), 50);
    const rounds = await this.roundRepo
      .createQueryBuilder('r')
      .addSelect('r.seed')
      .where('r.status = :status', { status: 'crashed' })
      .orderBy('r.crashedAt', 'DESC')
      .limit(safeLimit)
      .getMany();
    return rounds.map((r) => this.toRoundResponse(r, true));
  }

  async createRound(): Promise<CrashRoundResponse> {
    const existing = await this.roundRepo.findOne({
      where: { status: Not('crashed') as any },
    });
    if (existing) return this.toRoundResponse(existing);

    const seed = randomBytes(32).toString('hex');
    const seedHash = createHash('sha256').update(seed).digest('hex');

    const round = this.roundRepo.create({
      status: 'waiting',
      seedHash,
      seed,
      crashPointX100: null,
    });
    const saved = await this.roundRepo.save(round);
    this.logger.log(`Created Crash round ${saved.id} (hash: ${seedHash.slice(0, 12)}…)`);
    return this.toRoundResponse(saved);
  }

  async startRound(roundId: string): Promise<{ round: CrashRoundResponse; crashPointX100: number }> {
    return this.dataSource.transaction(async (manager) => {
      // seed has select:false — must use addSelect to load it
      const round = await manager
        .createQueryBuilder(CrashRound, 'r')
        .addSelect('r.seed')
        .where('r.id = :id', { id: roundId })
        .setLock('pessimistic_write')
        .getOne();
      if (!round) throw new NotFoundException('Round not found');
      if (round.status !== 'waiting') throw new ConflictException(`Round is ${round.status}`);
      if (!round.seed) throw new Error(`Round ${roundId} has no seed — cannot generate crash point`);

      const cfg = await this.getConfig();
      const crashPointX100 = await this.generateCrashPoint(round.id, round.seed, cfg.houseEdgePct, cfg.maxMultiplierX100, manager);

      round.status = 'running';
      round.crashPointX100 = crashPointX100;
      round.startedAt = new Date();
      await manager.save(round);

      this.logger.log(`Crash round ${round.id} started — crash at ${(crashPointX100 / 100).toFixed(2)}×`);
      return { round: this.toRoundResponse(round), crashPointX100 };
    });
  }

  async settleRound(roundId: string, elapsedMs: number): Promise<CrashRoundResponse> {
    return this.dataSource.transaction(async (manager) => {
      const round = await manager.findOne(CrashRound, {
        where: { id: roundId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!round) throw new NotFoundException('Round not found');
      if (round.status === 'crashed') return this.toRoundResponse(round, true);
      if (round.status !== 'running') throw new ConflictException(`Round is ${round.status}`);

      round.status = 'crashed';
      round.crashedAt = new Date();
      round.elapsedMs = elapsedMs;

      // Settle all still-active bets as lost
      const activeBets = await manager.find(CrashBet, {
        where: { roundId, status: 'active' },
      });

      let totalBets = 0;
      let totalPayouts = 0;

      for (const bet of activeBets) {
        bet.status = 'lost';
        totalBets++;
        await manager.save(bet);
      }

      // Count wins from already-cashed-out bets
      const wonBets = await manager.find(CrashBet, { where: { roundId, status: 'won' } });
      for (const bet of wonBets) {
        totalBets++;
        totalPayouts += bet.payoutMinor;
      }

      round.settlementSummary = {
        crashPointX100: round.crashPointX100,
        totalBets,
        totalLostBets: activeBets.length,
        totalWonBets: wonBets.length,
        totalPayoutsMinor: totalPayouts,
      };

      await manager.save(round);
      this.logger.log(`Crash round ${round.id} settled. ${activeBets.length} bets lost, ${wonBets.length} won.`);
      return this.toRoundResponse(round, true);
    });
  }

  // ── Betting ───────────────────────────────────────────────────────────────

  async placeBet(
    userId: string,
    roundId: string,
    dto: PlaceCrashBetDto,
    idempotencyKey: string,
  ): Promise<CrashBetResponse> {
    await this.gamesService.assertPlayable('crash');
    const cfg = await this.getConfig();

    if (dto.stakeMinor < cfg.minBetMinor) {
      throw new BadRequestException(`Minimum bet is ${cfg.minBetMinor} ETB`);
    }
    if (dto.stakeMinor > cfg.maxBetMinor) {
      throw new BadRequestException(`Maximum bet is ${cfg.maxBetMinor} ETB`);
    }

    const result = await this.dataSource.transaction(async (manager) => {
      // Idempotency guard
      const existing = await manager.findOne(CrashBet, {
        where: { idempotencyKey },
      });
      if (existing) return this.toBetResponse(existing);

      const round = await manager.findOne(CrashRound, {
        where: { id: roundId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!round) throw new NotFoundException('Round not found');
      if (round.status !== 'waiting') {
        throw new BadRequestException('Betting phase has ended for this round');
      }

      // Debit stake from wallet
      const debitResult = await this.walletService.debitInSession(
        {
          userId,
          amountMinor: dto.stakeMinor,
          entryType: 'stake',
          sourceType: 'crash_bet',
          sourceId: roundId,
          idempotencyKey: `debit:${idempotencyKey}`,
          metadata: { roundId },
        },
        manager,
      );

      const autoCashoutX100 = dto.autoCashoutAt
        ? Math.floor(dto.autoCashoutAt * 100)
        : null;

      const bet = manager.create(CrashBet, {
        userId,
        roundId,
        stakeMinor: dto.stakeMinor,
        autoCashoutX100,
        cashedOutAtX100: null,
        payoutMinor: 0,
        status: 'active',
        idempotencyKey,
        walletDebit: { ledgerEntryId: debitResult.ledgerEntry.id },
        walletCredit: null,
      });

      await manager.save(bet);
      return this.toBetResponse(bet);
    });

    // Post-commit: surface the bet on the public live feed (best-effort).
    void this.broadcastBetPlaced(result);
    return result;
  }

  async cashOut(userId: string, roundId: string, currentMultiplierX100: number): Promise<CrashBetResponse> {
    const result = await this.dataSource.transaction(async (manager) => {
      const round = await manager.findOne(CrashRound, { where: { id: roundId } });
      if (!round || round.status !== 'running') {
        throw new BadRequestException('Round is not running');
      }

      const bet = await manager.findOne(CrashBet, {
        where: { userId, roundId, status: 'active' },
        lock: { mode: 'pessimistic_write' },
      });
      if (!bet) throw new NotFoundException('No active bet found for this round');

      // Guard: can't cash out at or above crash point
      if (currentMultiplierX100 >= (round.crashPointX100 ?? 0)) {
        throw new BadRequestException('Cannot cash out — round has already crashed');
      }

      const payoutMinor = Math.floor((bet.stakeMinor * currentMultiplierX100) / 100);

      const creditResult = await this.walletService.creditInSession(
        {
          userId,
          amountMinor: payoutMinor,
          entryType: 'win',
          sourceType: 'crash_bet',
          sourceId: bet.id,
          idempotencyKey: `cashout:${bet.idempotencyKey}:${currentMultiplierX100}`,
          metadata: { roundId, multiplierX100: currentMultiplierX100 },
        },
        manager,
      );

      bet.status = 'won';
      bet.cashedOutAtX100 = currentMultiplierX100;
      bet.payoutMinor = payoutMinor;
      bet.walletCredit = { ledgerEntryId: creditResult.ledgerEntry.id };
      await manager.save(bet);

      return this.toBetResponse(bet);
    });

    // Post-commit: update the public live feed row to "cashed out" (best-effort).
    this.broadcastCashout(result);
    return result;
  }

  // Called by scheduler each tick to auto-cashout eligible bets
  async processAutoCashouts(roundId: string, currentMultiplierX100: number): Promise<CrashBetResponse[]> {
    const eligible = await this.betRepo.find({
      where: { roundId, status: 'active' },
    });

    const toProcess = eligible.filter(
      (b) => b.autoCashoutX100 !== null && currentMultiplierX100 >= b.autoCashoutX100,
    );

    const results: CrashBetResponse[] = [];
    for (const bet of toProcess) {
      try {
        const result = await this.cashOut(bet.userId, roundId, bet.autoCashoutX100!);
        results.push(result);
      } catch (err) {
        this.logger.warn(`Auto-cashout failed for bet ${bet.id}: ${err instanceof Error ? err.message : err}`);
      }
    }
    return results;
  }

  async getMyBetsForRound(userId: string, roundId: string): Promise<CrashBetResponse[]> {
    const bets = await this.betRepo.find({ where: { userId, roundId }, order: { createdAt: 'DESC' } });
    return bets.map((b) => this.toBetResponse(b));
  }

  async getMyRecentBets(userId: string, limit = 20): Promise<CrashBetResponse[]> {
    const safeLimit = Math.min(Math.max(limit, 1), 50);
    const bets = await this.betRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: safeLimit,
    });
    return bets.map((b) => this.toBetResponse(b));
  }

  // ── Provably fair RNG ─────────────────────────────────────────────────────

  private async generateCrashPoint(
    roundId: string,
    seed: string,
    houseEdgePct: number,
    maxMultiplierX100: number,
    manager: EntityManager,
  ): Promise<number> {
    // Use the RNG service for audit — we draw 1 "number" between 0 and 999999
    // to get a uniform random value, then apply the house-edge crash formula
    const result = await this.rngService.drawUniqueNumbers({
      min: 1,
      max: 1_000_000,
      count: 1,
      gameType: 'crash',
      gameReference: roundId,
      metadata: { seed: seed.slice(0, 8) + '…', houseEdgePct },
      manager,
    });

    const e = (result.numbers[0] - 1) / 1_000_000; // uniform [0, 1)

    // Standard crash formula with house edge:
    // crashPoint = max(100, floor(100 * 100 / (100 * e + houseEdge))) / 100
    // Simplified: floor(10000 / (e * 100 + houseEdgePct)) × 1
    // We work in ×100 integer space throughout
    const denominator = e * 100 + houseEdgePct;
    if (denominator <= 0) return 100; // instant crash guard

    const rawX100 = Math.floor(10000 / denominator);
    const clampedX100 = Math.min(Math.max(rawX100, 100), maxMultiplierX100);
    return clampedX100;
  }

  // ── Serializers ───────────────────────────────────────────────────────────

  private toRoundResponse(round: CrashRound, revealSeed = false): CrashRoundResponse {
    return {
      id: round.id,
      status: round.status,
      seedHash: round.seedHash,
      ...(revealSeed && round.seed ? { seed: round.seed } : {}),
      crashPointX100: round.status === 'crashed' ? round.crashPointX100 : null,
      startedAt: round.startedAt?.toISOString() ?? null,
      crashedAt: round.crashedAt?.toISOString() ?? null,
      elapsedMs: round.elapsedMs ?? null,
      settlementSummary: round.settlementSummary ?? null,
    };
  }

  private toBetResponse(bet: CrashBet): CrashBetResponse {
    return {
      id: bet.id,
      userId: bet.userId,
      roundId: bet.roundId,
      stakeMinor: bet.stakeMinor,
      autoCashoutX100: bet.autoCashoutX100,
      cashedOutAtX100: bet.cashedOutAtX100,
      payoutMinor: bet.payoutMinor,
      status: bet.status,
    };
  }
}
