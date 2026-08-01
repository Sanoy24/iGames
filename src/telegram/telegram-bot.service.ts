import {
    Inject,
    Injectable,
    Logger,
    OnModuleInit,
    OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import Redis from 'ioredis';
import {
    Bot,
    Context,
    InlineKeyboard,
    InputFile,
    Keyboard,
    webhookCallback,
} from 'grammy';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { describeTelegramUpdate } from './telegram-update.util';
import { parseReferralPayload } from '../common/referral-code.util';
import { AuthIdentity } from '../users/entities/auth-identity.entity';
import { UsersService } from '../users/users.service';

/** Reply-keyboard button that opens the pick-from-list dropdown. */
const LOCATION_PICK_FROM_LIST_TEXT = '👤 Choose my agent from a list';

/**
 * A referral code seen on `/start` is held here until the player's account
 * actually exists — the account is only created when they share their contact,
 * which can be a separate update handled by a DIFFERENT process (production runs
 * multiple Passenger workers), so this must be Redis and not an in-memory map.
 */
const PENDING_REFERRAL_KEY = (telegramUserId: number) => `referral:pending:${telegramUserId}`;
const PENDING_REFERRAL_TTL_SECONDS = 24 * 60 * 60;

/** callback_data prefix for an agent choice: `agent:<uuid>` or `agent:other`. */
const AGENT_CALLBACK_PREFIX = 'agent:';

@Injectable()
export class TelegramBotService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(TelegramBotService.name);
    private bot: Bot | undefined;
    private isPolling = false;

    // In-memory cache: telegramUserId → phone (avoids repeated DB writes on /start)
    private readonly phoneCache = new Map<number, string>();
    // Opportunistic cache for the internal user behind a Telegram account.
    private readonly internalUserCache = new Map<number, string>();

    constructor(
        private readonly configService: ConfigService,
        private readonly usersService: UsersService,
        @InjectDataSource() private readonly dataSource: DataSource,
        @Inject(REDIS_CLIENT) private readonly redis: Redis,
    ) {}

    async onModuleInit(): Promise<void> {
        const token = this.configService.get<string>('TELEGRAM_BOT_TOKEN');
        if (!token) {
            this.logger.warn(
                'TELEGRAM_BOT_TOKEN is not set — Telegram bot will not start',
            );
            return;
        }

        const miniAppUrl = this.configService.get<string>(
            'TELEGRAM_MINIAPP_URL',
        );
        if (!miniAppUrl) {
            this.logger.warn(
                'TELEGRAM_MINIAPP_URL is not set — Telegram bot will not start',
            );
            return;
        }

        this.bot = new Bot(token);

        this.bot.catch((err) => {
            this.logger.error(
                `Error in Telegram bot middleware: ${err.message}`,
                err.stack,
            );
        });

        this.registerCommands(miniAppUrl);

        try {
            await this.bot.api.setMyCommands([
                { command: 'start', description: 'Start playing iGames' },
                { command: 'play', description: 'Open the game' },
                { command: 'help', description: 'How to play' },
            ]);

            const isTelegramLink =
                miniAppUrl.includes('t.me/') ||
                miniAppUrl.includes('telegram.me/');

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
                        `Please configure a direct HTTPS URL (e.g. via ngrok) to enable the web_app menu button.`,
                );
            }

            const webhookUrl = this.configService.get<string>(
                'TELEGRAM_WEBHOOK_URL',
            );
            if (webhookUrl) {
                this.logger.log(`Setting Telegram webhook to: ${webhookUrl}`);
                await this.bot.api.setWebhook(webhookUrl);
                this.logger.log('Telegram bot webhook registered successfully');
            } else {
                this.logger.log(
                    'TELEGRAM_WEBHOOK_URL is not set — starting Telegram bot with long polling',
                );
                this.isPolling = true;
                this.bot
                    .start({
                        onStart: () =>
                            this.logger.log(
                                'Telegram bot started (long polling)',
                            ),
                    })
                    .catch((err) =>
                        this.logger.error('Telegram bot error', err),
                    );
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

    async notifyUserWin(
        _userId: string,
        _amountMinor: number,
        _gameName: string,
    ): Promise<void> {
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
        if (!this.bot)
            throw new Error(
                'Telegram bot is not initialized (TELEGRAM_BOT_TOKEN missing)',
            );

        const api = this.bot.api;
        const parseMode =
            opts.parseMode && opts.parseMode !== 'none'
                ? opts.parseMode
                : undefined;
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
                    const message = await api.sendPhoto(
                        chatId,
                        photoRef as string | InputFile,
                        {
                            caption: hasText
                                ? (opts.text as string)
                                : undefined,
                            parse_mode: parseMode,
                            reply_markup: keyboard,
                        },
                    );
                    // Reuse the uploaded file for every subsequent recipient.
                    if (
                        photoRef instanceof InputFile &&
                        message.photo?.length
                    ) {
                        photoRef =
                            message.photo[message.photo.length - 1].file_id;
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
                const e = err as {
                    error_code?: number;
                    description?: string;
                    message?: string;
                    parameters?: { retry_after?: number };
                };
                lastError = e.description ?? e.message ?? 'send failed';
                // Respect Telegram flood control before continuing.
                if (e.error_code === 429 && e.parameters?.retry_after) {
                    await this.sleep((e.parameters.retry_after + 1) * 1000);
                }
            }

            if ((sent + failed) % progressEvery === 0)
                opts.onProgress?.(sent, failed);
            if (throttleMs > 0) await this.sleep(throttleMs);
        }

        opts.onProgress?.(sent, failed);
        return { sent, failed, lastError };
    }

    private buildInlineButtons(
        buttons?: Array<{ text: string; url: string }>,
    ): InlineKeyboard | undefined {
        if (!buttons || buttons.length === 0) return undefined;
        const kb = new InlineKeyboard();
        buttons.forEach((b) => kb.url(b.text, b.url).row());
        return kb;
    }

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    /**
     * Run a follow-up outside the webhook's critical path.
     * We still log failures, but the update can be acknowledged immediately.
     */
    private deferTask(taskName: string, task: () => Promise<void>): void {
        setImmediate(() => {
            void task().catch((err) => {
                this.logger.error(
                    `Deferred Telegram task failed (${taskName}): ${err instanceof Error ? err.message : err}`,
                    err instanceof Error ? err.stack : undefined,
                );
            });
        });
    }

    public async handleWebhookRequest(req: any, res: any) {
        if (!this.bot) {
            res.status(500).send('Bot not initialized');
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
                `Unhandled error processing webhook update (${describeTelegramUpdate(req.body)}): ${err instanceof Error ? err.message : err}`,
                err instanceof Error ? err.stack : undefined,
            );
            if (!res.headersSent) res.status(200).send('OK');
        }
    }

    private getPlayKeyboard(text: string, miniAppUrl: string): InlineKeyboard {
        const isTelegramLink =
            miniAppUrl.includes('t.me/') || miniAppUrl.includes('telegram.me/');
        if (isTelegramLink) {
            return new InlineKeyboard().url(text, miniAppUrl);
        }
        return new InlineKeyboard().webApp(text, miniAppUrl);
    }

    /**
     * Handle a referral code arriving as a `/start` deep-link payload. The player's
     * internal account may not exist yet (it's created on contact-share), so when
     * we can't attribute now we park the code in Redis and the contact handler
     * applies it via `applyPendingReferral`. Never throws — a bad or unknown code
     * must not break onboarding.
     */
    private async captureReferralFromStart(
        telegramUserId: number,
        payload: string | undefined,
    ): Promise<void> {
        const code = parseReferralPayload(payload);
        if (!code) return;

        try {
            const existing =
                await this.usersService.findByTelegramUserId(String(telegramUserId));
            if (existing) {
                await this.usersService.attributeReferral(existing.id, code);
                return;
            }

            await this.redis.set(
                PENDING_REFERRAL_KEY(telegramUserId),
                code,
                'EX',
                PENDING_REFERRAL_TTL_SECONDS,
            );
        } catch (err) {
            this.logger.error(
                `Failed to capture referral code for Telegram user ${telegramUserId}`,
                err as Error,
            );
        }
    }

    /**
     * Apply (and clear) a referral code parked by `captureReferralFromStart`, now
     * that the player's account exists. Never throws — attribution is a bonus, not
     * a precondition for finishing onboarding.
     */
    private async applyPendingReferral(
        telegramUserId: number,
        userId: string,
    ): Promise<void> {
        try {
            const key = PENDING_REFERRAL_KEY(telegramUserId);
            const code = await this.redis.get(key);
            if (!code) return;

            await this.usersService.attributeReferral(userId, code);
            await this.redis.del(key);
        } catch (err) {
            this.logger.error(
                `Failed to apply pending referral for Telegram user ${telegramUserId}`,
                err as Error,
            );
        }
    }

    private contactRequestKeyboard(): Keyboard {
        return new Keyboard()
            .requestContact('📱 ስልክ ቁጥሬን አጋራ')
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
     * Send the pick-from-list dropdown: every currently on-duty agent, plus
     * "Other". Callback data is `agent:<uuid>` / `agent:other`, well under
     * Telegram's 64-byte callback_data limit. Returns false when nobody is on
     * duty, so callers can skip the whole step instead of showing an
     * "Other"-only list.
     */
    private async sendAgentList(
        ctx: Context,
        prompt: string,
    ): Promise<boolean> {
        let agents: Array<{ id: string; name: string }> = [];
        try {
            agents = await this.usersService.listOnDutyAgentsForMatching();
        } catch (err) {
            this.logger.error(
                'Failed to load on-duty agents for the dropdown',
                err as Error,
            );
            return false;
        }

        if (agents.length === 0) return false;

        const keyboard = new InlineKeyboard();
        for (const agent of agents) {
            keyboard
                .text(agent.name, `${AGENT_CALLBACK_PREFIX}${agent.id}`)
                .row();
        }
        keyboard.text(
            '🏠 Other / Not listed',
            `${AGENT_CALLBACK_PREFIX}other`,
        );

        await ctx.reply(prompt, {
            reply_markup: { remove_keyboard: true } as never,
        });
        await ctx.reply('Pick one:', { reply_markup: keyboard });
        return true;
    }

    /**
     * Ask the player to connect with an agent. The question is skippable by
     * design: "Other" is always offered, and a player who ignores the prompt
     * can still open the Mini App. When nobody is currently on duty the step
     * is skipped entirely, so a quiet moment isn't blocked on agent staffing.
     */
    private async promptForAgentMatch(
        ctx: Context,
        miniAppUrl: string,
    ): Promise<void> {
        let hasAgents = false;
        try {
            hasAgents =
                (await this.usersService.listOnDutyAgentsForMatching()).length > 0;
        } catch (err) {
            this.logger.error(
                'Failed to check on-duty agents',
                err as Error,
            );
        }

        if (!hasAgents) {
            await this.finishLocationStep(
                ctx,
                miniAppUrl,
                `እናመሰግናለን! ቁጥርዎ ለክፍያ ተቀምጧል።\n\nለመጫወት ከታች ያለውን ይንኩ፦`,
            );
            return;
        }

        await ctx.reply(
            `Thanks! Your number has been saved for payouts.\n\n` +
                `One last thing — share your location so we can connect you ` +
                `with the nearest available agent for fast deposits and withdrawals.`,
            { reply_markup: this.locationRequestKeyboard() },
        );
    }

    /** Confirm the recorded location and hand the player the Play button. */
    private async finishLocationStep(
        ctx: Context,
        miniAppUrl: string,
        confirmation: string,
    ): Promise<void> {
        const keyboard = this.getPlayKeyboard('🎮 አሁን ተጫወት', miniAppUrl);
        await ctx.reply(confirmation, {
            reply_markup: {
                remove_keyboard: true,
                ...keyboard,
            },
        });
    }

    /** Resolve the internal user id behind the Telegram account, if linked. */
    private async resolveInternalUserId(
        telegramUserId?: number,
    ): Promise<string | null> {
        if (!telegramUserId) return null;
        const cached = this.internalUserCache.get(telegramUserId);
        if (cached) return cached;
        try {
            const user = await this.usersService.findByTelegramUserId(
                String(telegramUserId),
            );
            if (user?.id) {
                this.internalUserCache.set(telegramUserId, user.id);
            }
            return user?.id ?? null;
        } catch (err) {
            this.logger.error(
                `Failed to resolve internal user for Telegram ${telegramUserId}`,
                err as Error,
            );
            return null;
        }
    }

    private registerCommands(miniAppUrl: string): void {
        if (!this.bot) return;

        // /start — request phone number before showing the Play button
        this.bot.command('start', (ctx) => {
            this.deferTask('player:/start', async () => {
            const firstName = ctx.from?.first_name ?? 'Player';
            const userId = ctx.from?.id;

            // Referral deep link (`?start=ref_<code>`). Captured BEFORE the
            // already-onboarded early-return below, so a returning-but-still-
            // unattributed player following an agent's link still gets credited.
            if (userId) {
                await this.captureReferralFromStart(userId, ctx.match);
            }

            if (userId && this.phoneCache.has(userId)) {
                // Already shared — go straight to play
                const keyboard = this.getPlayKeyboard(
                    '🎮 አሁን ተጫወት',
                    miniAppUrl,
                );
                await ctx.reply(
                    `እንኳን ደህና መጡ ተመልሰው፣ ${firstName}! 🎰\n\nለመጫወት ከታች ያለውን ይንኩ።`,
                    { reply_markup: keyboard },
                );
                return;
            }

            await ctx.reply(
                `እንኳን ወደ Yahoo Bingo በደህና መጡ፣ ${firstName}! 🎰\n\n` +
                    `75-ኳስ ቢንጎን በቴሌግራም ላይ ይጫወቱ።\n\n` +
                    `ለመጀመር እና የቴሌብር ክፍያ ለማንቃት እባክዎ ስልክ ቁጥርዎን ያጋሩ፦`,
                { reply_markup: this.contactRequestKeyboard() },
            );
            });
        });

        // Handle contact sharing
        this.bot.on('message:contact', async (ctx) => {
            const contact = ctx.message.contact;
            const userId = ctx.from?.id;

            // Telegram only allows users to share their own contact via the request button
            if (
                !contact.phone_number ||
                (contact.user_id && contact.user_id !== userId)
            ) {
                await ctx.reply('እባክዎ የቀረበውን አዝራር በመጠቀም የራስዎን ስልክ ቁጥር ያጋሩ።', {
                    reply_markup: this.contactRequestKeyboard(),
                });
                return;
            }

            // Persist the phone (normalized to +2519XXXXXXXX). setTelegramPhone creates
            // the internal user first if needed — the contact is shared on /start,
            // before the Mini App has ever opened, so the account may not exist yet.
            // We AWAIT this so the Play button only appears once the phone is durably
            // saved (the Mini App login refuses to start without it).
            let savedPhone: { phoneNumber: string; userId: string } | null =
                null;
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
                    this.logger.error(
                        `Failed to persist phone for Telegram user ${userId}`,
                        err as Error,
                    );
                }
            }

            if (!savedPhone) {
                await ctx.reply(
                    `ይህ ትክክለኛ የኢትዮጵያ ስልክ ቁጥር አይመስልም። እባክዎ ከታች ባለው አዝራር ስልክዎን ያጋሩ።`,
                    { reply_markup: this.contactRequestKeyboard() },
                );
                return;
            }

            if (userId) {
                this.phoneCache.set(userId, savedPhone.phoneNumber);
                this.internalUserCache.set(userId, savedPhone.userId);
                this.logger.log(
                    `Stored phone ${savedPhone.phoneNumber} for Telegram user ${userId}`,
                );
            }

            this.deferTask(`player:contact:${userId ?? 'unknown'}`, async () => {
                // The account now exists, so a referral code parked on /start can
                // finally be attributed.
                if (userId) {
                    await this.applyPendingReferral(userId, savedPhone.userId);
                }

                // Phone is durably saved; now offer to connect them with an agent.
                await this.promptForAgentMatch(ctx, miniAppUrl);
            });
        });

        // Location shared as a pin — match it onto the nearest on-duty agent.
        this.bot.on('message:location', async (ctx) => {
            const { latitude, longitude } = ctx.message.location;
            const [internalUserId, matched] = await Promise.all([
                this.resolveInternalUserId(ctx.from?.id),
                this.usersService.matchAgentFromCoords(latitude, longitude).catch((err) => {
                    this.logger.error(
                        'Failed to match shared location to an agent',
                        err as Error,
                    );
                    return null;
                }),
            ]);

            if (!internalUserId) {
                await ctx.reply('Please share your phone number first.', {
                    reply_markup: this.contactRequestKeyboard(),
                });
                return;
            }

            // Outside every on-duty agent's radius (or lookup failed) — don't guess, ask.
            if (!matched) {
                this.deferTask('player:location:no-agent', async () => {
                    const listed = await this.sendAgentList(
                        ctx,
                        `We couldn't find an on-duty agent near that spot.`,
                    );
                    if (!listed) {
                        await this.finishLocationStep(
                            ctx,
                            miniAppUrl,
                            'Tap below to start playing:',
                        );
                    }
                });
                return;
            }

            try {
                await this.usersService.setAssignedAgent(
                    internalUserId,
                    { agentId: matched.id },
                    'gps_match',
                );
            } catch (err) {
                this.logger.error(
                    `Failed to save agent match for user ${internalUserId}`,
                    err as Error,
                );
                this.deferTask('player:location:assignment-failed', async () => {
                    const listed = await this.sendAgentList(
                        ctx,
                        'Something went wrong connecting you with an agent.',
                    );
                    if (!listed) {
                        await this.finishLocationStep(
                            ctx,
                            miniAppUrl,
                            'Tap below to start playing:',
                        );
                    }
                });
                return;
            }

            this.deferTask(`player:location:${internalUserId}`, async () => {
                await this.finishLocationStep(
                    ctx,
                    miniAppUrl,
                    `Got it — we've connected you with ${matched.name}.\n\nTap below to start playing:`,
                );
            });
        });

        // "Choose from a list" — declared before the catch-all text handler so it wins.
        this.bot.hears(LOCATION_PICK_FROM_LIST_TEXT, (ctx) => {
            this.deferTask('player:location:list', async () => {
                const listed = await this.sendAgentList(
                    ctx,
                    'Which agent would you like to connect with?',
                );
                if (!listed) {
                    await this.finishLocationStep(
                        ctx,
                        miniAppUrl,
                        'Tap below to start playing:',
                    );
                }
            });
        });

        // An agent was picked from the inline dropdown.
        this.bot.callbackQuery(
            new RegExp(`^${AGENT_CALLBACK_PREFIX}`),
            async (ctx) => {
                const choice = ctx.callbackQuery.data.slice(
                    AGENT_CALLBACK_PREFIX.length,
                );
                const internalUserId = await this.resolveInternalUserId(
                    ctx.from?.id,
                );

                if (!internalUserId) {
                    await ctx.answerCallbackQuery({
                        text: 'Please share your phone number first.',
                    });
                    return;
                }

                const isOther = choice === 'other';
                let saved: { assignedAgentName: string | null } | null = null;

                try {
                    saved = await this.usersService.setAssignedAgent(
                        internalUserId,
                        isOther ? { other: true } : { agentId: choice },
                    );
                } catch (err) {
                    this.logger.error(
                        `Failed to save picked agent for user ${internalUserId}`,
                        err as Error,
                    );
                    await ctx.answerCallbackQuery({
                        text: 'Could not save that — please try again.',
                    });
                    return;
                }

                await ctx.answerCallbackQuery();
                // Drop the dropdown so the choice can't be silently changed later.
                await ctx
                    .editMessageReplyMarkup({ reply_markup: undefined })
                    .catch(() => undefined);

                await this.finishLocationStep(
                    ctx,
                    miniAppUrl,
                    isOther
                        ? `No problem — you're all set.\n\nTap below to start playing:`
                        : `Got it — we've connected you with ${saved?.assignedAgentName}.\n\nTap below to start playing:`,
                );
            },
        );

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
            const keyboard = this.getPlayKeyboard('🎮 አሁን ተጫወት', miniAppUrl);

            await ctx.reply(`Tap the button below to open iGames:`, {
                reply_markup: keyboard,
            });
        });
    }
}
