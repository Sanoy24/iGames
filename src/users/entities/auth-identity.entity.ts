import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index, ManyToOne } from 'typeorm';
import { User } from './user.entity';

export type AuthProvider = 'telegram' | 'password';

@Entity('auth_identities')
@Index(['provider', 'providerUserId'], { unique: true })
export class AuthIdentity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 36 })
  userId: string;

  @ManyToOne(() => User, (user) => user.identities, { onDelete: 'CASCADE' })
  user: User;

  @Column({ type: 'enum', enum: ['telegram', 'password'] })
  provider: AuthProvider;

  @Column({ type: 'varchar', length: 255 })
  providerUserId: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  providerUsername?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  normalizedEmail?: string;

  @Column({ type: 'varchar', length: 255, select: false, nullable: true })
  passwordHash?: string;

  @Column({ type: 'json', nullable: true })
  profileSnapshot?: Record<string, unknown>;

  @Column({ type: 'timestamp' })
  linkedAt: Date;

  @Column({ type: 'timestamp' })
  lastAuthAt: Date;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;
}
