import { Module } from '@nestjs/common';
import { BingoModule } from '../bingo/bingo.module';
import { BotsModule } from '../bots/bots.module';
import { GameEventsModule } from '../events/game-events.module';
import { KenoModule } from '../keno/keno.module';
import { BingoScheduler } from './bingo.scheduler';
import { KenoScheduler } from './keno.scheduler';

@Module({
  imports: [KenoModule, BingoModule, GameEventsModule, BotsModule],
  providers: [KenoScheduler, BingoScheduler]
})
export class SchedulerModule {}
