import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { GameEventsModule } from '../events/game-events.module';
import { RngModule } from '../rng/rng.module';
import { WalletModule } from '../wallet/wallet.module';
import { KenoAdminController } from './keno-admin.controller';
import { KenoController } from './keno.controller';
import { KenoRulesService } from './keno-rules.service';
import { KenoService } from './keno.service';
import { KenoConfig, KenoConfigSchema } from './schemas/keno-config.schema';
import { KenoDraw, KenoDrawSchema } from './schemas/keno-draw.schema';
import { KenoTicket, KenoTicketSchema } from './schemas/keno-ticket.schema';

@Module({
  imports: [
    JwtModule.register({}),
    RngModule,
    WalletModule,
    GameEventsModule,
    MongooseModule.forFeature([
      { name: KenoConfig.name, schema: KenoConfigSchema },
      { name: KenoDraw.name, schema: KenoDrawSchema },
      { name: KenoTicket.name, schema: KenoTicketSchema }
    ])
  ],
  controllers: [KenoController, KenoAdminController],
  providers: [KenoService, KenoRulesService, JwtAuthGuard, RolesGuard],
  exports: [KenoService]
})
export class KenoModule {}
