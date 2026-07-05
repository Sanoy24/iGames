import { create } from 'zustand';
import type { User, Wallet } from '../lib/models';

export type Toast = {
  id: string;
  type: 'success' | 'error' | 'info';
  message: string;
};

export type NotificationKind = 'win' | 'deposit' | 'withdrawal' | 'adjustment' | 'bonus' | 'system' | 'info';

export type AppNotification = {
  id: string;
  type: NotificationKind;
  title: string;
  message: string;
  timestamp: number;
  read: boolean;
};

export type LiveCounts = {
  kenoOnline: number;
  bingoOnline: number;
  totalOnline: number;
  totalPlaying: number;
  totalConnections: number;
};

type AppState = {
  // Auth
  user: User | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  authStatus: 'idle' | 'loading' | 'ready' | 'error';
  isAuthLoading: boolean;
  authError: string | null;
  isSocketConnected: boolean;
  setAuth: (user: User, token: string, refreshToken?: string) => void;
  setUser: (user: User) => void;
  setAuthLoading: () => void;
  setAuthError: (message: string) => void;
  setSocketConnected: (connected: boolean) => void;
  clearAuth: () => void;

  // Wallet
  wallet: Wallet | null;
  setWallet: (wallet: Wallet) => void;

  // Toasts
  toasts: Toast[];
  addToast: (type: Toast['type'], message: string) => void;
  removeToast: (id: string) => void;

  // Live counts
  liveCounts: LiveCounts | null;
  setLiveCounts: (counts: LiveCounts) => void;

  // Audio settings
  soundVolume: number;
  soundMuted: boolean;
  setSoundVolume: (vol: number) => void;
  setSoundMuted: (muted: boolean) => void;

  // Notifications
  notifications: AppNotification[];
  unreadCount: number;
  addNotification: (n: Omit<AppNotification, 'id' | 'timestamp' | 'read'>) => void;
  setNotifications: (items: AppNotification[], unreadCount: number) => void;
  addServerNotification: (n: AppNotification) => void;
  markAllNotificationsRead: () => void;
};

function getStoredUser(): User | null {
  if (typeof window === 'undefined') return null;
  if (localStorage.getItem('manualLogout') === '1') return null;

  const storedToken = localStorage.getItem('accessToken');
  const storedUser = localStorage.getItem('authUser');
  if (!storedToken || !storedUser) return null;

  try {
    return JSON.parse(storedUser) as User;
  } catch {
    localStorage.removeItem('authUser');
    return null;
  }
}

const initialUser = getStoredUser();
const initialAccessToken =
  initialUser && typeof window !== 'undefined'
    ? localStorage.getItem('accessToken')
    : null;

export const useStore = create<AppState>((set) => ({
  // Auth
  user: initialUser,
  accessToken: initialAccessToken,
  isAuthenticated: Boolean(initialUser && initialAccessToken),
  authStatus: initialUser && initialAccessToken ? 'ready' : 'idle',
  isAuthLoading: false,
  authError: null,
  isSocketConnected: false,

  setAuth: (user, token, refreshToken?: string) => {
    localStorage.setItem('accessToken', token);
    localStorage.setItem('authUser', JSON.stringify(user));
    if (refreshToken) localStorage.setItem('refreshToken', refreshToken);
    set({
      user,
      accessToken: token,
      isAuthenticated: true,
      authStatus: 'ready',
      isAuthLoading: false,
      authError: null,
    });
  },

  setUser: (user) => {
    localStorage.setItem('authUser', JSON.stringify(user));
    set({ user });
  },

  setAuthLoading: () => set({ authStatus: 'loading', isAuthLoading: true, authError: null }),

  setAuthError: (message) =>
    set({
      authStatus: 'error',
      isAuthLoading: false,
      authError: message,
      user: null,
      accessToken: null,
      isAuthenticated: false,
      wallet: null,
    }),

  setSocketConnected: (connected) => set({ isSocketConnected: connected }),

  clearAuth: () => {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('authUser');
    set({
      user: null,
      accessToken: null,
      isAuthenticated: false,
      authStatus: 'idle',
      authError: null,
      wallet: null,
    });
  },

  // Wallet
  wallet: null,
  setWallet: (wallet) => set({ wallet }),

  // Toasts
  toasts: [],
  addToast: (type, message) => {
    const id = Math.random().toString(36).slice(2);
    set((s) => ({ toasts: [...s.toasts, { id, type, message }] }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, 3500);
  },
  removeToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  // Live counts
  liveCounts: null,
  setLiveCounts: (counts) => set({ liveCounts: counts }),

  // Audio settings
  soundVolume: typeof window !== 'undefined' ? Number(localStorage.getItem('soundVolume') ?? '0.5') : 0.5,
  soundMuted: typeof window !== 'undefined' ? localStorage.getItem('soundMuted') === '1' : false,
  setSoundVolume: (vol) => {
    localStorage.setItem('soundVolume', String(vol));
    set({ soundVolume: vol });
  },
  setSoundMuted: (muted) => {
    localStorage.setItem('soundMuted', muted ? '1' : '0');
    set({ soundMuted: muted });
  },

  // Notifications
  notifications: [],
  unreadCount: 0,
  addNotification: (n) => {
    const note: AppNotification = {
      ...n,
      id: Math.random().toString(36).slice(2),
      timestamp: Date.now(),
      read: false,
    };
    set((s) => ({
      notifications: [note, ...s.notifications].slice(0, 50),
      unreadCount: s.unreadCount + 1,
    }));
  },
  // Replace the list from the server (initial load).
  setNotifications: (items, unreadCount) =>
    set({ notifications: items.slice(0, 50), unreadCount }),
  // A live notification pushed over the socket — prepend, de-duplicate by id.
  addServerNotification: (n) =>
    set((s) => {
      if (s.notifications.some((x) => x.id === n.id)) return s;
      return {
        notifications: [n, ...s.notifications].slice(0, 50),
        unreadCount: s.unreadCount + (n.read ? 0 : 1),
      };
    }),
  markAllNotificationsRead: () =>
    set((s) => ({
      notifications: s.notifications.map((n) => ({ ...n, read: true })),
      unreadCount: 0,
    })),
}));

// Helper: format minor units to display string
export const formatCredits = (minor: number) => {
  if (minor >= 1_000_000) return `${(minor / 1_000_000).toFixed(1)}M`;
  if (minor >= 1_000) return `${(minor / 1_000).toFixed(minor % 1000 === 0 ? 0 : 1)}K`;
  return minor.toString();
};
