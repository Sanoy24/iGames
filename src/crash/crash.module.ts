import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WalletModule } from '../wallet/wallet.module';
import { RngModule } from '../rng/rng.module';
import { CrashConfig } from './entities/crash-config.entity';
import { CrashRound } from './entities/crash-round.entity';
import { CrashBet } from './entities/crash-bet.entity';
import { CrashService } from './crash.service';
import { CrashController } from './crash.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([CrashConfig, CrashRound, CrashBet]),
    WalletModule,
    RngModule,
  ],
  controllers: [CrashController],
  providers: [CrashService],
  exports: [CrashService],
})
export class CrashModule {}
