import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

export type CrashRoundStatus = 'waiting' | 'running' | 'crashed';

@Entity('crash_rounds')
@Index(['status', 'createdAt'])
export class CrashRound {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'enum', enum: ['waiting', 'running', 'crashed'], default: 'waiting' })
  @Index()
  status: CrashRoundStatus;

  // Crash point stored as integer × 100 for precision (e.g. 1.52× → 152, 10.00× → 1000)
  @Column({ type: 'int', nullable: true })
  crashPointX100: number | null;

  // Committed before round starts for provably-fair verification
  @Column({ type: 'varchar', length: 64 })
  seedHash: string;

  // Revealed only after round crashes
  @Column({ type: 'varchar', length: 64, nullable: true, select: false })
  seed: string | null;

  @Column({ type: 'timestamp', nullable: true })
  startedAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  crashedAt: Date | null;

  @Column({ type: 'int', nullable: true })
  elapsedMs: number | null;

  @Column({ type: 'json', nullable: true })
  settlementSummary: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;
}
