import { existsSync } from 'fs';
import { unlink } from 'fs/promises';
import { join } from 'path';
import {
    BadRequestException,
    Injectable,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, LessThan, Repository } from 'typeorm';
import { AuthIdentity } from '../users/entities/auth-identity.entity';
import { TelegramBotService } from '../telegram/telegram-bot.service';
import { CreateBroadcastDto } from './dto/create-broadcast.dto';
import {
    BROADCAST_IMAGE_SUBDIR,
    TELEGRAM_CAPTION_MAX,
    UPLOADS_ROOT,
} from './broadcast.constants';
import {
    BroadcastMessage,
    BroadcastRecurrence,
} from './entities/broadcast-message.entity';

/** A row stuck in "sending" longer than this is treated as interrupted and recovered. */
const STALE_SENDING_MS = 45 * 60 * 1000;

@Injectable()
export class BroadcastService {
    private readonly logger = new Logger(BroadcastService.name);
    /** Ids of in-flight sends the admin has requested to stop. */
    private readonly cancelling = new Set<string>();

    constructor(
        @InjectRepository(BroadcastMessage)
        private readonly broadcastRepo: Repository<BroadcastMessage>,
        @InjectRepository(AuthIdentity)
        private readonly authIdentityRepo: Repository<AuthIdentity>,
        private readonly telegramBotService: TelegramBotService,
    ) {}

    // ── CRUD ──────────────────────────────────────────────────────────────────

    async list(): Promise<BroadcastMessage[]> {
        return this.broadcastRepo.find({
            order: { createdAt: 'DESC' },
            take: 100,
        });
    }

    async get(id: string): Promise<BroadcastMessage> {
        const row = await this.broadcastRepo.findOneBy({ id });
        if (!row) throw new NotFoundException('Broadcast not found');
        return row;
    }

    async create(
        dto: CreateBroadcastDto,
        adminId?: string,
    ): Promise<BroadcastMessage> {
        const hasText = !!dto.text && dto.text.trim().length > 0;
        const imagePath = dto.imageFilename
            ? this.resolveStoredImagePath(dto.imageFilename)
            : null;
        if (!hasText && !imagePath) {
            throw new BadRequestException(
                'A broadcast needs a message, an image, or both',
            );
        }
        if (
            imagePath &&
            hasText &&
            (dto.text as string).length > TELEGRAM_CAPTION_MAX
        ) {
            throw new BadRequestException(
                `With an image attached, the caption must be ${TELEGRAM_CAPTION_MAX} characters or fewer`,
            );
        }

        const offset = dto.timezoneOffsetMinutes ?? 180;
        const row = this.broadcastRepo.create({
            title: dto.title,
            text: hasText ? (dto.text as string) : null,
            imagePath,
            buttons: dto.buttons && dto.buttons.length > 0 ? dto.buttons : null,
            parseMode: dto.parseMode ?? 'HTML',
            audience: 'all_telegram',
            scheduleType: dto.scheduleType,
            recurrence:
                dto.scheduleType === 'recurring'
                    ? (dto.recurrence as BroadcastRecurrence)
                    : null,
            timezoneOffsetMinutes: offset,
            createdBy: adminId ?? null,
            status: 'draft',
            nextRunAt: null,
        });

        if (dto.scheduleType === 'now') {
            row.status = 'sending';
            const saved = await this.broadcastRepo.save(row);
            // Fire the send in the background; the client polls for progress.
            void this.dispatch(saved.id);
            return saved;
        }

        if (dto.asDraft) {
            row.status = 'draft';
            return this.broadcastRepo.save(row);
        }

        if (dto.scheduleType === 'once') {
            row.nextRunAt = this.computeOnceRunAt(
                dto.scheduledAtLocal as string,
                offset,
            );
            if (row.nextRunAt.getTime() <= Date.now()) {
                throw new BadRequestException(
                    'Scheduled time must be in the future',
                );
            }
        } else {
            row.nextRunAt = this.computeNextRecurrence(
                dto.recurrence as BroadcastRecurrence,
                offset,
                new Date(),
            );
        }
        row.status = 'scheduled';
        return this.broadcastRepo.save(row);
    }

    /** Send a draft/scheduled broadcast right now. */
    async sendNow(id: string): Promise<BroadcastMessage> {
        const row = await this.get(id);
        if (row.status === 'sending') return row;
        if (
            !['draft', 'scheduled', 'sent', 'failed', 'cancelled'].includes(
                row.status,
            )
        ) {
            throw new BadRequestException(
                `Cannot send a broadcast in status "${row.status}"`,
            );
        }
        const claimed = await this.broadcastRepo.update(
            { id, status: row.status },
            { status: 'sending', lastRunAt: new Date() },
        );
        if (!claimed.affected)
            throw new BadRequestException('Broadcast is already being sent');
        void this.dispatch(id);
        return this.get(id);
    }

    /** Cancel a scheduled/draft broadcast, or stop one that is mid-send. */
    async cancel(id: string): Promise<BroadcastMessage> {
        const row = await this.get(id);
        if (row.status === 'sending') {
            this.cancelling.add(id);
            return row; // dispatch loop will finalize it as cancelled
        }
        if (row.status === 'scheduled' || row.status === 'draft') {
            row.status = 'cancelled';
            row.nextRunAt = null;
            return this.broadcastRepo.save(row);
        }
        throw new BadRequestException(
            `Cannot cancel a broadcast in status "${row.status}"`,
        );
    }

    async remove(id: string): Promise<{ deleted: true }> {
        const row = await this.get(id);
        if (row.status === 'sending')
            throw new BadRequestException(
                'Stop the broadcast before deleting it',
            );
        if (row.imagePath) await this.deleteImageFile(row.imagePath);
        await this.broadcastRepo.delete(id);
        return { deleted: true };
    }

    // ── Scheduler entry point ───────────────────────────────────────────────────

    /** Recover interrupted rows and claim any that are now due. Safe to call often. */
    async runDueBroadcasts(): Promise<void> {
        await this.recoverStaleSending();

        const due = await this.broadcastRepo.find({
            where: { status: 'scheduled', nextRunAt: LessThan(new Date()) },
            order: { nextRunAt: 'ASC' },
            take: 10,
        });

        for (const row of due) {
            // Atomic claim  only one instance/tick can flip scheduled → sending.
            const claimed = await this.broadcastRepo.update(
                { id: row.id, status: 'scheduled' },
                { status: 'sending', lastRunAt: new Date() },
            );
            if (claimed.affected) void this.dispatch(row.id);
        }
    }

    private async recoverStaleSending(): Promise<void> {
        const cutoff = new Date(Date.now() - STALE_SENDING_MS);
        const stale = await this.broadcastRepo.find({
            where: { status: 'sending', updatedAt: LessThan(cutoff) },
            take: 10,
        });
        for (const row of stale) {
            if (this.cancelling.has(row.id)) continue; // being handled locally
            if (row.scheduleType === 'recurring' && row.recurrence) {
                row.status = 'scheduled';
                row.nextRunAt = this.computeNextRecurrence(
                    row.recurrence,
                    row.timezoneOffsetMinutes,
                    new Date(),
                );
            } else {
                row.status = 'failed';
            }
            row.lastError =
                'Interrupted before completion (recovered by scheduler)';
            await this.broadcastRepo.save(row);
            this.logger.warn(`Recovered stale broadcast ${row.id}`);
        }
    }

    // ── Dispatch ────────────────────────────────────────────────────────────────

    /** Send the broadcast to every recipient, persisting progress, then finalize. */
    private async dispatch(id: string): Promise<void> {
        const row = await this.broadcastRepo.findOneBy({ id });
        if (!row) return;

        try {
            const chatIds = await this.getTelegramChatIds();
            row.totalRecipients = chatIds.length;
            row.sentCount = 0;
            row.failedCount = 0;
            row.lastError = null;
            await this.broadcastRepo.save(row);

            if (chatIds.length === 0) {
                await this.finalize(row, 0, 0, 'No Telegram recipients');
                return;
            }

            const imageAbsolutePath = row.imagePath
                ? join(UPLOADS_ROOT, row.imagePath)
                : null;
            const { sent, failed, lastError, blockedChatIds } =
                await this.telegramBotService.sendBroadcastMessage({
                    chatIds,
                    text: row.text,
                    imageAbsolutePath,
                    buttons: row.buttons,
                    parseMode: row.parseMode,
                    isCancelled: () => this.cancelling.has(id),
                    onProgress: (s, f) => {
                        void this.broadcastRepo.update(id, {
                            sentCount: s,
                            failedCount: f,
                        });
                    },
                });

            if (blockedChatIds.length > 0)
                await this.markTelegramBlocked(blockedChatIds);

            await this.finalize(row, sent, failed, lastError ?? null);
        } catch (err) {
            const message =
                err instanceof Error
                    ? err.message
                    : 'Broadcast dispatch failed';
            this.logger.error(`Broadcast ${id} failed: ${message}`);
            const fresh = await this.broadcastRepo.findOneBy({ id });
            if (fresh)
                await this.finalize(
                    fresh,
                    fresh.sentCount,
                    fresh.failedCount,
                    message,
                );
        }
    }

    private async finalize(
        row: BroadcastMessage,
        sent: number,
        failed: number,
        lastError: string | null,
    ): Promise<void> {
        const wasCancelled = this.cancelling.delete(row.id);
        row.sentCount = sent;
        row.failedCount = failed;
        row.runCount += 1;
        row.lastRunAt = new Date();
        row.lastError = lastError;

        if (wasCancelled) {
            row.status = 'cancelled';
            row.nextRunAt = null;
        } else if (row.scheduleType === 'recurring' && row.recurrence) {
            // Re-arm for the next occurrence; counters reflect the most recent run.
            row.status = 'scheduled';
            row.nextRunAt = this.computeNextRecurrence(
                row.recurrence,
                row.timezoneOffsetMinutes,
                new Date(),
            );
        } else {
            row.status = sent === 0 && failed > 0 ? 'failed' : 'sent';
            row.nextRunAt = null;
        }
        await this.broadcastRepo.save(row);
        this.logger.log(
            `Broadcast ${row.id} finished: ${sent} sent, ${failed} failed, status=${row.status}`,
        );
    }

    /**
     * Every distinct Telegram chat id we can message (private chat id == user id).
     * Excludes chats Telegram has already told us are permanently unreachable
     * (see `markTelegramBlocked`)  otherwise the same dead handful gets retried,
     * and counted as "failed", on every scheduled run forever.
     */
    private async getTelegramChatIds(): Promise<string[]> {
        const rows = await this.authIdentityRepo.find({
            where: { provider: 'telegram', telegramBlockedAt: IsNull() },
            select: { providerUserId: true },
        });
        const seen = new Set<string>();
        for (const r of rows) {
            if (r.providerUserId) seen.add(r.providerUserId);
        }
        return [...seen];
    }

    /** Record chat ids Telegram returned a 403 (blocked/deactivated) for. */
    private async markTelegramBlocked(chatIds: string[]): Promise<void> {
        await this.authIdentityRepo.update(
            { provider: 'telegram', providerUserId: In(chatIds) },
            { telegramBlockedAt: new Date() },
        );
    }

    // ── Image helpers ───────────────────────────────────────────────────────────

    /** Validate an uploaded filename exists and return its stored relative path. */
    resolveStoredImagePath(filename: string): string {
        if (!/^[a-zA-Z0-9._-]+$/.test(filename))
            throw new BadRequestException('Invalid image reference');
        const relative = `${BROADCAST_IMAGE_SUBDIR}/${filename}`;
        if (!existsSync(join(UPLOADS_ROOT, relative))) {
            throw new BadRequestException(
                'Uploaded image not found  please re-upload',
            );
        }
        return relative;
    }

    private async deleteImageFile(relativePath: string): Promise<void> {
        try {
            await unlink(join(UPLOADS_ROOT, relativePath));
        } catch {
            // best-effort cleanup
        }
    }

    // ── Time math (wall-clock in a fixed UTC offset → absolute UTC instant) ──────

    private computeOnceRunAt(localStr: string, offsetMinutes: number): Date {
        const [datePart, timePart] = localStr.split('T');
        const [y, mo, d] = datePart.split('-').map(Number);
        const [h, mi] = timePart.split(':').map(Number);
        // Wall time in the offset zone → subtract the offset to get the UTC instant.
        return new Date(Date.UTC(y, mo - 1, d, h, mi) - offsetMinutes * 60_000);
    }

    private computeNextRecurrence(
        rec: BroadcastRecurrence,
        offsetMinutes: number,
        from: Date,
    ): Date {
        const [h, mi] = rec.time.split(':').map(Number);
        // Shift "from" into the offset zone so UTC getters read local wall values.
        const local = new Date(from.getTime() + offsetMinutes * 60_000);
        const ly = local.getUTCFullYear();
        const lmo = local.getUTCMonth();
        const ld = local.getUTCDate();

        if (rec.frequency === 'weekly') {
            const targetDow = rec.dayOfWeek ?? 0;
            let daysAhead = (targetDow - local.getUTCDay() + 7) % 7;
            let ms =
                Date.UTC(ly, lmo, ld + daysAhead, h, mi) -
                offsetMinutes * 60_000;
            if (ms <= from.getTime()) {
                daysAhead += 7;
                ms =
                    Date.UTC(ly, lmo, ld + daysAhead, h, mi) -
                    offsetMinutes * 60_000;
            }
            return new Date(ms);
        }

        // daily
        let ms = Date.UTC(ly, lmo, ld, h, mi) - offsetMinutes * 60_000;
        if (ms <= from.getTime())
            ms = Date.UTC(ly, lmo, ld + 1, h, mi) - offsetMinutes * 60_000;
        return new Date(ms);
    }
}
