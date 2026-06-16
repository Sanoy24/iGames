import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { WalletModule } from '../wallet/wallet.module';
import { AdminModule } from '../admin/admin.module';
import { UsersModule } from '../users/users.module';
import { PaymentsController } from './payments.controller';
import {
  TelebirrDeposit,
  TelebirrDepositSchema
} from './schemas/telebirr-deposit.schema';
import { TelebirrReceiptVerifierService } from './telebirr-receipt-verifier.service';
import { PaymentsService } from './payments.service';

@Module({
  imports: [
    JwtModule.register({}),
    WalletModule,
    MongooseModule.forFeature([
      { name: TelebirrDeposit.name, schema: TelebirrDepositSchema }
    ]),
    AdminModule,
    UsersModule
  ],
  controllers: [PaymentsController],
  providers: [PaymentsService, TelebirrReceiptVerifierService, JwtAuthGuard]
})
export class PaymentsModule {}
