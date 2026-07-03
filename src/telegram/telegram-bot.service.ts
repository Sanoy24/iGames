import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Bot, InlineKeyboard, InputFile, Keyboard, webhookCallback } from 'grammy';
import { AuthIdentity } from '../users/entities/auth-identity.entity';
import { UsersService } from '../users/users.service';

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
        await ctx.reply('Please share your own phone number using the button provided.');
        return;
      }

      if (userId) {
        this.phoneCache.set(userId, contact.phone_number);
        // Persist to DB — best-effort, do not block the reply
        this.usersService
          .updatePhoneByTelegramId(String(userId), contact.phone_number)
          .catch((err) => this.logger.error(`Failed to persist phone for Telegram user ${userId}`, err));
        this.logger.log(`Stored phone ${contact.phone_number} for Telegram user ${userId}`);
      }

      const keyboard = this.getPlayKeyboard('🎮 Play Now', miniAppUrl);

      await ctx.reply(
        `Thanks! Your number has been saved for payouts.\n\nTap below to start playing:`,
        {
          reply_markup: {
            remove_keyboard: true,
            ...keyboard,
          },
        },
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
