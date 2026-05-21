import { useEffect, useRef, useState } from 'react';
import { useSocketConnection } from './hooks/useSocketConnection';
import { useStore } from './store/useStore';
import { authApi, walletApi } from './lib/api';
import { Home } from './pages/Home';
import { Games } from './pages/Games';
import { Keno } from './pages/Keno';
import { Bingo } from './pages/Bingo';
import { Admin } from './pages/Admin';
import { Wallet } from './pages/Wallet';
import { BottomNav } from './components/BottomNav';
import { WalletBar } from './components/WalletBar';
import { Toasts } from './components/Toasts';
import type { AppTab } from './lib/navigation';

type TelegramWindow = Window &
  typeof globalThis & {
    Telegram?: {
      WebApp?: {
        initData?: string;
      };
    };
  };

export function App() {
  const { authStatus, setAuth, setAuthLoading, setAuthError, setWallet } = useStore();
  const [activeTab, setActiveTab] = useState<AppTab>('home');
  const loginStarted = useRef(false);

  useSocketConnection();

  useEffect(() => {
    if (authStatus !== 'idle' || loginStarted.current) return;

    loginStarted.current = true;
    setAuthLoading();

    const tg = (window as TelegramWindow).Telegram?.WebApp;
    const loginPromise = tg?.initData
      ? authApi.loginWithTelegram(tg.initData)
      : authApi.devSeedAdmin('Dev Admin');

    loginPromise
      .then(async ({ user, accessToken }) => {
        setAuth(user, accessToken);
        const walletData = await walletApi.getWallet();
        setWallet(walletData);
      })
      .catch((err) => {
        loginStarted.current = false;
        setAuthError(err.message);
      });
  }, [authStatus, setAuth, setAuthError, setAuthLoading, setWallet]);

  if (authStatus === 'idle' || authStatus === 'loading') {
    return (
      <div className="app-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="spinner" />
      </div>
    );
  }

  if (authStatus === 'error') {
    return (
      <div className="app-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
        <div className="card" style={{ textAlign: 'center', borderColor: 'var(--danger)' }}>
          <h2 style={{ color: 'var(--danger)', marginBottom: 8 }}>Authentication Failed</h2>
          <p className="text-muted">Could not connect to the server or authenticate your session.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app-container">
      <WalletBar />
      <main className="main-content">
        {activeTab === 'home' && <Home onNavigate={setActiveTab} />}
        {activeTab === 'games' && <Games onNavigate={setActiveTab} />}
        {activeTab === 'keno' && <Keno />}
        {activeTab === 'bingo' && <Bingo />}
        {activeTab === 'wallet' && <Wallet />}
        {activeTab === 'admin' && <Admin />}
      </main>
      <BottomNav active={activeTab} onChange={setActiveTab} />
      <Toasts />
    </div>
  );
}
