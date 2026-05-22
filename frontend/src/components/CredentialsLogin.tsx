import { useState } from 'react';
import { LogIn } from 'lucide-react';
import { authApi } from '../lib/api';
import type { AuthTokenResponse } from '../lib/models';

type Props = {
  onSuccess: (data: AuthTokenResponse) => Promise<void>;
};

export function CredentialsLogin({ onSuccess }: Props) {
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const login = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone.trim() || !password) return;
    setLoading(true);
    setError(null);
    try {
      const data = await authApi.loginWithCredentials(phone.trim(), password);
      await onSuccess(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Login failed';
      const axiosMsg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setError(axiosMsg ?? msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100dvh', padding: '24px' }}>
      <div style={{ width: '100%', maxWidth: 360 }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'var(--surface)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
            <LogIn size={22} style={{ color: 'var(--accent)' }} />
          </div>
          <h1 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: 4 }}>Agent / Admin Login</h1>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Sign in with your credentials</p>
        </div>

        <form onSubmit={login} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 6 }}>Phone Number</label>
            <input
              className="input"
              type="tel"
              placeholder="09XXXXXXXX"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              autoComplete="username"
              required
            />
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
              required
            />
          </div>

          {error && (
            <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '10px 12px', fontSize: '0.82rem', color: '#ef4444' }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            className="btn btn-primary"
            disabled={loading || !phone.trim() || !password}
            style={{ marginTop: 4 }}
          >
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>

        <p style={{ textAlign: 'center', fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 24 }}>
          Players open this app via the Telegram bot.
        </p>
      </div>
    </div>
  );
}
