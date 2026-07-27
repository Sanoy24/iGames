import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Bot, InlineKeyboard, Keyboard, webhookCallback } from 'grammy';
import { UsersService } from '../users/users.service';
import { normalizeEthiopianPhone } from '../common/phone.util';

/**
 * A separate, standalone Telegram bot for AGENTS only (e.g. @yaho_agent_bot) —
 * NOT part of TelegramBotService (the main player bot). Deliberately its own
 * small service with its own grammy Bot instance and own token: the command
 * set is fundamentally different (no location-capture, no welcome bonus
 * messaging, no game catalog), so branching the player bot's registerCommands
 * further would be riskier than keeping this fully independent. See the
 * reverted multi-bot-one-service attempt (git 2f775f1/d6f16d5) — that pattern
 * fit "same audience, different flavor," not this.
 *
 * Flow: an agent (already created by an admin, phone+password, NOT via
 * Telegram) opens this bot and shares their phone. The backend matches that
 * phone to an EXISTING agent account (never creates one) and links this
 * Telegram identity to it. The agent then opens the Mini App button, where the
 * frontend pre-fills/locks the phone field (via a dedicated resolve-phone
 * endpoint) and the agent must still type their password — POST
 * /auth/credentials, completely unchanged.
 */
@Injectable()
export class AgentBotService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(AgentBotService.name);
  private bot: Bot | undefined;
  private isPolling = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const token = this.configService.get<string>('TELEGRAM_AGENT_BOT_TOKEN');
    if (!token) {
      this.logger.log('TELEGRAM_AGENT_BOT_TOKEN is not set — agent bot will not start');
      return;
    }

    // The agent Mini App is its own standalone frontend deployment (own domain,
    // own Vite project) — NOT a query-param branch of the player TELEGRAM_MINIAPP_URL.
    const miniAppUrl = this.configService.get<string>('TELEGRAM_AGENT_MINIAPP_URL');
    if (!miniAppUrl) {
      this.logger.warn('TELEGRAM_AGENT_MINIAPP_URL is not set — agent bot will not start');
      return;
    }

    this.bot = new Bot(token);
    this.bot.catch((err) => {
      this.logger.error(`Error in agent bot middleware: ${err.message}`, err.stack);
    });

    this.registerCommands(this.bot, miniAppUrl);

    try {
      await this.bot.api.setMyCommands([
        { command: 'start', description: 'Link your agent account' },
      ]);

      const webhookUrl = this.configService.get<string>('TELEGRAM_AGENT_BOT_WEBHOOK_URL');
      if (webhookUrl) {
        this.logger.log(`Setting agent bot webhook to: ${webhookUrl}`);
        await this.bot.api.setWebhook(webhookUrl);
        this.logger.log('Agent bot webhook registered successfully');
      } else {
        this.logger.log('TELEGRAM_AGENT_BOT_WEBHOOK_URL is not set — starting agent bot with long polling');
        this.isPolling = true;
        this.bot.start({
          onStart: () => this.logger.log('Agent bot started (long polling)'),
        }).catch((err) => this.logger.error('Agent bot error', err));
      }
    } catch (error) {
      this.logger.error('Failed to start agent bot', error instanceof Error ? error.stack : error);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.bot && this.isPolling) {
      await this.bot.stop();
      this.logger.log('Agent bot polling stopped');
    }
  }

  public handleWebhookRequest(req: any, res: any) {
    if (!this.bot) {
      res.status(500).send('Agent bot not initialized');
      return;
    }
    const handler = webhookCallback(this.bot, 'express');
    return handler(req, res);
  }

  private contactRequestKeyboard(): Keyboard {
    return new Keyboard()
      .requestContact('📱 Share My Phone Number')
      .resized()
      .oneTime();
  }

  private registerCommands(bot: Bot, miniAppUrl: string): void {
    bot.command('start', async (ctx) => {
      await ctx.reply(
        'Welcome to the iGames Agent Panel.\n\n' +
        'Share your registered phone number to link your agent account:',
        { reply_markup: this.contactRequestKeyboard() },
      );
    });

    bot.on('message:contact', async (ctx) => {
      const contact = ctx.message.contact;
      const telegramUserId = ctx.from?.id;

      if (!contact.phone_number || (contact.user_id && contact.user_id !== telegramUserId)) {
        await ctx.reply('Please share your own phone number using the button provided.', {
          reply_markup: this.contactRequestKeyboard(),
        });
        return;
      }
      if (!telegramUserId) return;

      const normalized = normalizeEthiopianPhone(contact.phone_number);
      if (!normalized) {
        await ctx.reply('That does not look like a valid Ethiopian phone number.', {
          reply_markup: this.contactRequestKeyboard(),
        });
        return;
      }

      let agent;
      try {
        agent = await this.usersService.findAgentByPhone(normalized);
      } catch (err) {
        this.logger.error('Agent lookup failed', err instanceof Error ? err.stack : err);
        await ctx.reply('Something went wrong looking up your account. Please try again.');
        return;
      }

      if (!agent) {
        await ctx.reply(
          'No agent account was found for this number. Contact your admin if you believe this is a mistake.',
        );
        return;
      }

      if (agent.status === 'suspended' || agent.status === 'closed') {
        await ctx.reply('Your agent account is not active. Contact your admin.');
        return;
      }

      try {
        await this.usersService.linkTelegramIdentityToUser(
          agent.id,
          {
            telegramUserId: String(telegramUserId),
            username: ctx.from?.username,
            firstName: ctx.from?.first_name,
            lastName: ctx.from?.last_name,
            languageCode: ctx.from?.language_code,
          },
          'agent',
        );
      } catch (err) {
        this.logger.error(`Failed to link Telegram identity for agent ${agent.id}`, err instanceof Error ? err.stack : err);
        await ctx.reply(
          err instanceof Error && err.message.includes('already linked')
            ? 'This Telegram account is already linked to a different account.'
            : 'Something went wrong linking your account. Please try again.',
        );
        return;
      }

      const keyboard = new InlineKeyboard().webApp('📊 Open Agent Panel', miniAppUrl);
      await ctx.reply(
        `Linked! Welcome, ${agent.displayName}.\n\nTap below to open your Agent Panel and enter your password:`,
        { reply_markup: { remove_keyboard: true } as never },
      );
      await ctx.reply('Open Agent Panel:', { reply_markup: keyboard });
    });

    bot.on('message:text', async (ctx) => {
      await ctx.reply('Send /start to link your agent account.');
    });
  }
}
