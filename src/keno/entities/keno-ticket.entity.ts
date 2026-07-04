import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index, ManyToOne } from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { KenoDraw } from './keno-draw.entity';
import { KenoConfig } from './keno-config.entity';
import { TenantOwnedEntity } from '../../common/tenant/tenant-owned.entity';

export type KenoTicketStatus = 'pending' | 'lost' | 'won' | 'cancelled';
export type KenoSettlementStatus = 'pending' | 'settled';

const bigintTransformer = {
  to: (value: number | null) => value,
  from: (value: string | null) => value ? Number(value) : 0
};

@Entity({ name: 'keno_tickets', engine: 'InnoDB ROW_FORMAT=DYNAMIC' })
@Index(['userId', 'createdAt'])
@Index(['drawId', 'settlementStatus'])
@Index(['userId', 'idempotencyKey'], { unique: true })
export class KenoTicket extends TenantOwnedEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 36 })
  @Index()
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  user: User;

  @Column({ type: 'varchar', length: 36 })
  @Index()
  drawId: string;

  @ManyToOne(() => KenoDraw, { onDelete: 'RESTRICT' })
  draw: KenoDraw;

  @Column({ type: 'varchar', length: 36 })
  configId: string;

  @ManyToOne(() => KenoConfig, { onDelete: 'RESTRICT' })
  config: KenoConfig;

  @Column({ type: 'int' })
  configVersion: number;

  @Column({ type: 'json' })
  selectedNumbers: number[];

  @Column({ type: 'int' })
  stakeMinor: number;

  @Column({ type: 'int', default: 0 })
  matches: number;

  @Column({ type: 'bigint', default: 0, transformer: bigintTransformer })
  payoutMinor: number;

  @Column({
    type: 'enum',
    enum: ['pending', 'lost', 'won', 'cancelled'],
    default: 'pending',
  })
  @Index()
  status: KenoTicketStatus;

  @Column({
    type: 'enum',
    enum: ['pending', 'settled'],
    default: 'pending',
  })
  @Index()
  settlementStatus: KenoSettlementStatus;

  @Column({ type: 'varchar', length: 255 })
  idempotencyKey: string;

  @Column({ type: 'boolean', default: false })
  isForcedWin?: boolean;

  @Column({ type: 'json', nullable: true })
  walletDebit?: Record<string, unknown>;

  @Column({ type: 'json', nullable: true })
  walletCredit?: Record<string, unknown>;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;
}
