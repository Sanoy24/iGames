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
import { MpesaDeposit } from './entities/mpesa-deposit.entity';
import { TelebirrReceiptVerifierService } from './telebirr-receipt-verifier.service';
import { MpesaReceiptVerifierService } from './mpesa-receipt-verifier.service';
import { MpesaReceiptClientModule } from './mpesa-receipt-client.module';
import { TelebirrScreenshotOcrService } from './telebirr-screenshot.service';
import { PaymentsService } from './payments.service';

@Module({
  imports: [
    JwtModule.register({}),
    WalletModule,
    TypeOrmModule.forFeature([TelebirrDeposit, MpesaDeposit]),
    AdminModule,
    NotificationsModule,
    UsersModule,
    AgentsModule,
    MpesaReceiptClientModule
  ],
  controllers: [PaymentsController],
  providers: [PaymentsService, TelebirrReceiptVerifierService, MpesaReceiptVerifierService, TelebirrScreenshotOcrService, JwtAuthGuard]
})
export class PaymentsModule {}
