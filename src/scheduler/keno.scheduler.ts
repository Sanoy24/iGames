import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { BotsService } from "../bots/bots.service";
import { KenoService } from "../keno/keno.service";
import { GameEventsGateway } from "../events/game-events.gateway";
import { RedisLockService } from "../redis/redis-lock.service";

const DRAW_LOCK_KEY = "igames:keno:draw-lock";
const DRAW_LOCK_TTL_MS = 300_000; // 5 minutes — prevents lock expiration during long settlements

@Injectable()
export class KenoScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
    private readonly logger = new Logger(KenoScheduler.name);
    private shuttingDown = false;

    constructor(
        private readonly kenoService: KenoService,
        private readonly gameEventsGateway: GameEventsGateway,
        private readonly botsService: BotsService,
        private readonly lockService: RedisLockService,
    ) {}

    async onApplicationBootstrap(): Promise<void> {
        try {
            const config = await this.kenoService.getActiveConfig().catch(() => null);
            const autoScheduleIntervalMs = config ? this.kenoService.getAutoScheduleIntervalMs(config) : 0;
            if (!config || autoScheduleIntervalMs <= 0) return;
            const activeDraw = await this.kenoService.getActiveDraw();
            if (!activeDraw) {
                const scheduledAt = new Date(Date.now() + autoScheduleIntervalMs);
                await this.kenoService.scheduleDraw(scheduledAt);
                this.logger.log(`Bootstrapped first Keno draw at ${scheduledAt.toISOString()}`);
            }
        } catch (error) {
            this.logger.warn(`Keno bootstrap skipped: ${error instanceof Error ? error.message : error}`);
        }
    }

    onApplicationShutdown() {
        this.shuttingDown = true;
    }

    /**
     * Runs every 5 seconds. Uses a Redis distributed lock so that only ONE
     * backend instance executes a draw even when running behind a load balancer.
     * The draw status transition to "locked" acts as a second DB-level guard.
     */
    @Cron('*/5 * * * * *')
    async executeScheduledDraws(): Promise<void> {
        if (this.shuttingDown) return;
        const config = await this.kenoService.getActiveConfig().catch(() => null);
        if (!config || this.kenoService.getAutoScheduleIntervalMs(config) <= 0) return;

        const lock = await this.lockService.acquireLock(
            DRAW_LOCK_KEY,
            DRAW_LOCK_TTL_MS,
        );
        if (!lock) {
            // Another instance already holds the lock — skip silently
            return;
        }

        try {
            const draw = await this.kenoService.findNextScheduledDraw();
            if (!draw) {
                return;
            }

            // Bots buy tickets for this draw before it executes
            await this.botsService.buyTicketsForDraw(draw.id);

            this.logger.log(`Executing scheduled Keno draw ${draw.id}`);
            this.gameEventsGateway.emitKenoDrawStarted({
                drawId: draw.id,
                scheduledAt: draw.scheduledAt,
                configVersion: draw.configVersion,
            });

            const result = await this.kenoService.executeDraw(draw.id);

            this.logger.log(`Keno draw ${result.id} settled`);
            this.gameEventsGateway.emitKenoDrawCompleted(result);
        } catch (error) {
            this.logger.error(
                "Keno scheduler error",
                error instanceof Error ? error.stack : error,
            );
        } finally {
            await this.lockService.releaseLock(lock);
        }
    }
}
