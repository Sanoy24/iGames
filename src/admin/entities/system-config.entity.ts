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
   * Global default % of a referred player's Bingo GGR credited to the referring
   * agent (see User.referredByAgentId), independent of room ownership. An
   * agent's own `User.referralCommissionPct` overrides this when set. 0 = no
   * referral commission paid unless an agent has an explicit override.
   */
  @Column({ type: 'int', default: 0 })
  referralCommissionPct: number;

  /**
   * Minimum hours an agent must wait between their own self-service settlement
   * requests (see AgentsService.requestSettlement). 0 = no cooldown. Does not
   * apply to settlements an admin creates directly.
   */
  @Column({ type: 'int', default: 0 })
  agentSettlementCooldownHours: number;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;
}
