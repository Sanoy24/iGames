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
import { Profile } from './pages/Profile';
import { Agent } from './pages/Agent';
import { Crash } from './pages/Crash';
import { Leaderboard } from './pages/Leaderboard';
import { BottomNav } from './components/BottomNav';
import { WalletBar } from './components/WalletBar';
import { Toasts } from './components/Toasts';
import { CredentialsLogin } from './components/CredentialsLogin';
import type { AppTab } from './lib/navigation';

type TelegramWindow = Window &
  typeof globalThis & {
    Telegram?: {
      WebApp?: {
        initData?: string;
        close?: () => void;
        openTelegramLink?: (url: string) => void;
      };
    };
  };

export function App() {
  const { authStatus, isAuthenticated, setAuth, setAuthLoading, setWallet, clearAuth, user, wallet } = useStore();
  const [activeTab, setActiveTab] = useState<AppTab>('home');
  const [showCredLogin, setShowCredLogin] = useState(false);
  const [phoneRequired, setPhoneRequired] = useState(false);
  const loginStarted = useRef(false);

  useSocketConnection();

  useEffect(() => {
    if (!isAuthenticated || !user) return;
    setActiveTab((current) => {
      if (current !== 'home') return current;
      if (user.roles.includes('admin')) return 'admin';
      if (user.roles.includes('agent')) return 'agent';
      return 'home';
    });
  }, [isAuthenticated, user]);

  useEffect(() => {
    if (!isAuthenticated || wallet) return;
    walletApi.getWallet().then(setWallet).catch(() => {});
  }, [isAuthenticated, wallet, setWallet]);

  useEffect(() => {
    if (authStatus !== 'idle' || loginStarted.current) return;

    loginStarted.current = true;

    setAuthLoading();

    const bootstrap = async () => {
      try {
        const tg = (window as TelegramWindow).Telegram?.WebApp;
        const hasTelegramData = !!tg?.initData;

        // Telegram miniapp: always re-auth via initData, never show cred login
        if (hasTelegramData) {
          localStorage.removeItem('manualLogout');
          const { user, accessToken, refreshToken } = await authApi.loginWithTelegram(tg!.initData!);
          setAuth(user, accessToken, refreshToken);
          setActiveTab(user.roles.includes('admin') ? 'admin' : user.roles.includes('agent') ? 'agent' : 'home');
          setWallet(await walletApi.getWallet());
          return;
        }

        // Standalone web: respect manual logout flag
        if (localStorage.getItem('manualLogout') === '1') {
          setShowCredLogin(true);
          return;
        }

        const storedRefreshToken = localStorage.getItem('refreshToken');
        if (storedRefreshToken) {
          const { user, accessToken, refreshToken } = await authApi.refresh(storedRefreshToken);
          setAuth(user, accessToken, refreshToken);
          setActiveTab(user.roles.includes('admin') ? 'admin' : user.roles.includes('agent') ? 'agent' : 'home');
          setWallet(await walletApi.getWallet());
          return;
        }

        if (import.meta.env.DEV) {
          const { user, accessToken, refreshToken } = await authApi.devSeedAdmin('Dev Admin');
          setAuth(user, accessToken, refreshToken);
          setActiveTab(user.roles.includes('admin') ? 'admin' : user.roles.includes('agent') ? 'agent' : 'home');
          setWallet(await walletApi.getWallet());
          return;
        }

        setShowCredLogin(true);
      } catch (err) {
        // The Mini App backend refuses to start an account with no phone on file.
        const code = (err as { response?: { data?: { code?: string } } })?.response?.data?.code;
        if (code === 'PHONE_REQUIRED') {
          clearAuth();
          setPhoneRequired(true);
          return;
        }
        console.error('Auth bootstrap failed:', err);
        clearAuth();
        loginStarted.current = false;
        setShowCredLogin(true);
      }
    };

    void bootstrap();
  }, [authStatus, clearAuth, setAuth, setAuthLoading, setWallet]);

  if (phoneRequired && !isAuthenticated) {
    const tg = (window as TelegramWindow).Telegram?.WebApp;
    return (
      <div className="app-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ maxWidth: 360, textAlign: 'center' }}>
          <div style={{ fontSize: 44, marginBottom: 12 }}>📱</div>
          <h2 style={{ margin: '0 0 10px', fontSize: 20, fontWeight: 800 }}>One quick step</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: 14, lineHeight: 1.5, marginBottom: 20 }}>
            To start playing we need your phone number for Telebirr deposits and payouts.
            Head back to our Telegram bot chat and tap <strong>“📱 Share My Phone Number”</strong>, then reopen the app.
          </p>
          <button
            className="btn btn-primary"
            style={{ width: '100%' }}
            onClick={() => { tg?.close ? tg.close() : window.location.reload(); }}
          >
            {tg?.close ? 'Back to the bot' : 'Reload'}
          </button>
        </div>
        <Toasts />
      </div>
    );
  }

  if (showCredLogin && !isAuthenticated) {
    return (
      <div className="app-container">
        <CredentialsLogin
          onSuccess={async ({ user, accessToken, refreshToken }) => {
            localStorage.removeItem('manualLogout');
            setAuth(user, accessToken, refreshToken);
            const walletData = await walletApi.getWallet();
            setWallet(walletData);
            // Route to the appropriate default tab for the role
            if (user.roles.includes('agent')) setActiveTab('agent');
            else if (user.roles.includes('admin')) setActiveTab('admin');
            setShowCredLogin(false);
          }}
        />
        <Toasts />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="app-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="spinner" />
      </div>
    );
  }

  return (
    <div className="app-container">
      <WalletBar onNavigate={setActiveTab} />
      <main className="main-content">
        {activeTab === 'home' && <Home onNavigate={setActiveTab} />}
        {activeTab === 'games' && <Games onNavigate={setActiveTab} />}
        {activeTab === 'keno' && <Keno onBack={() => setActiveTab('games')} />}
        {activeTab === 'bingo' && <Bingo onBack={() => setActiveTab('games')} />}
        {activeTab === 'crash' && <Crash onBack={() => setActiveTab('games')} />}
        {activeTab === 'wallet' && <Wallet />}
        {activeTab === 'leaderboard' && <Leaderboard />}
        {activeTab === 'admin' && <Admin />}
        {activeTab === 'profile' && <Profile />}
        {activeTab === 'agent' && <Agent />}
      </main>
      <BottomNav active={activeTab} onChange={setActiveTab} />
      <Toasts />
    </div>
  );
}
