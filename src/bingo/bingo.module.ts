import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { GameEventsModule } from '../events/game-events.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RngModule } from '../rng/rng.module';
import { GamesModule } from '../games/games.module';
import { WalletModule } from '../wallet/wallet.module';
import { BingoAdminController } from './bingo-admin.controller';
import { BingoController } from './bingo.controller';
import { BingoRulesService } from './bingo-rules.service';
import { BingoService } from './bingo.service';
import { BingoCard } from './entities/bingo-card.entity';
import { BingoConfig } from './entities/bingo-config.entity';
import { BingoCustomRoomSlot } from './entities/bingo-custom-room-slot.entity';
import { CommissionSettlementError } from './entities/commission-settlement-error.entity';
import { BingoPattern } from './entities/bingo-pattern.entity';
import { BingoRoom } from './entities/bingo-room.entity';
import { BingoTicket } from './entities/bingo-ticket.entity';
import { BotName } from '../bots/entities/bot-name.entity';

@Module({
  imports: [
    JwtModule.register({}),
    RngModule,
    GamesModule,
    WalletModule,
    GameEventsModule,
    NotificationsModule,
    TypeOrmModule.forFeature([BingoRoom, BingoTicket, BingoCard, BingoConfig, BingoCustomRoomSlot, CommissionSettlementError, BingoPattern, BotName])
  ],
  controllers: [BingoController, BingoAdminController],
  providers: [BingoService, BingoRulesService, JwtAuthGuard, OptionalJwtAuthGuard, RolesGuard],
  exports: [BingoService]
})
export class BingoModule {}
