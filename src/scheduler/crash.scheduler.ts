import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { CrashService } from '../crash/crash.service';
import { GameEventsGateway } from '../events/game-events.gateway';
import { RedisLockService } from '../redis/redis-lock.service';
import { BotsService } from '../bots/bots.service';

const CRASH_LOCK_KEY = 'igames:crash:scheduler-lock';
const CRASH_LOCK_TTL_MS = 30_000;

// Multiplier grows as: M(t) = e^(k * t), where k controls speed
// k = 0.00006 gives roughly 1.00× at 0s → 2.0× at ~11.5s → 10× at ~38s
const GROWTH_K = 0.00006;

@Injectable()
export class CrashScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(CrashScheduler.name);
  private shuttingDown = false;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  // In-memory round state for the tick loop (avoids hitting DB every 100ms)
  private activeRoundId: string | null = null;
  private roundStatus: 'idle' | 'waiting' | 'running' = 'idle';
  private roundStartedAt: number | null = null;
  private waitingStartedAt: number | null = null;
  private crashPointX100: number | null = null;
  private waitingDurationMs = 12_000;
  private tickIntervalMs = 100;
  private lastCrashedAt: number | null = null;
  private betweenRoundDelayMs = 4_000;

  constructor(
    private readonly crashService: CrashService,
    private readonly gameEventsGateway: GameEventsGateway,
    private readonly lockService: RedisLockService,
    private readonly botsService: BotsService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      const cfg = await this.crashService.getConfig();
      if (!cfg.enabled) return;
      this.waitingDurationMs = cfg.waitingDurationSeconds * 1000;
      this.tickIntervalMs = cfg.tickIntervalMs;

      // Resume any in-progress round from DB
      const active = await this.crashService.getActiveRound();
      if (active && active.status === 'waiting') {
        // Create fresh round since we can't restore exact timing
        this.activeRoundId = active.id;
        this.roundStatus = 'waiting';
        this.waitingStartedAt = Date.now();
        this.logger.log(`Crash scheduler resumed waiting round ${active.id}`);
      }

      this.startTicker();
    } catch (err) {
      this.logger.error('Crash bootstrap failed', err instanceof Error ? err.stack : err);
    }
  }

  onApplicationShutdown() {
    this.shuttingDown = true;
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  private startTicker(): void {
    if (this.intervalHandle) return;
    this.intervalHandle = setInterval(() => void this.tick(), this.tickIntervalMs);
  }

  private async tick(): Promise<void> {
    if (this.shuttingDown) return;

    const lock = await this.lockService.acquireLock(CRASH_LOCK_KEY, CRASH_LOCK_TTL_MS);
    if (!lock) return;

    try {
      await this.runTick();
    } catch (err) {
      this.logger.error('Crash scheduler tick error', err instanceof Error ? err.stack : err);
    } finally {
      await this.lockService.releaseLock(lock);
    }
  }

  private async runTick(): Promise<void> {
    const now = Date.now();

    // ── IDLE: create a new round after the between-round delay ──
    if (this.roundStatus === 'idle') {
      if (this.lastCrashedAt && now - this.lastCrashedAt < this.betweenRoundDelayMs) return;

      const cfg = await this.crashService.getConfig();
      if (!cfg.enabled) return;
      this.waitingDurationMs = cfg.waitingDurationSeconds * 1000;
      this.tickIntervalMs = cfg.tickIntervalMs;

      const round = await this.crashService.createRound();
      this.activeRoundId = round.id;
      this.roundStatus = 'waiting';
      this.waitingStartedAt = now;
      this.crashPointX100 = null;

      this.gameEventsGateway.emitCrashRoundWaiting({
        roundId: round.id,
        status: 'waiting',
        seedHash: round.seedHash,
      });
      this.logger.log(`Crash round ${round.id} — waiting phase started`);
      return;
    }

    // ── WAITING: count down, then start ──
    if (this.roundStatus === 'waiting' && this.activeRoundId) {
      const elapsed = now - (this.waitingStartedAt ?? now);
      if (elapsed < this.waitingDurationMs) return;

      try {
        const { round, crashPointX100 } = await this.crashService.startRound(this.activeRoundId);
        this.roundStatus = 'running';
        this.roundStartedAt = now;
        this.crashPointX100 = crashPointX100;

        this.gameEventsGateway.emitCrashRoundStarted({
          roundId: round.id,
          status: 'running',
          seedHash: round.seedHash,
        });
      } catch (err) {
        this.logger.error(`Failed to start crash round ${this.activeRoundId}`, err instanceof Error ? err.stack : err);
        this.resetState();
      }
      return;
    }

    // ── RUNNING: emit tick, check auto-cashouts, check crash ──
    if (this.roundStatus === 'running' && this.activeRoundId && this.roundStartedAt !== null) {
      const elapsedMs = now - this.roundStartedAt;
      const multiplierX100 = this.computeMultiplierX100(elapsedMs);

      // Emit tick to all clients
      this.gameEventsGateway.emitCrashTick({
        roundId: this.activeRoundId,
        multiplierX100,
        elapsedMs,
      });

      // Process auto-cashouts (fire-and-forget per tick)
      void this.crashService.processAutoCashouts(this.activeRoundId, multiplierX100).catch(() => {});

      // Check if we've reached the crash point
      if (this.crashPointX100 !== null && multiplierX100 >= this.crashPointX100) {
        await this.handleCrash(elapsedMs);
      }
    }
  }

  private async handleCrash(elapsedMs: number): Promise<void> {
    if (!this.activeRoundId) return;
    const roundId = this.activeRoundId;

    try {
      const round = await this.crashService.settleRound(roundId, elapsedMs);

      // Fetch seed for provably-fair reveal
      const recentRounds = await this.crashService.getRecentRounds(1);
      const seed = recentRounds[0]?.seed ?? '';

      this.gameEventsGateway.emitCrashRoundCrashed({
        roundId,
        status: 'crashed',
        seedHash: round.seedHash ?? '',
        seed,
        crashPointX100: round.crashPointX100,
        elapsedMs: round.elapsedMs ?? elapsedMs,
      });

      this.logger.log(`Crash round ${roundId} crashed at ${(this.crashPointX100! / 100).toFixed(2)}× after ${elapsedMs}ms`);
    } catch (err) {
      this.logger.error(`Failed to settle crash round ${roundId}`, err instanceof Error ? err.stack : err);
    }

    this.lastCrashedAt = Date.now();
    this.resetState();
  }

  private computeMultiplierX100(elapsedMs: number): number {
    // M(t) = floor(100 * e^(k * t))  — exponential growth
    const m = Math.floor(100 * Math.exp(GROWTH_K * elapsedMs));
    return Math.max(100, m);
  }

  private resetState(): void {
    this.activeRoundId = null;
    this.roundStatus = 'idle';
    this.roundStartedAt = null;
    this.waitingStartedAt = null;
    this.crashPointX100 = null;
  }
}
