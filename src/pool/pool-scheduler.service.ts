import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PoolMatchService } from './pool-match.service';

/**
 * Enforces the shot clock: any active match whose `turnDeadline` has passed is
 * handled as a timeout (foul → ball in hand, or forfeit once the offender hits
 * `maxTimeoutFouls`). Restart-safe and retry-safe — `handleShotTimeout` guards on
 * `status = 'active'` and the offender's timeout count, so a duplicate tick can't
 * double-apply.
 */
@Injectable()
export class PoolSchedulerService {
  private readonly logger = new Logger(PoolSchedulerService.name);
  private running = false;

  constructor(private readonly matchService: PoolMatchService) {}

  @Interval('pool-shot-clock', 5000)
  async enforceShotClock(): Promise<void> {
    if (this.running) return; // avoid overlapping ticks
    this.running = true;
    try {
      const timedOut = await this.matchService.findTimedOutMatches();
      for (const m of timedOut) {
        await this.matchService
          .handleShotTimeout(m.id)
          .catch((e) => this.logger.warn(`Timeout handling failed for ${m.id}: ${e?.message ?? e}`));
      }
    } catch (e) {
      this.logger.warn(`Shot-clock tick failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      this.running = false;
    }
  }
}
