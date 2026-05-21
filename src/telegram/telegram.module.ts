import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { TelegramBotService } from './telegram-bot.service';
import { TelegramMiniAppAuthService } from './telegram-mini-app-auth.service';

@Module({
  imports: [UsersModule],
  providers: [TelegramMiniAppAuthService, TelegramBotService],
  exports: [TelegramMiniAppAuthService]
})
export class TelegramModule {}
