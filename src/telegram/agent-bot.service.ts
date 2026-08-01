import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Bot, Context, InlineKeyboard, Keyboard, webhookCallback } from 'grammy';
import { UsersService } from '../users/users.service';
import { normalizeEthiopianPhone } from '../common/phone.util';
import { describeTelegramUpdate } from './telegram-update.util';

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
        { command: 'updatelocation', description: 'Update your shared location' },
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

  public async handleWebhookRequest(req: any, res: any) {
    if (!this.bot) {
      res.status(500).send('Agent bot not initialized');
      return;
    }
    const handler = webhookCallback(this.bot, 'express');
    try {
      await handler(req, res);
    } catch (err) {
      // grammY's bot.catch() only applies to long polling — it has no effect on
      // webhook updates (handleUpdate() rethrows instead of routing through it).
      // Without this, any handler exception bubbles up as a 500, which makes
      // Telegram redeliver the same update forever and pile up pending_update_count.
      // Always ack Telegram so the queue keeps moving; the real error is logged here.
      this.logger.error(
        `Unhandled error processing agent bot webhook update (${describeTelegramUpdate(req.body)}): ${err instanceof Error ? err.message : err}`,
        err instanceof Error ? err.stack : undefined,
      );
      if (!res.headersSent) res.status(200).send('OK');
    }
  }

  private contactRequestKeyboard(): Keyboard {
    return new Keyboard()
      .requestContact('📱 Share My Phone Number')
      .resized()
      .oneTime();
  }

  /**
   * Location is mandatory for agents, so unlike the player bot there is no
   * "pick from a list" escape hatch here — an agent's own coordinates are the
   * point. If a client can't send a pin, an admin can still assign their area
   * directly, and web credentials login remains available regardless.
   */
  private locationRequestKeyboard(): Keyboard {
    return new Keyboard()
      .requestLocation('📍 Share My Location')
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

      // Location is mandatory for agents: ask for it now and withhold the panel
      // button until it's shared. Falls straight through to the panel if this
      // agent already shared one on a previous link.
      let alreadyShared = false;
      try {
        alreadyShared = await this.usersService.hasSharedLocation(agent.id);
      } catch (err) {
        this.logger.error(`Failed to check shared location for agent ${agent.id}`, err instanceof Error ? err.stack : err);
      }

      if (!alreadyShared) {
        await ctx.reply(
          `Linked! Welcome, ${agent.displayName}.\n\n` +
          `One more step — share your location so we know which area you operate in:`,
          { reply_markup: this.locationRequestKeyboard() },
        );
        return;
      }

      await ctx.reply(
        `Linked! Welcome, ${agent.displayName}.`,
        { reply_markup: { remove_keyboard: true } as never },
      );
      await this.sendPanelButton(ctx, miniAppUrl);
    });

    // Mandatory first-time agent location step. This pin is now the live signal
    // UsersService.matchAgentFromCoords matches players against (see
    // /updatelocation below for refreshing it), but it still does NOT itself
    // grant area access — visibility for an agent is governed by
    // User.assignedAgentId equality, never by pin proximity.
    bot.on('message:location', async (ctx) => {
      const telegramUserId = ctx.from?.id;
      if (!telegramUserId) return;

      const { latitude, longitude } = ctx.message.location;

      const agentId = await this.resolveLinkedAgentId(telegramUserId);
      if (!agentId) {
        await ctx.reply('Please share your phone number first to link your agent account.', {
          reply_markup: this.contactRequestKeyboard(),
        });
        return;
      }

      try {
        await this.usersService.setAgentSharedLocation(agentId, latitude, longitude);
      } catch (err) {
        this.logger.error(`Failed to save shared location for agent ${agentId}`, err instanceof Error ? err.stack : err);
        await ctx.reply('Could not save your location — please try again.', {
          reply_markup: this.locationRequestKeyboard(),
        });
        return;
      }

      await ctx.reply('Location saved. Thank you!', {
        reply_markup: { remove_keyboard: true } as never,
      });
      await this.sendPanelButton(ctx, miniAppUrl);
    });

    // Re-entry point for the same location step above — an agent's pin is
    // otherwise never refreshed after first link, which would make GPS-based
    // player matching drift stale as agents move between areas or shifts.
    // message:location's unconditional overwrite handles the actual save.
    bot.command('updatelocation', async (ctx) => {
      const telegramUserId = ctx.from?.id;
      if (!telegramUserId) return;

      const agentId = await this.resolveLinkedAgentId(telegramUserId);
      if (!agentId) {
        await ctx.reply('Please share your phone number first to link your agent account:', {
          reply_markup: this.contactRequestKeyboard(),
        });
        return;
      }

      await ctx.reply('Share your current location to update it:', {
        reply_markup: this.locationRequestKeyboard(),
      });
    });

    bot.on('message:text', async (ctx) => {
      await ctx.reply('Send /start to link your agent account.');
    });
  }

  /** The linked agent's user id for this Telegram account, or null if unlinked. */
  private async resolveLinkedAgentId(telegramUserId: number): Promise<string | null> {
    try {
      const linked = await this.usersService.findAgentPhoneByTelegramId(String(telegramUserId));
      if (!linked) return null;
      const agent = await this.usersService.findAgentByPhone(linked.phoneNumber);
      return agent?.id ?? null;
    } catch (err) {
      this.logger.error(`Failed to resolve agent for Telegram user ${telegramUserId}`, err instanceof Error ? err.stack : err);
      return null;
    }
  }

  private async sendPanelButton(ctx: Context, miniAppUrl: string): Promise<void> {
    const keyboard = new InlineKeyboard().webApp('📊 Open Agent Panel', miniAppUrl);
    await ctx.reply('Tap below to open your Agent Panel and enter your password:', {
      reply_markup: keyboard,
    });
  }
}
