import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index, OneToMany } from 'typeorm';
import { AuthIdentity } from './auth-identity.entity';
import { Wallet } from '../../wallet/entities/wallet.entity';
import { AgentShift } from '../../agents/entities/agent-shift.entity';

export type UserRole = 'player' | 'admin' | 'agent' | 'system';
export type UserStatus = 'active' | 'suspended' | 'closed';

/**
 * MySQL returns DECIMAL as a string to avoid precision loss. Coordinates are
 * well inside double precision, so converting to a plain number on read keeps
 * the service side arithmetic-friendly. (Mirrors the Location entity.)
 */
const decimalTransformer = {
  to: (value: number | null | undefined) => value ?? null,
  from: (value: string | null) => (value === null || value === undefined ? null : Number(value)),
};

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
   * Agent (user id) who brought this customer — set EITHER by the agent's referral
   * code at signup (see `referralCode`), or by whoever processed the customer's
   * FIRST credited Telebirr deposit, whichever happens first. Never reassigned
   * once set (every writer guards on `IS NULL`), so a code used at signup beats a
   * later deposit handled by a different agent. Used for "customers brought" stats
   * and to highlight the customer's home room in the lobby. Null = unattributed.
   */
  @Column({ type: 'varchar', length: 36, nullable: true })
  @Index()
  referredByAgentId?: string | null;

  /**
   * An AGENT's own shareable referral code (players never have one). Handed out as
   * a `t.me/<bot>?start=ref_<code>` deep link; a player arriving through it gets
   * `referredByAgentId` set to this agent. Attribution only — it does not create a
   * payout path of its own (agent commission stays per-deposit and per-room).
   */
  @Column({ type: 'varchar', length: 16, nullable: true })
  @Index({ unique: true })
  referralCode?: string | null;

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

  /**
   * An AGENT's own shared GPS pin, captured via the agent bot's mandatory
   * location step. Deliberately INFORMATIONAL ONLY: it is shown to admins as a
   * hint for assigning areas, but it does NOT grant area access. Area visibility
   * is governed solely by admin-managed `agent_locations` rows — a Telegram pin is
   * client-supplied and trivially movable, so treating it as authorization would
   * let an agent read any area's customer data by dragging the map.
   */
  @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true, transformer: decimalTransformer })
  sharedLatitude?: number | null;

  @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true, transformer: decimalTransformer })
  sharedLongitude?: number | null;

  @Column({ type: 'timestamp', nullable: true })
  sharedLocationAt?: Date | null;

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
