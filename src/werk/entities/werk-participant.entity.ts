import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export type WerkParticipantStatus = 'joined' | 'playing' | 'settled' | 'refunded';

/** Reference to the ledger entry produced by a wallet mutation. */
export type WalletRef = { ledgerEntryId: string } | null;

/**
 * One real player's participation in a shared WerkRound. The stake is debited on
 * join and the prize credited (or stake refunded) on settle. A user can hold at
 * most one participant row per round (UNIQUE roundId+userId). The count of a
 * user's `settled` participants is their Werk games-played tally, which drives the
 * onboarding win sequence.
 */
@Entity({ name: 'werk_participants', engine: 'InnoDB ROW_FORMAT=DYNAMIC' })
@Index(['roundId', 'userId'], { unique: true })
@Index(['userId', 'status'])
export class WerkParticipant {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 36 })
  @Index()
  roundId: string;

  @Column({ type: 'varchar', length: 36 })
  @Index()
  userId: string;

  @Column({ type: 'int' })
  stakeMinor: number;

  /** Seat/spawn index within the round (0-based). */
  @Column({ type: 'int', default: 0 })
  seatIndex: number;

  @Column({ type: 'enum', enum: ['joined', 'playing', 'settled', 'refunded'], default: 'joined' })
  status: WerkParticipantStatus;

  // ── Settlement ───────────────────────────────────────────────────────────────
  /** Total coin value this player collected (authoritative, from the server loop). */
  @Column({ type: 'int', default: 0 })
  coinValue: number;

  /** Mode B: whether they reached the center (else eliminated). */
  @Column({ type: 'boolean', default: false })
  reachedCenter: boolean;

  @Column({ type: 'int', nullable: true })
  rank: number | null;

  @Column({ type: 'int', nullable: true })
  tieCount: number | null;

  @Column({ type: 'boolean', default: false })
  eliminated: boolean;

  @Column({ type: 'int', default: 0 })
  prizeMinor: number;

  @Column({ type: 'json', nullable: true })
  walletDebit: WalletRef;

  @Column({ type: 'json', nullable: true })
  walletCredit: WalletRef;

  @Column({ type: 'json', nullable: true })
  resultJson: Record<string, unknown> | null;

  @Column({ type: 'timestamp', nullable: true })
  settledAt: Date | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;
}
