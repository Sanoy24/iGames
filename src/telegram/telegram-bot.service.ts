import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Bot, Context, InlineKeyboard, InputFile, Keyboard, webhookCallback } from 'grammy';
import { LocationsService } from '../locations/locations.service';
import { AuthIdentity } from '../users/entities/auth-identity.entity';
import { UsersService } from '../users/users.service';

/** Reply-keyboard button that opens the pick-from-list dropdown. */
const LOCATION_PICK_FROM_LIST_TEXT = '🗺 Choose my area from a list';

/** callback_data prefix for a location choice: `loc:<uuid>` or `loc:other`. */
const LOCATION_CALLBACK_PREFIX = 'loc:';

@Injectable()
export class TelegramBotService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramBotService.name);
  private bot: Bot | undefined;
  private isPolling = false;

  // In-memory cache: telegramUserId → phone (avoids repeated DB writes on /start)
  private readonly phoneCache = new Map<number, string>();

  constructor(
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
    private readonly locationsService: LocationsService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async onModuleInit(): Promise<void> {
    const token = this.configService.get<string>('TELEGRAM_BOT_TOKEN');
    if (!token) {
      this.logger.warn('TELEGRAM_BOT_TOKEN is not set — Telegram bot will not start');
      return;
    }

    const miniAppUrl = this.configService.get<string>('TELEGRAM_MINIAPP_URL');
    if (!miniAppUrl) {
      this.logger.warn('TELEGRAM_MINIAPP_URL is not set — Telegram bot will not start');
      return;
    }

    this.bot = new Bot(token);

    this.bot.catch((err) => {
      this.logger.error(`Error in Telegram bot middleware: ${err.message}`, err.stack);
    });

    this.registerCommands(miniAppUrl);

    try {
      await this.bot.api.setMyCommands([
        { command: 'start', description: 'Start playing iGames' },
        { command: 'play', description: 'Open the game' },
        { command: 'help', description: 'How to play' },
      ]);

      const isTelegramLink = miniAppUrl.includes('t.me/') || miniAppUrl.includes('telegram.me/');

      if (!isTelegramLink) {
        await this.bot.api.setChatMenuButton({
          menu_button: {
            type: 'web_app',
            text: '🎮 Play',
            web_app: { url: miniAppUrl },
          },
        });
      } else {
        this.logger.warn(
          `TELEGRAM_MINIAPP_URL (${miniAppUrl}) is a Telegram redirect link. ` +
          `Skipped setting the chat menu button of type 'web_app' as Telegram requires a direct HTTPS URL. ` +
          `Please configure a direct HTTPS URL (e.g. via ngrok) to enable the web_app menu button.`
        );
      }

      const webhookUrl = this.configService.get<string>('TELEGRAM_WEBHOOK_URL');
      if (webhookUrl) {
        this.logger.log(`Setting Telegram webhook to: ${webhookUrl}`);
        await this.bot.api.setWebhook(webhookUrl);
        this.logger.log('Telegram bot webhook registered successfully');
      } else {
        this.logger.log('TELEGRAM_WEBHOOK_URL is not set — starting Telegram bot with long polling');
        this.isPolling = true;
        this.bot.start({
          onStart: () => this.logger.log('Telegram bot started (long polling)'),
        }).catch((err) => this.logger.error('Telegram bot error', err));
      }
    } catch (error) {
      this.logger.error(
        'Failed to start Telegram bot',
        error instanceof Error ? error.stack : error,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.bot && this.isPolling) {
      await this.bot.stop();
      this.logger.log('Telegram bot polling stopped');
    }
  }

  async notifyUserWin(_userId: string, _amountMinor: number, _gameName: string): Promise<void> {
    // Win push notifications are disabled.
  }

  /** True once the bot has a token and is initialized (else broadcasts can't send). */
  public isReady(): boolean {
    return this.bot !== undefined;
  }

  /**
   * Fan a single message out to many chats (an admin broadcast). Sends serially
   * with a small delay to stay under Telegram's global ~30 msg/s limit, honours
   * 429 `retry_after`, and treats "blocked/deactivated" recipients as an
   * expected skip rather than an error. When a photo is attached it is uploaded
   * once and the resulting file_id is reused for every subsequent send, so an
   * 18k-user broadcast uploads the image a single time.
   */
  async sendBroadcastMessage(opts: {
    chatIds: string[];
    text?: string | null;
    imageAbsolutePath?: string | null;
    buttons?: Array<{ text: string; url: string }> | null;
    parseMode?: 'HTML' | 'MarkdownV2' | 'none' | null;
    throttleMs?: number;
    onProgress?: (sent: number, failed: number) => void;
    progressEvery?: number;
    isCancelled?: () => boolean;
  }): Promise<{ sent: number; failed: number; lastError?: string }> {
    if (!this.bot) throw new Error('Telegram bot is not initialized (TELEGRAM_BOT_TOKEN missing)');

    const api = this.bot.api;
    const parseMode = opts.parseMode && opts.parseMode !== 'none' ? opts.parseMode : undefined;
    const keyboard = this.buildInlineButtons(opts.buttons ?? undefined);
    const throttleMs = opts.throttleMs ?? 40; // ~25 msg/s
    const progressEvery = opts.progressEvery ?? 200;
    const hasImage = !!opts.imageAbsolutePath;
    const hasText = !!(opts.text && opts.text.trim().length > 0);

    let sent = 0;
    let failed = 0;
    let lastError: string | undefined;
    let photoRef: string | InputFile | undefined = opts.imageAbsolutePath
      ? new InputFile(opts.imageAbsolutePath)
      : undefined;

    for (const chatId of opts.chatIds) {
      if (opts.isCancelled?.()) break;
      try {
        if (hasImage) {
          const message = await api.sendPhoto(chatId, photoRef as string | InputFile, {
            caption: hasText ? (opts.text as string) : undefined,
            parse_mode: parseMode,
            reply_markup: keyboard,
          });
          // Reuse the uploaded file for every subsequent recipient.
          if (photoRef instanceof InputFile && message.photo?.length) {
            photoRef = message.photo[message.photo.length - 1].file_id;
          }
        } else if (hasText) {
          await api.sendMessage(chatId, opts.text as string, {
            parse_mode: parseMode,
            reply_markup: keyboard,
          });
        } else {
          break; // nothing to send
        }
        sent++;
      } catch (err) {
        failed++;
        const e = err as { error_code?: number; description?: string; message?: string; parameters?: { retry_after?: number } };
        lastError = e.description ?? e.message ?? 'send failed';
        // Respect Telegram flood control before continuing.
        if (e.error_code === 429 && e.parameters?.retry_after) {
          await this.sleep((e.parameters.retry_after + 1) * 1000);
        }
      }

      if ((sent + failed) % progressEvery === 0) opts.onProgress?.(sent, failed);
      if (throttleMs > 0) await this.sleep(throttleMs);
    }

    opts.onProgress?.(sent, failed);
    return { sent, failed, lastError };
  }

  private buildInlineButtons(buttons?: Array<{ text: string; url: string }>): InlineKeyboard | undefined {
    if (!buttons || buttons.length === 0) return undefined;
    const kb = new InlineKeyboard();
    buttons.forEach((b) => kb.url(b.text, b.url).row());
    return kb;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  public handleWebhookRequest(req: any, res: any) {
    if (!this.bot) {
      res.status(500).send('Bot not initialized');
      return;
    }
    const handler = webhookCallback(this.bot, 'express');
    return handler(req, res);
  }

  private getPlayKeyboard(text: string, miniAppUrl: string): InlineKeyboard {
    const isTelegramLink = miniAppUrl.includes('t.me/') || miniAppUrl.includes('telegram.me/');
    if (isTelegramLink) {
      return new InlineKeyboard().url(text, miniAppUrl);
    }
    return new InlineKeyboard().webApp(text, miniAppUrl);
  }

  private contactRequestKeyboard(): Keyboard {
    return new Keyboard()
      .requestContact('📱 Share My Phone Number')
      .resized()
      .oneTime();
  }

  /**
   * Location step: share a pin, or fall back to picking the area by name. The
   * pin is the better answer (it maps to a configured location automatically),
   * but Telegram desktop clients and users with location off can't send one —
   * hence the always-present list button.
   */
  private locationRequestKeyboard(): Keyboard {
    return new Keyboard()
      .requestLocation('📍 Share My Location')
      .row()
      .text(LOCATION_PICK_FROM_LIST_TEXT)
      .resized()
      .oneTime();
  }

  /**
   * Send the pick-from-list dropdown: every location with an active agent, plus
   * "Other". Callback data is `loc:<uuid>` / `loc:other`, well under Telegram's
   * 64-byte callback_data limit. Returns false when no locations are configured,
   * so callers can skip the whole step instead of showing an "Other"-only list.
   */
  private async sendLocationList(ctx: Context, prompt: string): Promise<boolean> {
    let locations: Array<{ id: string; name: string; region?: string | null }> = [];
    try {
      locations = await this.locationsService.listPublicLocations();
    } catch (err) {
      this.logger.error('Failed to load locations for the dropdown', err as Error);
      return false;
    }

    if (locations.length === 0) return false;

    const keyboard = new InlineKeyboard();
    for (const location of locations) {
      const label = location.region ? `${location.name} (${location.region})` : location.name;
      keyboard.text(label, `${LOCATION_CALLBACK_PREFIX}${location.id}`).row();
    }
    keyboard.text('🏠 Other / Not listed', `${LOCATION_CALLBACK_PREFIX}other`);

    await ctx.reply(prompt, {
      reply_markup: { remove_keyboard: true } as never,
    });
    await ctx.reply('Pick the closest one:', { reply_markup: keyboard });
    return true;
  }

  /**
   * Ask where the player is playing from. The question is skippable by design:
   * "Other" is always offered, and a player who ignores the prompt can still
   * open the Mini App. When no locations are configured at all the step is
   * skipped entirely, so a fresh deployment isn't blocked on admin setup.
   */
  private async promptForLocation(ctx: Context, miniAppUrl: string): Promise<void> {
    let hasLocations = false;
    try {
      hasLocations = (await this.locationsService.listPublicLocations()).length > 0;
    } catch (err) {
      this.logger.error('Failed to check configured locations', err as Error);
    }

    if (!hasLocations) {
      await this.finishLocationStep(
        ctx,
        miniAppUrl,
        `Thanks! Your number has been saved for payouts.\n\nTap below to start playing:`,
      );
      return;
    }

    await ctx.reply(
      `Thanks! Your number has been saved for payouts.\n\n` +
      `One last thing — which area are you playing from? ` +
      `This tells us which of our agents to connect you with.`,
      { reply_markup: this.locationRequestKeyboard() },
    );
  }

  /** Confirm the recorded location and hand the player the Play button. */
  private async finishLocationStep(ctx: Context, miniAppUrl: string, confirmation: string): Promise<void> {
    const keyboard = this.getPlayKeyboard('🎮 Play Now', miniAppUrl);
    await ctx.reply(confirmation, {
      reply_markup: {
        remove_keyboard: true,
        ...keyboard,
      },
    });
  }

  /** Resolve the internal user id behind the Telegram account, if linked. */
  private async resolveInternalUserId(telegramUserId?: number): Promise<string | null> {
    if (!telegramUserId) return null;
    try {
      const user = await this.usersService.findByTelegramUserId(String(telegramUserId));
      return user?.id ?? null;
    } catch (err) {
      this.logger.error(`Failed to resolve internal user for Telegram ${telegramUserId}`, err as Error);
      return null;
    }
  }

  private registerCommands(miniAppUrl: string): void {
    if (!this.bot) return;

    // /start — request phone number before showing the Play button
    this.bot.command('start', async (ctx) => {
      const firstName = ctx.from?.first_name ?? 'Player';
      const userId = ctx.from?.id;

      if (userId && this.phoneCache.has(userId)) {
        // Already shared — go straight to play
        const keyboard = this.getPlayKeyboard('🎮 Play Now', miniAppUrl);
        await ctx.reply(
          `Welcome back, ${firstName}! 🎰\n\nTap below to start playing.`,
          { reply_markup: keyboard },
        );
        return;
      }

      await ctx.reply(
        `Welcome to iGames, ${firstName}! 🎰\n\n` +
        `Play Keno and 90-Ball Bingo right here in Telegram.\n\n` +
        `To get started and enable Telebirr payouts, please share your phone number:`,
        { reply_markup: this.contactRequestKeyboard() },
      );
    });

    // Handle contact sharing
    this.bot.on('message:contact', async (ctx) => {
      const contact = ctx.message.contact;
      const userId = ctx.from?.id;

      // Telegram only allows users to share their own contact via the request button
      if (!contact.phone_number || (contact.user_id && contact.user_id !== userId)) {
        await ctx.reply('Please share your own phone number using the button provided.', {
          reply_markup: this.contactRequestKeyboard(),
        });
        return;
      }

      // Persist the phone (normalized to +2519XXXXXXXX). setTelegramPhone creates
      // the internal user first if needed — the contact is shared on /start,
      // before the Mini App has ever opened, so the account may not exist yet.
      // We AWAIT this so the Play button only appears once the phone is durably
      // saved (the Mini App login refuses to start without it).
      let savedPhone: string | null = null;
      if (userId) {
        try {
          savedPhone = await this.usersService.setTelegramPhone({
            telegramUserId: String(userId),
            username: ctx.from?.username,
            firstName: ctx.from?.first_name,
            lastName: ctx.from?.last_name,
            languageCode: ctx.from?.language_code,
            phoneNumber: contact.phone_number,
          });
        } catch (err) {
          this.logger.error(`Failed to persist phone for Telegram user ${userId}`, err as Error);
        }
      }

      if (!savedPhone) {
        await ctx.reply(
          `That doesn't look like a valid Ethiopian phone number. Please share your phone using the button below.`,
          { reply_markup: this.contactRequestKeyboard() },
        );
        return;
      }

      if (userId) {
        this.phoneCache.set(userId, savedPhone);
        this.logger.log(`Stored phone ${savedPhone} for Telegram user ${userId}`);
      }

      // Phone is durably saved; now ask where they are playing from.
      await this.promptForLocation(ctx, miniAppUrl);
    });

    // Location shared as a pin — map it onto a configured location.
    this.bot.on('message:location', async (ctx) => {
      const { latitude, longitude } = ctx.message.location;
      const internalUserId = await this.resolveInternalUserId(ctx.from?.id);

      if (!internalUserId) {
        await ctx.reply('Please share your phone number first.', {
          reply_markup: this.contactRequestKeyboard(),
        });
        return;
      }

      let matched: { id: string; name: string } | null = null;
      try {
        matched = await this.locationsService.resolveLocationFromCoords(latitude, longitude);
      } catch (err) {
        this.logger.error('Failed to resolve shared location', err as Error);
      }

      // Outside every configured radius (or lookup failed) — don't guess, ask.
      if (!matched) {
        const listed = await this.sendLocationList(
          ctx,
          `We couldn't match that spot to one of our areas.`,
        );
        if (!listed) {
          await this.finishLocationStep(ctx, miniAppUrl, 'Tap below to start playing:');
        }
        return;
      }

      try {
        await this.locationsService.setUserLocation(
          internalUserId,
          { locationId: matched.id },
          'telegram_geo',
        );
      } catch (err) {
        this.logger.error(`Failed to save geo location for user ${internalUserId}`, err as Error);
        const listed = await this.sendLocationList(ctx, 'Something went wrong saving that area.');
        if (!listed) {
          await this.finishLocationStep(ctx, miniAppUrl, 'Tap below to start playing:');
        }
        return;
      }

      await this.finishLocationStep(
        ctx,
        miniAppUrl,
        `Got it — we've set your area to ${matched.name}.\n\nTap below to start playing:`,
      );
    });

    // "Choose from a list" — declared before the catch-all text handler so it wins.
    this.bot.hears(LOCATION_PICK_FROM_LIST_TEXT, async (ctx) => {
      const listed = await this.sendLocationList(ctx, 'Which area are you playing from?');
      if (!listed) {
        await this.finishLocationStep(ctx, miniAppUrl, 'Tap below to start playing:');
      }
    });

    // A location was picked from the inline dropdown.
    this.bot.callbackQuery(new RegExp(`^${LOCATION_CALLBACK_PREFIX}`), async (ctx) => {
      const choice = ctx.callbackQuery.data.slice(LOCATION_CALLBACK_PREFIX.length);
      const internalUserId = await this.resolveInternalUserId(ctx.from?.id);

      if (!internalUserId) {
        await ctx.answerCallbackQuery({ text: 'Please share your phone number first.' });
        return;
      }

      const isOther = choice === 'other';
      let saved: { locationName: string | null } | null = null;

      try {
        saved = await this.locationsService.setUserLocation(
          internalUserId,
          isOther ? { other: true } : { locationId: choice },
        );
      } catch (err) {
        this.logger.error(`Failed to save picked location for user ${internalUserId}`, err as Error);
        await ctx.answerCallbackQuery({ text: 'Could not save that — please try again.' });
        return;
      }

      await ctx.answerCallbackQuery();
      // Drop the dropdown so the choice can't be silently changed later.
      await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => undefined);

      await this.finishLocationStep(
        ctx,
        miniAppUrl,
        isOther
          ? `No problem — you're all set.\n\nTap below to start playing:`
          : `Got it — we've set your area to ${saved?.locationName}.\n\nTap below to start playing:`,
      );
    });

    // /play — quick shortcut to open the Mini App
    this.bot.command('play', async (ctx) => {
      const keyboard = this.getPlayKeyboard('🎮 Open iGames', miniAppUrl);

      await ctx.reply('Tap below to open the game:', {
        reply_markup: keyboard,
      });
    });

    // /help — explain how the games work
    this.bot.command('help', async (ctx) => {
      await ctx.reply(
        `🎰 *Keno*\n` +
          `Pick 1–12 numbers from 1–80. Twenty numbers are drawn each round. ` +
          `The more you match, the bigger your payout!\n\n` +
          `🎱 *90\\-Ball Bingo*\n` +
          `Buy tickets and join a room. Numbers 1–90 are drawn one at a time. ` +
          `Complete one line, two lines, or a full house to win!\n\n` +
          `💰 *Wallet*\n` +
          `Top up your wallet via Telebirr. Winnings are credited instantly.\n\n` +
          `Tap the *🎮 Play* button below the chat to get started.`,
        { parse_mode: 'MarkdownV2' },
      );
    });

    // Handle any other text message with a nudge to play
    this.bot.on('message:text', async (ctx) => {
      const keyboard = this.getPlayKeyboard('🎮 Play Now', miniAppUrl);

      await ctx.reply(
        `Tap the button below to open iGames:`,
        { reply_markup: keyboard },
      );
    });
  }
}
