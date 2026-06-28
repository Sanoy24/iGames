import axios from 'axios';
import type {
  AuthTokenResponse,
  BingoConfig,
  BingoPattern,
  BingoRoom,
  BingoRoomState,
  BingoTicket,
  KenoConfig,
  KenoDraw,
  KenoTicket,
  LedgerEntry,
  RecentWin,
  User,
  Wallet,
  Withdrawal,
} from './models';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? 'http://localhost:3000',
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
        `${import.meta.env.VITE_API_URL ?? 'http://localhost:3000'}/auth/refresh`,
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
  requestWithdrawal: (amountMinor: number, destinationAccount: string) =>
    api.post<Withdrawal>('/wallet/withdraw', { amountMinor, destinationAccount }).then((r) => r.data),
  getWithdrawals: () => api.get<Withdrawal[]>('/wallet/withdrawals').then((r) => r.data),
};

// ── Payments ──────────────────────────────────────────────────────
export const paymentsApi = {
  submitTelebirrReceipt: (receipt: string) => {
    const trimmed = receipt.trim();
    const body = /^https?:\/\//i.test(trimmed) ? { receiptUrl: trimmed } : { receiptNo: trimmed };
    return api.post('/payments/telebirr/receipts', body).then((r) => r.data);
  },
};

// ── Keno ──────────────────────────────────────────────────────────
export const kenoApi = {
  getConfig: () => api.get<KenoConfig>('/keno/config').then((r) => r.data),
  getActiveDraw: () => api.get<KenoDraw | null>('/keno/active-draw').then((r) => r.data),
  purchaseTicket: (selectedNumbers: number[], idempotencyKey: string) =>
    api
      .post<KenoTicket>('/keno/tickets', { selectedNumbers }, { headers: { 'Idempotency-Key': idempotencyKey } })
      .then((r) => r.data),
  listTickets: (limit = 20) => api.get<KenoTicket[]>(`/keno/tickets?limit=${limit}`).then((r) => r.data),
  getTicket: (id: string) => api.get<KenoTicket>(`/keno/tickets/${id}`).then((r) => r.data),
  listDraws: (limit = 10) => api.get<KenoDraw[]>(`/keno/draws?limit=${limit}`).then((r) => r.data),
};

// ── Bingo ─────────────────────────────────────────────────────────
export const bingoApi = {
  listRooms: () => api.get<BingoRoom[]>('/bingo/rooms').then((r) => r.data),
  getRoomState: (roomId: string) => api.get<BingoRoomState>(`/bingo/rooms/${roomId}/state`).then((r) => r.data),
  purchaseTickets: (roomId: string, count: number, idempotencyKey: string) =>
    api
      .post(
        `/bingo/rooms/${roomId}/tickets`,
        { count },
        { headers: { 'Idempotency-Key': idempotencyKey } }
      )
      .then((r) => r.data as BingoTicket[]),
};

// ── Users / Profile ───────────────────────────────────────────────
export const userApi = {
  getMe: () => api.get<User>('/users/me').then((r) => r.data),
  updateProfile: (dto: { displayName?: string; phoneNumber?: string }) =>
    api.patch<User>('/users/me', dto).then((r) => r.data),
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
  withdrawalServiceChargePct: number;
  withdrawalMinAmountMinor: number;
  withdrawalMaxAmountMinor: number;
  maxPendingWithdrawalsPerUser: number;
};

export const adminApi = {
  getOverview: () => api.get<PlatformStats>('/admin/stats/overview').then((r) => r.data),
  getConfig: () => api.get<SystemConfig>('/admin/config').then((r) => r.data),
  updateConfig: (dto: Partial<SystemConfig>) => api.post<SystemConfig>('/admin/config', dto).then((r) => r.data),
  topupWallet: (amountMinor: number, idempotencyKey?: string) =>
    api.post<Wallet>('/admin/wallet/topup', { amountMinor, idempotencyKey }).then((r) => r.data),
  transferToAgent: (agentId: string, amountMinor: number, idempotencyKey?: string) =>
    api.post<{ adminWallet: Wallet; agentWallet: Wallet }>('/admin/wallet/transfer-to-agent', { agentId, amountMinor, idempotencyKey }).then((r) => r.data),
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
export const adminBingoApi = {
  getConfig: () => api.get<BingoConfig>('/admin/bingo/config').then((r) => r.data),
  updateConfig: (dto: Partial<BingoConfig>) =>
    api.post<BingoConfig>('/admin/bingo/config', dto).then((r) => r.data),
  listAllRooms: () => api.get<BingoRoom[]>('/bingo/rooms').then((r) => r.data),
  createRoom: (dto: {
    name: string;
    ticketPriceMinor: number;
    maxTickets: number;
    scheduledStartAt: string;
    prizes: Record<string, number>;
    winMode?: string;
    numberRange?: number;
    patternPrizes?: Array<{ patternId: string; name: string; prizeMinor: number }>;
  }) => api.post<BingoRoom>('/admin/bingo/rooms', dto).then((r) => r.data),
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
  botPolicy: {
    ticketsPerRound: number;
    spotCount: number;
    active: boolean;
  };
};

export const adminBotsApi = {
  listBots: () => api.get<BotUser[]>('/admin/bots').then((r) => r.data),
  createBot: (dto: { displayName: string; initialBalanceMinor: number; ticketsPerRound: number; spotCount: number }) =>
    api.post<BotUser>('/admin/bots', dto).then((r) => r.data),
  updateBot: (id: string, dto: Partial<{ active: boolean; ticketsPerRound: number; spotCount: number }>) =>
    api.patch<BotUser>(`/admin/bots/${id}`, dto).then((r) => r.data),
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

export type AdminUserActivity = {
  user: User;
  ledger: LedgerEntry[];
  withdrawals: Withdrawal[];
  deposits: AdminUserDeposit[];
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
  listActions: (limit = 100) =>
    api.get<{
      events: AgentActionEvent[];
      deposits: AgentDepositAction[];
      ledger: AgentLedgerAction[];
      withdrawals: AgentWithdrawalAction[];
      summaryByAgent: AgentAuditSummary[];
    }>(`/admin/agents/actions?limit=${limit}`).then((r) => r.data),
};

// ── Admin: Withdrawals ─────────────────────────────────────────────
export const adminWithdrawalsApi = {
  listWithdrawals: () => api.get<Withdrawal[]>('/admin/withdrawals').then((r) => r.data),
  processWithdrawal: (id: string, action: 'approve' | 'reject', adminNotes?: string) =>
    api.post<Withdrawal>(`/admin/withdrawals/${id}/process`, { action, adminNotes }).then((r) => r.data),
};

// ── Agent: Withdrawals ─────────────────────────────────────────────
export const agentApi = {
  getConfig: () => api.get<{ withdrawalServiceChargePct: number }>('/agent/config').then((r) => r.data),
  getAvailableWithdrawals: () => api.get<Withdrawal[]>('/agent/withdrawals').then((r) => r.data),
  getMyWithdrawals: () => api.get<Withdrawal[]>('/agent/withdrawals/my').then((r) => r.data),
  getTransactions: () => api.get<{ ledger: LedgerEntry[]; withdrawals: Withdrawal[] }>('/agent/transactions').then((r) => r.data),
  claimWithdrawal: (id: string) => api.post<Withdrawal>(`/agent/withdrawals/${id}/claim`).then((r) => r.data),
  releaseWithdrawal: (id: string) => api.post<Withdrawal>(`/agent/withdrawals/${id}/release`).then((r) => r.data),
  rejectWithdrawal: (id: string, remarks: string) => api.post<Withdrawal>(`/agent/withdrawals/${id}/reject`, { remarks }).then((r) => r.data),
  completeWithdrawal: (id: string, telebirrReference: string) =>
    api.post<Withdrawal>(`/agent/withdrawals/${id}/complete`, { telebirrReference }).then((r) => r.data),
  transferToUser: (phoneNumber: string, amountMinor: number, idempotencyKey?: string) =>
    api.post<{ agentWallet: Wallet; userWallet: Wallet }>('/agent/wallet/transfer-to-user', { phoneNumber, amountMinor, idempotencyKey }).then((r) => r.data),
};

// ── Admin: Users ───────────────────────────────────────────────────
export const adminUsersApi = {
  listUsers: (page = 1, limit = 50, role?: string, search?: string) => {
    let url = `/admin/users?page=${page}&limit=${limit}`;
    if (role) url += `&role=${role}`;
    if (search) url += `&search=${encodeURIComponent(search)}`;
    return api.get<{ data: User[]; total: number; page: number; limit: number }>(url).then((r) => r.data);
  },
  updateUserStatus: (id: string, status: 'active' | 'suspended' | 'closed') =>
    api.put<User>(`/admin/users/${id}/status`, { status }).then((r) => r.data),
  adjustWallet: (userId: string, amountMinor: number, direction: 'credit' | 'debit', reason: string) =>
    api.post<User>(`/admin/users/${userId}/wallet/adjust`, { amountMinor, direction, reason }).then((r) => r.data),
  getUserActivity: (userId: string, limit = 20) =>
    api.get<AdminUserActivity>(`/admin/users/${userId}/activity?limit=${limit}`).then((r) => r.data),
};

export default api;

