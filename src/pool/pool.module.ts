import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { GamesModule } from '../games/games.module';
import { RngModule } from '../rng/rng.module';
import { WalletModule } from '../wallet/wallet.module';
import { GameEventsModule } from '../events/game-events.module';
import { PoolConfig } from './entities/pool-config.entity';
import { PoolMatch } from './entities/pool-match.entity';
import { PoolShot } from './entities/pool-shot.entity';
import { PoolQueueEntry } from './entities/pool-queue-entry.entity';
import { PoolTournament } from './entities/pool-tournament.entity';
import { PoolTournamentPlayer } from './entities/pool-tournament-player.entity';
import { PoolService } from './pool.service';
import { PoolMatchService } from './pool-match.service';
import { PoolBotService } from './pool-bot.service';
import { PoolMatchmakingService } from './pool-matchmaking.service';
import { PoolTournamentService } from './pool-tournament.service';
import { PoolSchedulerService } from './pool-scheduler.service';
import { PoolController } from './pool.controller';
import { PoolMatchController } from './pool-match.controller';
import { PoolAdminController } from './pool-admin.controller';

@Module({
  imports: [
    JwtModule.register({}),
    TypeOrmModule.forFeature([
      PoolConfig,
      PoolMatch,
      PoolShot,
      PoolQueueEntry,
      PoolTournament,
      PoolTournamentPlayer,
    ]),
    GamesModule,
    RngModule,
    WalletModule,
    GameEventsModule,
  ],
  controllers: [PoolController, PoolMatchController, PoolAdminController],
  providers: [
    PoolService,
    PoolMatchService,
    PoolBotService,
    PoolMatchmakingService,
    PoolTournamentService,
    PoolSchedulerService,
    JwtAuthGuard,
    RolesGuard,
  ],
  exports: [PoolService, PoolMatchService, PoolTournamentService],
})
export class PoolModule {}
