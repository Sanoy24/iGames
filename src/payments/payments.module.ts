import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { WalletModule } from '../wallet/wallet.module';
import { AdminModule } from '../admin/admin.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { UsersModule } from '../users/users.module';
import { AgentsModule } from '../agents/agents.module';
import { PaymentsController } from './payments.controller';
import { TelebirrDeposit } from './entities/telebirr-deposit.entity';
import { TelebirrReceiptVerifierService } from './telebirr-receipt-verifier.service';
import { PaymentsService } from './payments.service';

@Module({
  imports: [
    JwtModule.register({}),
    WalletModule,
    TypeOrmModule.forFeature([TelebirrDeposit]),
    AdminModule,
    NotificationsModule,
    UsersModule,
    AgentsModule
  ],
  controllers: [PaymentsController],
  providers: [PaymentsService, TelebirrReceiptVerifierService, JwtAuthGuard]
})
export class PaymentsModule {}
