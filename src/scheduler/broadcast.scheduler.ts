import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BroadcastService } from '../broadcast/broadcast.service';
import { RedisLockService } from '../redis/redis-lock.service';

const BROADCAST_LOCK_KEY = 'igames:broadcast:lock';
const BROADCAST_LOCK_TTL_MS = 25_000;

/**
 * Every 30s, claims any scheduled broadcasts that are now due and dispatches
 * them. The Redis lock keeps only one instance scanning at a time; the actual
 * claim is an atomic status-guarded UPDATE inside the service, so delivery is
 * exactly-once even if the lock ever overlaps. Dispatch runs in the background,
 * so the lock is released immediately and a long fan-out never blocks the tick.
 */
@Injectable()
export class BroadcastScheduler {
  private readonly logger = new Logger(BroadcastScheduler.name);

  constructor(
    private readonly broadcastService: BroadcastService,
    private readonly lockService: RedisLockService,
  ) {}

  @Cron(CronExpression.EVERY_30_SECONDS)
  async dispatchDueBroadcasts(): Promise<void> {
    const lock = await this.lockService.acquireLock(BROADCAST_LOCK_KEY, BROADCAST_LOCK_TTL_MS);
    if (!lock) return;
    try {
      await this.broadcastService.runDueBroadcasts();
    } catch (error) {
      this.logger.error('Broadcast scheduler error', error instanceof Error ? error.stack : error);
    } finally {
      await this.lockService.releaseLock(lock);
    }
  }
}
