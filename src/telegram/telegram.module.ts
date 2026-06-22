import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { TelegramBotService } from './telegram-bot.service';
import { TelegramMiniAppAuthService } from './telegram-mini-app-auth.service';
import { TelegramController } from './telegram.controller';

@Module({
  imports: [UsersModule],
  controllers: [TelegramController],
  providers: [TelegramMiniAppAuthService, TelegramBotService],
  exports: [TelegramMiniAppAuthService]
})
export class TelegramModule {}
