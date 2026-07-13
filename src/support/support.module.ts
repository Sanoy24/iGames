import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { NotificationsModule } from '../notifications/notifications.module';
import { WalletModule } from '../wallet/wallet.module';
import { Withdrawal } from '../wallet/entities/withdrawal.entity';
import { TelebirrDeposit } from '../payments/entities/telebirr-deposit.entity';
import { User } from '../users/entities/user.entity';
import { SupportTicket } from './entities/support-ticket.entity';
import { SupportMessage } from './entities/support-message.entity';
import { SupportService } from './support.service';
import { SupportGateway } from './support.gateway';
import { SupportController } from './support.controller';
import { SupportAgentController } from './support-agent.controller';

@Module({
  imports: [
    JwtModule.register({}),
    TypeOrmModule.forFeature([SupportTicket, SupportMessage, Withdrawal, TelebirrDeposit, User]),
    WalletModule,
    NotificationsModule,
  ],
  controllers: [SupportController, SupportAgentController],
  providers: [SupportService, SupportGateway, JwtAuthGuard, RolesGuard],
  exports: [SupportService],
})
export class SupportModule {}
