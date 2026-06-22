export type User = {
  id: string;
  displayName: string;
  roles: string[];
  email?: string;
  phoneNumber?: string;
  status?: string;
  lastLoginAt?: string;
  workStartHour?: number;
  workStartMinute?: number;
  workEndHour?: number;
  workEndMinute?: number;
  agentPermissions?: {
    deposit: boolean;
    withdraw: boolean;
  };
};

export type AuthTokenResponse = {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  user: User;
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

export type BingoRoom = {
  id: string;
  name: string;
  status: string;
  ticketPriceMinor: number;
  maxTickets: number;
  soldTickets: number;
  prizes: Record<string, number>;
  scheduledStartAt: string;
  drawnNumbers: number[];
  settledTiers: string[];
  winnersByTier: Record<string, string[]>;
  settlementSummary: Record<string, unknown>;
};

export type BingoTicket = {
  id: string;
  userId: string;
  roomId: string;
  grid: Array<Array<number | null>>;
  markedNumbers: number[];
  completedLines: number[];
  wonTiers: string[];
  stakeMinor: number;
  payoutMinor: number;
  status: string;
  settlementStatus: string;
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
  defaultOneLineMinor: number;
  defaultTwoLinesMinor: number;
  defaultFullHouseMinor: number;
  drawIntervalSeconds: number;
  createdAt?: string;
  updatedAt?: string;
};

export type Withdrawal = {
  id: string;
  userId: string;
  amountMinor: number;
  status: 'pending' | 'claimed' | 'processing' | 'completed' | 'rejected';
  destinationAccount: string;
  agentId?: string;
  claimedAt?: string;
  serviceChargeMinor?: number;
  netAmountMinor?: number;
  telebirrReference?: string;
  adminNotes?: string;
  processedBy?: string;
  processedAt?: string;
  createdAt: string;
};
