import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

export type RngGameType = 'keno' | 'bingo' | 'crash';

@Entity({ name: 'rng_audit_logs', engine: 'InnoDB ROW_FORMAT=DYNAMIC' })
@Index(['gameType', 'gameReference'])
@Index(['createdAt'])
export class RngAuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'enum', enum: ['keno', 'bingo', 'crash'] })
  @Index()
  gameType: RngGameType;

  @Column({ type: 'varchar', length: 255 })
  @Index()
  gameReference: string;

  @Column({ type: 'varchar', length: 255 })
  algorithmVersion: string;

  @Column({ type: 'varchar', length: 255 })
  inputHash: string;

  @Column({ type: 'varchar', length: 255 })
  randomnessMaterialHash: string;

  @Column({ type: 'json' })
  outputNumbers: number[];

  @Column({ type: 'int' })
  min: number;

  @Column({ type: 'int' })
  max: number;

  @Column({ type: 'int' })
  count: number;

  @Column({ type: 'json', nullable: true })
  metadata?: Record<string, unknown>;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;
}
