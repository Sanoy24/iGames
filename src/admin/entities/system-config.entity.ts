import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'system_configs', engine: 'InnoDB ROW_FORMAT=DYNAMIC' })
export class SystemConfig {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ type: 'varchar', length: 50, unique: true, default: 'global' })
    key: string;

    // Flat 1:1 wallet model  1 Birr deposited credits 1 ETB.
    @Column({ type: 'int', default: 1 })
    telebirrCreditMinorPerBirr: number;

    @Column({ type: 'int', default: 0 })
    welcomeBonusMinor: number;

    /** Master on/off switch for the welcome bonus, independent of the amount above
     * so an admin can disable it without losing the configured value. */
    @Column({ type: 'boolean', default: false })
    welcomeBonusEnabled: boolean;

    /**
     * Master on/off switch for deposit cashback: when a player's wallet drops to
     * EXACTLY 0 from placing a bet (never from a withdrawal or an admin
     * adjustment  see WalletService.maybeTriggerDepositCashback), they are
     * credited `depositCashbackPct`% of their most recent Telebirr/M-Pesa
     * deposit. A given deposit can trigger this at most once, ever, regardless
     * of how many times the balance later returns to 0.
     */
    @Column({ type: 'boolean', default: false })
    depositCashbackEnabled: boolean;

    /** Whole-number percentage (10 = 10%) of the player's latest deposit credited
     * back under depositCashbackEnabled. 0 = no cashback even if enabled. */
    @Column({ type: 'int', default: 0 })
    depositCashbackPct: number;

    /**
     * Internal user id of the Master Wallet  a dedicated system account (no
     * login, no Telegram/password identity, roles: []) that is NOT any individual
     * admin's personal account. Every admin's ETB top-up and transfer-to-agent
     * operates on THIS ONE wallet, so N admin accounts always share one true
     * balance instead of each having their own float. Auto-created the first time
     * it's needed (see AdminService.getOrCreateMasterWalletUserId)  never set
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

    /** Minimum balance a user's wallet must retain; withdrawals cannot drop below it. 0 = no floor. */
    @Column({ type: 'int', default: 0 })
    minWalletBalanceMinor: number;

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
     * Per-game referral-commission % defaults for the games introduced after
     * Bingo (which keeps using the scalar column above for backward
     * compatibility). Keys: 'keno' | 'crash' | 'pool' | 'werk'. A missing key
     * means 0%  no commission  for that game. Same override precedence as
     * Bingo: an agent's own `User.referralCommissionPctByGame` entry wins when set.
     */
    @Column({ type: 'json', nullable: true })
    referralCommissionPctByGame?: Partial<
        Record<'keno' | 'crash' | 'pool' | 'werk', number>
    > | null;

    /**
     * Minimum hours an agent must wait between their own self-service settlement
     * requests (see AgentsService.requestSettlement). 0 = no cooldown. Does not
     * apply to settlements an admin creates directly.
     */
    @Column({ type: 'int', default: 0 })
    agentSettlementCooldownHours: number;

    /**
     * Player-facing Leaderboard tab. When false, the tab stays in navigation but
     * shows a "Coming Soon" placeholder instead of data (see WalletService.getLeaderboard).
     * Default off until an admin verifies real-player win volume looks good enough
     * to show  the tab always excludes bot accounts once turned on.
     */
    @Column({ type: 'boolean', default: false })
    leaderboardEnabled: boolean;

    /**
     * Home page "Live Wins Ticker". When false, the ticker shows rotating platform
     * trust messages instead of win data (see WalletService.getRecentPlatformWins).
     * Default off for the same reason as leaderboardEnabled; always excludes bots
     * once turned on.
     */
    @Column({ type: 'boolean', default: false })
    recentWinsEnabled: boolean;

    /**
     * When true, a pending withdrawal is only visible/claimable by the requesting
     * player's OWN agent (COALESCE(referredByAgentId, assignedAgentId)); a player
     * with no agent attributed falls straight to the admin-only queue. Replaces
     * the previous shared-pool model (any agent could claim any pending row) with
     * per-agent routing. When false, NO agent sees or can claim any withdrawal
     * every request goes to admin only (WalletService.getAvailableWithdrawals /
     * .claimWithdrawal enforce this server-side, not just in the UI). Admin's own
     * withdrawal view/actions (WalletService.getAllWithdrawals and friends) are
     * unaffected either way  admin always sees and can act on everything.
     */
    @Column({ type: 'boolean', default: true })
    agentWithdrawalRoutingEnabled: boolean;

    @CreateDateColumn({ type: 'timestamp' })
    createdAt: Date;

    @UpdateDateColumn({ type: 'timestamp' })
    updatedAt: Date;
}
