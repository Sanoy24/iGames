import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GameEventsModule } from '../events/game-events.module';
import { LedgerModule } from '../ledger/ledger.module';
import { Wallet } from './entities/wallet.entity';
import { WagerLimit } from './entities/wager-limit.entity';
import { Withdrawal } from './entities/withdrawal.entity';
import { WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';

@Module({
  imports: [
    JwtModule.register({}),
    LedgerModule,
    GameEventsModule,
    TypeOrmModule.forFeature([Wallet, WagerLimit, Withdrawal])
  ],
  controllers: [WalletController],
  providers: [WalletService, JwtAuthGuard],
  exports: [WalletService, TypeOrmModule]
})
export class WalletModule {}
