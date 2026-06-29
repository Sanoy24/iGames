import { Module } from '@nestjs/common';
import { BingoModule } from '../bingo/bingo.module';
import { BotsModule } from '../bots/bots.module';
import { CrashModule } from '../crash/crash.module';
import { GameEventsModule } from '../events/game-events.module';
import { KenoModule } from '../keno/keno.module';
import { TelegramModule } from '../telegram/telegram.module';
import { BingoScheduler } from './bingo.scheduler';
import { CrashScheduler } from './crash.scheduler';
import { KenoScheduler } from './keno.scheduler';
import { ReaperScheduler } from './reaper.scheduler';
import { ReconciliationScheduler } from './reconciliation.scheduler';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [KenoModule, BingoModule, CrashModule, GameEventsModule, BotsModule, UsersModule, TelegramModule],
  providers: [KenoScheduler, BingoScheduler, CrashScheduler, ReaperScheduler, ReconciliationScheduler]
})
export class SchedulerModule {}
