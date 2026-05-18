import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GameEventsModule } from '../events/game-events.module';
import { LedgerModule } from '../ledger/ledger.module';
import { Wallet, WalletSchema } from './schemas/wallet.schema';
import { WagerLimit, WagerLimitSchema } from './schemas/wager-limit.schema';
import { WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';

@Module({
  imports: [
    JwtModule.register({}),
    LedgerModule,
    GameEventsModule,
    MongooseModule.forFeature([
      { name: Wallet.name, schema: WalletSchema },
      { name: WagerLimit.name, schema: WagerLimitSchema }
    ])
  ],
  controllers: [WalletController],
  providers: [WalletService, JwtAuthGuard],
  exports: [WalletService, MongooseModule]
})
export class WalletModule {}
