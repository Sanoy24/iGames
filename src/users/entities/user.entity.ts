import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    Index,
    OneToMany,
} from 'typeorm';
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
    from: (value: string | null) =>
        value === null || value === undefined ? null : Number(value),
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

    @Column({
        type: 'enum',
        enum: ['active', 'suspended', 'closed'],
        default: 'active',
    })
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
     * Agent (user id) who brought this customer  set EITHER by the agent's referral
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
     * `referredByAgentId` set to this agent, which drives referral-commission payouts
     * (see `referralCommissionPct` below and `BingoService.settleReferralCommission`).
     */
    @Column({ type: 'varchar', length: 16, nullable: true })
    @Index({ unique: true })
    referralCode?: string | null;

    /**
     * How many times this agent's referral link (`t.me/<bot>?start=ref_<code>`)
     * has been opened  every `/start` with this code increments it, regardless
     * of whether the visitor already has an account or attribution succeeds.
     * Not deduped (see UsersService.recordReferralLinkClick).
     */
    @Column({ type: 'int', default: 0 })
    referralClickCount: number;

    /**
     * AGENT-specific override of the global `SystemConfig.referralCommissionPct`
     * the % of a referred player's Bingo GGR this agent earns. Null = no override,
     * use the global default; this doubles as the enable/disable toggle from the
     * admin UI (clearing it disables the override, it does not zero the commission).
     */
    @Column({ type: 'int', nullable: true })
    referralCommissionPct?: number | null;

    /**
     * AGENT-specific per-game overrides of `SystemConfig.referralCommissionPctByGame`,
     * for the games introduced after Bingo (which keeps using the scalar
     * `referralCommissionPct` above). A missing key = no override for that game,
     * falls back to the global default for that game.
     */
    @Column({ type: 'json', nullable: true })
    referralCommissionPctByGame?: Partial<
        Record<'keno' | 'crash' | 'pool' | 'werk', number>
    > | null;

    /**
     * AGENT-specific PERSISTENT label for their auto-managed Bingo room (per-agent
     * room mode  see BingoService.ensureAgentRooms). Null = no override, the
     * room falls back to the default "<displayName> · Bingo" name. Unlike a
     * room rename (BingoService.updateRoomDisplay, cosmetic and per-instance),
     * this is read fresh every time ensureAgentRooms creates that agent's NEXT
     * room, so a custom label survives the room auto-recreating after it
     * completes  a per-instance rename does not. Managed centrally from the
     * admin Bingo tab's "Room Slots" panel (BingoService.listRoomSlots /
     * updateRoomSlot), not from the Agents tab.
     */
    @Column({ type: 'varchar', length: 255, nullable: true })
    bingoRoomLabel?: string | null;

    /** PERSISTENT lobby card palette for this agent's room slot. Null = random each recreation. See bingoRoomLabel above. */
    @Column({ type: 'varchar', length: 20, nullable: true })
    bingoRoomCardPaletteId?: string | null;

    /** PERSISTENT decorative ball number for this agent's room slot. Null = random each recreation. See bingoRoomLabel above. */
    @Column({ type: 'int', nullable: true })
    bingoRoomCardBallNumber?: number | null;

    /** PERSISTENT ticket price for this agent's room slot. Null = use BingoConfig.defaultTicketPriceMinor each recreation. See bingoRoomLabel above. */
    @Column({ type: 'int', nullable: true })
    bingoRoomTicketPriceMinor?: number | null;

    /**
     * Where the player says they came from, picked during registration. This is the
     * durable attribution unit  an agent-level credit stays deposit-driven via
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
     * PLAYER attribution: the on-duty AGENT this player was matched/assigned to,
     * either automatically (nearest on-duty agent to a shared GPS pin, via
     * `UsersService.matchAgentFromCoords`) or manually picked from the on-duty
     * list. This is the current routing signal for "which agent handles this
     * player," replacing the `locationId` catalog step above for new onboarding
     * (that field is kept for backward compat but no longer written to). Distinct
     * from `referredByAgentId`, which is deposit/referral-code commission
     * attribution and is never reassigned once set  `assignedAgentId` IS
     * reassignable, since re-sharing location rematches to whichever on-duty
     * agent is nearest now.
     */
    @Column({ type: 'varchar', length: 36, nullable: true })
    @Index()
    assignedAgentId?: string | null;

    /** How `assignedAgentId` was obtained. `other` records a deliberate skip. */
    @Column({ type: 'varchar', length: 20, nullable: true })
    assignedAgentSource?: 'gps_match' | 'manual_pick' | 'other' | null;

    @Column({ type: 'timestamp', nullable: true })
    assignedAgentAt?: Date | null;

    /**
     * An AGENT's own shared GPS pin, captured via the agent bot's mandatory
     * location step (refreshable on demand via the agent bot's /updatelocation
     * command). This is now the live signal `matchAgentFromCoords` matches
     * players against, but it remains client-supplied and trivially movable, so
     * it must never be treated as authorization on its own  area/customer-data
     * visibility for an agent is governed by `assignedAgentId` equality, not by
     * proximity of this pin to anything.
     */
    @Column({
        type: 'decimal',
        precision: 10,
        scale: 7,
        nullable: true,
        transformer: decimalTransformer,
    })
    sharedLatitude?: number | null;

    @Column({
        type: 'decimal',
        precision: 10,
        scale: 7,
        nullable: true,
        transformer: decimalTransformer,
    })
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
