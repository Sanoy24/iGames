import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index, ManyToOne } from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { CrashRound } from './crash-round.entity';

export type CrashBetStatus = 'active' | 'won' | 'lost';

const bigintTransformer = {
  to: (value: number | null) => value,
  from: (value: string | null) => (value ? Number(value) : 0),
};

@Entity('crash_bets')
@Index(['userId', 'createdAt'])
@Index(['roundId', 'status'])
@Index(['userId', 'roundId'], { unique: true })
export class CrashBet {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 36 })
  @Index()
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  user: User;

  @Column({ type: 'varchar', length: 36 })
  @Index()
  roundId: string;

  @ManyToOne(() => CrashRound, { onDelete: 'RESTRICT' })
  round: CrashRound;

  @Column({ type: 'int' })
  stakeMinor: number;

  // Null = manual cashout only; set = auto-cashout triggers at this multiplier × 100
  @Column({ type: 'int', nullable: true })
  autoCashoutX100: number | null;

  // Multiplier at which player cashed out (× 100), null if lost
  @Column({ type: 'int', nullable: true })
  cashedOutAtX100: number | null;

  @Column({ type: 'bigint', default: 0, transformer: bigintTransformer })
  payoutMinor: number;

  @Column({ type: 'enum', enum: ['active', 'won', 'lost'], default: 'active' })
  @Index()
  status: CrashBetStatus;

  @Column({ type: 'varchar', length: 255 })
  @Index()
  idempotencyKey: string;

  @Column({ type: 'json', nullable: true })
  walletDebit: Record<string, unknown> | null;

  @Column({ type: 'json', nullable: true })
  walletCredit: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;
}
