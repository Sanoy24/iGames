import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { KenoModule } from '../keno/keno.module';
import { WalletModule } from '../wallet/wallet.module';
import { DevController } from './dev.controller';

@Module({
  imports: [AuthModule, KenoModule, WalletModule],
  controllers: [DevController]
})
export class DevModule {}
