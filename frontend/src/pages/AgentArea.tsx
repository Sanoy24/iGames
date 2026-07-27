import { useCallback, useEffect, useState } from 'react';
import { LogIn, Search, ArrowLeft, RefreshCw, Users } from 'lucide-react';
import { authApi, agentApi, type AreaPlayer, type AreaPlayerActivity } from '../lib/api';
import { formatCredits, useStore } from '../store/useStore';
import { formatDateTime, getErrorMessage } from '../lib/utils';

type TelegramWindow = Window &
  typeof globalThis & {
    Telegram?: { WebApp?: { initData?: string } };
  };

type Phase = 'resolving' | 'need-link' | 'login' | 'dashboard';

/**
 * Standalone entry surface for the agent bot (@yaho_agent_bot), opened via
 * `?entry=agent`. Deliberately NOT part of the standard player app shell/boot
 * flow — no Telegram-initData auto-login here. The phone field is resolved
 * from the Telegram identity linked via the agent bot's contact-share and is
 * locked; the agent must still type their password (POST /auth/credentials,
 * completely unchanged from the normal web/credentials login).
 */
export function AgentArea() {
  const setAuth = useStore((s) => s.setAuth);
  const [phase, setPhase] = useState<Phase>('resolving');
  const [phone, setPhone] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);

  const [selectedPlayer, setSelectedPlayer] = useState<string | null>(null);

  useEffect(() => {
    const tg = (window as TelegramWindow).Telegram?.WebApp;
    if (!tg?.initData) {
      setPhase('need-link');
      return;
    }
    authApi.resolveAgentPhone(tg.initData)
      .then((res) => {
        setPhone(res.phoneNumber);
        setDisplayName(res.displayName);
        setPhase('login');
      })
      .catch(() => setPhase('need-link'));
  }, []);

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

  if (phase === 'resolving') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100dvh' }}>
        <div className="spinner" />
      </div>
    );
  }

  if (phase === 'need-link') {
    return (
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
  }

  if (phase === 'login') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100dvh', padding: 24 }}>
        <div style={{ width: '100%', maxWidth: 360 }}>
          <div style={{ textAlign: 'center', marginBottom: 32 }}>
            <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'var(--surface)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
              <LogIn size={22} style={{ color: 'var(--accent)' }} />
            </div>
            <h1 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: 4 }}>Agent Panel</h1>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Welcome, {displayName}. Enter your password to continue.</p>
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
  }

  // phase === 'dashboard'
  return selectedPlayer
    ? <PlayerDrillDown userId={selectedPlayer} onBack={() => setSelectedPlayer(null)} />
    : <AreaPlayerList onSelectPlayer={setSelectedPlayer} />;
}

// ══════════════════════════════════════════════════════════════════
// Player list — searchable, paginated, area-scoped
// ══════════════════════════════════════════════════════════════════
function AreaPlayerList({ onSelectPlayer }: { onSelectPlayer: (userId: string) => void }) {
  const [players, setPlayers] = useState<AreaPlayer[]>([]);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await agentApi.listAreaPlayers(search || undefined, page, 20);
      setPlayers(result.data);
      setTotalPages(result.totalPages || 1);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [search, page]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <Users size={18} style={{ color: 'var(--accent)' }} />
        <h2 style={{ fontSize: 16, fontWeight: 800, margin: 0 }}>Players in My Area</h2>
        <button className="btn btn-secondary" style={{ marginLeft: 'auto', padding: '6px 10px' }} onClick={() => void load()} aria-label="Refresh">
          <RefreshCw size={14} />
        </button>
      </div>

      <div style={{ position: 'relative', marginBottom: 14 }}>
        <Search size={15} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
        <input
          className="input"
          placeholder="Search by name or phone…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          style={{ paddingLeft: 32 }}
        />
      </div>

      {error && (
        <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '10px 12px', fontSize: '0.82rem', color: '#ef4444', marginBottom: 12 }}>
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>Loading…</div>
      ) : players.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>No players found in your assigned area.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {players.map((p) => (
            <button
              key={p.id}
              onClick={() => onSelectPlayer(p.id)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 10,
                padding: '12px 14px', textAlign: 'left', cursor: 'pointer',
              }}
            >
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
                  {p.displayName}
                  {p.isMyReferral && (
                    <span style={{ fontSize: 9, fontWeight: 800, color: 'var(--accent)', border: '1px solid var(--accent)', borderRadius: 6, padding: '1px 5px' }}>
                      YOUR REFERRAL
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {p.phoneNumber ?? '—'} · {p.locationName ?? 'No area'}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{formatCredits(p.walletBalanceMinor)} ETB</div>
                <div style={{ fontSize: 11, color: p.status === 'active' ? 'var(--green)' : 'var(--text-muted)' }}>{p.status}</div>
              </div>
            </button>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 16 }}>
          <button className="btn btn-secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Prev</button>
          <span style={{ alignSelf: 'center', fontSize: 12, color: 'var(--text-muted)' }}>Page {page} / {totalPages}</span>
          <button className="btn btn-secondary" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</button>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// Player drill-down — deposits, withdrawals, games played/won
// ══════════════════════════════════════════════════════════════════
function PlayerDrillDown({ userId, onBack }: { userId: string; onBack: () => void }) {
  const [activity, setActivity] = useState<AreaPlayerActivity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    agentApi.getAreaPlayerActivity(userId)
      .then(setActivity)
      .catch((err) => setError(getErrorMessage(err)))
      .finally(() => setLoading(false));
  }, [userId]);

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', padding: 16 }}>
      <button onClick={onBack} className="btn btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16 }}>
        <ArrowLeft size={14} /> Back to players
      </button>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>Loading…</div>
      ) : error ? (
        <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '10px 12px', fontSize: '0.82rem', color: '#ef4444' }}>
          {error}
        </div>
      ) : activity ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 10, padding: 14 }}>
            <div style={{ fontWeight: 800, fontSize: 15, display: 'flex', alignItems: 'center', gap: 6 }}>
              {activity.player.displayName}
              {activity.player.isMyReferral && (
                <span style={{ fontSize: 9, fontWeight: 800, color: 'var(--accent)', border: '1px solid var(--accent)', borderRadius: 6, padding: '1px 5px' }}>
                  YOUR REFERRAL
                </span>
              )}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{activity.player.phoneNumber ?? '—'}</div>
          </div>

          <Section title="Games Played">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              <GameCard label="Bingo" summary={activity.games.bingo} />
              <GameCard label="Keno" summary={activity.games.keno} />
              <GameCard label="Crash" summary={activity.games.crash} />
            </div>
          </Section>

          <Section title={`Deposits (${activity.deposits.telebirr.length + activity.deposits.mpesa.length})`}>
            {activity.deposits.telebirr.length === 0 && activity.deposits.mpesa.length === 0 ? (
              <Empty text="No deposits yet." />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {activity.deposits.telebirr.map((d) => (
                  <Row key={d.id} label={`Telebirr · ${d.receiptNo}`} amountMinor={d.amountMinor} status={d.status} date={d.createdAt} />
                ))}
                {activity.deposits.mpesa.map((d) => (
                  <Row key={d.id} label={`M-Pesa · ${d.confirmationCode}`} amountMinor={d.amountMinor} status={d.status} date={d.createdAt} />
                ))}
              </div>
            )}
          </Section>

          <Section title={`Withdrawals (${activity.withdrawals.length})`}>
            {activity.withdrawals.length === 0 ? (
              <Empty text="No withdrawals yet." />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {activity.withdrawals.map((w) => (
                  <Row key={w.id} label={w.destinationAccount} amountMinor={w.amountMinor} status={w.status} date={w.createdAt} />
                ))}
              </div>
            )}
          </Section>
        </div>
      ) : null}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 8 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '8px 0' }}>{text}</div>;
}

function GameCard({ label, summary }: { label: string; summary: { played: number; won: number; stakedMinor: number; payoutMinor: number } }) {
  return (
    <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 10, padding: 10, textAlign: 'center' }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>{label}</div>
      <div style={{ fontWeight: 800, fontSize: 16 }}>{summary.played}</div>
      <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>played</div>
      <div style={{ fontSize: 11, color: 'var(--green)', marginTop: 4 }}>{summary.won} won</div>
    </div>
  );
}

function Row({ label, amountMinor, status, date }: { label: string; amountMinor: number; status: string; date: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', fontSize: 12 }}>
      <div>
        <div style={{ fontWeight: 700 }}>{label}</div>
        <div style={{ color: 'var(--text-muted)' }}>{formatDateTime(date)}</div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontWeight: 700 }}>{formatCredits(amountMinor)} ETB</div>
        <div style={{ color: 'var(--text-muted)' }}>{status}</div>
      </div>
    </div>
  );
}
