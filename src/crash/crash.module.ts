import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { WalletModule } from '../wallet/wallet.module';
import { RngModule } from '../rng/rng.module';
import { GamesModule } from '../games/games.module';
import { GameEventsModule } from '../events/game-events.module';
import { User } from '../users/entities/user.entity';
import { CrashConfig } from './entities/crash-config.entity';
import { CrashRound } from './entities/crash-round.entity';
import { CrashBet } from './entities/crash-bet.entity';
import { CrashService } from './crash.service';
import { CrashController } from './crash.controller';

@Module({
  imports: [
    JwtModule.register({}),
    TypeOrmModule.forFeature([CrashConfig, CrashRound, CrashBet, User]),
    WalletModule,
    RngModule,
    GamesModule,
    GameEventsModule,
  ],
  controllers: [CrashController],
  providers: [CrashService, JwtAuthGuard, RolesGuard],
  exports: [CrashService],
})
export class CrashModule {}
