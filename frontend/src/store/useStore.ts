import { create } from 'zustand';
import type { User, Wallet } from '../lib/models';

export type Toast = {
  id: string;
  type: 'success' | 'error' | 'info';
  message: string;
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
  liveCounts: { kenoOnline: number; bingoOnline: number; totalOnline: number } | null;
  setLiveCounts: (counts: { kenoOnline: number; bingoOnline: number; totalOnline: number }) => void;
};

export const useStore = create<AppState>((set) => ({
  // Auth
  user: null,
  accessToken: null,
  isAuthenticated: false,
  authStatus: 'idle',
  isAuthLoading: false,
  authError: null,
  isSocketConnected: false,

  setAuth: (user, token, refreshToken?: string) => {
    localStorage.setItem('accessToken', token);
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

  setUser: (user) => set({ user }),

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
}));

// Helper: format minor units to display string
export const formatCredits = (minor: number) => {
  if (minor >= 1_000_000) return `${(minor / 1_000_000).toFixed(1)}M`;
  if (minor >= 1_000) return `${(minor / 1_000).toFixed(minor % 1000 === 0 ? 0 : 1)}K`;
  return minor.toString();
};
