import {
    Column,
    CreateDateColumn,
    Entity,
    Index,
    ManyToOne,
    JoinColumn,
    PrimaryGeneratedColumn,
} from 'typeorm';
import { SupportTicket } from './support-ticket.entity';

export type SupportMessageAuthorRole = 'user' | 'agent' | 'system';

/** A message may also be a tagged request the agent must act on. */
export type SupportRequestType = 'complaint' | 'dispute' | 'refund';
export type SupportRequestStatus = 'pending' | 'approved' | 'rejected';

const bigintTransformer = {
    to: (value: number | null | undefined) => value ?? null,
    from: (value: string | null) => (value != null ? Number(value) : null),
};

/**
 * A single message in the user's support conversation. `internal` messages are
 * agent-only notes never returned to the user. `system` messages record lifecycle
 * events (request approved/rejected) in the thread. A message can ALSO carry a
 * tagged request (refund/dispute/complaint) that an agent resolves in place
 * this is how a single per-user chat supports many distinct requests over time.
 */
@Entity({ name: 'support_messages', engine: 'InnoDB ROW_FORMAT=DYNAMIC' })
@Index(['ticketId', 'createdAt'])
export class SupportMessage {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ type: 'varchar', length: 36 })
    @Index()
    ticketId: string;

    @ManyToOne(() => SupportTicket, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'ticketId' })
    ticket: SupportTicket;

    /** Author user id. Null for `system` messages. */
    @Column({ type: 'varchar', length: 36, nullable: true })
    authorId: string | null;

    @Column({ type: 'enum', enum: ['user', 'agent', 'system'] })
    authorRole: SupportMessageAuthorRole;

    @Column({
        type: 'varchar',
        length: 2000,
        charset: 'utf8mb4',
        collation: 'utf8mb4_unicode_ci',
    })
    body: string;

    /** Optional structured attachments (file url/name/mime), never trusted for auth. */
    @Column({ type: 'json', nullable: true })
    attachments: Record<string, unknown>[] | null;

    /** Agent-only internal note  excluded from all player-facing responses. */
    @Column({ type: 'boolean', default: false })
    internal: boolean;

    // ── Tagged request (null for a plain chat message) ──────────────────────
    @Column({
        type: 'enum',
        enum: ['complaint', 'dispute', 'refund'],
        nullable: true,
    })
    @Index()
    requestType: SupportRequestType | null;

    @Column({
        type: 'enum',
        enum: ['pending', 'approved', 'rejected'],
        nullable: true,
    })
    requestStatus: SupportRequestStatus | null;

    /** Amount the user is requesting back (refund requests), integer minor units. */
    @Column({ type: 'bigint', nullable: true, transformer: bigintTransformer })
    requestedAmountMinor: number | null;

    /** Optional transaction the request references (dispute/refund). */
    @Column({ type: 'varchar', length: 40, nullable: true })
    relatedType: string | null;

    @Column({ type: 'varchar', length: 64, nullable: true })
    relatedId: string | null;

    // ── Resolution (set when an agent acts on the request) ──────────────────
    @Column({ type: 'varchar', length: 36, nullable: true })
    refundLedgerEntryId: string | null;

    @Column({ type: 'bigint', nullable: true, transformer: bigintTransformer })
    refundedAmountMinor: number | null;

    @Column({
        type: 'varchar',
        length: 500,
        nullable: true,
        charset: 'utf8mb4',
        collation: 'utf8mb4_unicode_ci',
    })
    resolutionNote: string | null;

    @Column({ type: 'varchar', length: 36, nullable: true })
    decidedBy: string | null;

    @Column({ type: 'timestamp', nullable: true })
    decidedAt: Date | null;

    @CreateDateColumn({ type: 'timestamp' })
    createdAt: Date;
}
