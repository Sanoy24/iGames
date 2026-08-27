import { Controller, Post, Req, Res } from '@nestjs/common';
import { TelegramBotService } from './telegram-bot.service';
import { AgentBotService } from './agent-bot.service';
import { AdminNotificationBotService } from './admin-notification-bot.service';
import { Request, Response } from 'express';

@Controller('telegram')
export class TelegramController {
  constructor(
    private readonly telegramBotService: TelegramBotService,
    private readonly agentBotService: AgentBotService,
    private readonly adminNotificationBotService: AdminNotificationBotService,
  ) {}

  @Post('webhook')
  async handleWebhook(@Req() req: Request, @Res() res: Response) {
    return this.telegramBotService.handleWebhookRequest(req, res);
  }

  /** Separate agent bot's webhook (only used if TELEGRAM_AGENT_BOT_WEBHOOK_URL is set). */
  @Post('webhook/agent')
  async handleAgentWebhook(@Req() req: Request, @Res() res: Response) {
    return this.agentBotService.handleWebhookRequest(req, res);
  }

  /** Admin notification bot's webhook (only used if TELEGRAM_ADMIN_BOT_WEBHOOK_URL is set). */
  @Post('webhook/admin')
  async handleAdminWebhook(@Req() req: Request, @Res() res: Response) {
    return this.adminNotificationBotService.handleWebhookRequest(req, res);
  }
}
