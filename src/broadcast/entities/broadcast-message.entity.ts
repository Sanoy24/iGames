import {
    Column,
    CreateDateColumn,
    Entity,
    Index,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from 'typeorm';

export type BroadcastStatus =
    | 'draft'
    | 'scheduled'
    | 'sending'
    | 'sent'
    | 'failed'
    | 'cancelled';

export type BroadcastScheduleType = 'now' | 'once' | 'recurring';

export type BroadcastParseMode = 'none' | 'HTML' | 'MarkdownV2';

export type BroadcastButton = { text: string; url: string };

export type BroadcastRecurrence = {
    frequency: 'daily' | 'weekly';
    /** Local wall-clock time in HH:mm (interpreted with timezoneOffsetMinutes). */
    time: string;
    /** 0 = Sunday … 6 = Saturday. Only used for weekly. */
    dayOfWeek?: number;
};

/**
 * An admin-composed Telegram broadcast. One row is one message that is sent to
 * every Telegram-linked user  immediately, once at a scheduled time, or on a
 * repeating daily/weekly schedule. The `status` column doubles as an execution
 * guard so a scheduled row can only be claimed and dispatched once, even across
 * multiple app instances (see BroadcastScheduler).
 */
@Entity({ name: 'broadcast_messages' })
@Index(['status', 'nextRunAt'])
export class BroadcastMessage {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    /** Internal admin label  not shown to recipients. */
    @Column({
        type: 'varchar',
        length: 200,
        charset: 'utf8mb4',
        collation: 'utf8mb4_unicode_ci',
    })
    title: string;

    /**
     * Message body (or photo caption when an image is attached). Explicitly
     * utf8mb4 so 4-byte characters (emoji 💸🎉) survive  a plain utf8/utf8mb3
     * column silently replaces them with "?" at insert time, even though 3-byte
     * scripts like Amharic store fine.
     */
    @Column({
        type: 'text',
        nullable: true,
        charset: 'utf8mb4',
        collation: 'utf8mb4_unicode_ci',
    })
    text: string | null;

    /** Relative path under the served /uploads root, e.g. "broadcasts/ab12.jpg". */
    @Column({ type: 'varchar', length: 300, nullable: true })
    imagePath: string | null;

    /** Optional inline URL buttons rendered under the message. */
    @Column({ type: 'json', nullable: true })
    buttons: BroadcastButton[] | null;

    @Column({
        type: 'enum',
        enum: ['none', 'HTML', 'MarkdownV2'],
        default: 'HTML',
    })
    parseMode: BroadcastParseMode;

    /** Recipient segment. Only "all_telegram" for now, kept as a column for growth. */
    @Column({ type: 'varchar', length: 40, default: 'all_telegram' })
    audience: string;

    @Column({ type: 'enum', enum: ['now', 'once', 'recurring'] })
    scheduleType: BroadcastScheduleType;

    /** Structured recurrence config; only set when scheduleType = 'recurring'. */
    @Column({ type: 'json', nullable: true })
    recurrence: BroadcastRecurrence | null;

    /** Minutes east of UTC that all wall-clock times are interpreted in (Ethiopia = 180). */
    @Column({ type: 'int', default: 180 })
    timezoneOffsetMinutes: number;

    /** Absolute UTC instant the scheduler will next dispatch this row at. */
    @Column({ type: 'timestamp', nullable: true })
    nextRunAt: Date | null;

    @Column({
        type: 'enum',
        enum: ['draft', 'scheduled', 'sending', 'sent', 'failed', 'cancelled'],
        default: 'draft',
    })
    status: BroadcastStatus;

    // ── Delivery stats for the most recent run ──────────────────────────────────
    @Column({ type: 'int', default: 0 })
    totalRecipients: number;

    @Column({ type: 'int', default: 0 })
    sentCount: number;

    @Column({ type: 'int', default: 0 })
    failedCount: number;

    /** How many times this (recurring) broadcast has been dispatched. */
    @Column({ type: 'int', default: 0 })
    runCount: number;

    @Column({ type: 'timestamp', nullable: true })
    lastRunAt: Date | null;

    @Column({ type: 'text', nullable: true })
    lastError: string | null;

    @Column({ type: 'varchar', length: 36, nullable: true })
    createdBy: string | null;

    @CreateDateColumn({ type: 'timestamp' })
    createdAt: Date;

    @UpdateDateColumn({ type: 'timestamp' })
    updatedAt: Date;
}
