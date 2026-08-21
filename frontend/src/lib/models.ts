export type User = {
    id: string;
    displayName: string;
    roles: string[];
    email?: string;
    phoneNumber?: string;
    status?: string;
    /** Server-computed  true when the user has a live socket connection right now. */
    online?: boolean;
    /** Server-computed  true when this account is a house bot (productMetadata.botPolicy set). */
    isBot?: boolean;
    lastLoginAt?: string;
    workStartHour?: number;
    workStartMinute?: number;
    workEndHour?: number;
    workEndMinute?: number;
    agentPermissions?: {
        deposit: boolean;
        withdraw: boolean;
    };
    workDaysOfWeek?: number[];
    onDutyMode?: 'auto' | 'on' | 'off';
    /** Server-computed (Ethiopia time)  read-only annotations from listAgents. */
    effectiveOnDuty?: boolean;
    withinWorkingWindow?: boolean;
    wallets?: Wallet[];
    /** Attributed play area, picked at registration. Null = "Other" / house. */
    locationId?: string | null;
    locationSource?: 'telegram_geo' | 'self_selected' | 'other' | null;
    /**
     * An agent's own shared GPS pin (agent bot's mandatory location step).
     * Informational only  area access comes from admin-assigned agent_locations,
     * never from this pin. Shown to admins as an assignment hint.
     */
    sharedLatitude?: number | null;
    sharedLongitude?: number | null;
    sharedLocationAt?: string | null;
    /** An agent's shareable referral code (players never have one). */
    referralCode?: string | null;
    /** This agent's referral-commission % override. Null = use the global default. */
    referralCommissionPct?: number | null;
    /** This agent's per-game referral-commission % overrides (keno/crash/pool/werk). Missing key = no override for that game. */
    referralCommissionPctByGame?: Partial<
        Record<'keno' | 'crash' | 'pool' | 'werk', number>
    > | null;
    createdAt?: string;
    updatedAt?: string;
};

export type PublicLocation = {
    id: string;
    name: string;
    region?: string | null;
};

export type AdminLocation = PublicLocation & {
    latitude: number | null;
    longitude: number | null;
    radiusMeters: number;
    isActive: boolean;
    sortOrder: number;
    agentCount: number;
    playerCount: number;
};

export type UserLocation = {
    locationId: string | null;
    locationName: string | null;
    locationSource: 'telegram_geo' | 'self_selected' | 'other';
};

export type AuthTokenResponse = {
    accessToken: string;
    refreshToken: string;
    tokenType: 'Bearer';
    expiresIn: number;
    user: User;
};

export type RecentWin = {
    displayName: string;
    amountMinor: number;
    game: string;
    timestamp: string;
};

/** enabled=false means the admin has this feature toggled off  wins is always
 * empty in that case, never partial/fabricated data. */
export type RecentWinsResponse = {
    enabled: boolean;
    wins: RecentWin[];
};

export type Wallet = {
    id: string;
    userId?: string;
    availableMinor: number;
    reservedMinor: number;
    currencyCode: string;
    status: string;
};

export type LedgerEntry = {
    id: string;
    walletId: string;
    currencyCode: string;
    amountMinor: number;
    direction: 'credit' | 'debit';
    entryType: string;
    sourceType: string;
    sourceId: string;
    idempotencyKey?: string;
    balanceAfterMinor: number;
    metadata: Record<string, unknown>;
    createdAt?: string;
};

export type KenoPaytableEntry = {
    spots: number;
    matches: number;
    payoutMultiplier: number;
};

export type KenoConfig = {
    id?: string;
    name: string;
    version: number;
    numberMin: number;
    numberMax: number;
    drawSize: number;
    allowedSpots: number[];
    ticketPriceMinor: number;
    minStakeMinor?: number;
    maxStakeMinor?: number;
    globalBotWinInterval: number;
    autoScheduleIntervalMinutes?: number;
    autoScheduleIntervalSeconds?: number;
    maxWinnersPerDraw: number;
    paytable?: KenoPaytableEntry[];
    winChancePct?: number;
};

export type KenoDraw = {
    id: string;
    configVersion: number;
    status: string;
    scheduledAt: string;
    drawnNumbers: number[];
    rngAuditLogId?: string;
    settlementSummary: Record<string, unknown>;
};

export type KenoTicket = {
    id: string;
    userId: string;
    drawId: string;
    selectedNumbers: number[];
    stakeMinor: number;
    matches: number;
    payoutMinor: number;
    status: string;
    settlementStatus: string;
    configVersion: number;
    walletDebit?: Record<string, unknown>;
    walletCredit?: Record<string, unknown>;
};

export type PatternType =
    | 'fixed'
    | 'any_row'
    | 'any_col'
    | 'any_diagonal'
    | 'any_line'
    | 'coverall';

export type BingoPattern = {
    id: string;
    name: string;
    description?: string;
    patternType: PatternType;
    mask?: boolean[][];
    isBuiltIn: boolean;
    enabled: boolean;
    sortOrder: number;
    createdAt?: string;
    updatedAt?: string;
};

export type BingoPatternPrize = {
    patternId: string;
    name: string;
    prizeMinor: number;
};

export type BingoBonusRecurrence = {
    frequency: 'daily' | 'weekly';
    /** 0 = Sunday … 6 = Saturday. Only used for weekly. */
    dayOfWeek?: number;
    /** Addis Ababa local wall-clock time, HH:mm:ss. */
    startTime: string;
    endTime: string;
};

/**
 * An admin-scheduled window during which the platform proactively starts and
 * fills rooms using ONLY bots  no real player required. Up to `botCount`
 * distinct bots each buy up to `maxCartelasPerBot` cartelas while active.
 * Same once/recurring Addis Ababa (UTC+3) schedule shape as BingoBonusCampaign.
 */
export type BingoScheduledBotPlay = {
    id: string;
    name: string;
    enabled: boolean;
    scheduleType: 'once' | 'recurring';
    startAt: string | null;
    endAt: string | null;
    recurrence: BingoBonusRecurrence | null;
    botCount: number;
    maxCartelasPerBot: number;
    createdAt?: string;
    updatedAt?: string;
};

/**
 * An admin-scheduled "Bonus Win" campaign: while active, any prefilled/derash
 * ticket that completes `patternId` earns `prizeMinor` on top of its normal
 * Derash placement winnings. Always interpreted in Addis Ababa (UTC+3) time.
 */
export type BingoBonusCampaign = {
    id: string;
    name: string;
    patternId: string;
    prizeMinor: number;
    enabled: boolean;
    scheduleType: 'once' | 'recurring';
    /** ISO datetime (UTC). Set when scheduleType = 'once'. */
    startAt: string | null;
    endAt: string | null;
    recurrence: BingoBonusRecurrence | null;
    botWinEnabled: boolean;
    botMaxCartelasPerRoom: number;
    createdAt?: string;
    updatedAt?: string;
};

/** A 'running' room whose draw has stopped making progress  see
 * BingoService.findStalledRunningRooms on the backend for what this means. */
export type BingoStalledRoom = {
    id: string;
    name: string;
    updatedAt: string;
    stalledSeconds: number;
};

export type BingoOperationalAlertKind = 'pattern_resolution_failed';

export type BingoOperationalAlert = {
    id: string;
    kind: BingoOperationalAlertKind;
    roomId?: string | null;
    message: string;
    createdAt: string;
};

export type BingoRoom = {
    id: string;
    name: string;
    status: string;
    ticketPriceMinor: number;
    maxTickets: number;
    soldTickets: number;
    prizes: Record<string, number>;
    winMode: 'line' | 'pattern' | 'prefilled';
    numberRange: number;
    gridSize: number;
    patternPrizes: BingoPatternPrize[];
    scheduledStartAt: string;
    createdAt: string;
    drawnNumbers: number[];
    settledTiers: string[];
    winnersByTier: Record<string, string[]>;
    settlementSummary: Record<string, unknown>;
    bonusSettlement?: Record<string, unknown> | null;
    activeBonusCampaign?: {
        id: string;
        name: string;
        patternId: string;
        patternName: string;
        prizeMinor: number;
        activeUntil: string | null;
    } | null;
    houseEdgePct: number;
    prizeMinor: number;
    botIdentityMap?: Record<
        string,
        { displayName: string; phoneSuffix: string }
    >;
    takenSpots?: number[];
    cartelaChangeLockSeconds?: number;
    resultDisplaySeconds?: number;
    bonusWinDisplaySeconds?: number;
    isAdminCreated?: boolean;
    ownerAgentId?: string | null;
    cardPaletteId?: string | null;
    cardBallNumber?: number | null;
};

/**
 * A House-or-agent Bingo room "slot" (see BingoService.ensureAgentRooms) with
 * its PERSISTENT label/palette/ball  survives every auto-recreation of that
 * slot's room, unlike a one-off room rename (BingoRoom.name via updateRoomDisplay).
 */
export type BingoRoomSlot = {
    ownerId: string;
    ownerName: string;
    label: string | null;
    cardPaletteId: string | null;
    cardBallNumber: number | null;
    ticketPriceMinor: number | null;
    currentRoomId: string | null;
    currentRoomName: string | null;
    currentRoomStatus: string | null;
};

/**
 * A persistent, independently-named admin room (see BingoService.
 * ensureCustomRoomSlots)  unlike a one-off room from adminBingoApi.createRoom,
 * this keeps recreating itself with the same settings after every round.
 */
export type BingoCustomRoomSlot = {
    id: string;
    name: string;
    ticketPriceMinor: number;
    maxTickets: number;
    winMode: 'line' | 'pattern' | 'prefilled';
    numberRange: number | null;
    gridSize: number | null;
    prizes: Record<string, number>;
    patternPrizes: BingoPatternPrize[];
    cardPaletteId: string | null;
    cardBallNumber: number | null;
    isActive: boolean;
    currentRoomId: string | null;
    currentRoomName: string | null;
    currentRoomStatus: string | null;
};

export type BingoTicket = {
    id: string;
    userId: string;
    roomId: string;
    cartelaNumber?: number | null;
    grid: Array<Array<number | null>>;
    markedNumbers: number[];
    completedLines: number[];
    wonTiers: string[];
    completedPatterns: string[];
    stakeMinor: number;
    payoutMinor: number;
    status: string;
    settlementStatus: string;
    autoClaim?: boolean;
};

export type BingoRoomState = BingoRoom & {
    tickets?: BingoTicket[];
};

export type BingoConfig = {
    key: string;
    enabled: boolean;
    autoRepeatIntervalMinutes: number;
    defaultTicketPriceMinor: number;
    defaultMaxTickets: number;
    maxCartelasPerUser?: number;
    defaultOneLineMinor: number;
    defaultTwoLinesMinor: number;
    defaultFullHouseMinor: number;
    drawIntervalSeconds: number;
    salesWindowSeconds?: number;
    cartelaChangeLockSeconds?: number;
    resultDisplaySeconds?: number;
    bonusWinDisplaySeconds?: number;
    defaultWinMode?: string;
    defaultNumberRange?: number;
    defaultGridSize?: number;
    minDrawsBeforeWin?: number;
    minTicketsToStart?: number;
    houseEdgePct?: number;
    globalBingoBotWinInterval?: number;
    botCartelaPolicyEnabled?: boolean;
    botCartelaPolicyMode?: 'mirror' | 'fixed_cap';
    botMaxCartelasPerBotPerRoom?: number;
    botBelowThresholdEnabled?: boolean;
    botBelowThresholdRealPlayers?: number;
    botAboveThresholdEnabled?: boolean;
    botAboveThresholdRealPlayers?: number;
    /** Legacy below-threshold setting kept for compatibility. */
    botMaxRealPlayers?: number;
    /** How bots steer a below-threshold room. */
    botWinMode?:
        | 'off'
        | 'statistical'
        | 'guaranteed'
        | 'hybrid'
        | 'cartel-dual'
        | 'ranked-bot';
    botBonusWinEnabled?: boolean;
    botBonusWinMode?: 'interval' | 'random';
    botBonusWinEveryNRounds?: number;
    botBonusWinChancePct?: number;
    /** Completed Bingo rooms a bot must sit out after winning. 0 = no cooldown. */
    botWinnerCooldownRooms?: number;
    /** Master on/off for the Win Sequence (repeating Bot/User pattern), independent of botWinMode. */
    winSequenceEnabled?: boolean;
    /** Exactly 4 slots, each 'bot' or 'user', cycled in order per new room. */
    winSequencePattern?: Array<'bot' | 'user'> | null;
    /** Index into winSequencePattern the NEXT newly-created room will use (read-only display). */
    winSequencePosition?: number;
    prefilledRankingMode?: 'race' | 'leaderboard';
    prefilledFirstPlacePct?: number;
    prefilledSecondPlaceEnabled?: boolean;
    prefilledSecondPlacePct?: number;
    prefilledThirdPlaceEnabled?: boolean;
    prefilledThirdPlacePct?: number;
    prefilledFourthPlaceEnabled?: boolean;
    prefilledFourthPlacePct?: number;
    prefilledFifthPlaceEnabled?: boolean;
    prefilledFifthPlacePct?: number;
    prefilledWinPatternId?: string | null;
    prefilledFirstPatternId?: string | null;
    prefilledSecondPatternId?: string | null;
    prefilledThirdPatternId?: string | null;
    prefilledFourthPatternId?: string | null;
    prefilledFifthPatternId?: string | null;
    /** JSON array of alias names for the reserved cartel. Null = use bot displayName. */
    botAliasPool?: string | null;
    createdAt?: string;
    updatedAt?: string;
};

export type LeaderboardEntry = {
    rank: number;
    displayName: string;
    totalWinMinor: number;
    winCount: number;
};

/** enabled=false means the admin has the Leaderboard tab toggled off  entries
 * is always empty in that case. */
export type LeaderboardResponse = {
    enabled: boolean;
    entries: LeaderboardEntry[];
};

export type SpectatorCard = {
    grid: Array<Array<number | null>>;
    markedNumbers: number[];
    status: string;
};

export type CrashConfig = {
    key: string;
    enabled: boolean;
    houseEdgePct: number;
    minBetMinor: number;
    maxBetMinor: number;
    waitingDurationSeconds: number;
    tickIntervalMs: number;
    maxMultiplierX100: number;
    botBetMinor: number;
    globalBotWinInterval: number;
};

export type CrashRound = {
    id: string;
    status: 'waiting' | 'running' | 'crashed';
    seedHash: string;
    seed?: string | null;
    crashPointX100?: number | null;
    startedAt?: string | null;
    crashedAt?: string | null;
    elapsedMs?: number | null;
    settlementSummary?: Record<string, unknown> | null;
};

export type CrashBet = {
    id: string;
    userId: string;
    roundId: string;
    stakeMinor: number;
    autoCashoutX100?: number | null;
    cashedOutAtX100?: number | null;
    payoutMinor: number;
    status: 'active' | 'won' | 'lost';
};

export type Withdrawal = {
    id: string;
    userId: string;
    user?: User;
    amountMinor: number;
    status:
        | 'pending'
        | 'claimed'
        | 'processing'
        | 'awaiting_verification'
        | 'completed'
        | 'rejected';
    destinationAccount: string;
    agentId?: string;
    agent?: User;
    claimedAt?: string;
    /** The flat withdrawal fee, 100% credited to the agent  no platform split. */
    serviceChargeMinor?: number;
    netAmountMinor?: number;
    telebirrReference?: string;
    /** Agent-uploaded photo/PDF of the payout receipt, relative to /uploads/. */
    receiptFileUrl?: string | null;
    /** When the agent says they actually transferred the money  agent-entered. */
    transferCompletedAt?: string | null;
    adminNotes?: string;
    /** Who/when the agent submitted completion proof (or, on the admin-bypass path, who/when admin settled it directly). */
    processedBy?: string;
    processedAt?: string;
    /** Admin sign-off on the agent's submitted proof  set only via the new verification gate. */
    verifiedBy?: string | null;
    verifiedAt?: string | null;
    createdAt: string;
};
