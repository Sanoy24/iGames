import {
    Column,
    CreateDateColumn,
    Entity,
    PrimaryColumn,
    UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'bingo_config', engine: 'InnoDB ROW_FORMAT=DYNAMIC' })
export class BingoConfig {
    @PrimaryColumn({ type: 'varchar', length: 32 })
    key: string;

    @Column({ type: 'boolean', default: true })
    enabled: boolean;

    @Column({ type: 'int', default: 0 })
    autoRepeatIntervalMinutes: number;

    @Column({ type: 'int', default: 500 })
    defaultTicketPriceMinor: number;

    @Column({ type: 'int', default: 200 })
    defaultMaxTickets: number;

    /**
     * Maximum number of cartelas (tickets) a single user may buy in one bingo
     * room/game. 0 = unlimited. Enforced across all purchases in the room, not
     * just per transaction.
     */
    @Column({ type: 'int', default: 0 })
    maxCartelasPerUser: number;

    @Column({ type: 'int', default: 20000 })
    defaultOneLineMinor: number;

    @Column({ type: 'int', default: 50000 })
    defaultTwoLinesMinor: number;

    @Column({ type: 'int', default: 100000 })
    defaultFullHouseMinor: number;

    @Column({ type: 'int', default: 2 })
    drawIntervalSeconds: number;

    /** Seconds the buy/registration window stays open before a room starts drawing. */
    @Column({ type: 'int', default: 40 })
    salesWindowSeconds: number;

    /** Seconds before the scheduled draw when cartela buys/refunds are frozen. */
    @Column({ type: 'int', default: 3 })
    cartelaChangeLockSeconds: number;

    /** Seconds the completed-room result is shown before advancing to the next room. */
    @Column({ type: 'int', default: 10 })
    resultDisplaySeconds: number;

    /** Seconds the live Bonus Win popup is shown before it auto-dismisses. */
    @Column({ type: 'int', default: 5 })
    bonusWinDisplaySeconds: number;

    @Column({ type: 'varchar', length: 10, default: 'prefilled' })
    defaultWinMode: string;

    @Column({ type: 'int', default: 75 })
    defaultNumberRange: number;

    /** Number of cartela cards in the prefilled/derash grid (default 75, matching the ball pool). */
    @Column({ type: 'int', default: 75 })
    defaultGridSize: number;

    /**
     * How derash places are decided:
     * - `race`: each place is locked to the first cartela to complete that place's
     *   pattern, in order (the original behaviour).
     * - `leaderboard`: the round runs until a cartela completes the 1st-place
     *   pattern (or the pool is exhausted); ranks are then assigned by a live queue
     *   ordered by best pattern reached, ties by who reached it first. Patterns
     *   should be configured hardest (1st) → easiest (last) for this to be meaningful.
     */
    @Column({ type: 'varchar', length: 12, default: 'race' })
    prefilledRankingMode: 'race' | 'leaderboard';

    /** % of prize pool awarded to 1st place in prefilled mode. */
    @Column({ type: 'int', default: 80 })
    prefilledFirstPlacePct: number;

    /** Enable 2nd place prize in prefilled mode. */
    @Column({ type: 'boolean', default: false })
    prefilledSecondPlaceEnabled: boolean;

    /** % of prize pool awarded to 2nd place (only when enabled). */
    @Column({ type: 'int', default: 0 })
    prefilledSecondPlacePct: number;

    /** Enable 3rd place prize in prefilled mode. */
    @Column({ type: 'boolean', default: false })
    prefilledThirdPlaceEnabled: boolean;

    /** % of prize pool awarded to 3rd place (only when enabled). */
    @Column({ type: 'int', default: 0 })
    prefilledThirdPlacePct: number;

    /** Enable 4th place prize in prefilled mode. */
    @Column({ type: 'boolean', default: false })
    prefilledFourthPlaceEnabled: boolean;

    /** % of prize pool awarded to 4th place (only when enabled). */
    @Column({ type: 'int', default: 0 })
    prefilledFourthPlacePct: number;

    /** Enable 5th place prize in prefilled mode. */
    @Column({ type: 'boolean', default: false })
    prefilledFifthPlaceEnabled: boolean;

    /** % of prize pool awarded to 5th place (only when enabled). */
    @Column({ type: 'int', default: 0 })
    prefilledFifthPlacePct: number;

    /**
     * Winning pattern for prefilled/derash mode  the BingoPattern a cartela card
     * must complete to win a place. Null falls back to the built-in "Any Line".
     * Legacy field: used as the default pattern for any place whose own
     * per-place pattern is unset (and specifically the 1st-place default).
     */
    @Column({ type: 'varchar', length: 36, nullable: true })
    prefilledWinPatternId?: string | null;

    /**
     * Per-place winning patterns. Each place may require a DIFFERENT pattern to win
     * (e.g. 1st = Any Line, 2nd = Any Two Lines, 3rd = L Shape). Null on a place
     * falls back to `prefilledWinPatternId`, then to the built-in "Any Line".
     */
    @Column({ type: 'varchar', length: 36, nullable: true })
    prefilledFirstPatternId?: string | null;

    @Column({ type: 'varchar', length: 36, nullable: true })
    prefilledSecondPatternId?: string | null;

    @Column({ type: 'varchar', length: 36, nullable: true })
    prefilledThirdPatternId?: string | null;

    @Column({ type: 'varchar', length: 36, nullable: true })
    prefilledFourthPatternId?: string | null;

    @Column({ type: 'varchar', length: 36, nullable: true })
    prefilledFifthPatternId?: string | null;

    /** Minimum balls drawn before any prize tier can be settled (0 = immediate). */
    @Column({ type: 'int', default: 0 })
    minDrawsBeforeWin: number;

    /** Minimum tickets sold before draw can start (0 = no minimum). */
    @Column({ type: 'int', default: 0 })
    minTicketsToStart: number;

    /** House edge percentage shown in admin UI for reference (0–100). */
    @Column({ type: 'int', default: 20 })
    houseEdgePct: number;

    /** Every N bingo rooms a randomly chosen active bot receives a guaranteed win. 0 = disabled. */
    @Column({ type: 'int', default: 0 })
    globalBingoBotWinInterval: number;

    /** Enable or disable Bingo bot cartela allocation controls. */
    @Column({ type: 'boolean', default: true })
    botCartelaPolicyEnabled: boolean;

    /** How bot cartelas are assigned when the policy is enabled. */
    @Column({ type: 'varchar', length: 20, default: 'mirror' })
    botCartelaPolicyMode: 'mirror' | 'fixed_cap';

    /** Maximum cartelas a single bot may hold in a room. */
    @Column({ type: 'int', default: 5 })
    botMaxCartelasPerBotPerRoom: number;

    /**
     * Bot participation threshold below this many REAL (non-bot) players.
     * When enabled and the room drops below this count, bots join the room.
     */
    @Column({ type: 'boolean', default: true })
    botBelowThresholdEnabled: boolean;

    @Column({ type: 'int', default: 10 })
    botBelowThresholdRealPlayers: number;

    /**
     * Bot participation threshold above this many REAL (non-bot) players.
     * When enabled and the room rises above this count, bots join the room.
     */
    @Column({ type: 'boolean', default: true })
    botAboveThresholdEnabled: boolean;

    @Column({ type: 'int', default: 50 })
    botAboveThresholdRealPlayers: number;

    /**
     * Legacy Bingo bot threshold retained for backward compatibility. New logic
     * prefers the explicit below/above threshold controls above.
     */
    @Column({ type: 'int', default: 10 })
    botMaxRealPlayers: number;

    /**
     * How bots influence a below-threshold room:
     *  - `off`          bots just fill the room; fully fair draw, no win steering.
     *  - `statistical`  bots buy most free cartelas so a bot wins the majority of
     *                    rounds on a genuinely fair draw (a real user still wins
     *                    occasionally  which is what keeps it undetectable).
     *  - `guaranteed`   if a real user would win, the win is redirected to a bot
     *                    (deterministic house retention; overrides a fair result).
     *  - `hybrid`       statistical flooding PLUS the real-user→bot win redirect.
     *  - `ranked-bot`   rank-keyed, threshold-independent: places 1st-3rd always go
     *                    to a bot, places 4th-5th always go to a real player.
     */
    @Column({ type: 'varchar', length: 20, default: 'statistical' })
    botWinMode: string;

    /** Enable or disable explicit Bingo bot bonus-win controls. */
    @Column({ type: 'boolean', default: true })
    botBonusWinEnabled: boolean;

    /** How explicit bot bonus wins are awarded. */
    @Column({ type: 'varchar', length: 10, default: 'interval' })
    botBonusWinMode: 'interval' | 'random';

    /** Every N completed Bingo rooms a bot receives a bonus win. 0 = disabled. */
    @Column({ type: 'int', default: 0 })
    botBonusWinEveryNRounds: number;

    /** Random bonus-win chance per completed room when random mode is enabled. */
    @Column({ type: 'int', default: 0 })
    botBonusWinChancePct: number;

    /** Completed Bingo rooms a bot must sit out after winning. 0 = no cooldown. */
    @Column({ type: 'int', default: 25 })
    botWinnerCooldownRooms: number;

    /**
     * Win Sequence: an admin-defined repeating 4-slot Bot/User pattern applied
     * to every newly created prefilled room, independent of botWinMode/threshold
     * (see BingoRoom.winSequenceTarget, snapshotted per room at creation, and
     * BingoService.evaluateAndSettleDerash / reconcileBotCartelasInRoom for how
     * each slot is enforced). Master on/off switch, separate from the pattern
     * itself so a configured sequence can be paused without losing it.
     */
    @Column({ type: 'boolean', default: false })
    winSequenceEnabled: boolean;

    /** Exactly 4 slots, each 'bot' or 'user'. Cycled in order, wrapping around. */
    @Column({ type: 'json', nullable: true })
    winSequencePattern: Array<'bot' | 'user'> | null;

    /** Index into winSequencePattern the NEXT newly-created room will use. */
    @Column({ type: 'int', default: 0 })
    winSequencePosition: number;

    /**
     * JSON-encoded array of alias names the reserved cartel rotates through.
     * e.g. `["Abrsh","Derash","Yonas","Tigist","Hailu"]`.
     * Null = use the bot's own displayName for every game.
     */
    @Column({ type: 'text', nullable: true })
    botAliasPool: string | null;

    /**
     * PERSISTENT label for the House room slot (the auto-managed room with
     * ownerAgentId NULL  see BingoService.ensureAgentRooms). Null = default
     * "Bingo <time>" name. This is the House-slot counterpart of
     * User.bingoRoomLabel; it lives here because the house slot has no user row
     * to attach a label to. Managed from the admin Bingo tab's "Room Slots" panel.
     */
    @Column({ type: 'varchar', length: 255, nullable: true })
    houseRoomLabel?: string | null;

    /** PERSISTENT lobby card palette for the House room slot. Null = random each recreation. */
    @Column({ type: 'varchar', length: 20, nullable: true })
    houseCardPaletteId?: string | null;

    /** PERSISTENT decorative ball number for the House room slot. Null = random each recreation. */
    @Column({ type: 'int', nullable: true })
    houseCardBallNumber?: number | null;

    /** PERSISTENT ticket price for the House room slot. Null = use defaultTicketPriceMinor each recreation. */
    @Column({ type: 'int', nullable: true })
    houseTicketPriceMinor?: number | null;

    /**
     * Heartbeat: the last time a REAL player was served any Bingo read endpoint.
     * Not a setting — nothing in the admin UI touches it.
     *
     * It answers one question for the bot buy-in gate: is anybody actually in the
     * game right now? Bingo.tsx keeps polling the lobby every 5s even while it is
     * showing a finished round's result, so a player watching a result — INCLUDING
     * one who bought no cartela and holds no ticket — keeps this fresh. When it
     * has gone stale nobody is watching anything, so bots need not wait for a
     * player to land on a buying screen and an all-bot house never stalls.
     * See BingoService.isBotBuyAllowed.
     */
    @Column({ type: 'timestamp', nullable: true })
    lastPlayerSeenAt?: Date | null;

    @CreateDateColumn({ type: 'timestamp' })
    createdAt: Date;

    @UpdateDateColumn({ type: 'timestamp' })
    updatedAt: Date;
}
