import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { AuthIdentity } from '../users/entities/auth-identity.entity';
import { AdminAuditLog } from '../admin/entities/admin-audit-log.entity';
import { AdminAuditInterceptor } from '../admin/admin-audit.interceptor';
import { TelegramModule } from '../telegram/telegram.module';
import { BroadcastController } from './broadcast.controller';
import { BroadcastService } from './broadcast.service';
import { BroadcastMessage } from './entities/broadcast-message.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([BroadcastMessage, AuthIdentity, AdminAuditLog]),
    JwtModule.register({}),
    TelegramModule,
  ],
  controllers: [BroadcastController],
  providers: [BroadcastService, AdminAuditInterceptor],
  exports: [BroadcastService],
})
export class BroadcastModule {}
