import {
    Column,
    CreateDateColumn,
    Entity,
    Index,
    PrimaryGeneratedColumn,
} from 'typeorm';

export type NotificationType =
    | 'win'
    | 'deposit'
    | 'withdrawal'
    | 'adjustment'
    | 'bonus'
    | 'system';

/**
 * A durable, per-user notification (the bell). Unlike transient toasts, these
 * survive reload and are delivered on next open even if the user was offline
 * when the event happened  which is exactly why money events (withdrawal
 * approved/rejected, deposit credited) live here. `readAt = null` means unread.
 */
@Entity({ name: 'notifications' })
@Index(['userId', 'createdAt'])
@Index(['userId', 'readAt'])
export class Notification {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ type: 'varchar', length: 36 })
    @Index()
    userId: string;

    @Column({
        type: 'enum',
        enum: ['win', 'deposit', 'withdrawal', 'adjustment', 'bonus', 'system'],
    })
    type: NotificationType;

    @Column({
        type: 'varchar',
        length: 160,
        charset: 'utf8mb4',
        collation: 'utf8mb4_unicode_ci',
    })
    title: string;

    @Column({
        type: 'varchar',
        length: 500,
        charset: 'utf8mb4',
        collation: 'utf8mb4_unicode_ci',
    })
    body: string;

    /** Optional structured payload for deep-linking (amountMinor, withdrawalId, …). */
    @Column({ type: 'json', nullable: true })
    data: Record<string, unknown> | null;

    @Column({ type: 'timestamp', nullable: true })
    readAt: Date | null;

    @CreateDateColumn({ type: 'timestamp' })
    createdAt: Date;
}
