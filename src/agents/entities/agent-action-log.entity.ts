import { Column, CreateDateColumn, Entity, Index, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { User } from '../../users/entities/user.entity';

const bigintTransformer = {
  to: (value: number | null) => value,
  from: (value: string | null) => (value ? Number(value) : 0),
};

export type AgentActionType =
  | 'admin_transfer_to_agent'
  | 'agent_transfer_to_user'
  | 'withdrawal_claimed'
  | 'withdrawal_released'
  | 'withdrawal_rejected'
  | 'withdrawal_completed'
  | 'telebirr_deposit_receipt'
  | 'mpesa_deposit_receipt';

@Entity({ name: 'agent_action_logs', engine: 'InnoDB ROW_FORMAT=DYNAMIC' })
@Index(['agentId', 'createdAt'])
export class AgentActionLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 36 })
  @Index()
  agentId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  agent: User;

  @Column({ type: 'varchar', length: 36, nullable: true })
  @Index()
  userId?: string;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  user?: User;

  @Column({ type: 'varchar', length: 36, nullable: true })
  @Index()
  withdrawalId?: string;

  @Column({ type: 'varchar', length: 36, nullable: true })
  ledgerEntryId?: string;

  @Column({
    type: 'enum',
    enum: [
      'admin_transfer_to_agent',
      'agent_transfer_to_user',
      'withdrawal_claimed',
      'withdrawal_released',
      'withdrawal_rejected',
      'withdrawal_completed',
      'telebirr_deposit_receipt',
      'mpesa_deposit_receipt',
    ],
  })
  actionType: AgentActionType;

  @Column({ type: 'bigint', transformer: bigintTransformer, nullable: true })
  amountMinor?: number;

  @Column({ type: 'json', nullable: true })
  metadata?: Record<string, unknown>;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;
}
