import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { KenoModule } from '../keno/keno.module';
import { DevController } from './dev.controller';

@Module({
  imports: [AuthModule, KenoModule],
  controllers: [DevController]
})
export class DevModule {}
