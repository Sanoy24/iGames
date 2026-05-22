import { useCallback, useEffect, useState } from 'react';
import {
  Activity, Bot, ChevronDown, ChevronUp, CircleDot, Dices,
  Play, Plus, RefreshCw, Settings, Shield, Users, Wallet, X,
} from 'lucide-react';
import {
  adminAgentsApi,
  adminBingoApi,
  adminBotsApi,
  adminKenoApi,
  adminApi,
  adminWithdrawalsApi,
  type BotUser,
  type PlatformStats,
  type SystemConfig,
} from '../lib/api';
import type { BingoRoom, KenoConfig, KenoDraw, User, Withdrawal } from '../lib/models';
import { formatCreditsFull, formatDateTime, formatRelativeTime, getErrorMessage, titleCase } from '../lib/utils';
import { formatCredits, useStore } from '../store/useStore';

type AdminTab = 'overview' | 'agents' | 'keno' | 'bingo' | 'bots' | 'withdrawals' | 'config';

const TABS: Array<{ id: AdminTab; label: string; icon: React.ReactNode }> = [
  { id: 'overview',    label: 'Overview',    icon: <Activity size={15} /> },
  { id: 'agents',      label: 'Agents',      icon: <Users size={15} /> },
  { id: 'keno',        label: 'Keno',        icon: <Dices size={15} /> },
  { id: 'bingo',       label: 'Bingo',       icon: <CircleDot size={15} /> },
  { id: 'bots',        label: 'Bots',        icon: <Bot size={15} /> },
  { id: 'withdrawals', label: 'Withdrawals', icon: <Wallet size={15} /> },
  { id: 'config',      label: 'Config',      icon: <Settings size={15} /> },
];

// ── Shared helpers ────────────────────────────────────────────────

function Kpi({ label, value, color = '#3b82f6' }: { label: string; value: string; color?: string }) {
  return (
    <div className="adm-kpi" style={{ borderTopColor: color }}>
      <span className="adm-kpi-label">{label}</span>
      <strong className="adm-kpi-value" style={{ color }}>{value}</strong>
    </div>
  );
}

function Bar({ value, max, color = '#3b82f6' }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="adm-bar">
      <div className="adm-bar-fill" style={{ width: `${pct.toFixed(1)}%`, background: color }} />
    </div>
  );
}

function SectionHead({
  title, sub, children,
}: {
  title: string; sub?: string; children?: React.ReactNode;
}) {
  return (
    <div className="adm-section-head">
      <div>
        <h2 className="adm-section-title">{title}</h2>
        {sub && <p className="adm-section-sub">{sub}</p>}
      </div>
      {children && <div className="adm-section-actions">{children}</div>}
    </div>
  );
}

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

  if (loading) return <div className="adm-empty">Loading platform stats…</div>;
  if (!stats) return null;

  const bd = stats.breakdown as Record<string, number>;
  const totalLiab = stats.totalLiabilitiesMinor || 1;
  const metrics: Array<{ key: string; label: string; color: string }> = [
    { key: 'walletAvailable',    label: 'Wallet (available)',   color: '#3b82f6' },
    { key: 'walletReserved',     label: 'Wallet (reserved)',    color: '#8b5cf6' },
    { key: 'kenoPendingStakes',  label: 'Keno pending stakes',  color: '#f59e0b' },
    { key: 'bingoPendingStakes', label: 'Bingo pending stakes', color: '#ec4899' },
    { key: 'ticketPurchases',    label: 'Ticket purchases',     color: '#10b981' },
    { key: 'payouts',            label: 'Payouts',              color: '#ef4444' },
    { key: 'refunds',            label: 'Refunds',              color: '#6b7280' },
  ];

  return (
    <div className="stack-lg">
      <SectionHead title="Platform Overview" sub="Live financial snapshot.">
        <button className="adm-icon-btn" onClick={load} title="Refresh"><RefreshCw size={14} /></button>
      </SectionHead>

      <div className="adm-kpi-grid">
        <Kpi label="Gross Gaming Revenue" value={formatCreditsFull(stats.ggrMinor)} color="#10b981" />
        <Kpi label="Total Volume"          value={formatCreditsFull(stats.totalVolumeMinor)} color="#3b82f6" />
        <Kpi label="Total Payouts"         value={formatCreditsFull(stats.totalPayoutsMinor)} color="#ef4444" />
        <Kpi label="Total Liabilities"     value={formatCreditsFull(stats.totalLiabilitiesMinor)} color="#f59e0b" />
      </div>

      <div className="adm-panel">
        <div className="adm-panel-head">Financial Breakdown</div>
        <div className="adm-metric-list">
          {metrics.map(({ key, label, color }) => {
            const val = bd[key] ?? 0;
            return (
              <div key={key} className="adm-metric-row">
                <span className="adm-metric-label">{label}</span>
                <Bar value={val} max={totalLiab} color={color} />
                <span className="adm-metric-val">{formatCredits(val)}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// Agents
// ══════════════════════════════════════════════════════════════════
function AgentsAdmin() {
  const addToast = useStore((s) => s.addToast);
  const [agents, setAgents] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ displayName: '', phoneNumber: '', password: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try { setAgents(await adminAgentsApi.listAgents()); }
    catch (e) { addToast('error', getErrorMessage(e)); }
    finally { setLoading(false); }
  }, [addToast]);

  useEffect(() => { void load(); }, [load]);

  const createAgent = async () => {
    if (!form.displayName.trim() || !form.phoneNumber.trim() || form.password.length < 8) {
      addToast('info', 'Fill in all fields. Password must be at least 8 characters.');
      return;
    }
    setCreating(true);
    try {
      await adminAgentsApi.createAgent(form);
      addToast('success', `Agent "${form.displayName}" created.`);
      setForm({ displayName: '', phoneNumber: '', password: '' });
      setShowForm(false);
      await load();
    } catch (e) { addToast('error', getErrorMessage(e)); }
    finally { setCreating(false); }
  };

  return (
    <div className="stack-lg">
      <SectionHead title="Agent Accounts" sub="Agents process player withdrawals.">
        <button className="adm-icon-btn" onClick={load} title="Refresh"><RefreshCw size={14} /></button>
        <button className="adm-btn adm-btn-primary" onClick={() => setShowForm((v) => !v)}>
          {showForm ? <X size={13} /> : <Plus size={13} />}
          {showForm ? 'Cancel' : 'New Agent'}
        </button>
      </SectionHead>

      {showForm && (
        <div className="adm-panel">
          <div className="adm-panel-head">Create Agent Account</div>
          <div className="adm-field-grid">
            <label className="adm-field">
              <span>Display Name</span>
              <input className="input" placeholder="e.g. Agent Sara" value={form.displayName}
                onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))} />
            </label>
            <label className="adm-field">
              <span>Phone Number</span>
              <input className="input" type="tel" placeholder="09XXXXXXXX" value={form.phoneNumber}
                onChange={(e) => setForm((f) => ({ ...f, phoneNumber: e.target.value }))} />
            </label>
            <label className="adm-field">
              <span>Password (min 8 chars)</span>
              <input className="input" type="password" placeholder="••••••••" value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} />
            </label>
          </div>
          <div className="adm-panel-footer">
            <button className="adm-btn adm-btn-primary" disabled={creating} onClick={createAgent}>
              {creating ? 'Creating…' : 'Create Agent'}
            </button>
          </div>
        </div>
      )}

      <div className="adm-panel">
        {loading && agents.length === 0 ? (
          <div className="adm-empty">Loading agents…</div>
        ) : agents.length === 0 ? (
          <div className="adm-empty">No agents yet. Create one above.</div>
        ) : (
          <table className="adm-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Phone</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((a) => (
                <tr key={a.id} className="adm-tr">
                  <td><strong>{a.displayName}</strong></td>
                  <td className="adm-td-muted">{a.phoneNumber ?? '—'}</td>
                  <td>
                    <span className={`badge ${a.status === 'active' || !a.status ? 'badge-green' : 'badge-red'}`}>
                      {a.status ?? 'active'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
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
    telebirrCreditMinorPerBirr: 100, welcomeBonusMinor: 0,
    withdrawalServiceChargePct: 0, withdrawalMinAmountMinor: 0,
    withdrawalMaxAmountMinor: 0, maxPendingWithdrawalsPerUser: 1,
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
      setConfig(updated); setForm(updated);
      addToast('success', 'Configuration saved.');
    } catch (e) { addToast('error', getErrorMessage(e)); }
    finally { setSaving(false); }
  };

  const field = (key: keyof SystemConfig, label: string, hint?: string) => (
    <label className="adm-field" key={key}>
      <span>{label}{hint && <em className="adm-field-hint"> — {hint}</em>}</span>
      <input className="input" type="number" min={0} value={form[key]}
        onChange={(e) => setForm((f) => ({ ...f, [key]: Number(e.target.value) }))} />
    </label>
  );

  if (loading) return <div className="adm-empty">Loading configuration…</div>;

  return (
    <div className="stack-lg">
      <SectionHead title="System Configuration" sub="Platform-wide game and payment settings." />

      <div className="adm-panel">
        <div className="adm-panel-head">Payments & Credits</div>
        <div className="adm-field-grid">
          {field('telebirrCreditMinorPerBirr', 'Credits per Birr', '100 = 1 Birr → 100 credits')}
          {field('welcomeBonusMinor', 'Welcome Bonus (credits)', '0 = disabled')}
        </div>
      </div>

      <div className="adm-panel">
        <div className="adm-panel-head">Withdrawal Rules</div>
        <div className="adm-field-grid">
          {field('withdrawalServiceChargePct', 'Service Charge %', 'deducted from gross withdrawal')}
          {field('withdrawalMinAmountMinor', 'Minimum Withdrawal (credits)', '0 = no minimum')}
          {field('withdrawalMaxAmountMinor', 'Maximum Withdrawal (credits)', '0 = no limit')}
          {field('maxPendingWithdrawalsPerUser', 'Max Pending per User')}
        </div>
      </div>

      <button className="adm-btn adm-btn-primary adm-btn-full" disabled={saving} onClick={save}>
        {saving ? 'Saving…' : 'Save Configuration'}
      </button>
      {config && (
        <p className="adm-save-note">
          Current: {config.withdrawalServiceChargePct}% charge · min {formatCredits(config.withdrawalMinAmountMinor)} · max {config.withdrawalMaxAmountMinor > 0 ? formatCredits(config.withdrawalMaxAmountMinor) : '∞'} credits
        </p>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// Withdrawals
// ══════════════════════════════════════════════════════════════════
function WithdrawalsAdmin() {
  const addToast = useStore((s) => s.addToast);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<string | null>(null);

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

  const pending = withdrawals.filter((w) => w.status === 'pending' || (w.status as string) === 'processing');
  const done = withdrawals.filter((w) => w.status === 'completed' || w.status === 'rejected');

  const W_STATUS: Record<string, string> = { pending: 'badge-gold', claimed: 'badge-violet', processing: 'badge-violet', completed: 'badge-green', rejected: 'badge-red' };

  return (
    <div className="stack-lg">
      <SectionHead title="Withdrawal Requests" sub="Review and process player cashouts.">
        <button className="adm-icon-btn" onClick={load}><RefreshCw size={14} /></button>
      </SectionHead>

      {loading && withdrawals.length === 0 ? (
        <div className="adm-empty">Loading withdrawals…</div>
      ) : (
        <>
          {/* Pending */}
          <div className="adm-panel">
            <div className="adm-panel-head">
              Pending
              <span className="adm-badge-count">{pending.length}</span>
            </div>
            {pending.length === 0 ? (
              <div className="adm-empty">No pending withdrawals.</div>
            ) : (
              <div className="adm-list">
                {pending.map((w) => (
                  <div key={w.id} className="adm-w-row">
                    <div className="adm-w-main" onClick={() => setExpanded(expanded === w.id ? null : w.id)}>
                      <div className="adm-w-info">
                        <strong>{formatCredits(w.amountMinor)} credits</strong>
                        <span className="adm-td-muted">{w.destinationAccount}</span>
                        <span className="adm-td-muted">{formatDateTime(w.createdAt)}</span>
                      </div>
                      <div className="adm-w-right">
                        <span className={`badge ${W_STATUS[w.status] ?? 'badge-gold'}`}>{w.status}</span>
                        {expanded === w.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </div>
                    </div>
                    {expanded === w.id && (
                      <div className="adm-w-expand">
                        <input className="input" placeholder="Admin note (optional)"
                          value={notes[w.id] ?? ''}
                          onChange={(e) => setNotes((n) => ({ ...n, [w.id]: e.target.value }))} />
                        <div className="adm-w-actions">
                          <button className="adm-btn adm-btn-success" disabled={!!busy}
                            onClick={() => process(w.id, 'approve')}>
                            {busy === `approve-${w.id}` ? '…' : 'Approve'}
                          </button>
                          <button className="adm-btn adm-btn-danger" disabled={!!busy}
                            onClick={() => process(w.id, 'reject')}>
                            {busy === `reject-${w.id}` ? '…' : 'Reject'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* History */}
          {done.length > 0 && (
            <div className="adm-panel">
              <div className="adm-panel-head">
                History
                <span className="adm-badge-count">{done.length}</span>
              </div>
              <table className="adm-table">
                <thead><tr><th>Amount</th><th>Phone</th><th>Status</th><th>Processed</th></tr></thead>
                <tbody>
                  {done.map((w) => (
                    <tr key={w.id} className="adm-tr">
                      <td><strong>{formatCredits(w.amountMinor)}</strong></td>
                      <td className="adm-td-muted">{w.destinationAccount}</td>
                      <td><span className={`badge ${W_STATUS[w.status] ?? 'badge-gold'}`}>{w.status}</span></td>
                      <td className="adm-td-muted">{w.processedAt ? formatDateTime(w.processedAt) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// Keno
// ══════════════════════════════════════════════════════════════════
function KenoAdmin() {
  const addToast = useStore((s) => s.addToast);
  const [draws, setDraws] = useState<KenoDraw[]>([]);
  const [config, setConfig] = useState<KenoConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [showCfg, setShowCfg] = useState(false);
  const [cfgForm, setCfgForm] = useState({ ticketPriceMinor: 100, globalBotWinInterval: 0, autoScheduleIntervalMinutes: 3 });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [d, c] = await Promise.all([adminKenoApi.listDraws(20), adminKenoApi.getConfig()]);
      setDraws(d); setConfig(c);
      setCfgForm({ ticketPriceMinor: c.ticketPriceMinor, globalBotWinInterval: c.globalBotWinInterval || 0, autoScheduleIntervalMinutes: c.autoScheduleIntervalMinutes ?? 3 });
    } catch (e) { addToast('error', getErrorMessage(e)); }
    finally { setLoading(false); }
  }, [addToast]);

  useEffect(() => { void load(); }, [load]);

  const updateConfig = async () => {
    if (!config) return;
    setBusy('cfg');
    try { await adminKenoApi.createConfig({ ...config, ...cfgForm }); addToast('success', 'Config updated.'); setShowCfg(false); await load(); }
    catch (e) { addToast('error', getErrorMessage(e)); }
    finally { setBusy(null); }
  };

  const D_STATUS: Record<string, string> = { settled: 'badge-green', cancelled: 'badge-red', pending: 'badge-violet' };

  return (
    <div className="stack-lg">
      <SectionHead title="Keno Draws" sub="Schedule and execute draw rounds.">
        <button className="adm-icon-btn" onClick={load}><RefreshCw size={14} /></button>
        <button className="adm-btn adm-btn-secondary" onClick={() => setShowCfg((v) => !v)}>
          <Settings size={13} />{showCfg ? 'Close' : 'Config'}
        </button>
        <button className="adm-btn adm-btn-primary" disabled={busy === 'sched'}
          onClick={async () => { setBusy('sched'); try { await adminKenoApi.scheduleDraw(); await load(); } catch (e) { addToast('error', getErrorMessage(e)); } finally { setBusy(null); } }}>
          <Plus size={13} />Schedule
        </button>
      </SectionHead>

      {config && (
        <div className="adm-info-strip">
          <span>v{config.version}</span>
          <span>{formatCredits(config.ticketPriceMinor)} credits/ticket</span>
          <span>{config.numberMin}–{config.numberMax}, draw {config.drawSize}</span>
          <span>Bot interval: {config.globalBotWinInterval || 'off'}</span>
        </div>
      )}

      {showCfg && config && (
        <div className="adm-panel">
          <div className="adm-panel-head">New Config Version</div>
          <div className="adm-field-grid">
            <label className="adm-field">
              <span>Ticket Price (credits)</span>
              <input className="input" type="number" value={cfgForm.ticketPriceMinor}
                onChange={(e) => setCfgForm((f) => ({ ...f, ticketPriceMinor: Number(e.target.value) }))} />
            </label>
            <label className="adm-field">
              <span>Bot Win Interval (0 = off)</span>
              <input className="input" type="number" value={cfgForm.globalBotWinInterval}
                onChange={(e) => setCfgForm((f) => ({ ...f, globalBotWinInterval: Number(e.target.value) }))} />
            </label>
            <label className="adm-field">
              <span>Auto-schedule Interval (minutes, 0 = manual)</span>
              <input className="input" type="number" min={0} max={60} value={cfgForm.autoScheduleIntervalMinutes}
                onChange={(e) => setCfgForm((f) => ({ ...f, autoScheduleIntervalMinutes: Number(e.target.value) }))} />
            </label>
          </div>
          <div className="adm-panel-footer">
            <button className="adm-btn adm-btn-primary" disabled={busy === 'cfg'} onClick={updateConfig}>
              {busy === 'cfg' ? 'Saving…' : 'Activate Config'}
            </button>
          </div>
        </div>
      )}

      <div className="adm-panel">
        {loading && draws.length === 0 ? <div className="adm-empty">Loading draws…</div>
          : draws.length === 0 ? <div className="adm-empty">No draws yet.</div>
          : (
            <table className="adm-table">
              <thead><tr><th>Draw ID</th><th>Scheduled</th><th>Status</th><th>Numbers</th><th></th></tr></thead>
              <tbody>
                {draws.map((draw) => {
                  const active = draw.status === 'pending';
                  return (
                    <tr key={draw.id} className="adm-tr">
                      <td><code className="adm-mono">{draw.id.slice(-8)}</code></td>
                      <td className="adm-td-muted">{formatDateTime(draw.scheduledAt)}</td>
                      <td><span className={`badge ${D_STATUS[draw.status] ?? 'badge-violet'}`}>{draw.status}</span></td>
                      <td className="adm-td-muted">{draw.drawnNumbers.length > 0 ? `${draw.drawnNumbers.length} drawn` : '—'}</td>
                      <td>
                        {active && (
                          <div className="adm-cell-actions">
                            <button className="adm-btn adm-btn-primary adm-btn-xs"
                              disabled={!!busy}
                              onClick={async () => { setBusy(draw.id); try { await adminKenoApi.executeDraw(draw.id); await load(); } catch (e) { addToast('error', getErrorMessage(e)); } finally { setBusy(null); } }}>
                              <Play size={11} />Execute
                            </button>
                            <button className="adm-btn adm-btn-danger adm-btn-xs"
                              disabled={!!busy}
                              onClick={async () => { setBusy(`c-${draw.id}`); try { await adminKenoApi.cancelDraw(draw.id); await load(); } catch (e) { addToast('error', getErrorMessage(e)); } finally { setBusy(null); } }}>
                              <X size={11} />Cancel
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// Bingo
// ══════════════════════════════════════════════════════════════════
function BingoAdmin() {
  const addToast = useStore((s) => s.addToast);
  const [rooms, setRooms] = useState<BingoRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: 'Room Alpha', ticketPriceMinor: 500, maxTickets: 100, minutesFromNow: 5, oneLine: 20000, twoLines: 50000, fullHouse: 100000 });

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
      await adminBingoApi.createRoom({
        name: form.name, ticketPriceMinor: form.ticketPriceMinor, maxTickets: form.maxTickets,
        scheduledStartAt: new Date(Date.now() + form.minutesFromNow * 60_000).toISOString(),
        prizes: { oneLineMinor: form.oneLine, twoLinesMinor: form.twoLines, fullHouseMinor: form.fullHouse },
      });
      addToast('success', `Room "${form.name}" created.`);
      setShowCreate(false); await load();
    } catch (e) { addToast('error', getErrorMessage(e)); }
    finally { setBusy(null); }
  };

  const f = (key: keyof typeof form) => ({
    value: form[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((prev) => ({ ...prev, [key]: typeof prev[key] === 'number' ? Number(e.target.value) : e.target.value })),
  });

  const R_STATUS: Record<string, string> = { open: 'badge-gold', running: 'badge-violet', settled: 'badge-green', cancelled: 'badge-red' };

  return (
    <div className="stack-lg">
      <SectionHead title="Bingo Rooms" sub="Create rooms and manage live draws.">
        <button className="adm-icon-btn" onClick={load}><RefreshCw size={14} /></button>
        <button className="adm-btn adm-btn-primary" onClick={() => setShowCreate((v) => !v)}>
          {showCreate ? <X size={13} /> : <Plus size={13} />}{showCreate ? 'Cancel' : 'New Room'}
        </button>
      </SectionHead>

      {showCreate && (
        <div className="adm-panel">
          <div className="adm-panel-head">Create Bingo Room</div>
          <div className="adm-field-grid">
            <label className="adm-field"><span>Room Name</span><input className="input" {...f('name')} /></label>
            <label className="adm-field"><span>Ticket Price (credits)</span><input className="input" type="number" min={1} {...f('ticketPriceMinor')} /></label>
            <label className="adm-field"><span>Max Tickets</span><input className="input" type="number" min={1} {...f('maxTickets')} /></label>
            <label className="adm-field"><span>Starts In (minutes)</span><input className="input" type="number" min={1} {...f('minutesFromNow')} /></label>
            <label className="adm-field"><span>One Line Prize</span><input className="input" type="number" min={0} {...f('oneLine')} /></label>
            <label className="adm-field"><span>Two Lines Prize</span><input className="input" type="number" min={0} {...f('twoLines')} /></label>
            <label className="adm-field"><span>Full House Prize</span><input className="input" type="number" min={0} {...f('fullHouse')} /></label>
          </div>
          <div className="adm-panel-footer">
            <button className="adm-btn adm-btn-primary" disabled={busy === 'create'} onClick={createRoom}>
              {busy === 'create' ? 'Creating…' : 'Create Room'}
            </button>
          </div>
        </div>
      )}

      <div className="adm-panel">
        {loading && rooms.length === 0 ? <div className="adm-empty">Loading rooms…</div>
          : rooms.length === 0 ? <div className="adm-empty">No rooms yet.</div>
          : (
            <table className="adm-table">
              <thead><tr><th>Room</th><th>Tickets</th><th>Status</th><th>Starts</th><th></th></tr></thead>
              <tbody>
                {rooms.map((room) => {
                  const isActive = room.status === 'open' || room.status === 'running';
                  return (
                    <tr key={room.id} className="adm-tr">
                      <td><strong>{room.name}</strong></td>
                      <td className="adm-td-muted">{room.soldTickets}/{room.maxTickets}</td>
                      <td><span className={`badge ${R_STATUS[room.status] ?? 'badge-gold'}`}>{room.status}</span></td>
                      <td className="adm-td-muted">{formatRelativeTime(room.scheduledStartAt)}</td>
                      <td>
                        {isActive && (
                          <div className="adm-cell-actions">
                            <button className="adm-btn adm-btn-primary adm-btn-xs"
                              disabled={!!busy}
                              onClick={async () => { setBusy(`d-${room.id}`); try { await adminBingoApi.drawNext(room.id); await load(); } catch (e) { addToast('error', getErrorMessage(e)); } finally { setBusy(null); } }}>
                              <CircleDot size={11} />Draw
                            </button>
                            <button className="adm-btn adm-btn-danger adm-btn-xs"
                              disabled={!!busy}
                              onClick={async () => { setBusy(`c-${room.id}`); try { await adminBingoApi.cancelRoom(room.id); await load(); } catch (e) { addToast('error', getErrorMessage(e)); } finally { setBusy(null); } }}>
                              <X size={11} />Cancel
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// Bots
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

  const f = (key: keyof typeof form) => ({
    value: form[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((prev) => ({ ...prev, [key]: typeof prev[key] === 'number' ? Number(e.target.value) : e.target.value })),
  });

  return (
    <div className="stack-lg">
      <SectionHead title="Keno Bots" sub="Auto-playing bots that simulate player activity.">
        <button className="adm-icon-btn" onClick={load}><RefreshCw size={14} /></button>
        <button className="adm-btn adm-btn-primary" onClick={() => setShowCreate((v) => !v)}>
          {showCreate ? <X size={13} /> : <Plus size={13} />}{showCreate ? 'Cancel' : 'New Bot'}
        </button>
      </SectionHead>

      {showCreate && (
        <div className="adm-panel">
          <div className="adm-panel-head">Create Bot</div>
          <div className="adm-field-grid">
            <label className="adm-field"><span>Display Name</span><input className="input" {...f('displayName')} /></label>
            <label className="adm-field"><span>Starting Balance (credits)</span><input className="input" type="number" min={0} {...f('initialBalanceMinor')} /></label>
            <label className="adm-field"><span>Tickets per Round</span><input className="input" type="number" min={0} max={10} {...f('ticketsPerRound')} /></label>
            <label className="adm-field"><span>Spot Count (1–12)</span><input className="input" type="number" min={1} max={12} {...f('spotCount')} /></label>
          </div>
          <div className="adm-panel-footer">
            <button className="adm-btn adm-btn-primary" disabled={busy === 'create'} onClick={createBot}>
              {busy === 'create' ? 'Creating…' : 'Create Bot'}
            </button>
          </div>
        </div>
      )}

      <div className="adm-panel">
        {loading && bots.length === 0 ? <div className="adm-empty">Loading bots…</div>
          : bots.length === 0 ? <div className="adm-empty">No bots yet.</div>
          : (
            <table className="adm-table">
              <thead><tr><th>Name</th><th>Tickets/round</th><th>Spots</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {bots.map((bot) => (
                  <tr key={bot.id} className="adm-tr">
                    <td><strong>{bot.displayName}</strong></td>
                    <td className="adm-td-muted">{bot.botPolicy?.ticketsPerRound}</td>
                    <td className="adm-td-muted">{bot.botPolicy?.spotCount}-spot</td>
                    <td>
                      <span className={`badge ${bot.botPolicy?.active ? 'badge-green' : 'badge-red'}`}>
                        {bot.botPolicy?.active ? 'Active' : 'Paused'}
                      </span>
                    </td>
                    <td>
                      <button
                        className={`adm-btn adm-btn-xs ${bot.botPolicy?.active ? 'adm-btn-danger' : 'adm-btn-secondary'}`}
                        disabled={busy === bot.id}
                        onClick={async () => {
                          setBusy(bot.id);
                          try { await adminBotsApi.updateBot(bot.id, { active: !bot.botPolicy.active }); await load(); }
                          catch (e) { addToast('error', getErrorMessage(e)); }
                          finally { setBusy(null); }
                        }}>
                        {busy === bot.id ? '…' : bot.botPolicy?.active ? 'Pause' : 'Activate'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// Root Admin
// ══════════════════════════════════════════════════════════════════
export function Admin() {
  const user = useStore((s) => s.user);
  const setAuth = useStore((s) => s.setAuth);
  const setWallet = useStore((s) => s.setWallet);
  const addToast = useStore((s) => s.addToast);
  const [tab, setTab] = useState<AdminTab>('overview');

  if (!user?.roles.includes('admin')) {
    const handleDevLogin = async () => {
      try {
        const { authApi, walletApi } = await import('../lib/api');
        const data = await authApi.devSeedAdmin();
        setAuth(data.user, data.accessToken);
        setWallet(await walletApi.getWallet());
        addToast('success', 'Logged in as Dev Admin');
      } catch (err) { addToast('error', getErrorMessage(err)); }
    };
    return (
      <div className="centered-loader" style={{ flex: 1, gap: 16 }}>
        <Shield size={32} strokeWidth={1.5} style={{ color: 'var(--text-muted)' }} />
        <p style={{ color: 'var(--text-muted)' }}>Admin access required.</p>
        {import.meta.env.DEV && (
          <button className="btn btn-primary" onClick={handleDevLogin}>Login as Dev Admin</button>
        )}
      </div>
    );
  }

  return (
    <div className="adm-root">
      {/* Header */}
      <div className="adm-header">
        <Shield size={18} strokeWidth={1.8} />
        <div>
          <span className="adm-header-title">Admin Panel</span>
          <span className="adm-header-sub">iGames Platform</span>
        </div>
      </div>

      {/* Tab bar */}
      <div className="adm-tab-bar">
        {TABS.map((t) => (
          <button key={t.id} className={`adm-tab${tab === t.id ? ' active' : ''}`} onClick={() => setTab(t.id)}>
            {t.icon}
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="adm-content">
        {tab === 'overview'    && <OverviewAdmin />}
        {tab === 'agents'      && <AgentsAdmin />}
        {tab === 'keno'        && <KenoAdmin />}
        {tab === 'bingo'       && <BingoAdmin />}
        {tab === 'bots'        && <BotsAdmin />}
        {tab === 'withdrawals' && <WithdrawalsAdmin />}
        {tab === 'config'      && <ConfigAdmin />}
      </div>
    </div>
  );
}
