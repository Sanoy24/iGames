import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index, ManyToOne } from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Wallet } from '../../wallet/entities/wallet.entity';
import { TenantOwnedEntity } from '../../common/tenant/tenant-owned.entity';

export type LedgerDirection = 'debit' | 'credit';
export type LedgerEntryType =
  | 'stake'
  | 'win'
  | 'refund'
  | 'adjustment'
  | 'bonus'
  | 'deposit'
  | 'reversal'
  | 'withdrawal'
  | 'agent_receipt';

const bigintTransformer = {
  to: (value: number | null) => value,
  from: (value: string | null) => value ? Number(value) : 0
};

@Entity({ name: 'ledger_entries', engine: 'InnoDB ROW_FORMAT=DYNAMIC' })
@Index(['userId', 'createdAt'])
@Index(['sourceType', 'sourceId'])
// userId already implies the operator, so this is inherently per-operator.
@Index(['userId', 'sourceType', 'idempotencyKey'], { unique: true })
export class LedgerEntry extends TenantOwnedEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 36 })
  @Index()
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  user: User;

  @Column({ type: 'varchar', length: 36 })
  @Index()
  walletId: string;

  @ManyToOne(() => Wallet, { onDelete: 'CASCADE' })
  wallet: Wallet;

  @Column({ type: 'varchar', length: 10 })
  currencyCode: string;

  @Column({ type: 'bigint', transformer: bigintTransformer })
  amountMinor: number;

  @Column({ type: 'enum', enum: ['debit', 'credit'] })
  direction: LedgerDirection;

  @Column({
    type: 'enum',
    enum: ['stake', 'win', 'refund', 'adjustment', 'bonus', 'deposit', 'reversal', 'withdrawal', 'agent_receipt']
  })
  entryType: LedgerEntryType;

  @Column({ type: 'varchar', length: 255 })
  sourceType: string;

  @Column({ type: 'varchar', length: 255 })
  sourceId: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  idempotencyKey?: string;

  @Column({ type: 'bigint', transformer: bigintTransformer })
  balanceAfterMinor: number;

  @Column({ type: 'json', nullable: true })
  metadata?: Record<string, unknown>;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;
}
