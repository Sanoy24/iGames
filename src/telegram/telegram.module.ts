import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { TelegramBotService } from './telegram-bot.service';
import { AgentBotService } from './agent-bot.service';
import { AdminNotificationBotService } from './admin-notification-bot.service';
import { TelegramMiniAppAuthService } from './telegram-mini-app-auth.service';
import { TelegramController } from './telegram.controller';

@Module({
  imports: [UsersModule],
  controllers: [TelegramController],
  providers: [TelegramMiniAppAuthService, TelegramBotService, AgentBotService, AdminNotificationBotService],
  exports: [TelegramMiniAppAuthService, TelegramBotService, AgentBotService, AdminNotificationBotService]
})
export class TelegramModule {}
