import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity({ name: 'system_configs', engine: 'InnoDB ROW_FORMAT=DYNAMIC' })
export class SystemConfig {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 50, unique: true, default: 'global' })
  key: string;

  // Flat 1:1 wallet model — 1 Birr deposited credits 1 ETB.
  @Column({ type: 'int', default: 1 })
  telebirrCreditMinorPerBirr: number;

  @Column({ type: 'int', default: 0 })
  welcomeBonusMinor: number;

  /** Service fee % of a withdrawal that goes to the platform super-admin. */
  @Column({ type: 'int', default: 0 })
  withdrawalServiceChargePct: number;

  /** Commission % of a withdrawal earned by the agent who processed it. */
  @Column({ type: 'int', default: 0 })
  withdrawalCommissionPct: number;

  /**
   * User id of the designated super-admin whose wallet receives withdrawal
   * service fees. Null = fees are only tracked in platform_stats (no wallet credit).
   */
  @Column({ type: 'varchar', length: 36, nullable: true })
  superAdminUserId?: string | null;

  /** Minimum a single Telebirr deposit must be to be accepted. 0 = no minimum. */
  @Column({ type: 'int', default: 0 })
  minDepositMinor: number;

  @Column({ type: 'int', default: 0 })
  withdrawalMinAmountMinor: number;

  @Column({ type: 'int', default: 0 })
  withdrawalMaxAmountMinor: number;

  @Column({ type: 'int', default: 1 })
  maxPendingWithdrawalsPerUser: number;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;
}
