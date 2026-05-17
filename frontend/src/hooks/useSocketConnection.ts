import { useEffect } from 'react';
import { io, Socket } from 'socket.io-client';
import { useStore } from '../store/useStore';

let socketInstance: Socket | null = null;

export function useSocketConnection() {
  const setSocketConnected = useStore((s: any) => s.setSocketConnected);
  const isAuthenticated = useStore((s: any) => s.isAuthenticated);

  useEffect(() => {
    // Only connect if user is authenticated
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

      socketInstance.on('connect', () => {
        setSocketConnected(true);
        console.log('WebSocket connected:', socketInstance?.id);
      });

      socketInstance.on('disconnect', (reason) => {
        setSocketConnected(false);
        console.log('WebSocket disconnected:', reason);
      });

      socketInstance.on('connect_error', (error) => {
        setSocketConnected(false);
        console.error('WebSocket connection error:', error.message);
      });
    }

    return () => {
      if (socketInstance) {
        socketInstance.disconnect();
        socketInstance = null;
        setSocketConnected(false);
      }
    };
  }, [isAuthenticated, setSocketConnected]);

  return socketInstance;
}

export const getSocket = () => socketInstance;
