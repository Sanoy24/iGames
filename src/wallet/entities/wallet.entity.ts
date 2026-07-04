import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index, ManyToOne } from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { TenantOwnedEntity } from '../../common/tenant/tenant-owned.entity';

export type WalletStatus = 'active' | 'locked' | 'closed';

const bigintTransformer = {
  to: (value: number | null) => value,
  from: (value: string | null) => value ? Number(value) : 0
};

@Entity({ name: 'wallets', engine: 'InnoDB ROW_FORMAT=DYNAMIC' })
// userId already implies the operator (a user belongs to exactly one operator),
// so this unique constraint is inherently per-operator. operatorId is carried as
// a denormalized column (from TenantOwnedEntity) for efficient tenant-scoped reads.
@Index(['userId', 'currencyCode'], { unique: true })
export class Wallet extends TenantOwnedEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 36 })
  userId: string;

  @ManyToOne(() => User, (user) => user.wallets, { onDelete: 'CASCADE' })
  user: User;

  @Column({ type: 'varchar', length: 10, default: 'CREDIT' })
  currencyCode: string;

  @Column({ type: 'bigint', default: 0, transformer: bigintTransformer })
  availableMinor: number;

  @Column({ type: 'bigint', default: 0, transformer: bigintTransformer })
  reservedMinor: number;

  @Column({ type: 'enum', enum: ['active', 'locked', 'closed'], default: 'active' })
  status: WalletStatus;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;
}
