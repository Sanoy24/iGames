import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { Cron, CronExpression, Interval } from '@nestjs/schedule';
import type { Lock } from 'redlock';
import { WerkRoundManager } from '../werk/round/werk-round-manager.service';
import { RedisLockService } from '../redis/redis-lock.service';

const WERK_LEADER_LOCK_KEY = 'igames:werk:leader';
const WERK_LEADER_LOCK_TTL_MS = 4_000;

/**
 * Drives the single active Werk round. Leadership is a Redis lock HELD across
 * ticks (extended every second) so exactly one instance owns the in-memory round
 * loop cluster-wide — releasing/re-acquiring each tick would drop the live round
 * state. If the leader dies, its lock expires and another instance takes over.
 * The fast interval advances the running round + broadcasts snapshots (~15Hz);
 * the 1s cron renews leadership and runs lifecycle (open lobby, start, settle).
 */
@Injectable()
export class WerkScheduler implements OnApplicationShutdown {
  private readonly logger = new Logger(WerkScheduler.name);
  private heldLock: Lock | null = null;
  private leaderUntil = 0;
  private lifecycleRunning = false;
  private shuttingDown = false;

  constructor(
    private readonly roundManager: WerkRoundManager,
    private readonly lockService: RedisLockService,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    this.shuttingDown = true;
    if (this.heldLock) {
      await this.lockService.releaseLock(this.heldLock).catch(() => undefined);
      this.heldLock = null;
    }
  }

  private get isLeader(): boolean {
    return this.heldLock != null && Date.now() < this.leaderUntil;
  }

  /** Advance + broadcast the running round. Cheap no-op unless we're the leader. */
  @Interval(66)
  fast(): void {
    if (!this.isLeader || this.shuttingDown) return;
    try {
      this.roundManager.fastTick();
    } catch (err) {
      this.logger.error(`Werk fast tick failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  /** Renew leadership and run lifecycle once per second. */
  @Cron(CronExpression.EVERY_SECOND)
  async lifecycle(): Promise<void> {
    if (this.shuttingDown || this.lifecycleRunning) return;
    this.lifecycleRunning = true;
    try {
      if (!(await this.renewLeadership())) return;
      await this.roundManager.lifecycle();
    } catch (err) {
      this.logger.error(`Werk lifecycle failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      this.lifecycleRunning = false;
    }
  }

  /** Keep or acquire the leader lock. Extends a held lock; re-acquires if lost. */
  private async renewLeadership(): Promise<boolean> {
    if (this.heldLock) {
      const extend = (this.heldLock as unknown as { extend?: (ttl: number) => Promise<Lock> }).extend;
      if (typeof extend === 'function') {
        try {
          this.heldLock = await extend.call(this.heldLock, WERK_LEADER_LOCK_TTL_MS);
          this.leaderUntil = Date.now() + WERK_LEADER_LOCK_TTL_MS - 500;
          return true;
        } catch {
          this.heldLock = null; // lost the lock — fall through to re-acquire
        }
      } else {
        // In-memory mock lock (Redis not ready): release + re-acquire is safe in
        // the single-process case that path represents.
        await this.lockService.releaseLock(this.heldLock).catch(() => undefined);
        this.heldLock = null;
      }
    }
    const lock = await this.lockService.acquireLock(WERK_LEADER_LOCK_KEY, WERK_LEADER_LOCK_TTL_MS);
    if (!lock) return false;
    this.heldLock = lock;
    this.leaderUntil = Date.now() + WERK_LEADER_LOCK_TTL_MS - 500;
    return true;
  }
}
