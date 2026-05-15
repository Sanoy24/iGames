import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Bot, InlineKeyboard } from 'grammy';

@Injectable()
export class TelegramBotService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramBotService.name);
  private bot: Bot | undefined;

  constructor(private readonly configService: ConfigService) {}

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
    this.registerCommands(miniAppUrl);

    try {
      await this.bot.api.setMyCommands([
        { command: 'start', description: 'Start playing iGames' },
        { command: 'play', description: 'Open the game' },
        { command: 'help', description: 'How to play' },
      ]);

      // Set the menu button to open the Mini App directly
      await this.bot.api.setChatMenuButton({
        menu_button: {
          type: 'web_app',
          text: '🎮 Play',
          web_app: { url: miniAppUrl },
        },
      });

      this.bot.start({
        onStart: () => this.logger.log('Telegram bot started (long polling)'),
      });
    } catch (error) {
      this.logger.error(
        'Failed to start Telegram bot',
        error instanceof Error ? error.stack : error,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.bot) {
      await this.bot.stop();
      this.logger.log('Telegram bot stopped');
    }
  }

  private registerCommands(miniAppUrl: string): void {
    if (!this.bot) return;

    // /start — welcome message with Play button
    this.bot.command('start', async (ctx) => {
      const firstName = ctx.from?.first_name ?? 'Player';

      const keyboard = new InlineKeyboard().webApp('🎮 Play Now', miniAppUrl);

      await ctx.reply(
        `Welcome to iGames, ${firstName}! 🎰\n\n` +
          `Play Keno and 90-Ball Bingo right here in Telegram.\n\n` +
          `Tap the button below to start playing — no signup needed!`,
        { reply_markup: keyboard },
      );
    });

    // /play — quick shortcut to open the Mini App
    this.bot.command('play', async (ctx) => {
      const keyboard = new InlineKeyboard().webApp('🎮 Open iGames', miniAppUrl);

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
      const keyboard = new InlineKeyboard().webApp('🎮 Play Now', miniAppUrl);

      await ctx.reply(
        `Tap the button below to open iGames:`,
        { reply_markup: keyboard },
      );
    });
  }
}
