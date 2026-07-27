import { ConflictException, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { CrashService } from '../crash/crash.service';
import { GameEventsGateway } from '../events/game-events.gateway';
import { RedisLockService } from '../redis/redis-lock.service';
import { BotsService } from '../bots/bots.service';
import { GamesService } from '../games/games.service';

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

  // The round's phase/timing is re-read from the DB EVERY tick (see runTick) —
  // deliberately NOT cached in process-local fields. On a multi-process
  // deployment (e.g. Phusion Passenger running more than one worker), each
  // process has its own independent memory; a lock only serializes a single
  // tick's critical section, it doesn't synchronize what different processes
  // believe the current phase is. Trusting local memory across ticks meant a
  // process that won a LATER lock acquisition — with stale/idle memory — could
  // treat an already-waiting/running round as freshly created and race another
  // process to start/settle it, producing repeated "Round is running"/"Round
  // is crashed" ConflictExceptions on the SAME round id. Reading the DB's
  // CrashRound row as ground truth every tick makes every process converge on
  // the same decision regardless of how many are running.
  private waitingDurationMs = 12_000;
  private tickIntervalMs = 100;
  // Cosmetic pacing only (the gap between rounds) — not correctness-critical,
  // so process-local best-effort is fine even if it's not perfectly in sync
  // across processes.
  private lastCrashedAt: number | null = null;
  private betweenRoundDelayMs = 4_000;

  constructor(
    private readonly crashService: CrashService,
    private readonly gameEventsGateway: GameEventsGateway,
    private readonly lockService: RedisLockService,
    private readonly botsService: BotsService,
    private readonly gamesService: GamesService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      const cfg = await this.crashService.getConfig();
      if (!cfg.enabled) return;
      this.waitingDurationMs = cfg.waitingDurationSeconds * 1000;
      this.tickIntervalMs = cfg.tickIntervalMs;

      // Clear any rounds left mid-flight by a previous process (their exact
      // timing can't be restored) so the ticker starts from a clean state.
      await this.crashService.abandonStaleRounds();

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

    // Ground truth for every decision below — see the field-block comment.
    const active = await this.crashService.getActiveRoundEntity();

    // ── IDLE: no non-crashed round exists — create one after the between-round delay ──
    if (!active) {
      if (this.lastCrashedAt && now - this.lastCrashedAt < this.betweenRoundDelayMs) return;

      const cfg = await this.crashService.getConfig();
      if (!cfg.enabled) return;
      // Paused by admin (maintenance/hidden): don't create new rounds. Any
      // in-flight round already past IDLE continues to settle normally.
      if (!(await this.gamesService.isPlayable('crash'))) return;
      this.waitingDurationMs = cfg.waitingDurationSeconds * 1000;
      this.tickIntervalMs = cfg.tickIntervalMs;

      const round = await this.crashService.createRound();

      this.gameEventsGateway.emitCrashRoundWaiting({
        roundId: round.id,
        status: 'waiting',
        seedHash: round.seedHash,
      });
      this.logger.log(`Crash round ${round.id} — waiting phase started`);

      // Fire-and-forget: let bots place their bets during the waiting window
      void this.botsService.placeBetsForCrashRound(round.id).catch(() => {});
      return;
    }

    // ── WAITING: count down from the round's own creation time, then start ──
    if (active.status === 'waiting') {
      const elapsed = now - active.createdAt.getTime();
      if (elapsed < this.waitingDurationMs) return;

      try {
        const { round } = await this.crashService.startRound(active.id);
        this.gameEventsGateway.emitCrashRoundStarted({
          roundId: round.id,
          status: 'running',
          seedHash: round.seedHash,
        });
      } catch (err) {
        // Another process already started (or even settled) this round first —
        // an expected, harmless race now that phase comes from the DB, not a
        // bug to log loudly. The next tick re-reads reality and does the
        // right thing regardless of which process won.
        if (!(err instanceof ConflictException)) {
          this.logger.error(`Failed to start crash round ${active.id}`, err instanceof Error ? err.stack : err);
        }
      }
      return;
    }

    // ── RUNNING: emit tick, check auto-cashouts, check crash — timed off the round's own startedAt ──
    if (active.status === 'running' && active.startedAt) {
      const elapsedMs = now - active.startedAt.getTime();
      const multiplierX100 = this.computeMultiplierX100(elapsedMs);

      this.gameEventsGateway.emitCrashTick({
        roundId: active.id,
        multiplierX100,
        elapsedMs,
      });

      // Process auto-cashouts (fire-and-forget per tick)
      void this.crashService.processAutoCashouts(active.id, multiplierX100).catch(() => {});

      // Check if we've reached the crash point (real value from the entity —
      // never exposed to clients until the round has actually crashed).
      if (active.crashPointX100 !== null && multiplierX100 >= active.crashPointX100) {
        await this.handleCrash(active.id, elapsedMs);
      }
    }
  }

  private async handleCrash(roundId: string, elapsedMs: number): Promise<void> {
    try {
      // settleRound is itself idempotent (a round already 'crashed' just
      // returns as-is instead of throwing), so a race where another process
      // settles it a moment earlier is harmless here too.
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

      this.logger.log(`Crash round ${roundId} crashed at ${((round.crashPointX100 ?? 0) / 100).toFixed(2)}× after ${elapsedMs}ms`);
    } catch (err) {
      this.logger.error(`Failed to settle crash round ${roundId}`, err instanceof Error ? err.stack : err);
    }

    this.lastCrashedAt = Date.now();
  }

  private computeMultiplierX100(elapsedMs: number): number {
    // M(t) = floor(100 * e^(k * t))  — exponential growth
    const m = Math.floor(100 * Math.exp(GROWTH_K * elapsedMs));
    return Math.max(100, m);
  }
}
