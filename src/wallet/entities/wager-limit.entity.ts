import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, OneToOne, JoinColumn } from 'typeorm';
import { User } from '../../users/entities/user.entity';

const bigintTransformer = {
  to: (value: number | null) => value,
  from: (value: string | null) => value ? Number(value) : 0
};

@Entity({ name: 'wager_limits', engine: 'InnoDB ROW_FORMAT=DYNAMIC' })
export class WagerLimit {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 36, unique: true })
  userId: string;

  @OneToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ type: 'bigint', default: 0, transformer: bigintTransformer })
  dailyLimitMinor: number;

  @Column({ type: 'bigint', default: 0, transformer: bigintTransformer })
  weeklyLimitMinor: number;

  @Column({ type: 'bigint', default: 0, transformer: bigintTransformer })
  currentDailyWagerMinor: number;

  @Column({ type: 'bigint', default: 0, transformer: bigintTransformer })
  currentWeeklyWagerMinor: number;

  @Column({ type: 'timestamp' })
  dailyResetAt: Date;

  @Column({ type: 'timestamp' })
  weeklyResetAt: Date;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;
}
