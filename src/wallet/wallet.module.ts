import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GameEventsModule } from '../events/game-events.module';
import { LedgerModule } from '../ledger/ledger.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { TelegramModule } from '../telegram/telegram.module';
import { Wallet } from './entities/wallet.entity';
import { WagerLimit } from './entities/wager-limit.entity';
import { Withdrawal } from './entities/withdrawal.entity';
import { WithdrawalFeeRange } from './entities/withdrawal-fee-range.entity';
import { User } from '../users/entities/user.entity';
import { AgentActionLog } from '../agents/entities/agent-action-log.entity';
import { SystemConfig } from '../admin/entities/system-config.entity';
import { WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';

@Module({
  imports: [
    JwtModule.register({}),
    LedgerModule,
    GameEventsModule,
    NotificationsModule,
    TelegramModule,
    TypeOrmModule.forFeature([Wallet, WagerLimit, Withdrawal, User, AgentActionLog, SystemConfig, WithdrawalFeeRange])
  ],
  controllers: [WalletController],
  providers: [WalletService, JwtAuthGuard],
  exports: [WalletService, TypeOrmModule]
})
export class WalletModule {}
