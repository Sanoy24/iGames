import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BotsService } from '../bots/bots.service';
import { KenoService } from '../keno/keno.service';
import { GameEventsGateway } from '../events/game-events.gateway';

@Injectable()
export class KenoScheduler {
  private readonly logger = new Logger(KenoScheduler.name);
  private isRunning = false;

  constructor(
    private readonly kenoService: KenoService,
    private readonly gameEventsGateway: GameEventsGateway,
    private readonly botsService: BotsService
  ) {}

  /**
   * Runs every minute. Finds the oldest open draw whose scheduledAt is in the
   * past and executes it. The in-process lock (isRunning) prevents overlapping
   * runs within the same instance; the draw status transition to "locked" acts
   * as the database-level guard against duplicate execution across instances.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async executeScheduledDraws(): Promise<void> {
    if (this.isRunning) {
      return;
    }
    this.isRunning = true;

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
        configVersion: draw.configVersion
      });

      const result = await this.kenoService.executeDraw(draw.id);

      this.logger.log(`Keno draw ${result.id} settled`);
      this.gameEventsGateway.emitKenoDrawCompleted(result);
    } catch (error) {
      this.logger.error('Keno scheduler error', error instanceof Error ? error.stack : error);
    } finally {
      this.isRunning = false;
    }
  }
}
