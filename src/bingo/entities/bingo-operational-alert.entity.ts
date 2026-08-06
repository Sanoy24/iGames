import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type BingoOperationalAlertKind = 'pattern_resolution_failed';

/**
 * DB-visible trail of operational failures in the Bingo draw/settlement path
 * that would otherwise only show up in server logs — same purpose as
 * CommissionSettlementError, generalized with a `kind` discriminator so more
 * failure classes can share this one table instead of each growing their own.
 * An admin without log access can query this (or the `/admin/bingo/alerts`
 * endpoint) to see what actually happened without needing a screen recording.
 */
@Entity({ name: 'bingo_operational_alerts', engine: 'InnoDB ROW_FORMAT=DYNAMIC' })
export class BingoOperationalAlert {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 64 })
  @Index()
  kind: BingoOperationalAlertKind;

  /** Null when the failure is config-level (not tied to one specific room). */
  @Column({ type: 'varchar', length: 36, nullable: true })
  @Index()
  roomId?: string | null;

  @Column({ type: 'text' })
  message: string;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;
}
