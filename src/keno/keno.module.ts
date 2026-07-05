import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { GameEventsModule } from '../events/game-events.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RngModule } from '../rng/rng.module';
import { WalletModule } from '../wallet/wallet.module';
import { KenoAdminController } from './keno-admin.controller';
import { KenoController } from './keno.controller';
import { KenoRulesService } from './keno-rules.service';
import { KenoService } from './keno.service';
import { KenoConfig } from './entities/keno-config.entity';
import { KenoDraw } from './entities/keno-draw.entity';
import { KenoTicket } from './entities/keno-ticket.entity';

@Module({
  imports: [
    JwtModule.register({}),
    RngModule,
    WalletModule,
    GameEventsModule,
    NotificationsModule,
    TypeOrmModule.forFeature([KenoConfig, KenoDraw, KenoTicket])
  ],
  controllers: [KenoController, KenoAdminController],
  providers: [KenoService, KenoRulesService, JwtAuthGuard, RolesGuard],
  exports: [KenoService]
})
export class KenoModule {}
