import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { KenoService } from '../keno/keno.service';
import { BingoService } from '../bingo/bingo.service';
import { RedisLockService } from '../redis/redis-lock.service';

const REAPER_LOCK_KEY = 'igames:reaper:lock';
const REAPER_LOCK_TTL_MS = 55_000;

@Injectable()
export class ReaperScheduler {
  private readonly logger = new Logger(ReaperScheduler.name);

  constructor(
    private readonly kenoService: KenoService,
    private readonly bingoService: BingoService,
    private readonly lockService: RedisLockService
  ) {}

  /**
   * Runs every 10 minutes to scan for draws or rooms that have crashed or frozen
   * in "locked" or "open" states far past their scheduled execution time.
   * Cancels them to cleanly refund all players.
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async reapStuckGames(): Promise<void> {
    const lock = await this.lockService.acquireLock(REAPER_LOCK_KEY, REAPER_LOCK_TTL_MS);
    if (!lock) return;

    try {
      this.logger.debug('Scanning for stuck Keno draws and Bingo rooms...');

      // Reap Keno
      const stuckDraws = await this.kenoService.findStuckDraws(10); // 10 minutes threshold
      for (const drawId of stuckDraws) {
        this.logger.warn(`Reaping stuck Keno draw ${drawId}...`);
        try {
          await this.kenoService.cancelDraw(drawId);
          this.logger.log(`Successfully cancelled stuck Keno draw ${drawId}`);
        } catch (error) {
          this.logger.error(`Failed to reap Keno draw ${drawId}`, error instanceof Error ? error.stack : error);
        }
      }

      // Reap Bingo
      const stuckRooms = await this.bingoService.findStuckRooms(10);
      for (const roomId of stuckRooms) {
        this.logger.warn(`Reaping stuck Bingo room ${roomId}...`);
        try {
          await this.bingoService.cancelRoom(roomId);
          this.logger.log(`Successfully cancelled stuck Bingo room ${roomId}`);
        } catch (error) {
          this.logger.error(`Failed to reap Bingo room ${roomId}`, error instanceof Error ? error.stack : error);
        }
      }
    } catch (error) {
      this.logger.error('Reaper scheduler error', error instanceof Error ? error.stack : error);
    } finally {
      await this.lockService.releaseLock(lock);
    }
  }
}
