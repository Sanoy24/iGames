import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WalletModule } from '../wallet/wallet.module';
import { AgentsController } from './agents.controller';
import { AgentsService } from './agents.service';
import { AgentShift } from './entities/agent-shift.entity';
import { UsersModule } from '../users/users.module';
import { SystemConfig } from '../admin/entities/system-config.entity';
import { TelebirrReceiptClientModule } from '../payments/telebirr-receipt-client.module';
import { MpesaReceiptClientModule } from '../payments/mpesa-receipt-client.module';
import { LocationsModule } from '../locations/locations.module';
import { WithdrawalProofVerifierService } from './withdrawal-proof-verifier.service';

@Module({
  imports: [
    JwtModule.register({}),
    TypeOrmModule.forFeature([AgentShift, SystemConfig]),
    WalletModule,
    UsersModule,
    TelebirrReceiptClientModule,
    MpesaReceiptClientModule,
    LocationsModule,
  ],
  controllers: [AgentsController],
  providers: [AgentsService, WithdrawalProofVerifierService],
  exports: [AgentsService, TypeOrmModule],
})
export class AgentsModule {}
