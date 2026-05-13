import { Module } from '@nestjs/common';
import { TelegramMiniAppAuthService } from './telegram-mini-app-auth.service';

@Module({
  providers: [TelegramMiniAppAuthService],
  exports: [TelegramMiniAppAuthService]
})
export class TelegramModule {}
