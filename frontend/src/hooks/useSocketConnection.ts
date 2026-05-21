import { useEffect } from 'react';
import { io, Socket } from 'socket.io-client';
import { useStore } from '../store/useStore';
import type { Wallet } from '../lib/models';

let socketInstance: Socket | null = null;

type MaintenancePayload = {
  etaSeconds: number;
};

export function useSocketConnection() {
  const setSocketConnected = useStore((s) => s.setSocketConnected);
  const isAuthenticated = useStore((s) => s.isAuthenticated);
  const addToast = useStore((s) => s.addToast);
  const setWallet = useStore((s) => s.setWallet);

  useEffect(() => {
    if (!isAuthenticated) return;

    if (!socketInstance) {
      const token = localStorage.getItem('accessToken');
      socketInstance = io(import.meta.env.VITE_API_URL || 'http://localhost:3000', {
        auth: { token },
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        timeout: 20000,
      });

      socketInstance.on('connect', () => setSocketConnected(true));
      socketInstance.on('disconnect', () => setSocketConnected(false));
      socketInstance.on('connect_error', () => setSocketConnected(false));

      socketInstance.on('system.maintenance', (data: MaintenancePayload) => {
        addToast('error', `Server going down for maintenance in ${data.etaSeconds} seconds.`);
      });

      socketInstance.on('wallet.updated', (wallet: Wallet) => {
        setWallet(wallet);
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
