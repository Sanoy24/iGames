import {
    Injectable,
    Logger,
    OnApplicationBootstrap,
    OnApplicationShutdown,
} from '@nestjs/common';
import { BingoService } from '../bingo/bingo.service';
import { BotsService } from '../bots/bots.service';
import { GamesService } from '../games/games.service';
import { GameEventsGateway } from '../events/game-events.gateway';
import { RedisLockService } from '../redis/redis-lock.service';
import { TelegramBotService } from '../telegram/telegram-bot.service';

const BINGO_DRAW_LOCK_KEY = 'igames:bingo:draw-lock';
const BINGO_DRAW_LOCK_TTL_MS = 120_000;

// Standard `cron` (what @nestjs/schedule's @Cron runs on) only resolves to whole
// seconds, so a draw that becomes due at e.g. +2.1s doesn't fire until the next
// 1s boundary  up to ~1s of jitter on top of the configured drawIntervalSeconds,
// which read to players as calls landing "fast" then "slow". A self-rescheduling
// setTimeout loop instead ticks at sub-second resolution and reschedules only
// after each run finishes (not fixed-rate), so slow ticks can't pile up.
const SCHEDULER_TICK_MS = 250;

@Injectable()
export class BingoScheduler
    implements OnApplicationBootstrap, OnApplicationShutdown
{
    private readonly logger = new Logger(BingoScheduler.name);
    private isRunning = false;
    private shuttingDown = false;
    private tickTimer: NodeJS.Timeout | null = null;

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
                error instanceof Error ? error.stack : error,
            );
        }

        this.scheduleNextTick();
    }

    onApplicationShutdown() {
        this.shuttingDown = true;
        if (this.tickTimer) {
            clearTimeout(this.tickTimer);
            this.tickTimer = null;
        }
    }

    private scheduleNextTick(): void {
        if (this.shuttingDown) return;
        this.tickTimer = setTimeout(() => {
            this.drawNextNumbers()
                .catch((error) =>
                    this.logger.error(
                        'Bingo scheduler tick failed',
                        error instanceof Error ? error.stack : error,
                    ),
                )
                .finally(() => this.scheduleNextTick());
        }, SCHEDULER_TICK_MS);
    }

    /**
     * Ticks at SCHEDULER_TICK_MS resolution (self-rescheduled, not fixed-rate).
     * Draws the next number only for running rooms whose last draw is older than
     * the configured drawIntervalSeconds, so draw cadence is config-driven
     * (default ~1 ball every couple of seconds) instead of a fixed slow 5s. The
     * room status and drawnNumbers array act as the database-level guard against
     * duplicate draws across instances.
     *
     * After each completed room, auto-creates the next room using config defaults.
     */
    async drawNextNumbers(): Promise<void> {
        if (this.isRunning || this.shuttingDown) {
            return;
        }
        this.isRunning = true;
        const lock = await this.lockService.acquireLock(
            BINGO_DRAW_LOCK_KEY,
            BINGO_DRAW_LOCK_TTL_MS,
        );
        if (!lock) {
            this.isRunning = false;
            // Distinguish "Redis unreachable" (nothing anywhere is drawing
            // needs an operator) from normal cross-instance lock contention
            // (another instance already has it this tick  expected, not alert-worthy).
            if (this.lockService.getStatus() !== 'ready') {
                await this.bingoService
                    .logRedisLockUnavailable(this.lockService.getStatus())
                    .catch(() => undefined);
            }
            return;
        }

        try {
            const cfg = await this.bingoService.getBingoConfig();
            // When paused by admin (maintenance/hidden), keep drawing for running rooms
            // so in-flight games finish, but don't start or create any new rooms.
            const bingoPlayable = await this.gamesService.isPlayable('bingo');
            // Per-agent room mode (Approach B)  many rooms (one per agent + house) run
            // concurrently; the single-room reconcile/create paths are bypassed.
            const agentRooms = await this.bingoService.isAgentRoomsEnabled();

            // Single shared-room mode: collapse to one well-formed active room. This
            // cancels stale/duplicate rooms before they can draw ("two games at once").
            // Skipped in per-agent mode, where concurrent rooms are the whole point.
            if (!agentRooms) {
                try {
                    await this.bingoService.reconcileActiveRooms(cfg);
                } catch (err) {
                    this.logger.error(
                        'Bingo reconcile failed',
                        err instanceof Error ? err.stack : err,
                    );
                }
            }

            const intervalSeconds = Math.max(1, cfg.drawIntervalSeconds ?? 2);
            const intervalMs = intervalSeconds * 1000;
            const dueRoomIds =
                await this.bingoService.findRunningRoomIdsDue(intervalSeconds);

            // Draw+emit for due rooms concurrently rather than one-at-a-time: each
            // room draws under its own row-level transaction lock, so they don't
            // contend with each other, but sequential awaiting here was letting one
            // room's DB/RNG-audit latency delay the emit for every other due room in
            // the same tick  a direct source of the uneven call cadence players saw.
            await Promise.all(
                dueRoomIds.map(async (roomId) => {
                    if (this.shuttingDown) return;
                    try {
                        const updated =
                            await this.bingoService.drawNextNumber(roomId);
                        this.gameEventsGateway.emitBingoNumberDrawn(
                            updated,
                            intervalMs,
                        );

                        if (updated.status === 'completed') {
                            await this.handleRoomCompleted(updated, cfg);
                        }
                    } catch (error) {
                        this.logger.error(
                            `Error drawing next number for room ${roomId}`,
                            error instanceof Error ? error.stack : error,
                        );
                    }
                }),
            );

            // Progressively top up bot cartela purchases for rooms mid-countdown (or
            // just-expired but not yet picked up below), so the displayed player count
            // and pot climb through the buy window instead of jumping once at the end.
            if (!this.shuttingDown && bingoPlayable) {
                try {
                    const openRooms =
                        await this.bingoService.findOpenRoomsWithCountdown();
                    // While a Scheduled Bot Play window is active, also visit
                    // truly-idle rooms (no ticket sold yet) so bots can buy the
                    // very first cartela themselves instead of waiting on a real
                    // player who may never show up during this window. Same for
                    // any idle room already pinned to a Win Sequence 'bot' slot
                    // (see BingoRoom.winSequenceTarget)  it must be able to start
                    // and play out on bots alone to make good on that slot.
                    //
                    // A freshly-created room must sit untouched for at least
                    // resultDisplaySeconds: that's how long the client keeps
                    // showing the PREVIOUS room's win popup (see
                    // BingoService.getCurrentRoom) before switching over, so a
                    // bot buying in immediately  before any player could see
                    // the buying screen  made cartelas look pre-sold and the
                    // countdown look already-elapsed the moment it appeared
                    // (reported: bots visibly buy before the win window closes).
                    // Gating only the FIRST buy is enough: nothing else starts
                    // this room's countdown during a bot-play window, so it
                    // can't reach findOpenRoomsWithCountdown early either.
                    const activeBotPlaySchedule =
                        await this.bingoService.getActiveScheduledBotPlay();
                    if (activeBotPlaySchedule || cfg.winSequenceEnabled) {
                        const resultDisplayMs =
                            Math.max(1, cfg.resultDisplaySeconds ?? 10) * 1000;
                        const now = Date.now();
                        const idleRooms =
                            await this.bingoService.findIdleOpenRooms();
                        for (const room of idleRooms) {
                            if (
                                now - room.createdAt.getTime() <
                                resultDisplayMs
                            ) {
                                continue;
                            }
                            if (
                                activeBotPlaySchedule ||
                                room.winSequenceTarget === 'bot'
                            ) {
                                openRooms.push(room);
                            }
                        }
                    }
                    for (const room of openRooms) {
                        if (this.shuttingDown) break;
                        const changed =
                            await this.botsService.topUpBotsForOpenRoom(
                                room.id,
                            );
                        if (changed) {
                            const updated =
                                await this.bingoService.getRoomState({
                                    roomId: room.id,
                                });
                            this.gameEventsGateway.emitBingoRoomUpdated(
                                updated,
                            );
                        }
                    }
                } catch (error) {
                    this.logger.error(
                        'Bingo bot top-up failed',
                        error instanceof Error ? error.stack : error,
                    );
                }
            }

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
                    // Final top-off: the periodic top-up above already brings bots to ~100%
                    // of target by scheduledStartAt (fraction saturates at 1), this just
                    // catches any room whose countdown expired between ticks.
                    await this.botsService.topUpBotsForOpenRoom(room.id);
                    this.logger.log(`Auto-starting Bingo room ${room.id}`);
                    const updated = await this.bingoService.drawNextNumber(
                        room.id,
                    );
                    this.gameEventsGateway.emitBingoRoomUpdated(updated);
                    this.gameEventsGateway.emitBingoNumberDrawn(
                        updated,
                        intervalMs,
                    );
                    // A degenerate config (e.g. minDrawsBeforeWin/maxNumber of 1) could in
                    // theory complete a room on its very first draw  handle it here too so
                    // completion side effects (referral commission etc.) are never tied to
                    // which loop happened to trigger the finishing draw.
                    if (updated.status === 'completed') {
                        await this.handleRoomCompleted(updated, cfg);
                    }
                } catch (error) {
                    this.logger.error(
                        `Error auto-starting room ${room.id}`,
                        error instanceof Error ? error.stack : error,
                    );
                }
            }

            // Ensure exactly one upcoming room exists. autoCreateNextRoom self-guards
            // (no-op while a game is open or running), so this both opens the next
            // room after a completion and recovers if no room exists at all. Running
            // it only here  inside the Redis lock + isRunning guard  makes room
            // creation single-writer, which prevents the duplicate/concurrent rooms
            // that arose when the client-polled getCurrentRoom created rooms.
            if (!this.shuttingDown && bingoPlayable) {
                try {
                    if (agentRooms) {
                        // One idle room per agent + house; created idle (no pre-buy) so each
                        // only starts once a real player buys into it.
                        await this.bingoService.ensureAgentRooms(cfg);
                    } else {
                        const newRoom =
                            await this.bingoService.autoCreateNextRoom();
                        if (newRoom) {
                            this.gameEventsGateway.emitBingoRoomUpdated(
                                newRoom,
                            );
                            this.logger.log(
                                `Auto-created next Bingo room: ${newRoom.id}`,
                            );
                            // No bot pre-buy here: the room must stay IDLE (no countdown, no draws)
                            // until a real player buys the first ticket. Bots fill in last-minute
                            // in the auto-start path once the countdown a purchase started expires.
                        }
                    }
                } catch (error) {
                    this.logger.error(
                        'Error ensuring next Bingo room(s)',
                        error instanceof Error ? error.stack : error,
                    );
                }

                // Persistent admin-defined custom rooms (see BingoCustomRoomSlot)  run
                // independent of shared-vs-per-agent mode, so reconcile them either way.
                try {
                    await this.bingoService.ensureCustomRoomSlots(cfg);
                } catch (error) {
                    this.logger.error(
                        'Error ensuring custom Bingo room slots',
                        error instanceof Error ? error.stack : error,
                    );
                }
            }
        } catch (error) {
            this.logger.error(
                'Bingo scheduler error',
                error instanceof Error ? error.stack : error,
            );
        } finally {
            await this.lockService.releaseLock(lock);
            this.isRunning = false;
        }
    }

    /**
     * Shared "a room just completed" side effects  referral commission, bot
     * bonus-win rolls, and win notifications. Called from every scheduler path
     * that can be the one whose draw finishes a room, so completion handling
     * never depends on which loop happened to trigger the finishing draw.
     */
    private async handleRoomCompleted(
        updated: Awaited<ReturnType<BingoService['drawNextNumber']>>,
        cfg: Awaited<ReturnType<BingoService['getBingoConfig']>>,
    ): Promise<void> {
        this.logger.log(`Bingo room ${updated.id} completed`);
        this.gameEventsGateway.emitBingoRoomCompleted(updated);
        // Pay each referring agent their commission  a % of the service fee
        // (house edge cut) their own referred players generated in this room,
        // independent of who owns the room itself.
        await this.bingoService
            .settleReferralCommission(updated.id)
            .catch((err) =>
                this.logger.error(
                    'Referral commission failed',
                    err instanceof Error ? err.stack : err,
                ),
            );
        try {
            await this.botsService.handleBingoBotWinInterval(updated.id, {
                enabled: cfg.botBonusWinEnabled ?? true,
                mode: cfg.botBonusWinMode ?? 'interval',
                everyNRounds:
                    cfg.botBonusWinEveryNRounds ??
                    cfg.globalBingoBotWinInterval ??
                    0,
                chancePct: cfg.botBonusWinChancePct ?? 0,
            });
        } catch (err) {
            this.logger.error(
                'Bot win interval check failed',
                err instanceof Error ? err.stack : err,
            );
        }
        // Fire-and-forget Telegram win notifications
        this.bingoService
            .getRoomWinners(updated.id)
            .then((winners) => {
                for (const w of winners) {
                    this.telegramBotService
                        .notifyUserWin(w.userId, w.payoutMinor, 'Bingo')
                        .catch(() => {});
                }
            })
            .catch(() => {});
        // Persist in-app win notifications (survive leaving the game screen)
        void this.bingoService.notifyRoomWinners(updated.id).catch(() => {});
    }
}
