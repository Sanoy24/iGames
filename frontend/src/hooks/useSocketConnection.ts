import { useEffect } from 'react';
import { io, Socket } from 'socket.io-client';
import { useStore } from '../store/useStore';
import type { Wallet } from '../lib/models';

let socketInstance: Socket | null = null;

type MaintenancePayload = {
  etaSeconds: number;
};

// Silently refresh the access token using the stored refresh token
async function refreshAccessToken(): Promise<string | null> {
  try {
    const rt = localStorage.getItem('refreshToken');
    if (!rt) return null;
    const baseUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
    const res = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: rt }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { accessToken: string; refreshToken?: string };
    localStorage.setItem('accessToken', data.accessToken);
    if (data.refreshToken) localStorage.setItem('refreshToken', data.refreshToken);
    return data.accessToken;
  } catch {
    return null;
  }
}

export function useSocketConnection() {
  const setSocketConnected = useStore((s) => s.setSocketConnected);
  const isAuthenticated = useStore((s) => s.isAuthenticated);
  const addToast = useStore((s) => s.addToast);
  const setWallet = useStore((s) => s.setWallet);

  useEffect(() => {
    if (!isAuthenticated) return;

    if (!socketInstance) {
      const token = localStorage.getItem('accessToken');
      const SOCKET_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

      socketInstance = io(SOCKET_URL, {
        auth: { token },
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 10000,
        timeout: 20000,
      });

      socketInstance.on('connect', () => setSocketConnected(true));
      socketInstance.on('disconnect', () => setSocketConnected(false));

      // On connect error, silently try to refresh the access token and update
      // the socket auth before the next reconnect attempt — users should never
      // see an "Access token invalid" toast just because their tab was open.
      socketInstance.on('connect_error', async () => {
        setSocketConnected(false);
        if (!socketInstance) return;
        // Only refresh if we have a refresh token (i.e., not a network error)
        const newToken = await refreshAccessToken();
        if (newToken && socketInstance) {
          // Update auth so the next reconnect uses the fresh token
          socketInstance.auth = { token: newToken };
        }
      });

      socketInstance.on('system.maintenance', (data: MaintenancePayload) => {
        addToast('error', `Server going down for maintenance in ${data.etaSeconds} seconds.`);
      });

      socketInstance.on('wallet.updated', (wallet: Wallet) => {
        setWallet(wallet);
      });

      socketInstance.on('live.counts', (counts: { kenoOnline: number; bingoOnline: number; totalOnline: number }) => {
        useStore.getState().setLiveCounts(counts);
      });
    }

    return () => {
      if (socketInstance) {
        socketInstance.disconnect();
        socketInstance = null;
        setSocketConnected(false);
      }
    };
  }, [isAuthenticated, setSocketConnected, addToast, setWallet]);

  return socketInstance;
}

export const getSocket = () => socketInstance;
