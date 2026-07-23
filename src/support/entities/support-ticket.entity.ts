import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Ticket category. Complaints, disputes and refund requests are not separate
 * subsystems — they are categories of the same ticket, sharing the threaded
 * messaging backbone. `live_chat` tickets persist a real-time support
 * conversation so history survives reload and offline agents can pick it up.
 */
export type SupportTicketCategory =
  | 'general'
  | 'complaint'
  | 'dispute'
  | 'refund'
  | 'live_chat';

export type SupportTicketStatus =
  | 'open'
  | 'pending_agent'
  | 'pending_user'
  | 'resolved'
  | 'closed';

export type SupportTicketPriority = 'low' | 'normal' | 'high' | 'urgent';

/**
 * How a ticket was closed out. For refund tickets, `refunded` means the wallet
 * was credited via the ledger and `refundLedgerEntryId` points at the entry.
 */
export type SupportResolutionType = 'resolved' | 'rejected' | 'refunded';

const bigintTransformer = {
  to: (value: number | null | undefined) => value ?? null,
  from: (value: string | null) => (value != null ? Number(value) : null),
};

@Entity({ name: 'support_tickets', engine: 'InnoDB ROW_FORMAT=DYNAMIC' })
@Index(['status', 'category'])
@Index(['assignedAgentId', 'status'])
@Index(['userId', 'status'])
export class SupportTicket {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Internal iGames user who opened the ticket. */
  @Column({ type: 'varchar', length: 36 })
  @Index()
  userId: string;

  @Column({
    type: 'enum',
    enum: ['general', 'complaint', 'dispute', 'refund', 'live_chat'],
    default: 'general',
  })
  @Index()
  category: SupportTicketCategory;

  @Column({ type: 'varchar', length: 200, charset: 'utf8mb4', collation: 'utf8mb4_unicode_ci' })
  subject: string;

  @Column({
    type: 'enum',
    enum: ['open', 'pending_agent', 'pending_user', 'resolved', 'closed'],
    default: 'open',
  })
  @Index()
  status: SupportTicketStatus;

  @Column({
    type: 'enum',
    enum: ['low', 'normal', 'high', 'urgent'],
    default: 'normal',
  })
  priority: SupportTicketPriority;

  /** Agent/admin currently handling the ticket, if claimed. */
  @Column({ type: 'varchar', length: 36, nullable: true })
  @Index()
  assignedAgentId: string | null;

  // --- Dispute / refund linkage -------------------------------------------
  // For disputes and refunds, a ticket can reference the transaction it is
  // about (a withdrawal, deposit, keno/bingo ticket, ...). Kept as a loose
  // (type, id) pair rather than FKs so support can reference any domain object.
  @Column({ type: 'varchar', length: 40, nullable: true })
  relatedType: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  relatedId: string | null;

  /** Amount the user is requesting back (refund tickets only), integer minor units. */
  @Column({ type: 'bigint', nullable: true, transformer: bigintTransformer })
  requestedAmountMinor: number | null;

  // --- Resolution ----------------------------------------------------------
  @Column({
    type: 'enum',
    enum: ['resolved', 'rejected', 'refunded'],
    nullable: true,
  })
  resolutionType: SupportResolutionType | null;

  @Column({ type: 'varchar', length: 500, nullable: true, charset: 'utf8mb4', collation: 'utf8mb4_unicode_ci' })
  resolutionNote: string | null;

  /** Ledger entry created when a refund was approved — the audit link to the money movement. */
  @Column({ type: 'varchar', length: 36, nullable: true })
  refundLedgerEntryId: string | null;

  /** Amount actually refunded (may differ from requested for a partial refund). */
  @Column({ type: 'bigint', nullable: true, transformer: bigintTransformer })
  refundedAmountMinor: number | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  decidedBy: string | null;

  @Column({ type: 'timestamp', nullable: true })
  decidedAt: Date | null;

  /** Timestamp of the most recent message, for inbox sorting. */
  @Column({ type: 'timestamp', nullable: true })
  @Index()
  lastMessageAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  closedAt: Date | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;
}
