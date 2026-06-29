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
   * Runs every 5 seconds. Finds all running rooms and draws the next number
   * for each. The room status and drawnNumbers array act as the database-level
   * guard against duplicate draws across instances.
   *
   * After each completed room, auto-creates the next room using config defaults.
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
      let anyCompleted = false;

      for (const room of runningRooms) {
        if (this.shuttingDown) break;
        try {
          const updated = await this.bingoService.drawNextNumber(room.id);
          this.gameEventsGateway.emitBingoNumberDrawn(updated);

          if (updated.status === 'completed') {
            this.logger.log(`Bingo room ${updated.id} completed`);
            this.gameEventsGateway.emitBingoRoomCompleted(updated);
            anyCompleted = true;
            try {
              const cfg = await this.bingoService.getBingoConfig();
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

      // After any room completes, auto-create the next one and have bots buy in
      if (anyCompleted && !this.shuttingDown) {
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
