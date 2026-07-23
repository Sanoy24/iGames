export type User = {
  id: string;
  displayName: string;
  roles: string[];
  email?: string;
  phoneNumber?: string;
  status?: string;
  /** Server-computed — true when the user has a live socket connection right now. */
  online?: boolean;
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
  /** Server-computed (Ethiopia time) — read-only annotations from listAgents. */
  effectiveOnDuty?: boolean;
  withinWorkingWindow?: boolean;
  wallets?: Wallet[];
  createdAt?: string;
  updatedAt?: string;
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

export type PatternType = 'fixed' | 'any_row' | 'any_col' | 'any_diagonal' | 'any_line' | 'coverall';

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
  drawnNumbers: number[];
  settledTiers: string[];
  winnersByTier: Record<string, string[]>;
  settlementSummary: Record<string, unknown>;
  houseEdgePct: number;
  prizeMinor: number;
  takenSpots?: number[];
  resultDisplaySeconds?: number;
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
  resultDisplaySeconds?: number;
  defaultWinMode?: string;
  defaultNumberRange?: number;
  defaultGridSize?: number;
  minDrawsBeforeWin?: number;
  minTicketsToStart?: number;
  houseEdgePct?: number;
  globalBingoBotWinInterval?: number;
  /** Below this many real players in a room, bots join to fill/steer it. 0 = never. */
  botMaxRealPlayers?: number;
  /** How bots steer a below-threshold room. */
  botWinMode?: 'off' | 'statistical' | 'guaranteed' | 'hybrid';
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
  createdAt?: string;
  updatedAt?: string;
};

export type LeaderboardEntry = {
  rank: number;
  displayName: string;
  totalWinMinor: number;
  winCount: number;
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
  amountMinor: number;
  status: 'pending' | 'claimed' | 'processing' | 'completed' | 'rejected';
  destinationAccount: string;
  agentId?: string;
  agent?: User;
  claimedAt?: string;
  serviceChargeMinor?: number;
  serviceFeeMinor?: number;
  commissionMinor?: number;
  netAmountMinor?: number;
  telebirrReference?: string;
  adminNotes?: string;
  processedBy?: string;
  processedAt?: string;
  createdAt: string;
};
