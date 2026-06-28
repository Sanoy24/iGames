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
      };
    };
  };

export function App() {
  const { authStatus, isAuthenticated, setAuth, setAuthLoading, setWallet, clearAuth, user, wallet } = useStore();
  const [activeTab, setActiveTab] = useState<AppTab>('home');
  const [showCredLogin, setShowCredLogin] = useState(false);
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

        const tg = (window as TelegramWindow).Telegram?.WebApp;
        if (!tg?.initData && !import.meta.env.DEV) {
          setShowCredLogin(true);
          return;
        }

        const { user, accessToken, refreshToken } = tg?.initData
          ? await authApi.loginWithTelegram(tg.initData)
          : await authApi.devSeedAdmin('Dev Admin');
        setAuth(user, accessToken, refreshToken);
        setActiveTab(user.roles.includes('admin') ? 'admin' : user.roles.includes('agent') ? 'agent' : 'home');
        setWallet(await walletApi.getWallet());
      } catch (err) {
        console.error('Auth bootstrap failed:', err);
        clearAuth();
        loginStarted.current = false;
        setShowCredLogin(true);
      }
    };

    void bootstrap();
  }, [authStatus, clearAuth, setAuth, setAuthLoading, setWallet]);

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
        {activeTab === 'wallet' && <Wallet />}
        {activeTab === 'admin' && <Admin />}
        {activeTab === 'profile' && <Profile />}
        {activeTab === 'agent' && <Agent />}
      </main>
      <BottomNav active={activeTab} onChange={setActiveTab} />
      <Toasts />
    </div>
  );
}
