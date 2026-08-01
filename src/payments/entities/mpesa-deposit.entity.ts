import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index, ManyToOne } from 'typeorm';
import { User } from '../../users/entities/user.entity';

export type MpesaDepositStatus = 'credited' | 'rejected';

const bigintTransformer = {
  to: (value: number | null) => value,
  from: (value: string | null) => (value ? Number(value) : 0),
};

/**
 * A player's M-PESA deposit. Mirrors TelebirrDeposit so the two providers stay
 * self-contained (admin reports union them). Dedupe is on `confirmationCode` —
 * the M-PESA transaction code from the SMS — which is the FT/reference the
 * feature brief calls for verifying.
 */
@Entity({ name: 'mpesa_deposits', engine: 'InnoDB ROW_FORMAT=DYNAMIC' })
@Index(['userId', 'createdAt'])
export class MpesaDeposit {
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

  /** The M-PESA confirmation/transaction code — unique, so a receipt can't be reused. */
  @Column({ type: 'varchar', length: 32, unique: true })
  confirmationCode: string;

  @Column({ type: 'bigint', transformer: bigintTransformer })
  amountMinor: number;

  @Column({ type: 'varchar', length: 10, default: 'CREDIT' })
  currencyCode: string;

  @Column({ type: 'enum', enum: ['credited', 'rejected'] })
  status: MpesaDepositStatus;

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

  /** The structured fields parsed out of the SMS (ParsedMpesaSms). */
  @Column({ type: 'json' })
  parsedSms: any;

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
