import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index, ManyToOne } from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { TenantOwnedEntity } from '../../common/tenant/tenant-owned.entity';

export type WithdrawalStatus = 'pending' | 'claimed' | 'processing' | 'completed' | 'rejected';

const bigintTransformer = {
  to: (value: number | null) => value,
  from: (value: string | null) => value ? Number(value) : 0
};

@Entity({ name: 'withdrawals', engine: 'InnoDB ROW_FORMAT=DYNAMIC' })
@Index(['agentId', 'status'])
export class Withdrawal extends TenantOwnedEntity {
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

  @Column({ type: 'bigint', default: 0, transformer: bigintTransformer })
  serviceChargeMinor: number;

  @Column({ type: 'bigint', nullable: true, transformer: bigintTransformer })
  netAmountMinor?: number;

  @Column({ type: 'varchar', length: 255, nullable: true })
  telebirrReference?: string;

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
