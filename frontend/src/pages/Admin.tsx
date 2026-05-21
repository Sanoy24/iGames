import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Play, X, Settings, BarChart3, Wallet, Bot, Dices, CircleDot, ChevronRight } from 'lucide-react';
import {
  adminBingoApi,
  adminBotsApi,
  adminKenoApi,
  adminApi,
  adminWithdrawalsApi,
  type BotUser,
  type PlatformStats,
  type SystemConfig,
} from '../lib/api';
import type { BingoRoom, KenoConfig, KenoDraw, Withdrawal } from '../lib/models';
import {
  formatDateTime,
  formatRelativeTime,
  getErrorMessage,
  titleCase,
} from '../lib/utils';
import { formatCreditsFull } from '../lib/utils';
import { formatCredits, useStore } from '../store/useStore';

// ─── Sub-pages ────────────────────────────────────────────────────
type AdminTab = 'overview' | 'keno' | 'bingo' | 'bots' | 'withdrawals' | 'config';

const TABS: Array<{ id: AdminTab; label: string; icon: React.ReactNode }> = [
  { id: 'overview', label: 'Overview', icon: <BarChart3 size={14} /> },
  { id: 'keno', label: 'Keno', icon: <Dices size={14} /> },
  { id: 'bingo', label: 'Bingo', icon: <CircleDot size={14} /> },
  { id: 'bots', label: 'Bots', icon: <Bot size={14} /> },
  { id: 'withdrawals', label: 'Withdrawals', icon: <Wallet size={14} /> },
  { id: 'config', label: 'Config', icon: <Settings size={14} /> },
];

// ══════════════════════════════════════════════════════════════════
// Overview
// ══════════════════════════════════════════════════════════════════
function OverviewAdmin() {
  const addToast = useStore((s) => s.addToast);
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try { setStats(await adminApi.getOverview()); }
    catch (e) { addToast('error', getErrorMessage(e)); }
    finally { setLoading(false); }
  }, [addToast]);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <div className="card-muted">Loading platform stats...</div>;
  if (!stats) return null;

  const toCredits = (v: number) => formatCreditsFull(v);

  return (
    <div className="stack-lg">
      <div className="admin-action-bar">
        <div>
          <div className="section-title">Platform Overview</div>
          <p className="section-copy">Live financial snapshot of the platform.</p>
        </div>
        <button className="btn btn-ghost btn-sm icon-btn" onClick={load}><RefreshCw size={14} /></button>
      </div>
      <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
        <div className="stat-card">
          <span className="stat-label">Gross Gaming Revenue</span>
          <strong style={{ color: 'var(--green)' }}>{toCredits(stats.ggrMinor)}</strong>
        </div>
        <div className="stat-card">
          <span className="stat-label">Total Volume</span>
          <strong>{toCredits(stats.totalVolumeMinor)}</strong>
        </div>
        <div className="stat-card">
          <span className="stat-label">Total Payouts</span>
          <strong>{toCredits(stats.totalPayoutsMinor)}</strong>
        </div>
        <div className="stat-card">
          <span className="stat-label">Total Liabilities</span>
          <strong style={{ color: stats.totalLiabilitiesMinor > 0 ? 'var(--gold)' : undefined }}>
            {toCredits(stats.totalLiabilitiesMinor)}
          </strong>
        </div>
      </div>
      <div className="card">
        <div className="section-title" style={{ marginBottom: 12, fontSize: 15 }}>Breakdown</div>
        <div className="key-value-list">
          {Object.entries(stats.breakdown).map(([key, val]) => (
            <div key={key} className="key-value-row">
              <span>{titleCase(key.replace(/minor$/i, '').replace(/([A-Z])/g, ' $1').trim())}</span>
              <strong>{toCredits(val)}</strong>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// System Config
// ══════════════════════════════════════════════════════════════════
function ConfigAdmin() {
  const addToast = useStore((s) => s.addToast);
  const [config, setConfig] = useState<SystemConfig | null>(null);
  const [form, setForm] = useState<SystemConfig>({
    telebirrCreditMinorPerBirr: 100,
    welcomeBonusMinor: 0,
    withdrawalServiceChargePct: 0,
    withdrawalMinAmountMinor: 0,
    withdrawalMaxAmountMinor: 0,
    maxPendingWithdrawalsPerUser: 1,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    adminApi.getConfig()
      .then((c) => { setConfig(c); setForm(c); })
      .catch((e) => addToast('error', getErrorMessage(e)))
      .finally(() => setLoading(false));
  }, [addToast]);

  const save = async () => {
    setSaving(true);
    try {
      const updated = await adminApi.updateConfig(form);
      setConfig(updated);
      setForm(updated);
      addToast('success', 'System config saved.');
    } catch (e) { addToast('error', getErrorMessage(e)); }
    finally { setSaving(false); }
  };

  const field = (key: keyof SystemConfig, label: string, hint?: string) => (
    <label className="form-field">
      <span>{label}{hint && <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> — {hint}</span>}</span>
      <input
        className="input"
        type="number"
        min={0}
        value={form[key]}
        onChange={(e) => setForm((f) => ({ ...f, [key]: Number(e.target.value) }))}
      />
    </label>
  );

  if (loading) return <div className="card-muted">Loading config...</div>;

  return (
    <div className="stack-lg">
      <div className="admin-action-bar">
        <div>
          <div className="section-title">System Configuration</div>
          <p className="section-copy">Platform-wide settings for payments and withdrawals.</p>
        </div>
      </div>
      <div className="card admin-form">
        <div className="admin-form-grid">
          {field('telebirrCreditMinorPerBirr', 'Credits per Birr', 'e.g. 100 = 1 Birr → 100 credits')}
          {field('welcomeBonusMinor', 'Welcome Bonus (credits)')}
          {field('withdrawalServiceChargePct', 'Service Charge %', '0–100')}
          {field('withdrawalMinAmountMinor', 'Min Withdrawal (credits)')}
          {field('withdrawalMaxAmountMinor', 'Max Withdrawal (credits)', '0 = no limit')}
          {field('maxPendingWithdrawalsPerUser', 'Max Pending Withdrawals per User')}
        </div>
        <button className="btn btn-primary btn-full" style={{ marginTop: 20 }} disabled={saving} onClick={save}>
          {saving ? 'Saving...' : 'Save Configuration'}
        </button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// Withdrawals Admin
// ══════════════════════════════════════════════════════════════════
function WithdrawalsAdmin() {
  const addToast = useStore((s) => s.addToast);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try { setWithdrawals(await adminWithdrawalsApi.listWithdrawals()); }
    catch (e) { addToast('error', getErrorMessage(e)); }
    finally { setLoading(false); }
  }, [addToast]);

  useEffect(() => { void load(); }, [load]);

  const process = async (id: string, action: 'approve' | 'reject') => {
    setBusy(`${action}-${id}`);
    try {
      await adminWithdrawalsApi.processWithdrawal(id, action, notes[id]);
      addToast('success', `Withdrawal ${action === 'approve' ? 'approved' : 'rejected'}.`);
      await load();
    } catch (e) { addToast('error', getErrorMessage(e)); }
    finally { setBusy(null); }
  };

  const pending = withdrawals.filter((w) => w.status === 'pending' || w.status === 'processing');
  const completed = withdrawals.filter((w) => w.status === 'completed' || w.status === 'rejected');

  return (
    <div className="stack-lg">
      <div className="admin-action-bar">
        <div>
          <div className="section-title">Withdrawal Requests</div>
          <p className="section-copy">Review and process player Telebirr cashouts.</p>
        </div>
        <button className="btn btn-ghost btn-sm icon-btn" onClick={load}><RefreshCw size={14} /></button>
      </div>

      {loading && withdrawals.length === 0 ? (
        <div className="card-muted">Loading withdrawals...</div>
      ) : pending.length === 0 && completed.length === 0 ? (
        <div className="card-muted">No withdrawal requests yet.</div>
      ) : (
        <>
          {pending.length > 0 && (
            <>
              <div className="section-title" style={{ fontSize: 14, color: 'var(--text-muted)' }}>
                Pending ({pending.length})
              </div>
              <div className="list-stack">
                {pending.map((w) => (
                  <article key={w.id} className="admin-row" style={{ flexDirection: 'column', gap: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
                      <div>
                        <div className="admin-row-title">
                          {formatCredits(w.amountMinor)} credits
                          <span className={`badge ${w.status === 'processing' ? 'badge-violet' : 'badge-gold'}`}>{w.status}</span>
                        </div>
                        <div className="admin-row-meta">Phone: {w.destinationAccount}</div>
                        <div className="admin-row-meta">{new Date(w.createdAt).toLocaleString()}</div>
                      </div>
                      <div className="admin-row-actions">
                        <button
                          className="btn btn-success btn-sm"
                          disabled={!!busy}
                          onClick={() => process(w.id, 'approve')}
                        >
                          {busy === `approve-${w.id}` ? '...' : 'Approve'}
                        </button>
                        <button
                          className="btn btn-danger btn-sm"
                          disabled={!!busy}
                          onClick={() => process(w.id, 'reject')}
                        >
                          {busy === `reject-${w.id}` ? '...' : 'Reject'}
                        </button>
                      </div>
                    </div>
                    <input
                      className="input"
                      placeholder="Admin note (optional)"
                      value={notes[w.id] ?? ''}
                      onChange={(e) => setNotes((n) => ({ ...n, [w.id]: e.target.value }))}
                      style={{ fontSize: 13 }}
                    />
                  </article>
                ))}
              </div>
            </>
          )}

          {completed.length > 0 && (
            <>
              <div className="section-title" style={{ fontSize: 14, color: 'var(--text-muted)', marginTop: 8 }}>
                Completed ({completed.length})
              </div>
              <div className="list-stack">
                {completed.map((w) => (
                  <article key={w.id} className="admin-row">
                    <div className="admin-row-info">
                      <div className="admin-row-title">
                        {formatCredits(w.amountMinor)} credits
                        <span className={`badge ${w.status === 'completed' ? 'badge-green' : 'badge-red'}`}>{w.status}</span>
                      </div>
                      <div className="admin-row-meta">Phone: {w.destinationAccount}</div>
                      {w.adminNotes && <div className="admin-row-meta">Note: {w.adminNotes}</div>}
                    </div>
                  </article>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// Keno Admin
// ══════════════════════════════════════════════════════════════════
function KenoAdmin() {
  const addToast = useStore((s) => s.addToast);
  const [draws, setDraws] = useState<KenoDraw[]>([]);
  const [config, setConfig] = useState<KenoConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [showConfigEdit, setShowConfigEdit] = useState(false);
  const [configForm, setConfigForm] = useState({ ticketPriceMinor: 100, globalBotWinInterval: 0 });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [fetchedDraws, fetchedConfig] = await Promise.all([adminKenoApi.listDraws(20), adminKenoApi.getConfig()]);
      setDraws(fetchedDraws);
      setConfig(fetchedConfig);
      setConfigForm({ ticketPriceMinor: fetchedConfig.ticketPriceMinor, globalBotWinInterval: fetchedConfig.globalBotWinInterval || 0 });
    } catch (e) { addToast('error', getErrorMessage(e)); }
    finally { setLoading(false); }
  }, [addToast]);

  useEffect(() => { void load(); }, [load]);

  const updateConfig = async () => {
    if (!config) return;
    setBusy('config');
    try {
      await adminKenoApi.createConfig({ ...config, ...configForm });
      addToast('success', 'New Keno Config Version Activated.');
      setShowConfigEdit(false);
      await load();
    } catch (e) { addToast('error', getErrorMessage(e)); }
    finally { setBusy(null); }
  };

  const schedule = async () => {
    setBusy('schedule');
    try { await adminKenoApi.scheduleDraw(); addToast('success', 'Draw scheduled.'); await load(); }
    catch (e) { addToast('error', getErrorMessage(e)); }
    finally { setBusy(null); }
  };

  const execute = async (id: string) => {
    setBusy(id);
    try { await adminKenoApi.executeDraw(id); addToast('success', 'Draw executed.'); await load(); }
    catch (e) { addToast('error', getErrorMessage(e)); }
    finally { setBusy(null); }
  };

  const cancel = async (id: string) => {
    setBusy(`cancel-${id}`);
    try { await adminKenoApi.cancelDraw(id); addToast('info', 'Draw cancelled.'); await load(); }
    catch (e) { addToast('error', getErrorMessage(e)); }
    finally { setBusy(null); }
  };

  return (
    <div className="stack-lg">
      <div className="admin-action-bar">
        <div>
          <div className="section-title">Keno Draws</div>
          <p className="section-copy">Manage config and schedule rounds.</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost btn-sm icon-btn" onClick={load}><RefreshCw size={14} /></button>
          <button className="btn btn-secondary btn-sm" onClick={() => setShowConfigEdit(!showConfigEdit)}>
            <Settings size={13} style={{ marginRight: 4 }} />{showConfigEdit ? 'Close' : 'Config'}
          </button>
          <button className="btn btn-primary btn-sm" disabled={busy === 'schedule'} onClick={schedule}>
            {busy === 'schedule' ? '...' : '+ Schedule'}
          </button>
        </div>
      </div>

      {config && !showConfigEdit && (
        <div className="card" style={{ padding: 14, display: 'flex', gap: 20, fontSize: 13, flexWrap: 'wrap' }}>
          <div><strong>v{config.version}</strong> &nbsp;·&nbsp; {formatCredits(config.ticketPriceMinor)} credits/ticket</div>
          <div>Grid: {config.numberMin}–{config.numberMax} &nbsp;·&nbsp; Draw: {config.drawSize} numbers</div>
          <div>Bot interval: {config.globalBotWinInterval || 'Disabled'}</div>
        </div>
      )}

      {showConfigEdit && config && (
        <div className="card admin-form">
          <div className="section-title" style={{ marginBottom: 16, fontSize: 15 }}>New Config Version</div>
          <div className="admin-form-grid">
            <label className="form-field">
              <span>Ticket Price (credits)</span>
              <input className="input" type="number" value={configForm.ticketPriceMinor}
                onChange={(e) => setConfigForm((f) => ({ ...f, ticketPriceMinor: Number(e.target.value) }))} />
            </label>
            <label className="form-field">
              <span>Bot Win Interval (0 = off)</span>
              <input className="input" type="number" value={configForm.globalBotWinInterval}
                onChange={(e) => setConfigForm((f) => ({ ...f, globalBotWinInterval: Number(e.target.value) }))} />
            </label>
          </div>
          <button className="btn btn-primary btn-full" style={{ marginTop: 16 }} disabled={busy === 'config'} onClick={updateConfig}>
            {busy === 'config' ? 'Saving...' : 'Activate New Config'}
          </button>
        </div>
      )}

      {loading && draws.length === 0 ? <div className="card-muted">Loading draws...</div>
        : draws.length === 0 ? <div className="card-muted">No draws yet.</div>
        : (
          <div className="list-stack">
            {draws.map((draw) => {
              const isPending = draw.status === 'pending';
              const isSettled = draw.status === 'settled' || draw.status === 'cancelled';
              return (
                <article key={draw.id} className="admin-row">
                  <div className="admin-row-info">
                    <div className="admin-row-title">
                      Draw <code>{draw.id.slice(-8)}</code>
                      <span className={`badge badge-${draw.status === 'settled' ? 'green' : draw.status === 'cancelled' ? 'red' : 'violet'}`}>
                        {draw.status}
                      </span>
                    </div>
                    <div className="admin-row-meta">{formatDateTime(draw.scheduledAt)}</div>
                    {draw.drawnNumbers.length > 0 && (
                      <div className="ball-row" style={{ marginTop: 6 }}>
                        {draw.drawnNumbers.slice(0, 12).map((n) => <span key={n} className="ball ball-drawn">{n}</span>)}
                        {draw.drawnNumbers.length > 12 && <span className="text-muted">+{draw.drawnNumbers.length - 12} more</span>}
                      </div>
                    )}
                  </div>
                  {!isSettled && (
                    <div className="admin-row-actions">
                      {isPending && (
                        <button className="btn btn-primary btn-sm" disabled={busy === draw.id} onClick={() => execute(draw.id)}>
                          <Play size={12} style={{ marginRight: 4 }} />{busy === draw.id ? '...' : 'Execute'}
                        </button>
                      )}
                      <button className="btn btn-danger btn-sm" disabled={busy === `cancel-${draw.id}`} onClick={() => cancel(draw.id)}>
                        <X size={12} style={{ marginRight: 4 }} />{busy === `cancel-${draw.id}` ? '...' : 'Cancel'}
                      </button>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// Bingo Admin
// ══════════════════════════════════════════════════════════════════
function BingoAdmin() {
  const addToast = useStore((s) => s.addToast);
  const [rooms, setRooms] = useState<BingoRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    name: 'Room Alpha', ticketPriceMinor: 500, maxTickets: 100, minutesFromNow: 5,
    oneLine: 20000, twoLines: 50000, fullHouse: 100000,
  });

  const load = useCallback(async () => {
    setLoading(true);
    try { setRooms(await adminBingoApi.listAllRooms()); }
    catch (e) { addToast('error', getErrorMessage(e)); }
    finally { setLoading(false); }
  }, [addToast]);

  useEffect(() => { void load(); }, [load]);

  const createRoom = async () => {
    setBusy('create');
    try {
      const scheduledStartAt = new Date(Date.now() + form.minutesFromNow * 60 * 1000).toISOString();
      await adminBingoApi.createRoom({
        name: form.name, ticketPriceMinor: form.ticketPriceMinor, maxTickets: form.maxTickets,
        scheduledStartAt, prizes: { oneLineMinor: form.oneLine, twoLinesMinor: form.twoLines, fullHouseMinor: form.fullHouse },
      });
      addToast('success', `Room "${form.name}" created.`);
      setShowCreate(false);
      await load();
    } catch (e) { addToast('error', getErrorMessage(e)); }
    finally { setBusy(null); }
  };

  const drawNext = async (roomId: string) => {
    setBusy(`draw-${roomId}`);
    try { await adminBingoApi.drawNext(roomId); addToast('success', 'Ball drawn.'); await load(); }
    catch (e) { addToast('error', getErrorMessage(e)); }
    finally { setBusy(null); }
  };

  const cancelRoom = async (roomId: string) => {
    setBusy(`cancel-${roomId}`);
    try { await adminBingoApi.cancelRoom(roomId); addToast('info', 'Room cancelled.'); await load(); }
    catch (e) { addToast('error', getErrorMessage(e)); }
    finally { setBusy(null); }
  };

  const field = (key: keyof typeof form) => ({
    value: form[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [key]: typeof f[key] === 'number' ? Number(e.target.value) : e.target.value })),
  });

  return (
    <div className="stack-lg">
      <div className="admin-action-bar">
        <div>
          <div className="section-title">Bingo Rooms</div>
          <p className="section-copy">Create rooms, draw balls, and manage settlements.</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost btn-sm icon-btn" onClick={load}><RefreshCw size={14} /></button>
          <button className="btn btn-primary btn-sm" onClick={() => setShowCreate((v) => !v)}>
            {showCreate ? 'Close' : '+ New Room'}
          </button>
        </div>
      </div>

      {showCreate && (
        <div className="card admin-form">
          <div className="section-title" style={{ marginBottom: 16, fontSize: 15 }}>Create Bingo Room</div>
          <div className="admin-form-grid">
            <label className="form-field"><span>Room Name</span><input className="input" {...field('name')} /></label>
            <label className="form-field"><span>Ticket Price</span><input className="input" type="number" min={1} {...field('ticketPriceMinor')} /></label>
            <label className="form-field"><span>Max Tickets</span><input className="input" type="number" min={1} {...field('maxTickets')} /></label>
            <label className="form-field"><span>Start In (minutes)</span><input className="input" type="number" min={1} {...field('minutesFromNow')} /></label>
            <label className="form-field"><span>One Line Prize</span><input className="input" type="number" min={0} {...field('oneLine')} /></label>
            <label className="form-field"><span>Two Lines Prize</span><input className="input" type="number" min={0} {...field('twoLines')} /></label>
            <label className="form-field"><span>Full House Prize</span><input className="input" type="number" min={0} {...field('fullHouse')} /></label>
          </div>
          <button className="btn btn-primary btn-full" style={{ marginTop: 16 }} disabled={busy === 'create'} onClick={createRoom}>
            {busy === 'create' ? 'Creating...' : 'Create Room'}
          </button>
        </div>
      )}

      {loading && rooms.length === 0 ? <div className="card-muted">Loading rooms...</div>
        : rooms.length === 0 ? <div className="card-muted">No rooms yet.</div>
        : (
          <div className="list-stack">
            {rooms.map((room) => {
              const isActive = room.status === 'open' || room.status === 'running';
              return (
                <article key={room.id} className="admin-row">
                  <div className="admin-row-info">
                    <div className="admin-row-title">
                      {room.name}
                      <span className={`badge badge-${room.status === 'settled' ? 'green' : room.status === 'cancelled' ? 'red' : room.status === 'running' ? 'violet' : 'gold'}`}>
                        {room.status}
                      </span>
                    </div>
                    <div className="admin-row-meta">
                      {room.soldTickets}/{room.maxTickets} tickets · {formatCredits(room.ticketPriceMinor)} credits · Starts {formatRelativeTime(room.scheduledStartAt)}
                    </div>
                    <div className="admin-row-meta">{room.drawnNumbers.length} balls drawn</div>
                  </div>
                  {isActive && (
                    <div className="admin-row-actions">
                      <button className="btn btn-primary btn-sm" disabled={busy === `draw-${room.id}`} onClick={() => drawNext(room.id)}>
                        <CircleDot size={12} style={{ marginRight: 4 }} />{busy === `draw-${room.id}` ? '...' : 'Draw Ball'}
                      </button>
                      <button className="btn btn-danger btn-sm" disabled={busy === `cancel-${room.id}`} onClick={() => cancelRoom(room.id)}>
                        <X size={12} style={{ marginRight: 4 }} />{busy === `cancel-${room.id}` ? '...' : 'Cancel'}
                      </button>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// Bots Admin
// ══════════════════════════════════════════════════════════════════
function BotsAdmin() {
  const addToast = useStore((s) => s.addToast);
  const [bots, setBots] = useState<BotUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ displayName: 'Bot Alpha', initialBalanceMinor: 10000, ticketsPerRound: 2, spotCount: 4 });

  const load = useCallback(async () => {
    setLoading(true);
    try { setBots(await adminBotsApi.listBots()); }
    catch (e) { addToast('error', getErrorMessage(e)); }
    finally { setLoading(false); }
  }, [addToast]);

  useEffect(() => { void load(); }, [load]);

  const createBot = async () => {
    setBusy('create');
    try { await adminBotsApi.createBot(form); addToast('success', `Bot "${form.displayName}" created.`); setShowCreate(false); await load(); }
    catch (e) { addToast('error', getErrorMessage(e)); }
    finally { setBusy(null); }
  };

  const toggleActive = async (bot: BotUser) => {
    setBusy(bot.id);
    try { await adminBotsApi.updateBot(bot.id, { active: !bot.botPolicy.active }); addToast('success', `Bot ${bot.botPolicy.active ? 'paused' : 'activated'}.`); await load(); }
    catch (e) { addToast('error', getErrorMessage(e)); }
    finally { setBusy(null); }
  };

  const field = (key: keyof typeof form) => ({
    value: form[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [key]: typeof f[key] === 'number' ? Number(e.target.value) : e.target.value })),
  });

  return (
    <div className="stack-lg">
      <div className="admin-action-bar">
        <div>
          <div className="section-title">Keno Bots</div>
          <p className="section-copy">Auto-playing bots that simulate player activity.</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost btn-sm icon-btn" onClick={load}><RefreshCw size={14} /></button>
          <button className="btn btn-primary btn-sm" onClick={() => setShowCreate((v) => !v)}>{showCreate ? 'Close' : '+ New Bot'}</button>
        </div>
      </div>

      {showCreate && (
        <div className="card admin-form">
          <div className="section-title" style={{ marginBottom: 16, fontSize: 15 }}>Create Bot</div>
          <div className="admin-form-grid">
            <label className="form-field"><span>Display Name</span><input className="input" {...field('displayName')} /></label>
            <label className="form-field"><span>Starting Balance</span><input className="input" type="number" min={0} {...field('initialBalanceMinor')} /></label>
            <label className="form-field"><span>Tickets/Round</span><input className="input" type="number" min={0} max={10} {...field('ticketsPerRound')} /></label>
            <label className="form-field"><span>Spot Count (1–12)</span><input className="input" type="number" min={1} max={12} {...field('spotCount')} /></label>
          </div>
          <button className="btn btn-primary btn-full" style={{ marginTop: 16 }} disabled={busy === 'create'} onClick={createBot}>
            {busy === 'create' ? 'Creating...' : 'Create Bot'}
          </button>
        </div>
      )}

      {loading && bots.length === 0 ? <div className="card-muted">Loading bots...</div>
        : bots.length === 0 ? <div className="card-muted">No bots yet.</div>
        : (
          <div className="list-stack">
            {bots.map((bot) => (
              <article key={bot.id} className="admin-row">
                <div className="admin-row-info">
                  <div className="admin-row-title">
                    {bot.displayName}
                    <span className={`badge ${bot.botPolicy?.active ? 'badge-green' : 'badge-red'}`}>
                      {bot.botPolicy?.active ? 'Active' : 'Paused'}
                    </span>
                  </div>
                  <div className="admin-row-meta">{bot.botPolicy?.ticketsPerRound} ticket/round · {bot.botPolicy?.spotCount}-spot</div>
                </div>
                <div className="admin-row-actions">
                  <button className={`btn btn-sm ${bot.botPolicy?.active ? 'btn-danger' : 'btn-secondary'}`}
                    disabled={busy === bot.id} onClick={() => toggleActive(bot)}>
                    {busy === bot.id ? '...' : bot.botPolicy?.active ? 'Pause' : 'Activate'}
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// Main Admin Page
// ══════════════════════════════════════════════════════════════════
export function Admin() {
  const user = useStore((s) => s.user);
  const setAuth = useStore((s) => s.setAuth);
  const setWallet = useStore((s) => s.setWallet);
  const addToast = useStore((s) => s.addToast);
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');

  if (!user?.roles.includes('admin')) {
    const handleDevLogin = async () => {
      try {
        const { authApi, walletApi } = await import('../lib/api');
        const data = await authApi.devSeedAdmin();
        setAuth(data.user, data.accessToken);
        const wallet = await walletApi.getWallet();
        setWallet(wallet);
        addToast('success', 'Logged in as Admin');
      } catch (err) {
        addToast('error', getErrorMessage(err));
      }
    };

    return (
      <div className="centered-loader" style={{ flex: 1, gap: 16 }}>
        <p style={{ color: 'var(--text-muted)' }}>Admin access required.</p>
        {import.meta.env.DEV && (
          <button className="btn btn-primary" onClick={handleDevLogin}>Login as Dev Admin</button>
        )}
      </div>
    );
  }

  return (
    <div className="stack-lg">
      <div className="admin-header">
        <Settings size={24} strokeWidth={1.8} style={{ color: 'var(--gold)' }} />
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>Admin Panel</h1>
          <p className="section-copy">Platform management and financial controls.</p>
        </div>
      </div>

      <div className="admin-tabs" style={{ overflowX: 'auto' }}>
        {TABS.map((tab) => (
          <button key={tab.id} className={`admin-tab${activeTab === tab.id ? ' active' : ''}`} onClick={() => setActiveTab(tab.id)}>
            {tab.icon}
            <span style={{ marginLeft: 5 }}>{tab.label}</span>
            {tab.id === 'withdrawals' && <ChevronRight size={11} style={{ marginLeft: 2, opacity: 0.5 }} />}
          </button>
        ))}
      </div>

      {activeTab === 'overview' && <OverviewAdmin />}
      {activeTab === 'keno' && <KenoAdmin />}
      {activeTab === 'bingo' && <BingoAdmin />}
      {activeTab === 'bots' && <BotsAdmin />}
      {activeTab === 'withdrawals' && <WithdrawalsAdmin />}
      {activeTab === 'config' && <ConfigAdmin />}
    </div>
  );
}
