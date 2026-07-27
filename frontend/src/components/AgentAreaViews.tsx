import { useCallback, useEffect, useState } from 'react';
import { Search, ArrowLeft, RefreshCw, Users } from 'lucide-react';
import { agentApi, type AreaPlayer, type AreaPlayerActivity } from '../lib/api';
import { formatCredits } from '../store/useStore';
import { formatDateTime, getErrorMessage } from '../lib/utils';

/**
 * "Players in My Area" — a tab within the web Agent page (Agent.tsx). Also
 * copied verbatim into the standalone agent-frontend project's Agent.tsx, so
 * both deployments show the identical feature rather than a lookalike duplicate.
 */

// ══════════════════════════════════════════════════════════════════
// Player list — searchable, paginated, area-scoped
// ══════════════════════════════════════════════════════════════════
export function AreaPlayerList({ onSelectPlayer }: { onSelectPlayer: (userId: string) => void }) {
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
    <div>
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
export function PlayerDrillDown({ userId, onBack }: { userId: string; onBack: () => void }) {
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
    <div>
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
