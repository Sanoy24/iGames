import axios from 'axios';
import type {
  AuthTokenResponse,
  BingoRoom,
  BingoRoomState,
  BingoTicket,
  KenoConfig,
  KenoDraw,
  KenoTicket,
  LedgerEntry,
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
};

// ── Wallet ────────────────────────────────────────────────────────
export const walletApi = {
  getWallet: () => api.get<Wallet>('/wallet').then((r) => r.data),
  getLedger: (limit = 20) => api.get<LedgerEntry[]>(`/wallet/ledger?limit=${limit}`).then((r) => r.data),
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
  listAllRooms: () => api.get<BingoRoom[]>('/bingo/rooms').then((r) => r.data),
  createRoom: (dto: {
    name: string;
    ticketPriceMinor: number;
    maxTickets: number;
    scheduledStartAt: string;
    prizes: Record<string, number>;
  }) => api.post<BingoRoom>('/admin/bingo/rooms', dto).then((r) => r.data),
  drawNext: (roomId: string) =>
    api.post<BingoRoom>(`/admin/bingo/rooms/${roomId}/draw-next`).then((r) => r.data),
  cancelRoom: (roomId: string) =>
    api.post<BingoRoom>(`/admin/bingo/rooms/${roomId}/cancel`).then((r) => r.data),
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
export const adminAgentsApi = {
  listAgents: (page = 1, limit = 50) =>
    api.get<{ data: User[]; total: number; page: number; limit: number }>(`/admin/agents?page=${page}&limit=${limit}`)
      .then((r) => r.data.data),
  createAgent: (dto: { phoneNumber: string; displayName: string; password: string }) =>
    api.post<User>('/admin/agents', dto).then((r) => r.data),
};

// ── Admin: Withdrawals ─────────────────────────────────────────────
export const adminWithdrawalsApi = {
  listWithdrawals: () => api.get<Withdrawal[]>('/admin/withdrawals').then((r) => r.data),
  processWithdrawal: (id: string, action: 'approve' | 'reject', adminNotes?: string) =>
    api.post<Withdrawal>(`/admin/withdrawals/${id}/process`, { action, adminNotes }).then((r) => r.data),
};

// ── Agent: Withdrawals ─────────────────────────────────────────────
export const agentApi = {
  getAvailableWithdrawals: () => api.get<Withdrawal[]>('/agent/withdrawals').then((r) => r.data),
  getMyWithdrawals: () => api.get<Withdrawal[]>('/agent/withdrawals/my').then((r) => r.data),
  claimWithdrawal: (id: string) => api.post<Withdrawal>(`/agent/withdrawals/${id}/claim`).then((r) => r.data),
  releaseWithdrawal: (id: string) => api.post<Withdrawal>(`/agent/withdrawals/${id}/release`).then((r) => r.data),
  completeWithdrawal: (id: string, telebirrReference: string) =>
    api.post<Withdrawal>(`/agent/withdrawals/${id}/complete`, { telebirrReference }).then((r) => r.data),
};

export default api;

