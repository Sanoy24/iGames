import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DevController } from './dev.controller';

@Module({
  imports: [AuthModule],
  controllers: [DevController]
})
export class DevModule {}
