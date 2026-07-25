import { Controller, Param, Post, Req, Res } from '@nestjs/common';
import { TelegramBotService } from './telegram-bot.service';
import { Request, Response } from 'express';

@Controller('telegram')
export class TelegramController {
  constructor(private readonly telegramBotService: TelegramBotService) {}

  /** The main bot's webhook — unchanged path, so an already-configured Telegram webhook keeps working. */
  @Post('webhook')
  async handleWebhook(@Req() req: Request, @Res() res: Response) {
    return this.telegramBotService.handleWebhookRequest('main', req, res);
  }

  /** An add-on bot's webhook (e.g. `/telegram/webhook/bingo`) — routed by name. */
  @Post('webhook/:bot')
  async handleWebhookForBot(@Param('bot') bot: string, @Req() req: Request, @Res() res: Response) {
    return this.telegramBotService.handleWebhookRequest(bot, req, res);
  }
}
