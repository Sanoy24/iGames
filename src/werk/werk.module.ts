import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { GamesModule } from '../games/games.module';
import { RngModule } from '../rng/rng.module';
import { WalletModule } from '../wallet/wallet.module';
import { GameEventsModule } from '../events/game-events.module';
import { WerkConfig } from './entities/werk-config.entity';
import { WerkRound } from './entities/werk-round.entity';
import { WerkParticipant } from './entities/werk-participant.entity';
import { WerkBot } from './entities/werk-bot.entity';
import { WerkService } from './werk.service';
import { WerkRoundManager } from './round/werk-round-manager.service';
import { WerkController } from './werk.controller';
import { WerkAdminController } from './werk-admin.controller';

@Module({
  imports: [
    JwtModule.register({}),
    TypeOrmModule.forFeature([WerkConfig, WerkRound, WerkParticipant, WerkBot]),
    GamesModule,
    RngModule,
    WalletModule,
    // Provides the GameEventsGateway (for round broadcasts) and re-exports the
    // User repository (to resolve player display names).
    GameEventsModule,
  ],
  controllers: [WerkController, WerkAdminController],
  providers: [WerkService, WerkRoundManager, JwtAuthGuard, RolesGuard],
  exports: [WerkService, WerkRoundManager],
})
export class WerkModule {}
