import { useEffect, useState } from 'react';
import { LogIn, LogOut } from 'lucide-react';
import { authApi } from './lib/api';
import { useStore } from './store/useStore';
import { useSocketConnection } from './hooks/useSocketConnection';
import { getErrorMessage } from './lib/utils';
import { Agent } from './pages/Agent';
import { Toasts } from './components/Toasts';

type TelegramWindow = Window &
  typeof globalThis & {
    Telegram?: { WebApp?: { initData?: string } };
  };

type Phase = 'resolving' | 'need-link' | 'login' | 'dashboard';

/**
 * This whole app IS the agent bot's Mini App (opened via @yaho_agent_bot's
 * "Open Agent Panel" button) — a standalone deployment, deliberately not a
 * route inside the player app, so there's no query-param/menu-button
 * ambiguity about which experience a given URL renders. No Telegram-initData
 * auto-login here: on a genuinely fresh session the phone field is resolved
 * from the Telegram identity linked via the bot's contact-share and locked,
 * and the agent types their password (POST /auth/credentials, same endpoint
 * the web credentials login uses). Once logged in, the session persists in
 * localStorage exactly like the rest of the app (useStore rehydrates it on
 * load) — a reload or reopen of the Mini App does NOT force a fresh login.
 */
export function App() {
  useSocketConnection();
  const setAuth = useStore((s) => s.setAuth);
  const clearAuth = useStore((s) => s.clearAuth);
  const isAuthenticated = useStore((s) => s.isAuthenticated);
  const [phase, setPhase] = useState<Phase>(isAuthenticated ? 'dashboard' : 'resolving');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    if (isAuthenticated) return;
    const tg = (window as TelegramWindow).Telegram?.WebApp;
    if (!tg?.initData) {
      setPhase('need-link');
      return;
    }
    authApi.resolveAgentPhone(tg.initData)
      .then((res) => {
        setPhone(res.phoneNumber);
        setPhase('login');
      })
      .catch(() => setPhase('need-link'));
  }, [isAuthenticated]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    setLoggingIn(true);
    setLoginError(null);
    try {
      const { user, accessToken, refreshToken } = await authApi.loginWithCredentials(phone, password);
      setAuth(user, accessToken, refreshToken);
      setPhase('dashboard');
    } catch (err) {
      setLoginError(getErrorMessage(err));
    } finally {
      setLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await authApi.logout();
    } catch {
      /* local logout is fine even if the server is unreachable */
    } finally {
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      clearAuth();
      setPhone('');
      setPassword('');
      setPhase('resolving');
      setLoggingOut(false);
    }
  };

  let content;

  if (phase === 'resolving') {
    content = (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100dvh' }}>
        <div className="spinner" />
      </div>
    );
  } else if (phase === 'need-link') {
    content = (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100dvh', padding: 24 }}>
        <div style={{ maxWidth: 360, textAlign: 'center' }}>
          <div style={{ fontSize: 44, marginBottom: 12 }}>📱</div>
          <h2 style={{ margin: '0 0 10px', fontSize: 20, fontWeight: 800 }}>Link your agent account</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: 14, lineHeight: 1.5 }}>
            Open <strong>@yaho_agent_bot</strong> in Telegram, send /start, and share your registered phone number.
            Then come back and reopen this panel.
          </p>
        </div>
      </div>
    );
  } else if (phase === 'login') {
    content = (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100dvh', padding: 24 }}>
        <div style={{ width: '100%', maxWidth: 360 }}>
          <div style={{ textAlign: 'center', marginBottom: 32 }}>
            <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'var(--surface)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
              <LogIn size={22} style={{ color: 'var(--accent)' }} />
            </div>
            <h1 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: 4 }}>Agent Panel</h1>
          </div>

          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 6 }}>Phone Number</label>
              <input className="input" type="tel" value={phone} disabled readOnly style={{ opacity: 0.7 }} />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 6 }}>Password</label>
              <input
                className="input"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                autoFocus
                required
              />
            </div>

            {loginError && (
              <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '10px 12px', fontSize: '0.82rem', color: '#ef4444' }}>
                {loginError}
              </div>
            )}

            <button type="submit" className="btn btn-primary" disabled={loggingIn || !password} style={{ marginTop: 4 }}>
              {loggingIn ? 'Signing in…' : 'Sign In'}
            </button>
          </form>
        </div>
      </div>
    );
  } else {
    content = (
      <>
        <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '10px 12px 0' }}>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => void handleLogout()}
            disabled={loggingOut}
            title="Log out"
          >
            <LogOut size={14} /> {loggingOut ? 'Logging out…' : 'Log out'}
          </button>
        </div>
        <Agent />
      </>
    );
  }

  return (
    <div className="app-container">
      {content}
      <Toasts />
    </div>
  );
}
