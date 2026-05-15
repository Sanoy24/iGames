import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { GameEventsModule } from '../events/game-events.module';
import { RngModule } from '../rng/rng.module';
import { WalletModule } from '../wallet/wallet.module';
import { BingoAdminController } from './bingo-admin.controller';
import { BingoController } from './bingo.controller';
import { BingoRulesService } from './bingo-rules.service';
import { BingoService } from './bingo.service';
import { BingoRoom, BingoRoomSchema } from './schemas/bingo-room.schema';
import { BingoTicket, BingoTicketSchema } from './schemas/bingo-ticket.schema';

@Module({
  imports: [
    JwtModule.register({}),
    RngModule,
    WalletModule,
    GameEventsModule,
    MongooseModule.forFeature([
      { name: BingoRoom.name, schema: BingoRoomSchema },
      { name: BingoTicket.name, schema: BingoTicketSchema }
    ])
  ],
  controllers: [BingoController, BingoAdminController],
  providers: [BingoService, BingoRulesService, JwtAuthGuard, RolesGuard],
  exports: [BingoService]
})
export class BingoModule {}
