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
   * Commission % of a credited DEPOSIT earned by the agent whose Telebirr/M-PESA
   * account received it. Credited to the agent's wallet in the same transaction as
   * the player credit. 0 = no deposit commission (deposits still attribute the
   * agent, just without a payout).
   */
  @Column({ type: 'int', default: 0 })
  depositCommissionPct: number;

  /**
   * User id of the designated super-admin whose wallet receives withdrawal
   * service fees. Null = fees are only tracked in platform_stats (no wallet credit).
   */
  @Column({ type: 'varchar', length: 36, nullable: true })
  superAdminUserId?: string | null;

  /**
   * Internal user id of the Master Wallet — a dedicated system account (no
   * login, no Telegram/password identity, roles: []) that is NOT any individual
   * admin's personal account. Every admin's ETB top-up and transfer-to-agent
   * operates on THIS ONE wallet, so N admin accounts always share one true
   * balance instead of each having their own float. Auto-created the first time
   * it's needed (see AdminService.getOrCreateMasterWalletUserId) — never set
   * from the admin config form.
   */
  @Column({ type: 'varchar', length: 36, nullable: true })
  masterWalletUserId?: string | null;

  /** Minimum a single Telebirr deposit must be to be accepted. 0 = no minimum. */
  @Column({ type: 'int', default: 0 })
  minDepositMinor: number;

  @Column({ type: 'int', default: 0 })
  withdrawalMinAmountMinor: number;

  @Column({ type: 'int', default: 0 })
  withdrawalMaxAmountMinor: number;

  @Column({ type: 'int', default: 1 })
  maxPendingWithdrawalsPerUser: number;

  /**
   * Per-agent Bingo rooms (Approach B). When true, each active agent owns a Bingo
   * room, customers pick a room from a lobby, and settlement/stats are credited to
   * the room's owner. When false, Bingo runs the original single shared-room model.
   * Toggled from the admin panel.
   */
  @Column({ type: 'boolean', default: false })
  agentRoomsEnabled: boolean;

  /**
   * % of a room's real-player GGR (staked − paid out, bots excluded) credited to
   * the room-owning agent when the game completes. 0 = no commission (stats only).
   */
  @Column({ type: 'int', default: 0 })
  agentRoomCommissionPct: number;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;
}
