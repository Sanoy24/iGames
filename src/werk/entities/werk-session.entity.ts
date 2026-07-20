import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import type { WerkWinningMode } from './werk-config.entity';

export type WerkSessionStatus = 'active' | 'settled' | 'aborted';

/** Reference to the ledger entry produced by a wallet mutation. */
export type WalletRef = { ledgerEntryId: string } | null;

/**
 * One playthrough of Werk Flega by a single human. Created (and its stake
 * debited) when the player starts a game; updated to `settled` (prize credited)
 * when the client reports the final standings, or `aborted` (stake refunded) if
 * the player leaves before the clock ends.
 *
 * The maze + coin layout is fully determined by `seed` (drawn by the RNG service,
 * `seedAuditLogId` links the audit row), so the round is reproducible from the
 * audit trail. `resultJson` snapshots the reported outcome for evidence.
 */
@Entity({ name: 'werk_sessions', engine: 'InnoDB ROW_FORMAT=DYNAMIC' })
@Index(['userId', 'status'])
@Index(['createdAt'])
export class WerkSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 36 })
  @Index()
  userId: string;

  @Column({ type: 'enum', enum: ['active', 'settled', 'aborted'], default: 'active' })
  status: WerkSessionStatus;

  // ── Round parameters (snapshotted from config at start) ──────────────────────
  @Column({ type: 'int' })
  stakeMinor: number;

  @Column({ type: 'enum', enum: ['A', 'B'] })
  mode: WerkWinningMode;

  @Column({ type: 'int' })
  durationSec: number;

  @Column({ type: 'int' })
  totalPlayers: number;

  @Column({ type: 'int' })
  botCount: number;

  // ── RNG evidence ─────────────────────────────────────────────────────────────
  /** Deterministic layout seed drawn by the RNG service. */
  @Column({ type: 'bigint' })
  seed: number;

  @Column({ type: 'varchar', length: 36, nullable: true })
  seedAuditLogId: string | null;

  // ── Settlement ───────────────────────────────────────────────────────────────
  /** Human's final rank (1 = best). null until settled. */
  @Column({ type: 'int', nullable: true })
  humanRank: number | null;

  /** Number of finishers tied at the human's rank (>=1), for prize splitting. */
  @Column({ type: 'int', nullable: true })
  tieCount: number | null;

  /** Mode B: true if the human failed to reach the center and was eliminated. */
  @Column({ type: 'boolean', default: false })
  humanEliminated: boolean;

  /** Total coin value the human collected (evidence only). */
  @Column({ type: 'int', default: 0 })
  coinValue: number;

  @Column({ type: 'int', default: 0 })
  prizeMinor: number;

  @Column({ type: 'json', nullable: true })
  walletDebit: WalletRef;

  @Column({ type: 'json', nullable: true })
  walletCredit: WalletRef;

  /** Snapshot of the reported standings and stats for audit. */
  @Column({ type: 'json', nullable: true })
  resultJson: Record<string, unknown> | null;

  @Column({ type: 'timestamp', nullable: true })
  settledAt: Date | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;
}
