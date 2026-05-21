import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BingoService } from '../bingo/bingo.service';
import { GameEventsGateway } from '../events/game-events.gateway';
import { RedisLockService } from '../redis/redis-lock.service';

const BINGO_DRAW_LOCK_KEY = 'igames:bingo:draw-lock';
const BINGO_DRAW_LOCK_TTL_MS = 120_000;

@Injectable()
export class BingoScheduler implements OnApplicationShutdown {
  private readonly logger = new Logger(BingoScheduler.name);
  private isRunning = false;
  private shuttingDown = false;

  constructor(
    private readonly bingoService: BingoService,
    private readonly gameEventsGateway: GameEventsGateway,
    private readonly lockService: RedisLockService
  ) {}

  onApplicationShutdown() {
    this.shuttingDown = true;
  }

  /**
   * Runs every 5 seconds. Finds all running rooms and draws the next number
   * for each. The room status and drawnNumbers array act as the database-level
   * guard against duplicate draws across instances.
   */
  @Cron(CronExpression.EVERY_5_SECONDS)
  async drawNextNumbers(): Promise<void> {
    if (this.isRunning || this.shuttingDown) {
      return;
    }
    this.isRunning = true;
    const lock = await this.lockService.acquireLock(BINGO_DRAW_LOCK_KEY, BINGO_DRAW_LOCK_TTL_MS);
    if (!lock) {
      this.isRunning = false;
      return;
    }

    try {
      const runningRooms = await this.bingoService.listRunningRooms();
      for (const room of runningRooms) {
        if (this.shuttingDown) break;
        try {
          const updated = await this.bingoService.drawNextNumber(room.id);
          this.gameEventsGateway.emitBingoNumberDrawn(updated);

          if (updated.status === 'completed') {
            this.logger.log(`Bingo room ${updated.id} completed`);
            this.gameEventsGateway.emitBingoRoomCompleted(updated);
          }
        } catch (error) {
          this.logger.error(
            `Error drawing next number for room ${room.id}`,
            error instanceof Error ? error.stack : error
          );
        }
      }

      // Auto-start rooms whose scheduledStartAt has passed
      const roomsToStart = await this.bingoService.findRoomsToStart();
      for (const room of roomsToStart) {
        if (this.shuttingDown) break;
        try {
          this.logger.log(`Auto-starting Bingo room ${room.id}`);
          const updated = await this.bingoService.drawNextNumber(room.id);
          this.gameEventsGateway.emitBingoRoomUpdated(updated);
          this.gameEventsGateway.emitBingoNumberDrawn(updated);
        } catch (error) {
          this.logger.error(
            `Error auto-starting room ${room.id}`,
            error instanceof Error ? error.stack : error
          );
        }
      }
    } catch (error) {
      this.logger.error('Bingo scheduler error', error instanceof Error ? error.stack : error);
    } finally {
      await this.lockService.releaseLock(lock);
      this.isRunning = false;
    }
  }
}
