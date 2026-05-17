import { useEffect } from 'react';
import { useStore } from '../store/useStore';
import { authApi, walletApi } from '../lib/api';
import { getTelegramWebApp } from '../lib/telegram';
import { getErrorMessage } from '../lib/utils';

export function useAuth() {
  const isAuthenticated = useStore((state) => state.isAuthenticated);
  const setAuth = useStore((state) => state.setAuth);
  const setWallet = useStore((state) => state.setWallet);
  const addToast = useStore((state) => state.addToast);
  const setAuthLoading = useStore((state) => state.setAuthLoading);
  const setAuthError = useStore((state) => state.setAuthError);

  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      setAuthLoading();

      try {
        // 1. Try Telegram WebApp initData
        const tg = getTelegramWebApp();
        if (tg?.initData) {
          tg.ready();
          tg.expand();
          tg.setHeaderColor?.('#12141a');
          tg.setBackgroundColor?.('#0a0b0f');
          const data = await authApi.loginWithTelegram(tg.initData);
          if (cancelled) {
            return;
          }
          setAuth(data.user, data.accessToken);
          const wallet = await walletApi.getWallet();
          if (cancelled) {
            return;
          }
          setWallet(wallet);
          return;
        }

        // 2. Dev fallback: auto-seed if already have token
        const existing = localStorage.getItem('accessToken');
        if (existing) {
          try {
            const wallet = await walletApi.getWallet();
            if (cancelled) {
              return;
            }
            setWallet(wallet);
            const payload = JSON.parse(atob(existing.split('.')[1] ?? ''));
            setAuth({ id: payload.sub, displayName: 'Dev User', roles: payload.roles }, existing);
            return;
          } catch {
            // Token expired — seed fresh
            localStorage.removeItem('accessToken');
          }
        }

        // 3. Dev: create fresh seeded player
        if (import.meta.env.DEV) {
          const data = await authApi.devSeedPlayer('Dev Player', 100000);
          if (cancelled) {
            return;
          }
          setAuth(data.user, data.accessToken);
          const wallet = await walletApi.getWallet();
          if (cancelled) {
            return;
          }
          setWallet(wallet);
          return;
        }

        setAuthError('Open this app inside Telegram to sign in.');
      } catch (err) {
        console.error('Auth init failed', err);
        const message = getErrorMessage(err);
        setAuthError(message);
        addToast('error', message);
      }
    };

    if (!isAuthenticated) {
      void init();
    } else {
      // Refresh wallet on mount
      walletApi.getWallet().then(setWallet).catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [addToast, isAuthenticated, setAuth, setAuthError, setAuthLoading, setWallet]);
}
