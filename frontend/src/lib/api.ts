import axios from 'axios';
import type {
  AuthTokenResponse,
  BingoConfig,
  BingoPattern,
  BingoRoom,
  BingoRoomSlot,
  BingoCustomRoomSlot,
  BingoRoomState,
  BingoTicket,
  CrashBet,
  CrashConfig,
  CrashRound,
  KenoConfig,
  KenoDraw,
  KenoTicket,
  LeaderboardEntry,
  LedgerEntry,
  AdminLocation,
  PublicLocation,
  UserLocation,
  RecentWin,
  SpectatorCard,
  User,
  Wallet,
  Withdrawal,
} from './models';

// In dev (no VITE_API_URL set) use '/api' so Vite proxies the request to
// localhost:3000 server-side — this works through ngrok and any other tunnel.
// In production VITE_API_URL is the absolute backend domain (e.g. https://api.binastech.com).
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? '/api',
  timeout: 15000,
});

// Inject auth token on every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Silent token refresh on 401 ─────────────────────────────────────
let _refreshing: Promise<string | null> | null = null;

function doRefresh(): Promise<string | null> {
  if (_refreshing) return _refreshing;
  _refreshing = (async () => {
    try {
      const rt = localStorage.getItem('refreshToken');
      if (!rt) return null;
      const res = await axios.post<{ accessToken: string; refreshToken?: string }>(
        `${import.meta.env.VITE_API_URL ?? '/api'}/auth/refresh`,
        { refreshToken: rt },
      );
      const { accessToken, refreshToken } = res.data;
      localStorage.setItem('accessToken', accessToken);
      if (refreshToken) localStorage.setItem('refreshToken', refreshToken);
      return accessToken;
    } catch {
      return null;
    } finally {
      _refreshing = null;
    }
  })();
  return _refreshing;
}

api.interceptors.response.use(
  (response) => response,
  async (error: import('axios').AxiosError) => {
    const original = error.config as import('axios').InternalAxiosRequestConfig & { _retry?: boolean };
    // Only attempt refresh once, and only for 401s on non-auth endpoints
    if (
      error.response?.status === 401 &&
      !original._retry &&
      original.url &&
      !original.url.includes('/auth/')
    ) {
      original._retry = true;
      const newToken = await doRefresh();
      if (newToken) {
        original.headers.Authorization = `Bearer ${newToken}`;
        return api(original);
      }
      // Refresh failed — clear stored tokens so the UI can re-authenticate
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
    }
    return Promise.reject(error);
  },
);


// ── Auth ──────────────────────────────────────────────────────────
export const authApi = {
  loginWithTelegram: (initData: string) =>
    api.post<AuthTokenResponse>('/auth/telegram/miniapp', { initData }).then((r) => r.data),

  devSeedPlayer: (displayName: string, initialBalanceMinor = 100000) =>
    api
      .post<AuthTokenResponse>('/dev/seed/player', { displayName, initialBalanceMinor })
      .then((r) => r.data),

  devSeedAdmin: (displayName = 'Dev Admin', initialBalanceMinor = 1000000) =>
    api
      .post<AuthTokenResponse>('/dev/seed/admin', { displayName, initialBalanceMinor })
      .then((r) => r.data),

  devTopup: (userId: string, amountMinor = 100_000) =>
    api.post<{ ok: boolean; amountMinor: number }>('/dev/topup', { userId, amountMinor }).then((r) => r.data),

  loginWithCredentials: (phoneNumber: string, password: string) =>
    api
      .post<AuthTokenResponse>('/auth/credentials', { phoneNumber, password })
      .then((r) => r.data),

  /** Agent Mini App pre-login: resolves the phone linked via the agent bot's contact-share. */
  resolveAgentPhone: (initData: string) =>
    api
      .post<{ phoneNumber: string; displayName: string }>('/auth/agent/resolve-phone', { initData })
      .then((r) => r.data),

  refresh: (refreshToken: string) =>
    api.post<AuthTokenResponse>('/auth/refresh', { refreshToken }).then((r) => r.data),

  logout: () => api.post('/auth/logout').then((r) => r.data),

  changePassword: (currentPassword: string, newPassword: string) =>
    api.post<{ ok: boolean }>('/auth/change-password', { currentPassword, newPassword }).then((r) => r.data),
};

// ── Wallet ────────────────────────────────────────────────────────
export const walletApi = {
  getWallet: () => api.get<Wallet>('/wallet').then((r) => r.data),
  getLedger: (limit = 20) => api.get<LedgerEntry[]>(`/wallet/ledger?limit=${limit}`).then((r) => r.data),
  getRecentWins: (limit = 20) => api.get<RecentWin[]>(`/wallet/recent-wins?limit=${limit}`).then((r) => r.data),
  getLeaderboard: (period: 'all' | 'monthly' | 'weekly' = 'all', limit = 10) =>
    api.get<LeaderboardEntry[]>(`/wallet/leaderboard?period=${period}&limit=${limit}`).then((r) => r.data),
  requestWithdrawal: (amountMinor: number, destinationAccount: string) =>
    api.post<Withdrawal>('/wallet/withdraw', { amountMinor, destinationAccount }).then((r) => r.data),
  getWithdrawals: () => api.get<Withdrawal[]>('/wallet/withdrawals').then((r) => r.data),
  getWithdrawalFeeConfig: () =>
    api.get<{ withdrawalFeeRanges: Array<{ minAmountMinor: number; maxAmountMinor: number | null; feeMinor: number }> }>('/wallet/withdrawal-fee-config').then((r) => r.data),
};

// ── Payments ──────────────────────────────────────────────────────

export type TelebirrPreview = {
  receiptNo: string;
  amountMinor: number;
  payerName?: string;
  payerPhone?: string;
  receiverName?: string;
  transactionStatus?: string;
  date?: string;
};

function extractTelebirrReceiptBody(rawText: string): { receiptUrl: string } | { receiptNo: string } {
  const trimmed = rawText.trim();
  // 1. Full URL anywhere in the text
  const urlMatch = trimmed.match(/https?:\/\/transactioninfo\.ethiotelecom\.et\/receipt\/([A-Za-z0-9_-]+)/i);
  if (urlMatch) return { receiptUrl: urlMatch[0] };
  // 2. The entire input is already a URL
  if (/^https?:\/\//i.test(trimmed)) return { receiptUrl: trimmed };
  // 3. Plain receipt number
  return { receiptNo: trimmed };
}

export type MpesaPreview = {
  confirmationCode: string;
  amountMinor: number;
  payerPhone?: string;
  receiverName?: string;
  receiverPhone?: string;
  date?: string;
};

export type ActiveAgent = {
  id?: string;
  displayName: string;
  phoneNumber: string | null;
};

export const paymentsApi = {
  // Receipt verification fetches an external page (Ethiotelecom, via the proxy),
  // so it can take longer than the 15s global default — give it 45s.
  previewTelebirrReceipt: (rawText: string) =>
    api.post<TelebirrPreview>('/payments/telebirr/preview', extractTelebirrReceiptBody(rawText), { timeout: 45000 }).then((r) => r.data),

  submitTelebirrReceipt: (rawText: string, receiptFileUrl?: string) =>
    api.post('/payments/telebirr/receipts', { ...extractTelebirrReceiptBody(rawText), receiptFileUrl }, { timeout: 45000 }).then((r) => r.data),

  /** Same submit endpoint, given an already-known receipt number (e.g. from
   * the screenshot/OCR flow) instead of raw SMS text to re-parse. */
  submitTelebirrReceiptByNo: (receiptNo: string, receiptFileUrl?: string) =>
    api.post('/payments/telebirr/receipts', { receiptNo, receiptFileUrl }, { timeout: 45000 }).then((r) => r.data),

  /** Upload a screenshot of the Telebirr app's "Successful" screen — OCR reads
   * the transaction number server-side, then verifies it the same way the
   * text-paste flow does. The screenshot is stored and its path returned as
   * `fileUrl`, so it doubles as the receipt photo (no separate upload needed). */
  previewTelebirrScreenshot: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return api
      .post<TelebirrPreview & { receiptNo: string; fileUrl: string }>('/payments/telebirr/preview-screenshot', form, { timeout: 45000 })
      .then((r) => r.data);
  },

  // M-Pesa is verified from the pasted confirmation SMS (optionally cross-checked
  // against a portal server-side), so it can also exceed the default — give it 45s.
  previewMpesaSms: (sms: string) =>
    api.post<MpesaPreview>('/payments/mpesa/preview', { sms: sms.trim() }, { timeout: 45000 }).then((r) => r.data),

  submitMpesaSms: (sms: string, receiptFileUrl?: string) =>
    api.post('/payments/mpesa/receipts', { sms: sms.trim(), receiptFileUrl }, { timeout: 45000 }).then((r) => r.data),

  /** Upload a photo/PDF of the physical receipt before submitting — returns a
   * relative path (e.g. "deposit-receipts/<uuid>.jpg") to pass as receiptFileUrl. */
  uploadReceipt: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return api.post<{ fileUrl: string }>('/payments/receipts/upload', form).then((r) => r.data);
  },

  getActiveAgent: () =>
    api.get<ActiveAgent | null>('/payments/active-agent').then((r) => r.data),

  getActiveAgents: () =>
    api.get<ActiveAgent[]>('/payments/active-agents').then((r) => r.data),

  getConfig: () =>
    api.get<{ minDepositMinor: number }>('/payments/config').then((r) => r.data),
};

// ── Keno ──────────────────────────────────────────────────────────
export const kenoApi = {
  getConfig: () => api.get<KenoConfig>('/keno/config').then((r) => r.data),
  getActiveDraw: () => api.get<KenoDraw | null>('/keno/active-draw').then((r) => r.data),
  purchaseTicket: (selectedNumbers: number[], idempotencyKey: string) =>
    api
      .post<KenoTicket>('/keno/tickets', { selectedNumbers }, { headers: { 'Idempotency-Key': idempotencyKey } })
      .then((r) => r.data),
  updateTicketNumbers: (ticketId: string, selectedNumbers: number[]) =>
    api.patch<KenoTicket>(`/keno/tickets/${ticketId}/numbers`, { selectedNumbers }).then((r) => r.data),
  listTickets: (limit = 20) => api.get<KenoTicket[]>(`/keno/tickets?limit=${limit}`).then((r) => r.data),
  getTicket: (id: string) => api.get<KenoTicket>(`/keno/tickets/${id}`).then((r) => r.data),
  listDraws: (limit = 10) => api.get<KenoDraw[]>(`/keno/draws?limit=${limit}`).then((r) => r.data),
};

// ── Bingo ─────────────────────────────────────────────────────────
export type BingoLobbyRoom = {
  id: string;
  name: string;
  status: string;
  ownerAgentId: string | null;
  ownerName: string;
  ticketPriceMinor: number;
  players: number;
  potMinor: number;
  scheduledStartAt: string | null;
  cardPaletteId: string | null;
  cardBallNumber: number | null;
};

export type BingoRoomListResponse = {
  data: BingoRoom[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

export const bingoApi = {
  listRooms: (page = 1, limit = 10) =>
    api.get<BingoRoomListResponse>(`/bingo/rooms?page=${page}&limit=${limit}`).then((r) => r.data),
  getCurrentRoom: () => api.get<BingoRoomState | null>('/bingo/current').then((r) => r.data),
  getLobby: () => api.get<{ enabled: boolean; rooms: BingoLobbyRoom[] }>('/bingo/lobby').then((r) => r.data),
  getRoomState: (roomId: string) => api.get<BingoRoomState>(`/bingo/rooms/${roomId}/state`).then((r) => r.data),
  spectateRoom: (roomId: string) => api.get<SpectatorCard[]>(`/bingo/rooms/${roomId}/spectate`).then((r) => r.data),
  purchaseTickets: (roomId: string, count: number, idempotencyKey: string, selectedNumbers?: number[]) =>
    api
      .post(
        `/bingo/rooms/${roomId}/tickets`,
        { count, ...(selectedNumbers && selectedNumbers.length > 0 ? { selectedNumbers } : {}) },
        { headers: { 'Idempotency-Key': idempotencyKey } }
      )
      .then((r) => r.data as BingoTicket[]),
  purchaseCartelas: (roomId: string, cartelaNumbers: number[], idempotencyKey: string) =>
    api
      .post(
        `/bingo/rooms/${roomId}/tickets`,
        { cartelaNumbers },
        { headers: { 'Idempotency-Key': idempotencyKey } }
      )
      .then((r) => r.data as BingoTicket[]),
  releaseCartela: (roomId: string, cartelaNumber: number) =>
    api
      .delete(`/bingo/rooms/${roomId}/cartelas/${cartelaNumber}`)
      .then((r) => r.data as { cartelaNumber: number; refundedMinor: number; roomCancelled?: boolean }),
  setAuto: (roomId: string, auto: boolean) =>
    api
      .post(`/bingo/rooms/${roomId}/auto`, { auto })
      .then((r) => r.data as { autoClaim: boolean; updated: number }),
  claimBingo: (roomId: string, ticketId: string) =>
    api
      .post(`/bingo/rooms/${roomId}/tickets/${ticketId}/claim`)
      .then((r) => r.data as { result: 'won' | 'disqualified' | 'ignored'; ticket: BingoTicket; room: BingoRoomState }),
};

// ── Crash ─────────────────────────────────────────────────────────
export const crashApi = {
  getConfig: () => api.get<CrashConfig>('/crash/config').then((r) => r.data),
  getActiveRound: () => api.get<CrashRound | null>('/crash/active').then((r) => r.data),
  getRecentRounds: (limit = 20) => api.get<CrashRound[]>(`/crash/rounds?limit=${limit}`).then((r) => r.data),
  getMyBets: (limit = 20) => api.get<CrashBet[]>(`/crash/bets?limit=${limit}`).then((r) => r.data),
  getMyBetsForRound: (roundId: string) => api.get<CrashBet[]>(`/crash/rounds/${roundId}/bets`).then((r) => r.data),
  placeBet: (roundId: string, stakeMinor: number, idempotencyKey: string, autoCashoutAt?: number) =>
    api.post<CrashBet>(
      `/crash/rounds/${roundId}/bet`,
      { stakeMinor, ...(autoCashoutAt ? { autoCashoutAt } : {}) },
      { headers: { 'Idempotency-Key': idempotencyKey } },
    ).then((r) => r.data),
  cashOut: (roundId: string, multiplierX100: number) =>
    api.post<CrashBet>(`/crash/rounds/${roundId}/cashout`, { multiplierX100 }).then((r) => r.data),
};

// ── Users / Profile ───────────────────────────────────────────────
export const userApi = {
  getMe: () => api.get<User>('/users/me').then((r) => r.data),
  updateProfile: (dto: { displayName?: string; phoneNumber?: string }) =>
    api.patch<User>('/users/me', dto).then((r) => r.data),
};

// ── Locations (player-facing) ─────────────────────────────────────
// Retired for onboarding — kept only for anything still reading the admin
// Location catalog. New player→agent attribution uses agentMatchApi below.
export const locationsApi = {
  list: () => api.get<PublicLocation[]>('/locations').then((r) => r.data),
  /** Null when the player has never answered — the Mini App uses this to prompt. */
  getMine: () => api.get<UserLocation | null>('/locations/me').then((r) => r.data),
  setMine: (dto: { locationId?: string; other?: boolean }) =>
    api.patch<UserLocation>('/locations/me', dto).then((r) => r.data),
};

// ── Direct player→agent GPS matching (replaces Location-based onboarding) ──
export type OnDutyAgentOption = { id: string; name: string };
export type AssignedAgentResult = {
  assignedAgentId: string | null;
  assignedAgentName: string | null;
  assignedAgentSource: 'gps_match' | 'manual_pick' | 'other';
};

export const agentMatchApi = {
  listAgents: () => api.get<OnDutyAgentOption[]>('/agent-match/agents').then((r) => r.data),
  getMine: () => api.get<AssignedAgentResult | null>('/agent-match/me').then((r) => r.data),
  setMine: (dto: { agentId?: string; other?: boolean }) =>
    api.patch<AssignedAgentResult>('/agent-match/me', dto).then((r) => r.data),
  attempt: (latitude: number, longitude: number) =>
    api.post<AssignedAgentResult | null>('/agent-match/attempt', { latitude, longitude }).then((r) => r.data),
};

// ── Admin: Overview + Config ──────────────────────────────────────
export type PlatformStats = {
  ggrMinor: number;
  totalVolumeMinor: number;
  totalPayoutsMinor: number;
  totalRefundsMinor: number;
  totalLiabilitiesMinor: number;
  breakdown: Record<string, number>;
};

export type SystemConfig = {
  telebirrCreditMinorPerBirr: number;
  welcomeBonusMinor: number;
  minDepositMinor: number;
  withdrawalMinAmountMinor: number;
  withdrawalMaxAmountMinor: number;
  maxPendingWithdrawalsPerUser: number;
  /** Approach B: per-agent Bingo rooms on/off. */
  agentRoomsEnabled?: boolean;
  /** % of a room's real-player GGR paid to the owning agent on completion. */
  agentRoomCommissionPct?: number;
  /** Global default % of a referred player's Bingo GGR paid to the referring agent. */
  referralCommissionPct?: number;
};

export type WithdrawalFeeRange = {
  id: string;
  minAmountMinor: number;
  /** Null = open-ended ("and above"). */
  maxAmountMinor: number | null;
  feeMinor: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CoverageGap = { fromMinor: number; toMinor: number | null };

export type ConfigChangeLog = {
  id: string;
  configType: 'global_referral_commission' | 'agent_referral_commission' | 'withdrawal_fee_range';
  entityId: string | null;
  previousValue: string | null;
  newValue: string | null;
  changedByAdminId: string;
  createdAt: string;
};

export type AgentPerformance = {
  agentId: string;
  displayName: string;
  customersBrought: number;
  tickets: number;
  players: number;
  stakedMinor: number;
  payoutMinor: number;
  ggrMinor: number;
  commissionEarnedMinor: number;
  withdrawalFeesEarnedMinor: number;
  depositCount: number;
  depositVolumeMinor: number;
  depositCommissionEarnedMinor: number;
};

export type AgentSelfPerformance = {
  customersBrought: number;
  tickets: number;
  players: number;
  stakedMinor: number;
  payoutMinor: number;
  ggrMinor: number;
  commissionEarnedMinor: number;
  withdrawalFeesEarnedMinor: number;
  depositCount: number;
  depositVolumeMinor: number;
  depositCommissionEarnedMinor: number;
};

export type AgentDashboardSummary = {
  totalReferredPlayers: number;
  activePlayers: number;
  gameCommission: { referralCommissionMinor: number; ownedRoomCommissionMinor: number; totalMinor: number };
  withdrawalFeesEarnedMinor: number;
  totalEarningsMinor: number;
  pendingWithdrawalRequests: number;
  completedWithdrawalRequests: number;
  earnings: { todayMinor: number; weeklyMinor: number; monthlyMinor: number; lifetimeMinor: number };
};

export type AgentSettlementStatus = 'pending' | 'approved' | 'paid' | 'rejected';
export type AgentSettlementPaymentMethod = 'bank_transfer' | 'cash' | 'mobile_money' | 'other';

export type AgentSettlement = {
  id: string;
  agentId: string;
  agent?: User;
  periodStart: string;
  periodEnd: string;
  gameCommissionMinor: number;
  withdrawalFeesMinor: number;
  totalEarnedMinor: number;
  amountPaidMinor: number;
  outstandingBalanceMinor: number;
  status: AgentSettlementStatus;
  paymentMethod?: AgentSettlementPaymentMethod | null;
  ftNumber?: string | null;
  receiptFileUrl?: string | null;
  paidAt?: string | null;
  paidByAdminId?: string | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
};

export const adminApi = {
  getOverview: () => api.get<PlatformStats>('/admin/stats/overview').then((r) => r.data),
  getConfig: () => api.get<SystemConfig>('/admin/config').then((r) => r.data),
  updateConfig: (dto: Partial<SystemConfig>) => api.post<SystemConfig>('/admin/config', dto).then((r) => r.data),
  getConfigHistory: (params?: { configType?: ConfigChangeLog['configType']; entityId?: string; page?: number; limit?: number }) =>
    api.get<{ data: ConfigChangeLog[]; total: number; page: number; limit: number }>('/admin/config-history', { params }).then((r) => r.data),
  listWithdrawalFeeRanges: () =>
    api.get<{ ranges: WithdrawalFeeRange[]; coverageGaps: CoverageGap[] }>('/admin/withdrawal-fee-ranges').then((r) => r.data),
  createWithdrawalFeeRange: (dto: { minAmountMinor: number; maxAmountMinor: number | null; feeMinor: number; active?: boolean }) =>
    api.post<WithdrawalFeeRange>('/admin/withdrawal-fee-ranges', dto).then((r) => r.data),
  updateWithdrawalFeeRange: (id: string, dto: Partial<{ minAmountMinor: number; maxAmountMinor: number | null; feeMinor: number; active: boolean }>) =>
    api.patch<WithdrawalFeeRange>(`/admin/withdrawal-fee-ranges/${id}`, dto).then((r) => r.data),
  deleteWithdrawalFeeRange: (id: string) =>
    api.delete<void>(`/admin/withdrawal-fee-ranges/${id}`).then((r) => r.data),
  getAgentPerformance: () => api.get<AgentPerformance[]>('/admin/agents/performance').then((r) => r.data),
  /** The Master Wallet — the ONE shared system wallet every admin account operates on (see backend AdminService). */
  getHouseWallet: () => api.get<Wallet>('/admin/wallet/house').then((r) => r.data),
  topupWallet: (amountMinor: number, idempotencyKey?: string) =>
    api.post<Wallet>('/admin/wallet/topup', { amountMinor, idempotencyKey }).then((r) => r.data),
  transferToAgent: (agentId: string, amountMinor: number, idempotencyKey?: string) =>
    api.post<{ adminWallet: Wallet; agentWallet: Wallet }>('/admin/wallet/transfer-to-agent', { agentId, amountMinor, idempotencyKey }).then((r) => r.data),
};

// ── Notifications (per-user bell) ─────────────────────────────────
export type ServerNotification = {
  id: string;
  type: 'win' | 'deposit' | 'withdrawal' | 'adjustment' | 'bonus' | 'system';
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  read: boolean;
  createdAt: string;
};

export const notificationsApi = {
  list: () =>
    api.get<{ items: ServerNotification[]; unreadCount: number }>('/notifications').then((r) => r.data),
  markRead: (ids?: string[]) =>
    api.post<{ unreadCount: number }>('/notifications/read', ids && ids.length ? { ids } : {}).then((r) => r.data),
};

// ── Admin: Broadcast (Telegram) ───────────────────────────────────
export type BroadcastButton = { text: string; url: string };
export type BroadcastRecurrence = { frequency: 'daily' | 'weekly'; time: string; dayOfWeek?: number };
export type BroadcastStatus = 'draft' | 'scheduled' | 'sending' | 'sent' | 'failed' | 'cancelled';

export type BroadcastMessage = {
  id: string;
  title: string;
  text: string | null;
  imagePath: string | null;
  buttons: BroadcastButton[] | null;
  parseMode: 'none' | 'HTML' | 'MarkdownV2';
  audience: string;
  scheduleType: 'now' | 'once' | 'recurring';
  recurrence: BroadcastRecurrence | null;
  timezoneOffsetMinutes: number;
  nextRunAt: string | null;
  status: BroadcastStatus;
  totalRecipients: number;
  sentCount: number;
  failedCount: number;
  runCount: number;
  lastRunAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateBroadcastInput = {
  title: string;
  text?: string;
  imageFilename?: string;
  buttons?: BroadcastButton[];
  parseMode?: 'none' | 'HTML' | 'MarkdownV2';
  scheduleType: 'now' | 'once' | 'recurring';
  scheduledAtLocal?: string;
  recurrence?: BroadcastRecurrence;
  timezoneOffsetMinutes?: number;
  asDraft?: boolean;
};

// Uploaded broadcast images are served at the backend root (/uploads), not under
// the /api prefix. In prod VITE_API_URL is the backend origin; in dev it's unset
// and Vite proxies /uploads to localhost:3000 (see vite.config).
export const ASSET_BASE = ((import.meta.env.VITE_API_URL as string | undefined) ?? '').replace(/\/$/, '');
export const broadcastImageUrl = (imagePath: string | null | undefined): string | null =>
  imagePath ? `${ASSET_BASE}/uploads/${imagePath}` : null;

export const broadcastApi = {
  list: () => api.get<BroadcastMessage[]>('/admin/broadcasts').then((r) => r.data),
  get: (id: string) => api.get<BroadcastMessage>(`/admin/broadcasts/${id}`).then((r) => r.data),
  uploadImage: (file: File) => {
    const form = new FormData();
    form.append('image', file);
    return api
      .post<{ imageFilename: string; imagePath: string }>('/admin/broadcasts/upload', form)
      .then((r) => r.data);
  },
  create: (dto: CreateBroadcastInput) =>
    api.post<BroadcastMessage>('/admin/broadcasts', dto).then((r) => r.data),
  sendNow: (id: string) => api.post<BroadcastMessage>(`/admin/broadcasts/${id}/send`).then((r) => r.data),
  cancel: (id: string) => api.post<BroadcastMessage>(`/admin/broadcasts/${id}/cancel`).then((r) => r.data),
  remove: (id: string) => api.delete(`/admin/broadcasts/${id}`).then((r) => r.data),
};

// ── Admin: Keno ───────────────────────────────────────────────────
export const adminKenoApi = {
  getConfig: () => api.get<KenoConfig>('/keno/config').then((r) => r.data),
  createConfig: (dto: Partial<KenoConfig>) =>
    api.post<KenoConfig>('/admin/keno/configs', dto).then((r) => r.data),
  listDraws: (limit = 20) => api.get<KenoDraw[]>(`/keno/draws?limit=${limit}`).then((r) => r.data),
  scheduleDraw: (scheduledAt?: string) =>
    api.post<KenoDraw>('/admin/keno/draws', { scheduledAt }).then((r) => r.data),
  executeDraw: (drawId: string) =>
    api.post<KenoDraw>(`/admin/keno/draws/${drawId}/execute`).then((r) => r.data),
  cancelDraw: (drawId: string) =>
    api.post<KenoDraw>(`/admin/keno/draws/${drawId}/cancel`).then((r) => r.data),
};

// ── Admin: Bingo ──────────────────────────────────────────────────
export type BingoRoundTicket = {
  id: string;
  userId: string;
  userName: string;
  phoneLast4: string;
  isBot: boolean;
  cartelaNumber: number | null;
  status: string;
  settlementStatus: string;
  autoClaim: boolean;
  stakeMinor: number;
  payoutMinor: number;
  wonTiers: string[];
  grid: Array<Array<number | null>>;
  markedNumbers: number[];
  createdAt: string;
};

export type BingoRoundDetails = {
  room: BingoRoom & { rankingMode?: string; rngAuditLogIds?: string[]; createdAt?: string };
  totals: {
    soldTickets: number;
    totalPotMinor: number;
    prizePoolMinor: number;
    totalPaidOutMinor: number;
    houseEdgePct: number;
  };
  tickets: BingoRoundTicket[];
};

export const adminBingoApi = {
  getConfig: () => api.get<BingoConfig>('/admin/bingo/config').then((r) => r.data),
  getRoomDetails: (roomId: string) =>
    api.get<BingoRoundDetails>(`/admin/bingo/rooms/${roomId}/details`).then((r) => r.data),
  updateConfig: (dto: Partial<BingoConfig>) =>
    api.post<BingoConfig>('/admin/bingo/config', dto).then((r) => r.data),
  listAllRooms: (page = 1, limit = 10) =>
    api.get<BingoRoomListResponse>(`/bingo/rooms?page=${page}&limit=${limit}`).then((r) => r.data),
  createRoom: (dto: {
    name: string;
    ticketPriceMinor: number;
    maxTickets: number;
    scheduledStartAt: string | null;
    prizes: Record<string, number>;
    winMode?: string;
    numberRange?: number;
    patternPrizes?: Array<{ patternId: string; name: string; prizeMinor: number }>;
    /** Lobby card gradient — omit for a random one. */
    cardPaletteId?: string;
    /** Decorative ball number — omit for a random one. */
    cardBallNumber?: number;
  }) => api.post<BingoRoom>('/admin/bingo/rooms', dto).then((r) => r.data),
  /** Cosmetic-only: rename and/or restyle a room's lobby card. Any room, any
   * status. Pass cardPaletteId/cardBallNumber as null to re-roll them at random. */
  updateRoomDisplay: (roomId: string, dto: { name?: string; cardPaletteId?: string | null; cardBallNumber?: number | null }) =>
    api.patch<BingoRoom>(`/admin/bingo/rooms/${roomId}/display`, dto).then((r) => r.data),
  /** House + every agent room slot with its PERSISTENT label/palette/ball —
   * survives every auto-recreation, unlike updateRoomDisplay above. */
  listRoomSlots: () => api.get<BingoRoomSlot[]>('/admin/bingo/room-slots').then((r) => r.data),
  updateRoomSlot: (
    ownerId: string,
    dto: { label?: string | null; cardPaletteId?: string | null; cardBallNumber?: number | null; ticketPriceMinor?: number | null },
  ) => api.patch<BingoRoomSlot[]>(`/admin/bingo/room-slots/${encodeURIComponent(ownerId)}`, dto).then((r) => r.data),
  /** Persistent, independently-named custom rooms — each keeps recreating
   * itself with the same name/price/prizes/style after every round. */
  listCustomRoomSlots: () => api.get<BingoCustomRoomSlot[]>('/admin/bingo/room-slots/custom').then((r) => r.data),
  createCustomRoomSlot: (dto: {
    name: string;
    ticketPriceMinor: number;
    maxTickets: number;
    prizes: Record<string, number>;
    winMode?: string;
    numberRange?: number;
    patternPrizes?: Array<{ patternId: string; name: string; prizeMinor: number }>;
    cardPaletteId?: string;
    cardBallNumber?: number;
  }) => api.post<BingoCustomRoomSlot>('/admin/bingo/room-slots/custom', dto).then((r) => r.data),
  updateCustomRoomSlot: (
    id: string,
    dto: Partial<{
      name: string;
      ticketPriceMinor: number;
      maxTickets: number;
      prizes: Record<string, number>;
      winMode: string;
      numberRange: number;
      patternPrizes: Array<{ patternId: string; name: string; prizeMinor: number }>;
      cardPaletteId: string | null;
      cardBallNumber: number | null;
      isActive: boolean;
    }>,
  ) => api.patch<BingoCustomRoomSlot[]>(`/admin/bingo/room-slots/custom/${encodeURIComponent(id)}`, dto).then((r) => r.data),
  deleteCustomRoomSlot: (id: string) =>
    api.delete<BingoCustomRoomSlot[]>(`/admin/bingo/room-slots/custom/${encodeURIComponent(id)}`).then((r) => r.data),
  drawNext: (roomId: string) =>
    api.post<BingoRoom>(`/admin/bingo/rooms/${roomId}/draw-next`).then((r) => r.data),
  cancelRoom: (roomId: string) =>
    api.post<BingoRoom>(`/admin/bingo/rooms/${roomId}/cancel`).then((r) => r.data),
  listPatterns: () => api.get<BingoPattern[]>('/admin/bingo/patterns').then((r) => r.data),
  createPattern: (dto: Partial<BingoPattern>) =>
    api.post<BingoPattern>('/admin/bingo/patterns', dto).then((r) => r.data),
  updatePattern: (id: string, dto: Partial<BingoPattern>) =>
    api.patch<BingoPattern>(`/admin/bingo/patterns/${id}`, dto).then((r) => r.data),
  deletePattern: (id: string) =>
    api.delete(`/admin/bingo/patterns/${id}`).then((r) => r.data),
  seedPatterns: () =>
    api.post<BingoPattern[]>('/admin/bingo/patterns/seed').then((r) => r.data),
};

// ── Admin: Bots ───────────────────────────────────────────────────
export type BotUser = {
  id: string;
  displayName: string;
  walletBalanceMinor?: number;
  botPolicy: {
    ticketsPerRound: number;
    spotCount: number;
    drawParticipationCount: number;
    active: boolean;
    games?: {
      keno?: {
        active: boolean;
        strategy: 'conservative' | 'normal' | 'aggressive' | 'mirror-human';
        participationRatePct: number;
        actionDelayMinMs: number;
        actionDelayMaxMs: number;
        hesitationChancePct: number;
        variancePct: number;
        minBalanceMinor: number;
        maxStakeMinorPerDay: number;
        maxLossMinorPerDay: number;
        maxWinMinorPerDay: number;
        ticketsPerRound: number;
        spotCount: number;
        drawParticipationCount: number;
      };
      bingo?: {
        active: boolean;
        strategy: 'conservative' | 'normal' | 'aggressive' | 'mirror-human';
        participationRatePct: number;
        actionDelayMinMs: number;
        actionDelayMaxMs: number;
        hesitationChancePct: number;
        variancePct: number;
        minBalanceMinor: number;
        maxStakeMinorPerDay: number;
        maxLossMinorPerDay: number;
        maxWinMinorPerDay: number;
        maxCartelasPerRoom: number;
      };
      crash?: {
        active: boolean;
        strategy: 'conservative' | 'normal' | 'aggressive' | 'mirror-human';
        participationRatePct: number;
        actionDelayMinMs: number;
        actionDelayMaxMs: number;
        hesitationChancePct: number;
        variancePct: number;
        minBalanceMinor: number;
        maxStakeMinorPerDay: number;
        maxLossMinorPerDay: number;
        maxWinMinorPerDay: number;
        minCashoutX100: number;
        maxCashoutX100: number;
      };
    };
  };
};

export type BotActionLogRecord = {
  id: string;
  botId: string | null;
  game: 'keno' | 'bingo' | 'crash' | 'admin';
  action: string;
  sourceId: string | null;
  amountMinor: number | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
};

export type BotNameRecord = {
  id: string;
  displayName: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export const adminBotsApi = {
  listBots: () => api.get<BotUser[]>('/admin/bots').then((r) => r.data),
  createBot: (dto: {
    displayName: string;
    initialBalanceMinor: number;
    ticketsPerRound: number;
    spotCount: number;
    kenoActive?: boolean;
    bingoActive?: boolean;
    crashActive?: boolean;
    kenoStrategy?: 'conservative' | 'normal' | 'aggressive' | 'mirror-human';
    bingoStrategy?: 'conservative' | 'normal' | 'aggressive' | 'mirror-human';
    crashStrategy?: 'conservative' | 'normal' | 'aggressive' | 'mirror-human';
    kenoParticipationRatePct?: number;
    kenoActionDelayMinMs?: number;
    kenoActionDelayMaxMs?: number;
    kenoHesitationChancePct?: number;
    kenoVariancePct?: number;
    bingoParticipationRatePct?: number;
    bingoActionDelayMinMs?: number;
    bingoActionDelayMaxMs?: number;
    bingoHesitationChancePct?: number;
    bingoVariancePct?: number;
    crashParticipationRatePct?: number;
    crashActionDelayMinMs?: number;
    crashActionDelayMaxMs?: number;
    crashHesitationChancePct?: number;
    crashVariancePct?: number;
    kenoMinBalanceMinor?: number;
    bingoMinBalanceMinor?: number;
    crashMinBalanceMinor?: number;
    kenoMaxStakeMinorPerDay?: number;
    bingoMaxStakeMinorPerDay?: number;
    crashMaxStakeMinorPerDay?: number;
    bingoMaxCartelasPerRoom?: number;
    crashMinCashoutX100?: number;
    crashMaxCashoutX100?: number;
  }) =>
    api.post<BotUser>('/admin/bots', dto).then((r) => r.data),
  updateBot: (id: string, dto: Partial<{
    displayName: string;
    active: boolean;
    ticketsPerRound: number;
    spotCount: number;
    kenoActive: boolean;
    bingoActive: boolean;
    crashActive: boolean;
    kenoStrategy: 'conservative' | 'normal' | 'aggressive' | 'mirror-human';
    bingoStrategy: 'conservative' | 'normal' | 'aggressive' | 'mirror-human';
    crashStrategy: 'conservative' | 'normal' | 'aggressive' | 'mirror-human';
    kenoParticipationRatePct: number;
    kenoActionDelayMinMs: number;
    kenoActionDelayMaxMs: number;
    kenoHesitationChancePct: number;
    kenoVariancePct: number;
    bingoParticipationRatePct: number;
    bingoActionDelayMinMs: number;
    bingoActionDelayMaxMs: number;
    bingoHesitationChancePct: number;
    bingoVariancePct: number;
    crashParticipationRatePct: number;
    crashActionDelayMinMs: number;
    crashActionDelayMaxMs: number;
    crashHesitationChancePct: number;
    crashVariancePct: number;
    kenoMinBalanceMinor: number;
    bingoMinBalanceMinor: number;
    crashMinBalanceMinor: number;
    kenoMaxStakeMinorPerDay: number;
    bingoMaxStakeMinorPerDay: number;
    crashMaxStakeMinorPerDay: number;
    bingoMaxCartelasPerRoom: number;
    crashMinCashoutX100: number;
    crashMaxCashoutX100: number;
  }>) =>
    api.patch<BotUser>(`/admin/bots/${id}`, dto).then((r) => r.data),
  topupBot: (id: string, amountMinor: number) =>
    api.post<BotUser>(`/admin/bots/${id}/topup`, { amountMinor }).then((r) => r.data),
  deleteBot: (id: string) =>
    api.delete(`/admin/bots/${id}`).then((r) => r.data),
  listBotActions: (params?: { botId?: string; game?: 'keno' | 'bingo' | 'crash' | 'admin'; page?: number; limit?: number }) => {
    const search = new URLSearchParams();
    if (params?.botId) search.set('botId', params.botId);
    if (params?.game) search.set('game', params.game);
    if (params?.page) search.set('page', String(params.page));
    if (params?.limit) search.set('limit', String(params.limit));
    const suffix = search.toString();
    return api.get<{ data: BotActionLogRecord[]; total: number; page: number; limit: number; totalPages: number }>(
      `/admin/bots/actions${suffix ? `?${suffix}` : ''}`,
    ).then((r) => r.data);
  },
  listBotNames: () => api.get<BotNameRecord[]>('/admin/bots/names').then((r) => r.data),
  createBotName: (dto: { displayName: string; active?: boolean }) =>
    api.post<BotNameRecord>('/admin/bots/names', dto).then((r) => r.data),
  importBotNames: (dto: { names: string[] }) =>
    api.post<BotNameRecord[]>('/admin/bots/names/import', dto).then((r) => r.data),
  updateBotName: (id: string, dto: Partial<{ displayName: string; active: boolean }>) =>
    api.patch<BotNameRecord>(`/admin/bots/names/${id}`, dto).then((r) => r.data),
  deleteBotName: (id: string) =>
    api.delete(`/admin/bots/names/${id}`).then((r) => r.data),
};

// ── Admin: Agents ─────────────────────────────────────────────────
export type AgentLedgerAction = {
  id: string;
  agentId: string;
  agentName?: string;
  amountMinor: number;
  direction: 'credit' | 'debit';
  entryType: string;
  sourceType: string;
  sourceId: string;
  balanceAfterMinor: number;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type AgentWithdrawalAction = {
  id: string;
  userId: string;
  userName?: string;
  agentId?: string;
  agentName?: string;
  amountMinor: number;
  status: string;
  destinationAccount: string;
  serviceChargeMinor?: number;
  serviceFeeMinor?: number;
  commissionMinor?: number;
  netAmountMinor?: number;
  telebirrReference?: string;
  adminNotes?: string;
  claimedAt?: string;
  processedAt?: string;
  updatedAt?: string;
  createdAt: string;
};

export type AgentActionEvent = {
  id: string;
  agentId: string;
  agentName?: string;
  userId?: string;
  userName?: string;
  withdrawalId?: string;
  ledgerEntryId?: string;
  actionType: string;
  amountMinor?: number;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type AgentDepositAction = {
  id: string;
  agentId?: string;
  agentName?: string;
  userId: string;
  userName?: string;
  receiptNo: string;
  amountMinor: number;
  status: string;
  payerPhone?: string;
  creditedPartyAccount?: string;
  createdAt: string;
};

export type AgentAuditSummary = {
  agentId: string;
  agentName?: string;
  totalDepositsMinor: number;
  depositCount: number;
  totalTransfersToUsersMinor: number;
  transferCount: number;
  totalWithdrawalsMinor: number;
  withdrawalCount: number;
  totalReceiptsMinor: number;
  receiptCount: number;
  eventCount: number;
};

export type AdminUserDeposit = {
  id: string;
  receiptNo: string;
  amountMinor: number;
  status: string;
  payerPhone?: string;
  creditedPartyAccount?: string;
  agentId?: string;
  agent?: User;
  createdAt: string;
};

export type AdminGameStat = {
  tickets: number;
  rounds: number;
  stakedMinor: number;
  wins: number;
  winMinor: number;
};

export type AdminUserGameStats = {
  bingo: AdminGameStat;
  keno: AdminGameStat;
  crash: AdminGameStat;
  totalGamesPlayed: number;
  totalRoundsPlayed: number;
  totalStakedMinor: number;
  totalWins: number;
  totalWinMinor: number;
};

export type AdminUserActivity = {
  user: User;
  ledger: LedgerEntry[];
  withdrawals: Withdrawal[];
  deposits: AdminUserDeposit[];
  gameStats: AdminUserGameStats;
  totals: {
    walletAvailableMinor: number;
    walletReservedMinor: number;
    depositMinor: number;
    completedWithdrawalMinor: number;
  };
};

export const adminAgentsApi = {
  listAgents: (page = 1, limit = 50) =>
    api.get<{ data: User[]; total: number; page: number; limit: number }>(`/admin/agents?page=${page}&limit=${limit}`)
      .then((r) => r.data.data),
  createAgent: (dto: Partial<User & { password?: string }>) =>
    api.post<User>('/admin/agents', dto).then((r) => r.data),
  updateAgent: (id: string, dto: Partial<User & { password?: string }>) =>
    api.patch<User>(`/admin/agents/${id}`, dto).then((r) => r.data),
  setAgentOnDuty: (id: string, mode: 'auto' | 'on' | 'off') =>
    api.patch<User>(`/admin/agents/${id}/on-duty`, { mode }).then((r) => r.data),
  listActions: (limit = 100) =>
    api.get<{
      events: AgentActionEvent[];
      deposits: AgentDepositAction[];
      ledger: AgentLedgerAction[];
      withdrawals: AgentWithdrawalAction[];
      summaryByAgent: AgentAuditSummary[];
    }>(`/admin/agents/actions?limit=${limit}`).then((r) => r.data),
};

// ── Admin: Locations ───────────────────────────────────────────────
export const adminLocationsApi = {
  list: () => api.get<AdminLocation[]>('/admin/locations').then((r) => r.data),
  create: (dto: {
    name: string;
    region?: string;
    latitude?: number;
    longitude?: number;
    radiusMeters?: number;
    isActive?: boolean;
    sortOrder?: number;
  }) => api.post<AdminLocation>('/admin/locations', dto).then((r) => r.data),
  update: (id: string, dto: Partial<{
    name: string;
    region: string;
    latitude: number;
    longitude: number;
    radiusMeters: number;
    isActive: boolean;
    sortOrder: number;
  }>) => api.patch<AdminLocation>(`/admin/locations/${id}`, dto).then((r) => r.data),
  remove: (id: string) => api.delete(`/admin/locations/${id}`).then((r) => r.data),
  listLocationAgents: (id: string) =>
    api.get<Array<{ agentId: string; displayName: string; isPrimary: boolean }>>(`/admin/locations/${id}/agents`).then((r) => r.data),
  listAgentLocations: (agentId: string) =>
    api.get<Array<PublicLocation & { isPrimary: boolean }>>(`/admin/agents/${agentId}/locations`).then((r) => r.data),
  setAgentLocations: (agentId: string, dto: { locationIds: string[]; primaryLocationId?: string }) =>
    api.put<Array<{ id: string; agentId: string; locationId: string; isPrimary: boolean }>>(`/admin/agents/${agentId}/locations`, dto).then((r) => r.data),
};

// ── Admin: Withdrawals ─────────────────────────────────────────────
export const adminWithdrawalsApi = {
  listWithdrawals: () => api.get<Withdrawal[]>('/admin/withdrawals').then((r) => r.data),
  processWithdrawal: (id: string, action: 'approve' | 'reject', adminNotes?: string) =>
    api.post<Withdrawal>(`/admin/withdrawals/${id}/process`, { action, adminNotes }).then((r) => r.data),
  /** Admin sign-off on an agent-submitted withdrawal (status 'awaiting_verification') —
   * approve is what actually releases the fund-hold and credits the agent. */
  verifyWithdrawal: (id: string, decision: 'approve' | 'reject', notes?: string) =>
    api.post<Withdrawal>(`/admin/withdrawals/${id}/verify`, { decision, notes }).then((r) => r.data),
  /** Admin-direct completion — records agent/fee/reference/receipt and completes
   * in one step (fee is always resolved server-side, never sent from here). */
  completeWithAgent: (id: string, dto: { agentId: string; telebirrReference: string; receiptFileUrl: string; transferCompletedAt?: string }) =>
    api.post<Withdrawal>(`/admin/withdrawals/${id}/complete-with-agent`, dto).then((r) => r.data),
  /** Upload a photo/PDF of the payout receipt for the above. */
  uploadReceipt: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return api.post<{ fileUrl: string }>('/admin/withdrawals/receipts/upload', form).then((r) => r.data);
  },
};

// ── Admin: Agent Settlements ────────────────────────────────────────
export const adminSettlementsApi = {
  listAll: (page = 1, limit = 50) =>
    api.get<{ data: AgentSettlement[]; total: number; page: number; limit: number }>('/admin/settlements', { params: { page, limit } }).then((r) => r.data),
  listForAgent: (agentId: string, page = 1, limit = 50) =>
    api.get<{ data: AgentSettlement[]; total: number; page: number; limit: number }>(`/admin/agents/${agentId}/settlements`, { params: { page, limit } }).then((r) => r.data),
  create: (agentId: string, periodStart: string, periodEnd: string, notes?: string) =>
    api.post<AgentSettlement>(`/admin/agents/${agentId}/settlements`, { periodStart, periodEnd, notes }).then((r) => r.data),
  update: (id: string, dto: Partial<{
    status: AgentSettlementStatus;
    paymentMethod: AgentSettlementPaymentMethod | null;
    ftNumber: string | null;
    receiptFileUrl: string | null;
    paidAt: string | null;
    amountPaidMinor: number;
    notes: string | null;
  }>) => api.patch<AgentSettlement>(`/admin/settlements/${id}`, dto).then((r) => r.data),
  /** Upload a photo/PDF of the payment receipt — returns a relative path to pass as receiptFileUrl. */
  uploadReceipt: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return api.post<{ fileUrl: string }>('/admin/settlements/receipts/upload', form).then((r) => r.data);
  },
};

// ── Agent: Withdrawals ─────────────────────────────────────────────
export const agentApi = {
  getConfig: () => api.get<{ withdrawalFeeRanges: Array<{ minAmountMinor: number; maxAmountMinor: number | null; feeMinor: number }> }>('/agent/config').then((r) => r.data),
  getPerformance: () => api.get<AgentSelfPerformance>('/agent/performance').then((r) => r.data),
  getDashboard: () => api.get<AgentDashboardSummary>('/agent/dashboard').then((r) => r.data),
  getSettlements: (page = 1, limit = 50) =>
    api.get<{ data: AgentSettlement[]; total: number; page: number; limit: number }>('/agent/settlements', { params: { page, limit } }).then((r) => r.data),
  getReferral: () => api.get<AgentReferral>('/agent/referral').then((r) => r.data),
  getAvailableWithdrawals: () => api.get<Withdrawal[]>('/agent/withdrawals').then((r) => r.data),
  getMyWithdrawals: () => api.get<Withdrawal[]>('/agent/withdrawals/my').then((r) => r.data),
  getTransactions: () => api.get<{ ledger: LedgerEntry[]; withdrawals: Withdrawal[] }>('/agent/transactions').then((r) => r.data),
  claimWithdrawal: (id: string) => api.post<Withdrawal>(`/agent/withdrawals/${id}/claim`).then((r) => r.data),
  releaseWithdrawal: (id: string) => api.post<Withdrawal>(`/agent/withdrawals/${id}/release`).then((r) => r.data),
  rejectWithdrawal: (id: string, remarks: string) => api.post<Withdrawal>(`/agent/withdrawals/${id}/reject`, { remarks }).then((r) => r.data),
  completeWithdrawal: (id: string, provider: 'telebirr' | 'mpesa', proof: string, receiptFileUrl: string, transferCompletedAt: string) =>
    api.post<Withdrawal>(`/agent/withdrawals/${id}/complete`, { provider, proof, receiptFileUrl, transferCompletedAt }, { timeout: 45000 }).then((r) => r.data),
  /** Upload a photo/PDF of the payout receipt before completing — returns a
   * relative path (e.g. "withdrawal-receipts/<uuid>.jpg") to pass as receiptFileUrl. */
  uploadWithdrawalReceipt: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return api.post<{ fileUrl: string }>('/agent/withdrawals/receipts/upload', form).then((r) => r.data);
  },
  transferToUser: (phoneNumber: string, amountMinor: number, idempotencyKey?: string) =>
    api.post<{ agentWallet: Wallet; userWallet: Wallet }>('/agent/wallet/transfer-to-user', { phoneNumber, amountMinor, idempotencyKey }).then((r) => r.data),

  // ── Area reporting: players in the agent's assigned locations ──────
  listAreaPlayers: (search?: string, page = 1, limit = 20) => {
    let url = `/agent/area/players?page=${page}&limit=${limit}`;
    if (search) url += `&search=${encodeURIComponent(search)}`;
    return api.get<AreaPlayersPage>(url).then((r) => r.data);
  },
  getAreaPlayerActivity: (userId: string) =>
    api.get<AreaPlayerActivity>(`/agent/area/players/${userId}/activity`).then((r) => r.data),
};

export type AgentReferral = {
  code: string;
  /** Ready-made t.me deep link, or null when TELEGRAM_BOT_USERNAME is unset server-side. */
  link: string | null;
  referredPlayers: number;
};

export type AreaPlayer = {
  id: string;
  displayName: string;
  phoneNumber: string | null;
  walletBalanceMinor: number;
  status: string;
  isMyReferral: boolean;
  createdAt: string;
};

export type AreaPlayersPage = {
  data: AreaPlayer[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

export type AreaGameSummary = {
  played: number;
  won: number;
  stakedMinor: number;
  payoutMinor: number;
};

export type AreaPlayerActivity = {
  player: { id: string; displayName: string; phoneNumber: string | null; isMyReferral: boolean };
  deposits: {
    telebirr: Array<{ id: string; receiptNo: string; amountMinor: number; status: string; createdAt: string }>;
    mpesa: Array<{ id: string; confirmationCode: string; amountMinor: number; status: string; createdAt: string }>;
  };
  withdrawals: Array<{ id: string; amountMinor: number; status: string; destinationAccount: string; createdAt: string; processedAt: string | null }>;
  games: {
    bingo: AreaGameSummary;
    keno: AreaGameSummary;
    crash: AreaGameSummary;
  };
};

// ── Admin: Users ───────────────────────────────────────────────────
export const adminUsersApi = {
  listUsers: (
    page = 1,
    limit = 50,
    role?: string,
    search?: string,
    filters?: {
      isBot?: boolean;
      status?: 'active' | 'suspended' | 'closed';
      online?: boolean;
      hasPhone?: boolean;
      minBalanceMinor?: number;
      maxBalanceMinor?: number;
    },
  ) => {
    let url = `/admin/users?page=${page}&limit=${limit}`;
    if (role) url += `&role=${role}`;
    if (search) url += `&search=${encodeURIComponent(search)}`;
    if (filters?.isBot !== undefined) url += `&isBot=${filters.isBot}`;
    if (filters?.status) url += `&status=${filters.status}`;
    if (filters?.online !== undefined) url += `&online=${filters.online}`;
    if (filters?.hasPhone !== undefined) url += `&hasPhone=${filters.hasPhone}`;
    if (filters?.minBalanceMinor !== undefined) url += `&minBalanceMinor=${filters.minBalanceMinor}`;
    if (filters?.maxBalanceMinor !== undefined) url += `&maxBalanceMinor=${filters.maxBalanceMinor}`;
    return api.get<{ data: User[]; total: number; page: number; limit: number }>(url).then((r) => r.data);
  },
  updateUserStatus: (id: string, status: 'active' | 'suspended' | 'closed') =>
    api.put<User>(`/admin/users/${id}/status`, { status }).then((r) => r.data),
  adjustWallet: (userId: string, amountMinor: number, direction: 'credit' | 'debit', reason: string) =>
    api.post<User>(`/admin/users/${userId}/wallet/adjust`, { amountMinor, direction, reason }).then((r) => r.data),
  getUserActivity: (userId: string, limit = 20) =>
    api.get<AdminUserActivity>(`/admin/users/${userId}/activity?limit=${limit}`).then((r) => r.data),
};

// ── Support (tickets, complaints, disputes, refunds, live chat) ───
export type SupportTicketCategory = 'general' | 'complaint' | 'dispute' | 'refund' | 'live_chat';
export type SupportTicketStatus = 'open' | 'pending_agent' | 'pending_user' | 'resolved' | 'closed';
export type SupportTicketPriority = 'low' | 'normal' | 'high' | 'urgent';
export type SupportResolutionType = 'resolved' | 'rejected' | 'refunded';

export type SupportTicket = {
  id: string;
  userId: string;
  category: SupportTicketCategory;
  subject: string;
  status: SupportTicketStatus;
  priority: SupportTicketPriority;
  assignedAgentId: string | null;
  relatedType: string | null;
  relatedId: string | null;
  requestedAmountMinor: number | null;
  resolutionType: SupportResolutionType | null;
  resolutionNote: string | null;
  refundLedgerEntryId: string | null;
  refundedAmountMinor: number | null;
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SupportRequestType = 'complaint' | 'dispute' | 'refund';
export type SupportRequestStatus = 'pending' | 'approved' | 'rejected';

export type SupportMessage = {
  id: string;
  authorId: string | null;
  authorRole: 'user' | 'agent' | 'system';
  body: string;
  attachments: Record<string, unknown>[] | null;
  internal: boolean;
  createdAt: string;
  // Present only when the message is a tagged request.
  requestType: SupportRequestType | null;
  requestStatus: SupportRequestStatus | null;
  requestedAmountMinor: number | null;
  relatedType: string | null;
  relatedId: string | null;
  refundedAmountMinor: number | null;
  resolutionNote: string | null;
  decidedAt: string | null;
};

export type SupportConversation = { ticket: SupportTicket; messages: SupportMessage[] };

export type PostMessageInput = {
  body: string;
  requestType?: SupportRequestType;
  requestedAmountMinor?: number;
  relatedType?: string;
  relatedId?: string;
};

export const supportApi = {
  /** The user's single support conversation. */
  getConversation: () =>
    api.get<SupportConversation>('/support/conversation').then((r) => r.data),
  /** Post a message, optionally as a tagged refund/dispute/complaint request. */
  postMessage: (input: PostMessageInput) =>
    api.post<SupportMessage>('/support/messages', input).then((r) => r.data),
};

export type SupportTicketFilter = {
  status?: SupportTicketStatus;
  category?: SupportTicketCategory;
  assignedAgentId?: string; // or 'me'
  limit?: number;
  offset?: number;
};

export const supportAgentApi = {
  list: (filter: SupportTicketFilter = {}) => {
    const params = new URLSearchParams();
    if (filter.status) params.set('status', filter.status);
    if (filter.category) params.set('category', filter.category);
    if (filter.assignedAgentId) params.set('assignedAgentId', filter.assignedAgentId);
    params.set('limit', String(filter.limit ?? 30));
    params.set('offset', String(filter.offset ?? 0));
    return api
      .get<{ items: SupportTicket[]; total: number }>(`/agent/support/tickets?${params.toString()}`)
      .then((r) => r.data);
  },
  get: (id: string) =>
    api.get<SupportConversation>(`/agent/support/tickets/${id}`).then((r) => r.data),
  reply: (id: string, body: string, internal = false) =>
    api.post<SupportMessage>(`/agent/support/tickets/${id}/messages`, { body, internal }).then((r) => r.data),
  update: (id: string, dto: { status?: SupportTicketStatus; priority?: SupportTicketPriority; assignedAgentId?: string | null }) =>
    api.patch<SupportTicket>(`/agent/support/tickets/${id}`, dto).then((r) => r.data),
  claim: (id: string) =>
    api.post<SupportTicket>(`/agent/support/tickets/${id}/claim`).then((r) => r.data),
  // Request actions are message-level now (a request is a tagged message).
  approveRefund: (messageId: string, dto: { amountMinor?: number; note?: string }) =>
    api.post<SupportMessage>(`/agent/support/messages/${messageId}/refund/approve`, dto).then((r) => r.data),
  reject: (messageId: string, reason: string) =>
    api.post<SupportMessage>(`/agent/support/messages/${messageId}/reject`, { reason }).then((r) => r.data),
};

// ── Games catalog + admin availability control ───────────────────
export type GameCode = 'keno' | 'bingo' | 'crash' | 'pool';
export type GameState = 'enabled' | 'maintenance' | 'hidden';

export type GameCatalogEntry = {
  code: GameCode;
  name: string;
  state: GameState;
  maintenanceMessage: string | null;
  playable: boolean;
  displayOrder: number;
};

export const gamesApi = {
  getCatalog: () => api.get<GameCatalogEntry[]>('/games/catalog').then((r) => r.data),
};

export const adminGamesApi = {
  list: () => api.get<GameCatalogEntry[]>('/admin/games').then((r) => r.data),
  update: (code: GameCode, dto: { state?: GameState; maintenanceMessage?: string | null; displayOrder?: number }) =>
    api.patch<GameCatalogEntry>(`/admin/games/${code}`, dto).then((r) => r.data),
};

// ── Pool admin ───────────────────────────────────────────────────────────────
export type PoolBotDifficulty = 'easy' | 'medium' | 'hard';

/** Full editable Pool config (admin view) — mirrors PoolConfig entity + DTO. */
export type AdminPoolConfig = {
  // Single player
  singlePlayerEnabled: boolean;
  singlePlayerStakeMinor: number;
  botDifficulty: PoolBotDifficulty;
  // Two player
  twoPlayerEnabled: boolean;
  minStakeMinor: number;
  maxStakeMinor: number;
  rakePct: number;
  shotClockSeconds: number;
  maxTimeoutFouls: number;
  // Tournament
  tournamentEnabled: boolean;
  tournamentEntryFeeMinor: number;
  tournamentSize: number;
  tournamentRakePct: number;
  tournamentPrize1Weight: number;
  tournamentPrize2Weight: number;
  tournamentPrize34Weight: number;
  // Physics tuning (integers)
  slidingFrictionX100: number;
  rollingFrictionX1000: number;
  cushionReboundPct: number;
  ballReboundPct: number;
  pocketSizePct: number;
  cueMaxSpeedX100: number;
  maxSideSpin: number;
  maxRollSpin: number;
  // Rules
  strictCallShot: boolean;
  // Global
  rulesetVersion: number;
  engineVersion: number;
};

export type AdminPoolTournament = {
  id: string;
  name: string;
  status: 'registering' | 'active' | 'completed' | 'cancelled';
  size: number;
  rounds: number;
  entryFeeMinor: number;
  rakePct: number;
  prizePoolMinor: number;
  winnerUserId: string | null;
};

export const adminPoolApi = {
  getConfig: () => api.get<AdminPoolConfig>('/admin/pool/config').then((r) => r.data),
  updateConfig: (dto: Partial<AdminPoolConfig>) =>
    api.patch<AdminPoolConfig>('/admin/pool/config', dto).then((r) => r.data),
  createTournament: (name?: string) =>
    api.post<AdminPoolTournament>('/admin/pool/tournaments', { name }).then((r) => r.data),
  startTournament: (id: string) =>
    api.post<AdminPoolTournament>(`/admin/pool/tournaments/${id}/start`, {}).then((r) => r.data),
};

export default api;

  
export const adminGameTransactionsApi = {
  getGameTransactions: (page?: number, limit?: number) =>
    api.get<{ data: any[], total: number }>('/admin/game-transactions', { params: { page, limit } }).then((r) => r.data)
};

export const adminDepositsApi = {
  getDeposits: (provider: 'telebirr' | 'mpesa', page?: number, limit?: number, status?: 'credited' | 'rejected') =>
    api.get<{ data: any[], total: number }>('/admin/deposits', { params: { provider, page, limit, status } }).then((r) => r.data),
  verifyDeposit: (provider: 'telebirr' | 'mpesa', id: string, verificationStatus: 'verified' | 'flagged') =>
    api.patch(`/admin/deposits/${id}/verify`, { provider, verificationStatus }).then((r) => r.data),
};
