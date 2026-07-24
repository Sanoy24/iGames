import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index, OneToMany } from 'typeorm';
import { AuthIdentity } from './auth-identity.entity';
import { Wallet } from '../../wallet/entities/wallet.entity';
import { AgentShift } from '../../agents/entities/agent-shift.entity';

export type UserRole = 'player' | 'admin' | 'agent' | 'system';
export type UserStatus = 'active' | 'suspended' | 'closed';

@Entity({ name: 'users', engine: 'InnoDB ROW_FORMAT=DYNAMIC' })
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

  /**
   * On-duty control for agents. `auto` follows the working window
   * (`workDaysOfWeek` + work hours, evaluated in Ethiopia time); `on`/`off` are
   * admin overrides that win over the schedule until cleared back to `auto`.
   * Only an effectively-on-duty agent is shown to players as the deposit
   * destination and may claim/complete withdrawals. Force-`on` is single-primary.
   */
  @Column({ type: 'varchar', length: 8, default: 'auto' })
  onDutyMode: 'auto' | 'on' | 'off';

  /** Days the agent works (0=Sun..6=Sat). Empty/absent = every day. */
  @Column({ type: 'json', nullable: true })
  workDaysOfWeek?: number[];

  /**
   * Agent (user id) who brought this customer — set to the agent who processed the
   * customer's FIRST credited Telebirr deposit. Used for "customers brought" stats
   * and to highlight the customer's home room in the lobby. Null = unattributed.
   */
  @Column({ type: 'varchar', length: 36, nullable: true })
  @Index()
  referredByAgentId?: string | null;

  /**
   * Where the player says they came from, picked during registration. This is the
   * durable attribution unit — an agent-level credit stays deposit-driven via
   * `referredByAgentId`, because a location can have many agents. Null means the
   * player picked "Other" (or has not answered yet) and counts for the house.
   */
  @Column({ type: 'varchar', length: 36, nullable: true })
  @Index()
  locationId?: string | null;

  /**
   * How `locationId` was obtained. `other` records a deliberate "Other" choice,
   * which is different from null-because-never-asked: only the latter should be
   * re-prompted.
   */
  @Column({ type: 'varchar', length: 20, nullable: true })
  locationSource?: 'telegram_geo' | 'self_selected' | 'other' | null;

  @Column({ type: 'timestamp', nullable: true })
  locationCapturedAt?: Date | null;

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
