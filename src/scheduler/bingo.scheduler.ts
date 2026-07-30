import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BingoService } from '../bingo/bingo.service';
import { BotsService } from '../bots/bots.service';
import { GamesService } from '../games/games.service';
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
    private readonly gamesService: GamesService,
  ) {}

  /**
   * On startup, ensure there is at least one open Bingo room if auto-bingo is enabled.
   */
  async onApplicationBootstrap(): Promise<void> {
    try {
      // Relax scheduledStartAt to NULLable on legacy DBs so rooms can idle.
      await this.bingoService.ensureRoomSchema();
      if (await this.gamesService.isPlayable('bingo')) {
        if (await this.bingoService.isAgentRoomsEnabled()) {
          await this.bingoService.ensureAgentRooms();
        } else {
          await this.bingoService.autoCreateNextRoom();
        }
      }
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
      // When paused by admin (maintenance/hidden), keep drawing for running rooms
      // so in-flight games finish, but don't start or create any new rooms.
      const bingoPlayable = await this.gamesService.isPlayable('bingo');
      // Per-agent room mode (Approach B) — many rooms (one per agent + house) run
      // concurrently; the single-room reconcile/create paths are bypassed.
      const agentRooms = await this.bingoService.isAgentRoomsEnabled();

      // Single shared-room mode: collapse to one well-formed active room. This
      // cancels stale/duplicate rooms before they can draw ("two games at once").
      // Skipped in per-agent mode, where concurrent rooms are the whole point.
      if (!agentRooms) {
        try {
          await this.bingoService.reconcileActiveRooms(cfg);
        } catch (err) {
          this.logger.error('Bingo reconcile failed', err instanceof Error ? err.stack : err);
        }
      }

      const intervalSeconds = Math.max(1, cfg.drawIntervalSeconds ?? 2);
      const intervalMs = intervalSeconds * 1000;
      const dueRoomIds = await this.bingoService.findRunningRoomIdsDue(intervalSeconds);

      // Draw+emit for due rooms concurrently rather than one-at-a-time: each
      // room draws under its own row-level transaction lock, so they don't
      // contend with each other, but sequential awaiting here was letting one
      // room's DB/RNG-audit latency delay the emit for every other due room in
      // the same tick — a direct source of the uneven call cadence players saw.
      await Promise.all(dueRoomIds.map(async (roomId) => {
        if (this.shuttingDown) return;
        try {
          const updated = await this.bingoService.drawNextNumber(roomId);
          this.gameEventsGateway.emitBingoNumberDrawn(updated, intervalMs);

          if (updated.status === 'completed') {
            this.logger.log(`Bingo room ${updated.id} completed`);
            this.gameEventsGateway.emitBingoRoomCompleted(updated);
            // Per-agent mode: pay the room owner their commission (no-op otherwise).
            await this.bingoService.settleAgentRoomCommission(updated.id).catch((err) =>
              this.logger.error('Agent room commission failed', err instanceof Error ? err.stack : err),
            );
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
            // Persist in-app win notifications (survive leaving the game screen)
            void this.bingoService.notifyRoomWinners(updated.id).catch(() => {});
          }
        } catch (error) {
          this.logger.error(
            `Error drawing next number for room ${roomId}`,
            error instanceof Error ? error.stack : error
          );
        }
      }));

      // Auto-start rooms whose scheduledStartAt has passed (skipped while paused).
      // Per-agent mode starts one game per owner; shared mode starts one globally.
      const roomsToStart = bingoPlayable
        ? agentRooms
          ? await this.bingoService.findAgentRoomsToStart()
          : await this.bingoService.findRoomsToStart()
        : [];
      for (const room of roomsToStart) {
        if (this.shuttingDown) break;
        try {
          // Have bots buy last-minute tickets before the first draw (idempotent)
          await this.botsService.buyTicketsForBingoRoom(room.id);
          this.logger.log(`Auto-starting Bingo room ${room.id}`);
          const updated = await this.bingoService.drawNextNumber(room.id);
          this.gameEventsGateway.emitBingoRoomUpdated(updated);
          this.gameEventsGateway.emitBingoNumberDrawn(updated, intervalMs);
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
      if (!this.shuttingDown && bingoPlayable) {
        try {
          if (agentRooms) {
            // One idle room per agent + house; created idle (no pre-buy) so each
            // only starts once a real player buys into it.
            await this.bingoService.ensureAgentRooms(cfg);
          } else {
            const newRoom = await this.bingoService.autoCreateNextRoom();
            if (newRoom) {
              this.gameEventsGateway.emitBingoRoomUpdated(newRoom);
              this.logger.log(`Auto-created next Bingo room: ${newRoom.id}`);
              // No bot pre-buy here: the room must stay IDLE (no countdown, no draws)
              // until a real player buys the first ticket. Bots fill in last-minute
              // in the auto-start path once the countdown a purchase started expires.
            }
          }
        } catch (error) {
          this.logger.error(
            'Error ensuring next Bingo room(s)',
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
