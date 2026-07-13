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

/**
 * A single message in a ticket thread. `internal` messages are agent-only notes
 * that must never be returned to the ticket owner. `system` messages record
 * lifecycle events (assigned, status changed, refund approved) in the thread.
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

  @Column({ type: 'varchar', length: 2000, charset: 'utf8mb4', collation: 'utf8mb4_unicode_ci' })
  body: string;

  /** Optional structured attachments (file url/name/mime), never trusted for auth. */
  @Column({ type: 'json', nullable: true })
  attachments: Record<string, unknown>[] | null;

  /** Agent-only internal note — excluded from all player-facing responses. */
  @Column({ type: 'boolean', default: false })
  internal: boolean;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;
}
