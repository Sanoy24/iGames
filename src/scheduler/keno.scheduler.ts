import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { BotsService } from "../bots/bots.service";
import { KenoService } from "../keno/keno.service";
import { GameEventsGateway } from "../events/game-events.gateway";
import { RedisLockService } from "../redis/redis-lock.service";

const DRAW_LOCK_KEY = "igames:keno:draw-lock";
const DRAW_LOCK_TTL_MS = 55_000; // 55 seconds — expires before next CRON minute fires

@Injectable()
export class KenoScheduler {
    private readonly logger = new Logger(KenoScheduler.name);

    constructor(
        private readonly kenoService: KenoService,
        private readonly gameEventsGateway: GameEventsGateway,
        private readonly botsService: BotsService,
        private readonly lockService: RedisLockService,
    ) {}

    /**
     * Runs every minute. Uses a Redis distributed lock so that only ONE
     * backend instance executes a draw even when running behind a load balancer.
     * The draw status transition to "locked" acts as a second DB-level guard.
     */
    @Cron(CronExpression.EVERY_MINUTE)
    async executeScheduledDraws(): Promise<void> {
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
