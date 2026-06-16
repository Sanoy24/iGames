import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
import { SystemConfig } from './entities/system-config.entity';
import { PlatformStats } from './entities/platform-stats.entity';
import { AdminAuditLog } from './entities/admin-audit-log.entity';
import { AgentsModule } from '../agents/agents.module';
import { UsersModule } from '../users/users.module';
import { WalletModule } from '../wallet/wallet.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([SystemConfig, PlatformStats, AdminAuditLog]),
    JwtModule.register({}),
    UsersModule,
    WalletModule,
    AgentsModule,
  ],
  controllers: [AdminController],
  providers: [AdminService],
  exports: [AdminService, TypeOrmModule],
})
export class AdminModule {}
