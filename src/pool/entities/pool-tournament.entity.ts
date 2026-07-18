import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type PoolTournamentStatus = 'registering' | 'active' | 'completed' | 'cancelled';

/** A single-elimination 8-ball bracket. Prize pool accrues from entry fees. */
@Entity({ name: 'pool_tournaments', engine: 'InnoDB ROW_FORMAT=DYNAMIC' })
export class PoolTournament {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'enum', enum: ['registering', 'active', 'completed', 'cancelled'], default: 'registering' })
  @Index()
  status: PoolTournamentStatus;

  /** Bracket size (power of two). */
  @Column({ type: 'int' })
  size: number;

  /** Number of rounds = log2(size). */
  @Column({ type: 'int' })
  rounds: number;

  @Column({ type: 'int' })
  entryFeeMinor: number;

  @Column({ type: 'int' })
  rakePct: number;

  /** Accumulated entry fees (minor units). */
  @Column({ type: 'int', default: 0 })
  prizePoolMinor: number;

  @Column({ type: 'varchar', length: 36, nullable: true })
  winnerUserId: string | null;

  @Column({ type: 'timestamp', nullable: true })
  startedAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  completedAt: Date | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;
}
