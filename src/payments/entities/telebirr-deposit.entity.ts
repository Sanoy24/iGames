import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index, ManyToOne } from 'typeorm';
import { User } from '../../users/entities/user.entity';

export type TelebirrDepositStatus = 'credited' | 'rejected';

const bigintTransformer = {
  to: (value: number | null) => value,
  from: (value: string | null) => value ? Number(value) : 0
};

@Entity({ name: 'telebirr_deposits', engine: 'InnoDB ROW_FORMAT=DYNAMIC' })
@Index(['userId', 'createdAt'])
export class TelebirrDeposit {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 36 })
  @Index()
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  user: User;

  @Column({ type: 'varchar', length: 36, nullable: true })
  @Index()
  agentId?: string;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  agent?: User;

  @Column({ type: 'varchar', length: 255, unique: true })
  receiptNo: string;

  @Column({ type: 'bigint', transformer: bigintTransformer })
  amountMinor: number;

  @Column({ type: 'varchar', length: 10, default: 'CREDIT' })
  currencyCode: string;

  @Column({ type: 'enum', enum: ['credited', 'rejected'] })
  status: TelebirrDepositStatus;

  @Column({ type: 'varchar', length: 255, nullable: true })
  payerName?: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  payerPhone?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  creditedPartyName?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  creditedPartyAccount?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  transactionStatus?: string;

  @Column({ type: 'json' })
  parsedReceipt: any;

  @Column({ type: 'json', nullable: true })
  verification?: Record<string, unknown>;

  @Column({ type: 'json', nullable: true })
  walletCredit?: Record<string, unknown>;

  /** Which wallet actually funded the player credit (only set when status is 'credited'). */
  @Column({ type: 'enum', enum: ['agent_wallet', 'master_wallet'], nullable: true })
  fundedBy?: 'agent_wallet' | 'master_wallet';

  /** Why it fell back to the Master Wallet instead of the agent's own wallet, if it did. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  fundingFallbackReason?: string | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;
}
