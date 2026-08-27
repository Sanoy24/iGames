import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
import { SystemConfig } from './entities/system-config.entity';
import { PlatformStats } from './entities/platform-stats.entity';
import { AdminAuditLog } from './entities/admin-audit-log.entity';
import { ConfigChangeLog } from './entities/config-change-log.entity';
import { WithdrawalFeeRange } from '../wallet/entities/withdrawal-fee-range.entity';
import { AgentsModule } from '../agents/agents.module';
import { LocationsModule } from '../locations/locations.module';
import { UsersModule } from '../users/users.module';
import { WalletModule } from '../wallet/wallet.module';
import { GameEventsModule } from '../events/game-events.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { TelegramModule } from '../telegram/telegram.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([SystemConfig, PlatformStats, AdminAuditLog, ConfigChangeLog, WithdrawalFeeRange]),
    JwtModule.register({}),
    UsersModule,
    WalletModule,
    AgentsModule,
    LocationsModule,
    GameEventsModule,
    NotificationsModule,
    TelegramModule,
  ],
  controllers: [AdminController],
  providers: [AdminService],
  exports: [AdminService, TypeOrmModule],
})
export class AdminModule {}
