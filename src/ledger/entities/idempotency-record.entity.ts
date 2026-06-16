import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index, ManyToOne } from 'typeorm';
import { User } from '../../users/entities/user.entity';

export type IdempotencyStatus = 'pending' | 'completed' | 'failed';

@Entity('idempotency_records')
@Index(['key', 'userId', 'action'], { unique: true })
export class IdempotencyRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  key: string;

  @Column({ type: 'varchar', length: 36 })
  @Index()
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  user: User;

  @Column({ type: 'varchar', length: 255 })
  action: string;

  @Column({ type: 'varchar', length: 255 })
  requestHash: string;

  @Column({ type: 'enum', enum: ['pending', 'completed', 'failed'], default: 'pending' })
  status: IdempotencyStatus;

  @Column({ type: 'json', nullable: true })
  response?: Record<string, unknown>;

  @Column({ type: 'timestamp' })
  expiresAt: Date;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;
}
