import { Module } from '@nestjs/common';
import { TelegramBotService } from './telegram-bot.service';
import { TelegramMiniAppAuthService } from './telegram-mini-app-auth.service';

@Module({
  providers: [TelegramMiniAppAuthService, TelegramBotService],
  exports: [TelegramMiniAppAuthService]
})
export class TelegramModule {}
