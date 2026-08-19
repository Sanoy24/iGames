import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index, ManyToOne } from 'typeorm';
import { User } from './user.entity';

export type AuthProvider = 'telegram' | 'password';

@Entity({ name: 'auth_identities', engine: 'InnoDB ROW_FORMAT=DYNAMIC' })
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

  /**
   * Set when Telegram tells us delivery is permanently impossible (bot blocked,
   * account deactivated, etc — HTTP 403). Broadcasts exclude these recipients so
   * a dead chat isn't retried on every scheduled run forever; cleared again if
   * the user ever re-authenticates (proving the chat is live again).
   */
  @Column({ type: 'timestamp', nullable: true })
  telegramBlockedAt?: Date | null;

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
