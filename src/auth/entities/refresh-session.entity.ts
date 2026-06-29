import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn, Index, ManyToOne } from 'typeorm';
import { User } from '../../users/entities/user.entity';

@Entity({ name: 'refresh_sessions', engine: 'InnoDB ROW_FORMAT=DYNAMIC' })
export class RefreshSession {
  @PrimaryColumn({ type: 'varchar', length: 255 })
  id: string;

  @Column({ type: 'varchar', length: 36 })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  user: User;

  @Column({ type: 'enum', enum: ['telegram', 'password'] })
  provider: 'telegram' | 'password';

  @Column({ type: 'varchar', length: 255 })
  refreshTokenHash: string;

  @Column({ type: 'timestamp' })
  expiresAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  revokedAt?: Date;

  @Column({ type: 'timestamp', nullable: true })
  lastUsedAt?: Date;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;
}
