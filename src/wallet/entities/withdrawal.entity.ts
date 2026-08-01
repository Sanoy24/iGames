import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index, ManyToOne } from 'typeorm';
import { User } from '../../users/entities/user.entity';

export type WithdrawalStatus = 'pending' | 'claimed' | 'processing' | 'completed' | 'rejected';

const bigintTransformer = {
  to: (value: number | null) => value,
  from: (value: string | null) => value ? Number(value) : 0
};

@Entity({ name: 'withdrawals', engine: 'InnoDB ROW_FORMAT=DYNAMIC' })
@Index(['agentId', 'status'])
export class Withdrawal {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 36 })
  @Index()
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  user: User;

  @Column({ type: 'bigint', transformer: bigintTransformer })
  amountMinor: number;

  @Column({
    type: 'enum',
    enum: ['pending', 'claimed', 'processing', 'completed', 'rejected'],
    default: 'pending',
  })
  @Index()
  status: WithdrawalStatus;

  @Column({ type: 'varchar', length: 255 })
  destinationAccount: string;

  @Column({ type: 'varchar', length: 36, nullable: true })
  @Index()
  agentId?: string;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  agent?: User;

  @Column({ type: 'timestamp', nullable: true })
  claimedAt?: Date;

  /** The flat withdrawal fee (from the matched WithdrawalFeeRange), 100% credited
   * to the processing agent — no platform split. */
  @Column({ type: 'bigint', default: 0, transformer: bigintTransformer })
  serviceChargeMinor: number;

  /** Net amount the user receives (gross − serviceChargeMinor). */
  @Column({ type: 'bigint', nullable: true, transformer: bigintTransformer })
  netAmountMinor?: number;

  /**
   * The verified payout reference — a Telebirr receipt number or an M-PESA
   * confirmation code — proving the agent actually paid the player. Kept as
   * `telebirrReference` for backward compatibility; `paymentProvider` says which
   * rail it belongs to.
   */
  @Column({ type: 'varchar', length: 255, nullable: true })
  @Index()
  telebirrReference?: string;

  /** Which rail the payout proof came from. Null on legacy/admin-approved rows. */
  @Column({ type: 'varchar', length: 10, nullable: true })
  paymentProvider?: 'telebirr' | 'mpesa' | null;

  /** Structured result of verifying the payout proof (amount/receiver/freshness). */
  @Column({ type: 'json', nullable: true })
  payoutVerification?: Record<string, unknown> | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  adminNotes?: string;

  @Column({ type: 'varchar', length: 36, nullable: true })
  processedBy?: string;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  processor?: User;

  @Column({ type: 'timestamp', nullable: true })
  processedAt?: Date;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;
}
