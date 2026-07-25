import { Controller, Post, Req, Res } from '@nestjs/common';
import { TelegramBotService } from './telegram-bot.service';
import { Request, Response } from 'express';

@Controller('telegram')
export class TelegramController {
  constructor(private readonly telegramBotService: TelegramBotService) {}

  @Post('webhook')
  async handleWebhook(@Req() req: Request, @Res() res: Response) {
    return this.telegramBotService.handleWebhookRequest(req, res);
  }
}
