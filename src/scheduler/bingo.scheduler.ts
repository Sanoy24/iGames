import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BingoService } from '../bingo/bingo.service';
import { BotsService } from '../bots/bots.service';
import { GameEventsGateway } from '../events/game-events.gateway';
import { RedisLockService } from '../redis/redis-lock.service';
import { TelegramBotService } from '../telegram/telegram-bot.service';

const BINGO_DRAW_LOCK_KEY = 'igames:bingo:draw-lock';
const BINGO_DRAW_LOCK_TTL_MS = 120_000;

@Injectable()
export class BingoScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(BingoScheduler.name);
  private isRunning = false;
  private shuttingDown = false;

  constructor(
    private readonly bingoService: BingoService,
    private readonly botsService: BotsService,
    private readonly gameEventsGateway: GameEventsGateway,
    private readonly lockService: RedisLockService,
    private readonly telegramBotService: TelegramBotService,
  ) {}

  /**
   * On startup, ensure there is at least one open Bingo room if auto-bingo is enabled.
   */
  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.bingoService.autoCreateNextRoom();
    } catch (error) {
      this.logger.error(
        'Bootstrap: Failed to ensure initial Bingo room',
        error instanceof Error ? error.stack : error
      );
    }
  }

  onApplicationShutdown() {
    this.shuttingDown = true;
  }

  /**
   * Runs every second. Draws the next number only for running rooms whose last
   * draw is older than the configured drawIntervalSeconds, so draw cadence is
   * config-driven (default ~1 ball every couple of seconds) instead of a fixed
   * slow 5s. The room status and drawnNumbers array act as the database-level
   * guard against duplicate draws across instances.
   *
   * After each completed room, auto-creates the next room using config defaults.
   */
  @Cron(CronExpression.EVERY_SECOND)
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
      const cfg = await this.bingoService.getBingoConfig();
      const intervalSeconds = Math.max(1, cfg.drawIntervalSeconds ?? 2);
      const dueRoomIds = await this.bingoService.findRunningRoomIdsDue(intervalSeconds);

      for (const roomId of dueRoomIds) {
        if (this.shuttingDown) break;
        try {
          const updated = await this.bingoService.drawNextNumber(roomId);
          this.gameEventsGateway.emitBingoNumberDrawn(updated);

          if (updated.status === 'completed') {
            this.logger.log(`Bingo room ${updated.id} completed`);
            this.gameEventsGateway.emitBingoRoomCompleted(updated);
            try {
              await this.botsService.handleBingoBotWinInterval(updated.id, cfg.globalBingoBotWinInterval ?? 0);
            } catch (err) {
              this.logger.error('Bot win interval check failed', err instanceof Error ? err.stack : err);
            }
            // Fire-and-forget Telegram win notifications
            this.bingoService.getRoomWinners(updated.id).then((winners) => {
              for (const w of winners) {
                this.telegramBotService.notifyUserWin(w.userId, w.payoutMinor, 'Bingo').catch(() => {});
              }
            }).catch(() => {});
          }
        } catch (error) {
          this.logger.error(
            `Error drawing next number for room ${roomId}`,
            error instanceof Error ? error.stack : error
          );
        }
      }

      // Auto-start rooms whose scheduledStartAt has passed
      const roomsToStart = await this.bingoService.findRoomsToStart();
      for (const room of roomsToStart) {
        if (this.shuttingDown) break;
        try {
          // Have bots buy last-minute tickets before the first draw (idempotent)
          await this.botsService.buyTicketsForBingoRoom(room.id);
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

      // Ensure exactly one upcoming room exists. autoCreateNextRoom self-guards
      // (no-op while a game is open or running), so this both opens the next
      // room after a completion and recovers if no room exists at all. Running
      // it only here — inside the Redis lock + isRunning guard — makes room
      // creation single-writer, which prevents the duplicate/concurrent rooms
      // that arose when the client-polled getCurrentRoom created rooms.
      if (!this.shuttingDown) {
        try {
          const newRoom = await this.bingoService.autoCreateNextRoom();
          if (newRoom) {
            this.gameEventsGateway.emitBingoRoomUpdated(newRoom);
            this.logger.log(`Auto-created next Bingo room: ${newRoom.id}`);
            await this.botsService.buyTicketsForBingoRoom(newRoom.id);
          }
        } catch (error) {
          this.logger.error(
            'Error auto-creating next Bingo room',
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
