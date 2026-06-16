import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index, OneToMany } from 'typeorm';
import { AuthIdentity } from './auth-identity.entity';
import { Wallet } from '../../wallet/entities/wallet.entity';
import { AgentShift } from '../../agents/entities/agent-shift.entity';

export type UserRole = 'player' | 'admin' | 'agent' | 'system';
export type UserStatus = 'active' | 'suspended' | 'closed';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  displayName: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  @Index({ unique: true })
  email?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  @Index({ unique: true })
  username?: string;

  @Column({ type: 'json' })
  roles: UserRole[];

  @Column({ type: 'enum', enum: ['active', 'suspended', 'closed'], default: 'active' })
  status: UserStatus;

  @Column({ type: 'varchar', length: 50, nullable: true })
  phoneNumber?: string;

  @Column({ type: 'timestamp', nullable: true })
  lastLoginAt?: Date;

  @Column({ type: 'json', nullable: true })
  responsibleGamingFlags?: Record<string, unknown>;

  @Column({ type: 'json', nullable: true })
  productMetadata?: Record<string, unknown>;

  @Column({ type: 'int', nullable: true })
  workStartHour?: number;

  @Column({ type: 'int', nullable: true })
  workStartMinute?: number;

  @Column({ type: 'int', nullable: true })
  workEndHour?: number;

  @Column({ type: 'int', nullable: true })
  workEndMinute?: number;

  @Column({ type: 'json', nullable: true })
  agentPermissions?: {
    deposit: boolean;
    withdraw: boolean;
  };

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;

  @OneToMany(() => AuthIdentity, (identity) => identity.user)
  identities: AuthIdentity[];

  @OneToMany(() => Wallet, (wallet) => wallet.user)
  wallets: Wallet[];

  @OneToMany(() => AgentShift, (shift) => shift.user)
  shifts: AgentShift[];
}
