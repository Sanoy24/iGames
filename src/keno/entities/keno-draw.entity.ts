import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index, ManyToOne } from 'typeorm';
import { KenoConfig } from './keno-config.entity';
import { TenantOwnedEntity } from '../../common/tenant/tenant-owned.entity';

export type KenoDrawStatus = 'open' | 'locked' | 'drawn' | 'settled' | 'cancelled';

@Entity({ name: 'keno_draws', engine: 'InnoDB ROW_FORMAT=DYNAMIC' })
@Index(['status', 'scheduledAt'])
export class KenoDraw extends TenantOwnedEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 36 })
  @Index()
  configId: string;

  @ManyToOne(() => KenoConfig, { onDelete: 'RESTRICT' })
  config: KenoConfig;

  @Column({ type: 'int' })
  configVersion: number;

  @Column({
    type: 'enum',
    enum: ['open', 'locked', 'drawn', 'settled', 'cancelled'],
    default: 'open',
  })
  @Index()
  status: KenoDrawStatus;

  @Column({ type: 'timestamp' })
  @Index()
  scheduledAt: Date;

  @Column({ type: 'json' })
  drawnNumbers: number[];

  @Column({ type: 'varchar', length: 255, nullable: true })
  rngAuditLogId?: string;

  @Column({ type: 'timestamp', nullable: true })
  executedAt?: Date;

  @Column({ type: 'timestamp', nullable: true })
  settledAt?: Date;

  @Column({ type: 'json', nullable: true })
  settlementSummary?: Record<string, unknown>;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;
}
