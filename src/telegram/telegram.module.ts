import { Module } from '@nestjs/common';
import { LocationsModule } from '../locations/locations.module';
import { UsersModule } from '../users/users.module';
import { TelegramBotService } from './telegram-bot.service';
import { TelegramMiniAppAuthService } from './telegram-mini-app-auth.service';
import { TelegramController } from './telegram.controller';

@Module({
  imports: [UsersModule, LocationsModule],
  controllers: [TelegramController],
  providers: [TelegramMiniAppAuthService, TelegramBotService],
  exports: [TelegramMiniAppAuthService, TelegramBotService]
})
export class TelegramModule {}
