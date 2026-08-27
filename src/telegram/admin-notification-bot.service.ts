import {
    Injectable,
    Logger,
    OnApplicationBootstrap,
    OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Bot, Keyboard, webhookCallback } from 'grammy';
import { UsersService } from '../users/users.service';
import { normalizeEthiopianPhone } from '../common/phone.util';
import { describeTelegramUpdate } from './telegram-update.util';

/**
 * A separate, standalone Telegram bot whose ONLY job is pinging admins when a
 * withdrawal is requested. NOT part of TelegramBotService (player) or
 * AgentBotService (agent)  same reasoning as the agent bot's own doc comment:
 * a different audience and a single-purpose command set deserve their own
 * bot/token rather than another branch bolted onto an existing one.
 *
 * Flow: an admin account already exists (created via ensureAdminAccount /
 * ADMIN_BOOTSTRAP_ACCOUNTS  there is no self-service admin creation). Whoever
 * should receive withdrawal alerts opens this bot and shares their phone; the
 * backend matches it to an EXISTING admin account (never creates one) and
 * links this Telegram identity to it (role-scoped, see
 * UsersService.linkTelegramIdentityToUser). There is deliberately no separate
 * "recipients" list to configure: whichever admin account(s) link this bot
 * one, two, or several  is the whole recipient list
 * (UsersService.findAdminTelegramRecipients).
 */
@Injectable()
export class AdminNotificationBotService
    implements OnApplicationBootstrap, OnApplicationShutdown
{
    private readonly logger = new Logger(AdminNotificationBotService.name);
    private bot: Bot | undefined;
    private isPolling = false;

    constructor(
        private readonly configService: ConfigService,
        private readonly usersService: UsersService,
    ) {}

    async onApplicationBootstrap(): Promise<void> {
        const token = this.configService.get<string>(
            'TELEGRAM_ADMIN_BOT_TOKEN',
        );
        if (!token) {
            this.logger.log(
                'TELEGRAM_ADMIN_BOT_TOKEN is not set  admin notification bot will not start',
            );
            return;
        }

        this.bot = new Bot(token);
        this.bot.catch((err) => {
            this.logger.error(
                `Error in admin notification bot middleware: ${err.message}`,
                err.stack,
            );
        });

        this.registerCommands(this.bot);

        try {
            await this.bot.api.setMyCommands([
                { command: 'start', description: 'Link your admin account' },
            ]);

            const webhookUrl = this.configService.get<string>(
                'TELEGRAM_ADMIN_BOT_WEBHOOK_URL',
            );
            if (webhookUrl) {
                this.logger.log(
                    `Setting admin notification bot webhook to: ${webhookUrl}`,
                );
                await this.bot.api.setWebhook(webhookUrl);
                this.logger.log(
                    'Admin notification bot webhook registered successfully',
                );
            } else {
                this.logger.log(
                    'TELEGRAM_ADMIN_BOT_WEBHOOK_URL is not set  starting admin notification bot with long polling',
                );
                this.isPolling = true;
                this.bot
                    .start({
                        onStart: () =>
                            this.logger.log(
                                'Admin notification bot started (long polling)',
                            ),
                    })
                    .catch((err) =>
                        this.logger.error('Admin notification bot error', err),
                    );
            }
        } catch (error) {
            this.logger.error(
                'Failed to start admin notification bot',
                error instanceof Error ? error.stack : error,
            );
        }
    }

    async onApplicationShutdown(): Promise<void> {
        if (this.bot && this.isPolling) {
            await this.bot.stop();
            this.logger.log('Admin notification bot polling stopped');
        }
    }

    public async handleWebhookRequest(req: any, res: any) {
        if (!this.bot) {
            res.status(500).send('Admin notification bot not initialized');
            return;
        }
        const handler = webhookCallback(this.bot, 'express');
        try {
            await handler(req, res);
        } catch (err) {
            this.logger.error(
                `Unhandled error processing admin bot webhook update (${describeTelegramUpdate(req.body)}): ${err instanceof Error ? err.message : err}`,
                err instanceof Error ? err.stack : undefined,
            );
            if (!res.headersSent) res.status(200).send('OK');
        }
    }

    private deferTask(taskName: string, task: () => Promise<void>): void {
        setImmediate(() => {
            void task().catch((err) => {
                this.logger.error(
                    `Deferred admin-bot task failed (${taskName}): ${err instanceof Error ? err.message : err}`,
                    err instanceof Error ? err.stack : undefined,
                );
            });
        });
    }

    private contactRequestKeyboard(): Keyboard {
        return new Keyboard()
            .requestContact('📱 Share My Phone Number')
            .resized()
            .oneTime();
    }

    private registerCommands(bot: Bot): void {
        bot.command('start', (ctx) => {
            this.deferTask('admin:/start', async () => {
                await ctx.reply(
                    'This bot sends withdrawal alerts to admins.\n\n' +
                        'Share your registered admin phone number to start receiving them here:',
                    { reply_markup: this.contactRequestKeyboard() },
                );
            });
        });

        bot.on('message:contact', (ctx) => {
            const contact = ctx.message.contact;
            const telegramUserId = ctx.from?.id;

            if (
                !contact.phone_number ||
                (contact.user_id && contact.user_id !== telegramUserId)
            ) {
                this.deferTask('admin:contact:invalid', async () => {
                    await ctx.reply(
                        'Please share your own phone number using the button provided.',
                        { reply_markup: this.contactRequestKeyboard() },
                    );
                });
                return;
            }
            if (!telegramUserId) return;

            const normalized = normalizeEthiopianPhone(contact.phone_number);
            if (!normalized) {
                this.deferTask('admin:contact:bad-phone', async () => {
                    await ctx.reply(
                        'That does not look like a valid Ethiopian phone number.',
                        { reply_markup: this.contactRequestKeyboard() },
                    );
                });
                return;
            }

            this.deferTask(`admin:contact:${telegramUserId}`, async () => {
                let admin;
                try {
                    admin = await this.usersService.findAdminByPhone(normalized);
                } catch (err) {
                    this.logger.error(
                        'Admin lookup failed',
                        err instanceof Error ? err.stack : err,
                    );
                    await ctx.reply(
                        'Something went wrong looking up your account. Please try again.',
                    );
                    return;
                }

                if (!admin) {
                    await ctx.reply(
                        'No admin account was found for this number.',
                    );
                    return;
                }

                if (admin.status !== 'active') {
                    await ctx.reply('Your admin account is not active.');
                    return;
                }

                try {
                    await this.usersService.linkTelegramIdentityToUser(
                        admin.id,
                        {
                            telegramUserId: String(telegramUserId),
                            username: ctx.from?.username,
                            firstName: ctx.from?.first_name,
                            lastName: ctx.from?.last_name,
                            languageCode: ctx.from?.language_code,
                        },
                        'admin',
                    );
                } catch (err) {
                    this.logger.error(
                        `Failed to link Telegram identity for admin ${admin.id}`,
                        err instanceof Error ? err.stack : err,
                    );
                    await ctx.reply(
                        err instanceof Error &&
                            err.message.includes('already linked')
                            ? 'This Telegram account is already linked to a different account.'
                            : 'Something went wrong linking your account. Please try again.',
                    );
                    return;
                }

                await ctx.reply(
                    `Linked! Welcome, ${admin.displayName}. You'll receive withdrawal alerts here.`,
                    { reply_markup: { remove_keyboard: true } as never },
                );
            });
        });

        bot.on('message:text', (ctx) => {
            this.deferTask('admin:text', async () => {
                await ctx.reply('Send /start to link your admin account.');
            });
        });
    }

    /**
     * Push a withdrawal-request alert to every currently-linked admin. Best
     * effort per recipient: one blocked/broken chat is logged and marked
     * (see UsersService.markAdminTelegramBlocked) but never stops delivery to
     * the others.
     */
    async notifyWithdrawalRequested(details: {
        withdrawalId: string;
        displayName: string;
        phoneNumber?: string | null;
        amountMinor: number;
        destinationAccount: string;
    }): Promise<void> {
        const text =
            `💸 New withdrawal request\n` +
            `User: ${details.displayName}${details.phoneNumber ? ` (${details.phoneNumber})` : ''}\n` +
            `Amount: ${(details.amountMinor / 100).toFixed(2)} ETB\n` +
            `To: ${details.destinationAccount}\n` +
            `Ref: ${details.withdrawalId}`;

        await this.broadcastToAdmins(text);
    }

    /**
     * Sends a harmless sample alert to every currently-linked admin, for the
     * "Send Test Alert" button on the admin dashboard's notification settings
     * so an admin can confirm the bot is wired up correctly without waiting
     * for a real withdrawal. Returns how many admins are actually linked so
     * the dashboard can show "no admin has linked the bot yet" if that's 0.
     */
    async sendTestAlert(): Promise<{ recipientCount: number }> {
        const recipients = await this.usersService.findAdminTelegramRecipients();
        if (recipients.length === 0) return { recipientCount: 0 };

        const text =
            `🔔 Test alert\n` +
            `This is a test  a real withdrawal request looks like this.\n` +
            `Sent: ${new Date().toISOString()}`;

        await this.broadcastToAdmins(text, recipients);
        return { recipientCount: recipients.length };
    }

    /** Best-effort fan-out to every linked admin chat; one bad chat never blocks the rest. */
    private async broadcastToAdmins(
        text: string,
        recipients?: Awaited<
            ReturnType<UsersService['findAdminTelegramRecipients']>
        >,
    ): Promise<void> {
        if (!this.bot) return;

        const list = recipients ?? (await this.usersService.findAdminTelegramRecipients());
        if (list.length === 0) return;

        for (const recipient of list) {
            try {
                await this.bot.api.sendMessage(recipient.telegramChatId, text);
            } catch (err) {
                const e = err as { error_code?: number; description?: string };
                this.logger.error(
                    `Failed to send admin alert to chat ${recipient.telegramChatId}: ${e.description ?? (err instanceof Error ? err.message : err)}`,
                );
                if (e.error_code === 403) {
                    await this.usersService
                        .markAdminTelegramBlocked(recipient.identityId)
                        .catch(() => undefined);
                }
            }
        }
    }
}
