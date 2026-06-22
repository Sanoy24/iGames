import { useCallback, useEffect, useState } from 'react';
import {
  Activity, Bot, ChevronDown, ChevronUp, CircleDot, Coins, Dices,
  Play, Plus, RefreshCw, Settings, Shield, Users, Wallet, X,
} from 'lucide-react';
import {
  adminAgentsApi,
  adminBingoApi,
  adminBotsApi,
  adminKenoApi,
  adminApi,
  adminWithdrawalsApi,
  walletApi,
  type BotUser,
  type PlatformStats,
  type SystemConfig,
} from '../lib/api';
import type { BingoConfig, BingoRoom, KenoConfig, KenoDraw, KenoPaytableEntry, User, Withdrawal } from '../lib/models';
import { formatCreditsFull, formatDateTime, formatRelativeTime, getErrorMessage } from '../lib/utils';
import { formatCredits, useStore } from '../store/useStore';

type AdminTab = 'overview' | 'agents' | 'keno' | 'bingo' | 'bots' | 'withdrawals' | 'config' | 'emoney';

const TABS: Array<{ id: AdminTab; label: string; icon: React.ReactNode }> = [
  { id: 'overview',    label: 'Overview',    icon: <Activity size={15} /> },
  { id: 'agents',      label: 'Agents',      icon: <Users size={15} /> },
  { id: 'keno',        label: 'Keno',        icon: <Dices size={15} /> },
  { id: 'bingo',       label: 'Bingo',       icon: <CircleDot size={15} /> },
  { id: 'bots',        label: 'Bots',        icon: <Bot size={15} /> },
  { id: 'withdrawals', label: 'Withdrawals', icon: <Wallet size={15} /> },
  { id: 'config',      label: 'Config',      icon: <Settings size={15} /> },
  { id: 'emoney',      label: 'E-Money',     icon: <Coins size={15} /> },
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
  const [updating, setUpdating] = useState(false);
  const [showForm, setShowForm] = useState(false);
  
  const [form, setForm] = useState({
    displayName: '',
    phoneNumber: '',
    password: '',
    workStartHour: 8,
    workStartMinute: 0,
    workEndHour: 17,
    workEndMinute: 0,
    deposit: true,
    withdraw: true,
  });

  const [editingAgent, setEditingAgent] = useState<User | null>(null);
  const [editForm, setEditForm] = useState({
    displayName: '',
    phoneNumber: '',
    password: '',
    workStartHour: 8,
    workStartMinute: 0,
    workEndHour: 17,
    workEndMinute: 0,
    deposit: true,
    withdraw: true,
    status: 'active'
  });

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
      await adminAgentsApi.createAgent({
        displayName: form.displayName,
        phoneNumber: form.phoneNumber,
        password: form.password,
        workStartHour: form.workStartHour,
        workStartMinute: form.workStartMinute,
        workEndHour: form.workEndHour,
        workEndMinute: form.workEndMinute,
        agentPermissions: {
          deposit: form.deposit,
          withdraw: form.withdraw,
        }
      });
      addToast('success', `Agent "${form.displayName}" created.`);
      setForm({
        displayName: '',
        phoneNumber: '',
        password: '',
        workStartHour: 8,
        workStartMinute: 0,
        workEndHour: 17,
        workEndMinute: 0,
        deposit: true,
        withdraw: true,
      });
      setShowForm(false);
      await load();
    } catch (e) { addToast('error', getErrorMessage(e)); }
    finally { setCreating(false); }
  };

  const startEdit = (agent: User) => {
    setEditingAgent(agent);
    setEditForm({
      displayName: agent.displayName,
      phoneNumber: agent.phoneNumber || '',
      password: '',
      workStartHour: agent.workStartHour !== undefined ? agent.workStartHour : 8,
      workStartMinute: agent.workStartMinute !== undefined ? agent.workStartMinute : 0,
      workEndHour: agent.workEndHour !== undefined ? agent.workEndHour : 17,
      workEndMinute: agent.workEndMinute !== undefined ? agent.workEndMinute : 0,
      deposit: agent.agentPermissions ? agent.agentPermissions.deposit : true,
      withdraw: agent.agentPermissions ? agent.agentPermissions.withdraw : true,
      status: agent.status || 'active'
    });
  };

  const updateAgent = async () => {
    if (!editingAgent) return;
    if (!editForm.displayName.trim() || !editForm.phoneNumber.trim()) {
      addToast('info', 'Name and Phone number are required.');
      return;
    }
    if (editForm.password && editForm.password.length < 8) {
      addToast('info', 'Password must be at least 8 characters.');
      return;
    }
    setUpdating(true);
    try {
      const payload: any = {
        displayName: editForm.displayName,
        phoneNumber: editForm.phoneNumber,
        workStartHour: editForm.workStartHour,
        workStartMinute: editForm.workStartMinute,
        workEndHour: editForm.workEndHour,
        workEndMinute: editForm.workEndMinute,
        agentPermissions: {
          deposit: editForm.deposit,
          withdraw: editForm.withdraw,
        },
        status: editForm.status
      };
      if (editForm.password.trim() !== '') {
        payload.password = editForm.password;
      }
      await adminAgentsApi.updateAgent(editingAgent.id, payload);
      addToast('success', `Agent "${editForm.displayName}" updated.`);
      setEditingAgent(null);
      await load();
    } catch (e) { addToast('error', getErrorMessage(e)); }
    finally { setUpdating(false); }
  };

  return (
    <div className="stack-lg">
      <SectionHead title="Agent Accounts" sub="Agents process player withdrawals.">
        <button className="adm-icon-btn" onClick={load} title="Refresh"><RefreshCw size={14} /></button>
        <button className="adm-btn adm-btn-primary" onClick={() => { setShowForm((v) => !v); setEditingAgent(null); }}>
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
            <label className="adm-field">
              <span>Work Hours Timeframe</span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input className="input" type="number" min={0} max={23} placeholder="Start Hr" value={form.workStartHour} style={{ width: 80 }}
                  onChange={(e) => setForm((f) => ({ ...f, workStartHour: Number(e.target.value) }))} />
                <span>:</span>
                <input className="input" type="number" min={0} max={59} placeholder="Min" value={form.workStartMinute} style={{ width: 80 }}
                  onChange={(e) => setForm((f) => ({ ...f, workStartMinute: Number(e.target.value) }))} />
                <span>to</span>
                <input className="input" type="number" min={0} max={23} placeholder="End Hr" value={form.workEndHour} style={{ width: 80 }}
                  onChange={(e) => setForm((f) => ({ ...f, workEndHour: Number(e.target.value) }))} />
                <span>:</span>
                <input className="input" type="number" min={0} max={59} placeholder="Min" value={form.workEndMinute} style={{ width: 80 }}
                  onChange={(e) => setForm((f) => ({ ...f, workEndMinute: Number(e.target.value) }))} />
              </div>
            </label>
            <div className="adm-field" style={{ flexDirection: 'row', gap: 16, alignItems: 'center', gridColumn: 'span 2' }}>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
                <input type="checkbox" checked={form.deposit}
                  onChange={(e) => setForm((f) => ({ ...f, deposit: e.target.checked }))} />
                <span>Deposit Permission</span>
              </label>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
                <input type="checkbox" checked={form.withdraw}
                  onChange={(e) => setForm((f) => ({ ...f, withdraw: e.target.checked }))} />
                <span>Withdrawal Permission</span>
              </label>
            </div>
          </div>
          <div className="adm-panel-footer">
            <button className="adm-btn adm-btn-primary" disabled={creating} onClick={createAgent}>
              {creating ? 'Creating…' : 'Create Agent'}
            </button>
          </div>
        </div>
      )}

      {editingAgent && (
        <div className="adm-panel">
          <div className="adm-panel-head">Edit Agent: {editingAgent.displayName}</div>
          <div className="adm-field-grid">
            <label className="adm-field">
              <span>Display Name</span>
              <input className="input" placeholder="e.g. Agent Sara" value={editForm.displayName}
                onChange={(e) => setEditForm((f) => ({ ...f, displayName: e.target.value }))} />
            </label>
            <label className="adm-field">
              <span>Phone Number</span>
              <input className="input" type="tel" placeholder="09XXXXXXXX" value={editForm.phoneNumber}
                onChange={(e) => setEditForm((f) => ({ ...f, phoneNumber: e.target.value }))} />
            </label>
            <label className="adm-field">
              <span>New Password (optional, min 8 chars)</span>
              <input className="input" type="password" placeholder="Leave blank to keep current" value={editForm.password}
                onChange={(e) => setEditForm((f) => ({ ...f, password: e.target.value }))} />
            </label>
            <label className="adm-field">
              <span>Status</span>
              <select className="input" value={editForm.status}
                onChange={(e) => setEditForm((f) => ({ ...f, status: e.target.value as any }))}
                style={{ background: 'var(--bg-2)', color: 'var(--text-primary)' }}>
                <option value="active">Active</option>
                <option value="suspended">Suspended</option>
                <option value="closed">Closed</option>
              </select>
            </label>
            <label className="adm-field">
              <span>Work Hours Timeframe</span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input className="input" type="number" min={0} max={23} placeholder="Start Hr" value={editForm.workStartHour} style={{ width: 80 }}
                  onChange={(e) => setEditForm((f) => ({ ...f, workStartHour: Number(e.target.value) }))} />
                <span>:</span>
                <input className="input" type="number" min={0} max={59} placeholder="Min" value={editForm.workStartMinute} style={{ width: 80 }}
                  onChange={(e) => setEditForm((f) => ({ ...f, workStartMinute: Number(e.target.value) }))} />
                <span>to</span>
                <input className="input" type="number" min={0} max={23} placeholder="End Hr" value={editForm.workEndHour} style={{ width: 80 }}
                  onChange={(e) => setEditForm((f) => ({ ...f, workEndHour: Number(e.target.value) }))} />
                <span>:</span>
                <input className="input" type="number" min={0} max={59} placeholder="Min" value={editForm.workEndMinute} style={{ width: 80 }}
                  onChange={(e) => setEditForm((f) => ({ ...f, workEndMinute: Number(e.target.value) }))} />
              </div>
            </label>
            <div className="adm-field" style={{ flexDirection: 'row', gap: 16, alignItems: 'center', gridColumn: 'span 2' }}>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
                <input type="checkbox" checked={editForm.deposit}
                  onChange={(e) => setEditForm((f) => ({ ...f, deposit: e.target.checked }))} />
                <span>Deposit Permission</span>
              </label>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
                <input type="checkbox" checked={editForm.withdraw}
                  onChange={(e) => setEditForm((f) => ({ ...f, withdraw: e.target.checked }))} />
                <span>Withdrawal Permission</span>
              </label>
            </div>
          </div>
          <div className="adm-panel-footer" style={{ display: 'flex', gap: 8 }}>
            <button className="adm-btn adm-btn-primary" disabled={updating} onClick={updateAgent}>
              {updating ? 'Saving…' : 'Save Changes'}
            </button>
            <button className="adm-btn adm-btn-secondary" onClick={() => setEditingAgent(null)}>
              Cancel
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
                <th>Working Hours</th>
                <th>Permissions</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((a) => {
                const pad = (n?: number) => n !== undefined ? String(n).padStart(2, '0') : '--';
                const timeStr = a.workStartHour !== undefined && a.workEndHour !== undefined
                  ? `${pad(a.workStartHour)}:${pad(a.workStartMinute)} - ${pad(a.workEndHour)}:${pad(a.workEndMinute)}`
                  : 'All day';
                
                const permissionsList: string[] = [];
                if (a.agentPermissions?.deposit !== false) permissionsList.push('Deposit');
                if (a.agentPermissions?.withdraw !== false) permissionsList.push('Withdraw');
                const permStr = permissionsList.length > 0 ? permissionsList.join(', ') : 'None';

                return (
                  <tr key={a.id} className="adm-tr">
                    <td><strong>{a.displayName}</strong></td>
                    <td className="adm-td-muted">{a.phoneNumber ?? '—'}</td>
                    <td className="adm-td-muted">{timeStr}</td>
                    <td className="adm-td-muted">{permStr}</td>
                    <td>
                      <span className={`badge ${a.status === 'active' || !a.status ? 'badge-green' : 'badge-red'}`}>
                        {a.status ?? 'active'}
                      </span>
                    </td>
                    <td>
                      <button className="adm-btn adm-btn-secondary adm-btn-xs" onClick={() => { startEdit(a); setShowForm(false); }}>
                        Edit
                      </button>
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
type KenoConfigForm = {
  ticketPriceMinor: number;
  globalBotWinInterval: number;
  autoScheduleIntervalSeconds: number;
  maxWinnersPerDraw: number;
  paytable: KenoPaytableEntry[];
  winChancePct: number;
};

const DEFAULT_KENO_CONFIG_FORM: KenoConfigForm = {
  ticketPriceMinor: 100,
  globalBotWinInterval: 0,
  autoScheduleIntervalSeconds: 40,
  maxWinnersPerDraw: 0,
  paytable: [],
  winChancePct: 100,
};

function getKenoIntervalSeconds(config: KenoConfig) {
  if (config.autoScheduleIntervalSeconds !== undefined) {
    return config.autoScheduleIntervalSeconds;
  }
  if (config.autoScheduleIntervalMinutes === 0) {
    return 0;
  }
  return DEFAULT_KENO_CONFIG_FORM.autoScheduleIntervalSeconds;
}

function formatKenoInterval(config: KenoConfig) {
  const seconds = getKenoIntervalSeconds(config);
  if (seconds <= 0) return 'manual';
  if (seconds < 60) return `${seconds}s`;
  const minutes = seconds / 60;
  return Number.isInteger(minutes) ? `${minutes}m` : `${seconds}s`;
}

function KenoAdmin() {
  const addToast = useStore((s) => s.addToast);
  const [draws, setDraws] = useState<KenoDraw[]>([]);
  const [config, setConfig] = useState<KenoConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [showCfg, setShowCfg] = useState(false);
  const [cfgForm, setCfgForm] = useState<KenoConfigForm>(DEFAULT_KENO_CONFIG_FORM);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await adminKenoApi.listDraws(20).catch(() => []);
      setDraws(d);
      try {
        const c = await adminKenoApi.getConfig();
        setConfig(c);
        setCfgForm({
          ticketPriceMinor: c.ticketPriceMinor,
          globalBotWinInterval: c.globalBotWinInterval || 0,
          autoScheduleIntervalSeconds: getKenoIntervalSeconds(c),
          maxWinnersPerDraw: c.maxWinnersPerDraw ?? 0,
          paytable: (c.paytable ?? []).map((entry) => ({ ...entry })),
          winChancePct: c.winChancePct ?? 100,
        });
      } catch (err) {
        // If config is not found (404), we leave it as null
        setConfig(null);
        // Pre-populate with standard Keno default values to make initialization easy
        setCfgForm({
          ticketPriceMinor: 100,
          globalBotWinInterval: 0,
          autoScheduleIntervalSeconds: 40,
          maxWinnersPerDraw: 0,
          paytable: [
            { spots: 1, matches: 1, payoutMultiplier: 3 },
            { spots: 2, matches: 2, payoutMultiplier: 12 },
            { spots: 3, matches: 2, payoutMultiplier: 2 },
            { spots: 3, matches: 3, payoutMultiplier: 45 },
            { spots: 4, matches: 2, payoutMultiplier: 1 },
            { spots: 4, matches: 3, payoutMultiplier: 8 },
            { spots: 4, matches: 4, payoutMultiplier: 120 },
            { spots: 5, matches: 3, payoutMultiplier: 3 },
            { spots: 5, matches: 4, payoutMultiplier: 25 },
            { spots: 5, matches: 5, payoutMultiplier: 800 }
          ],
          winChancePct: 100,
        });
      }
    } catch (e) {
      addToast('error', getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => { void load(); }, [load]);

  const updateConfig = async () => {
    setBusy('cfg');
    try {
      await adminKenoApi.createConfig({
        name: config ? config.name : 'Default Keno',
        numberMin: config ? config.numberMin : 1,
        numberMax: config ? config.numberMax : 80,
        drawSize: config ? config.drawSize : 20,
        allowedSpots: config ? config.allowedSpots : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
        ticketPriceMinor: cfgForm.ticketPriceMinor,
        globalBotWinInterval: cfgForm.globalBotWinInterval,
        autoScheduleIntervalSeconds: cfgForm.autoScheduleIntervalSeconds,
        maxWinnersPerDraw: cfgForm.maxWinnersPerDraw,
        paytable: cfgForm.paytable,
        winChancePct: cfgForm.winChancePct,
      });
      addToast('success', config ? 'Config updated.' : 'Initial config created.');
      setShowCfg(false);
      await load();
    }
    catch (e) { addToast('error', getErrorMessage(e)); }
    finally { setBusy(null); }
  };

  const updatePaytableEntry = (index: number, key: keyof KenoPaytableEntry, value: number) => {
    setCfgForm((form) => ({
      ...form,
      paytable: form.paytable.map((entry, entryIndex) =>
        entryIndex === index ? { ...entry, [key]: value } : entry
      ),
    }));
  };

  const addPaytableEntry = () => {
    setCfgForm((form) => ({
      ...form,
      paytable: [...form.paytable, { spots: 4, matches: 2, payoutMultiplier: 1 }],
    }));
  };

  const removePaytableEntry = (index: number) => {
    setCfgForm((form) => ({
      ...form,
      paytable: form.paytable.filter((_, entryIndex) => entryIndex !== index),
    }));
  };

  const paytableRows = cfgForm.paytable
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => a.entry.spots - b.entry.spots || a.entry.matches - b.entry.matches);

  const D_STATUS: Record<string, string> = { open: 'badge-gold', locked: 'badge-violet', drawn: 'badge-violet', settled: 'badge-green', cancelled: 'badge-red' };

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
          <span>Draw interval: {formatKenoInterval(config)}</span>
          <span>Bot interval: {config.globalBotWinInterval || 'off'}</span>
          <span>Win Probability: {config.winChancePct ?? 100}%</span>
        </div>
      )}

      {showCfg && (
        <div className="adm-panel">
          <div className="adm-panel-head">{config ? 'New Config Version' : 'Create Initial Config'}</div>
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
              <span>Auto-schedule Interval (seconds, 0 = manual)</span>
              <input className="input" type="number" min={0} max={3600} value={cfgForm.autoScheduleIntervalSeconds}
                onChange={(e) => setCfgForm((f) => ({ ...f, autoScheduleIntervalSeconds: Number(e.target.value) }))} />
            </label>
            <label className="adm-field">
              <span>Max Winners Per Draw (0 = unlimited)</span>
              <input className="input" type="number" min={0} value={cfgForm.maxWinnersPerDraw}
                onChange={(e) => setCfgForm((f) => ({ ...f, maxWinnersPerDraw: Number(e.target.value) }))} />
            </label>
            <label className="adm-field">
              <span>Win Probability % (0-100)</span>
              <input className="input" type="number" min={0} max={100} value={cfgForm.winChancePct}
                onChange={(e) => setCfgForm((f) => ({ ...f, winChancePct: Number(e.target.value) }))} />
            </label>
          </div>
          <div className="adm-paytable-editor">
            <div className="adm-paytable-head">
              <span>Payout Multipliers</span>
              <button className="adm-btn adm-btn-secondary adm-btn-xs" type="button" onClick={addPaytableEntry}>
                <Plus size={11} />Add Payout
              </button>
            </div>
            <div className="adm-paytable-grid">
              {paytableRows.map(({ entry, index }) => (
                <div key={`${index}-${entry.spots}-${entry.matches}`} className="adm-paytable-entry">
                  <label className="adm-field">
                    <span>Spots</span>
                    <input className="input" type="number" min={1} max={12} value={entry.spots}
                      onChange={(e) => updatePaytableEntry(index, 'spots', Number(e.target.value))} />
                  </label>
                  <label className="adm-field">
                    <span>Matches</span>
                    <input className="input" type="number" min={0} max={12} value={entry.matches}
                      onChange={(e) => updatePaytableEntry(index, 'matches', Number(e.target.value))} />
                  </label>
                  <label className="adm-field">
                    <span>Multiplier</span>
                    <input className="input" type="number" min={0} value={entry.payoutMultiplier}
                      onChange={(e) => updatePaytableEntry(index, 'payoutMultiplier', Number(e.target.value))} />
                  </label>
                  <button className="adm-icon-btn" type="button" title="Remove payout" onClick={() => removePaytableEntry(index)}>
                    <X size={13} />
                  </button>
                </div>
              ))}
            </div>
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
                  const active = draw.status === 'open';
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
  const [cfg, setCfg] = useState<BingoConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [form, setForm] = useState({ name: 'Room Alpha', ticketPriceMinor: 500, maxTickets: 100, minutesFromNow: 5, oneLine: 20000, twoLines: 50000, fullHouse: 100000 });
  const [cfgForm, setCfgForm] = useState<Partial<BingoConfig>>({
    enabled: true,
    autoRepeatIntervalMinutes: 0,
    defaultTicketPriceMinor: 500,
    defaultMaxTickets: 200,
    defaultOneLineMinor: 20000,
    defaultTwoLinesMinor: 50000,
    defaultFullHouseMinor: 100000,
    drawIntervalSeconds: 5,
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r, c] = await Promise.all([
        adminBingoApi.listAllRooms(),
        adminBingoApi.getConfig(),
      ]);
      setRooms(r);
      setCfg(c);
      setCfgForm({
        enabled: c.enabled,
        autoRepeatIntervalMinutes: c.autoRepeatIntervalMinutes,
        defaultTicketPriceMinor: c.defaultTicketPriceMinor,
        defaultMaxTickets: c.defaultMaxTickets,
        defaultOneLineMinor: c.defaultOneLineMinor,
        defaultTwoLinesMinor: c.defaultTwoLinesMinor,
        defaultFullHouseMinor: c.defaultFullHouseMinor,
        drawIntervalSeconds: c.drawIntervalSeconds,
      });
    }
    catch (e) { addToast('error', getErrorMessage(e)); }
    finally { setLoading(false); }
  }, [addToast]);

  useEffect(() => { void load(); }, [load]);

  const saveConfig = async () => {
    setBusy('cfg');
    try {
      const updated = await adminBingoApi.updateConfig(cfgForm);
      setCfg(updated);
      addToast('success', 'Bingo settings saved.');
      setShowSettings(false);
    } catch (e) { addToast('error', getErrorMessage(e)); }
    finally { setBusy(null); }
  };

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

  const R_STATUS: Record<string, string> = {
    open: 'badge-gold',
    running: 'badge-violet',
    completed: 'badge-green',
    cancelled: 'badge-red',
  };

  return (
    <div className="stack-lg">
      <SectionHead title="Bingo" sub="Auto-draw rooms with configurable prizes.">
        <button className="adm-icon-btn" onClick={load}><RefreshCw size={14} /></button>
        <button className="adm-btn adm-btn-secondary" onClick={() => setShowSettings((v) => !v)}>
          <Settings size={13} />{showSettings ? 'Close' : 'Settings'}
        </button>
        <button className="adm-btn adm-btn-primary" onClick={() => setShowCreate((v) => !v)}>
          {showCreate ? <X size={13} /> : <Plus size={13} />}{showCreate ? 'Cancel' : 'New Room'}
        </button>
      </SectionHead>

      {/* Config info strip */}
      {cfg && (
        <div className="adm-info-strip">
          <span>{cfg.enabled ? '✅ Auto-Bingo ON' : '⏸ Auto-Bingo OFF'}</span>
          <span>{cfg.defaultTicketPriceMinor} credits/ticket</span>
          <span>Max {cfg.defaultMaxTickets} tickets</span>
          <span>Draw every {cfg.drawIntervalSeconds}s</span>
          <span>Repeat delay: {cfg.autoRepeatIntervalMinutes} min</span>
        </div>
      )}

      {/* Settings panel */}
      {showSettings && (
        <div className="adm-panel">
          <div className="adm-panel-head">Bingo Settings</div>
          <div className="adm-field-grid">
            <label className="adm-field" style={{ gridColumn: '1 / -1' }}>
              <span>Auto-Bingo Enabled</span>
              <select
                className="input"
                value={cfgForm.enabled ? 'true' : 'false'}
                onChange={(e) => setCfgForm((f) => ({ ...f, enabled: e.target.value === 'true' }))}
              >
                <option value="true">Yes — automatically create & run rooms</option>
                <option value="false">No — admin creates rooms manually</option>
              </select>
            </label>
            <label className="adm-field">
              <span>Repeat Delay After Completion (minutes, 0 = instant)</span>
              <input className="input" type="number" min={0} value={cfgForm.autoRepeatIntervalMinutes}
                onChange={(e) => setCfgForm((f) => ({ ...f, autoRepeatIntervalMinutes: Number(e.target.value) }))} />
            </label>
            <label className="adm-field">
              <span>Number Draw Interval (seconds)</span>
              <input className="input" type="number" min={1} max={60} value={cfgForm.drawIntervalSeconds}
                onChange={(e) => setCfgForm((f) => ({ ...f, drawIntervalSeconds: Number(e.target.value) }))} />
            </label>
            <label className="adm-field">
              <span>Default Ticket Price (credits)</span>
              <input className="input" type="number" min={1} value={cfgForm.defaultTicketPriceMinor}
                onChange={(e) => setCfgForm((f) => ({ ...f, defaultTicketPriceMinor: Number(e.target.value) }))} />
            </label>
            <label className="adm-field">
              <span>Default Max Tickets Per Room</span>
              <input className="input" type="number" min={1} value={cfgForm.defaultMaxTickets}
                onChange={(e) => setCfgForm((f) => ({ ...f, defaultMaxTickets: Number(e.target.value) }))} />
            </label>
            <label className="adm-field">
              <span>Default One-Line Prize (credits)</span>
              <input className="input" type="number" min={0} value={cfgForm.defaultOneLineMinor}
                onChange={(e) => setCfgForm((f) => ({ ...f, defaultOneLineMinor: Number(e.target.value) }))} />
            </label>
            <label className="adm-field">
              <span>Default Two-Lines Prize (credits)</span>
              <input className="input" type="number" min={0} value={cfgForm.defaultTwoLinesMinor}
                onChange={(e) => setCfgForm((f) => ({ ...f, defaultTwoLinesMinor: Number(e.target.value) }))} />
            </label>
            <label className="adm-field">
              <span>Default Full-House Prize (credits)</span>
              <input className="input" type="number" min={0} value={cfgForm.defaultFullHouseMinor}
                onChange={(e) => setCfgForm((f) => ({ ...f, defaultFullHouseMinor: Number(e.target.value) }))} />
            </label>
          </div>
          <div className="adm-panel-footer">
            <button className="adm-btn adm-btn-primary" disabled={busy === 'cfg'} onClick={saveConfig}>
              {busy === 'cfg' ? 'Saving…' : 'Save Settings'}
            </button>
          </div>
        </div>
      )}

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
          : rooms.length === 0 ? <div className="adm-empty">No rooms yet. Enable Auto-Bingo in Settings and a room will be created automatically.</div>
          : (
            <table className="adm-table">
              <thead><tr><th>Room</th><th>Tickets</th><th>Status</th><th>Starts</th><th>Drawn</th><th></th></tr></thead>
              <tbody>
                {rooms.map((room) => {
                  const isActive = room.status === 'open' || room.status === 'running';
                  return (
                    <tr key={room.id} className="adm-tr">
                      <td><strong>{room.name}</strong></td>
                      <td className="adm-td-muted">{room.soldTickets}/{room.maxTickets}</td>
                      <td><span className={`badge ${R_STATUS[room.status] ?? 'badge-gold'}`}>{room.status}</span></td>
                      <td className="adm-td-muted">{formatRelativeTime(room.scheduledStartAt)}</td>
                      <td className="adm-td-muted">{room.drawnNumbers?.length ?? 0}/90</td>
                      <td>
                        {isActive && (
                          <div className="adm-cell-actions">
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
// E-Money Management
// ══════════════════════════════════════════════════════════════════
function EMoneyAdmin() {
  const wallet = useStore((s) => s.wallet);
  const setWallet = useStore((s) => s.setWallet);
  const addToast = useStore((s) => s.addToast);

  const [topupAmount, setTopupAmount] = useState('');
  const [transferAmount, setTransferAmount] = useState('');
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [agents, setAgents] = useState<User[]>([]);
  const [loadingAgents, setLoadingAgents] = useState(false);
  const [submittingTopup, setSubmittingTopup] = useState(false);
  const [submittingTransfer, setSubmittingTransfer] = useState(false);

  const refreshWallet = useCallback(async () => {
    try {
      const data = await walletApi.getWallet();
      setWallet(data);
    } catch (e) {
      addToast('error', 'Failed to refresh wallet: ' + getErrorMessage(e));
    }
  }, [addToast, setWallet]);

  const loadAgents = useCallback(async () => {
    setLoadingAgents(true);
    try {
      const list = await adminAgentsApi.listAgents();
      setAgents(list);
      if (list.length > 0) {
        setSelectedAgentId(list[0].id);
      }
    } catch (e) {
      addToast('error', 'Failed to load agents: ' + getErrorMessage(e));
    } finally {
      setLoadingAgents(false);
    }
  }, [addToast]);

  useEffect(() => {
    void refreshWallet();
    void loadAgents();
  }, [refreshWallet, loadAgents]);

  const handleTopup = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = parseInt(topupAmount, 10);
    if (!amount || amount <= 0) {
      addToast('error', 'Please enter a valid amount');
      return;
    }
    setSubmittingTopup(true);
    try {
      const updatedWallet = await adminApi.topupWallet(amount);
      setWallet(updatedWallet);
      addToast('success', `Successfully topped up ${formatCreditsFull(amount)}`);
      setTopupAmount('');
    } catch (err) {
      addToast('error', getErrorMessage(err));
    } finally {
      setSubmittingTopup(false);
    }
  };

  const handleTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = parseInt(transferAmount, 10);
    if (!selectedAgentId) {
      addToast('error', 'Please select an agent');
      return;
    }
    if (!amount || amount <= 0) {
      addToast('error', 'Please enter a valid amount');
      return;
    }
    setSubmittingTransfer(true);
    try {
      const result = await adminApi.transferToAgent(selectedAgentId, amount);
      setWallet(result.adminWallet);
      addToast('success', `Successfully transferred ${formatCreditsFull(amount)} to agent`);
      setTransferAmount('');
    } catch (err) {
      addToast('error', getErrorMessage(err));
    } finally {
      setSubmittingTransfer(false);
    }
  };

  return (
    <div className="stack-lg">
      <SectionHead title="E-Money Management" sub="Top-up your system balance and distribute e-money to agents.">
        <button className="adm-icon-btn" onClick={refreshWallet} title="Refresh Balance"><RefreshCw size={14} /></button>
      </SectionHead>

      <div className="adm-kpi-grid" style={{ gridTemplateColumns: '1fr' }}>
        <Kpi label="Admin E-Money Balance" value={formatCreditsFull(wallet?.availableMinor ?? 0)} color="#10b981" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
        {/* Top-up Panel */}
        <div className="adm-panel">
          <div className="adm-panel-head">Top-up E-Money</div>
          <form onSubmit={handleTopup} className="stack-md p-lg">
            <div className="adm-field">
              <label>Amount (Credits / Minor Units)</label>
              <input
                className="input"
                type="number"
                min="1"
                placeholder="e.g. 100000 for 1000 e-Birr"
                value={topupAmount}
                onChange={(e) => setTopupAmount(e.target.value)}
                required
              />
              <span className="adm-field-hint" style={{ marginTop: 4, display: 'block', fontSize: '0.85em', color: 'var(--text-muted)' }}>
                Equivalent to: {formatCreditsFull(parseInt(topupAmount, 10) || 0)}
              </span>
            </div>
            <button className="adm-btn adm-btn-primary" type="submit" disabled={submittingTopup}>
              {submittingTopup ? 'Topping up...' : 'Top-up Wallet'}
            </button>
          </form>
        </div>

        {/* Transfer Panel */}
        <div className="adm-panel">
          <div className="adm-panel-head">Transfer to Agent</div>
          <form onSubmit={handleTransfer} className="stack-md p-lg">
            <div className="adm-field">
              <label>Select Agent</label>
              {loadingAgents ? (
                <div>Loading agents...</div>
              ) : (
                <select
                  className="input"
                  style={{ background: 'var(--bg-card)', color: 'var(--text)' }}
                  value={selectedAgentId}
                  onChange={(e) => setSelectedAgentId(e.target.value)}
                  required
                >
                  <option value="" disabled>-- Choose Agent --</option>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.displayName} ({a.phoneNumber || 'No Phone'})
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div className="adm-field">
              <label>Amount (Credits / Minor Units)</label>
              <input
                className="input"
                type="number"
                min="1"
                placeholder="e.g. 50000 for 500 e-Birr"
                value={transferAmount}
                onChange={(e) => setTransferAmount(e.target.value)}
                required
              />
              <span className="adm-field-hint" style={{ marginTop: 4, display: 'block', fontSize: '0.85em', color: 'var(--text-muted)' }}>
                Equivalent to: {formatCreditsFull(parseInt(transferAmount, 10) || 0)}
              </span>
            </div>
            <button className="adm-btn adm-btn-primary" type="submit" disabled={submittingTransfer || !selectedAgentId}>
              {submittingTransfer ? 'Transferring...' : 'Transfer E-Money'}
            </button>
          </form>
        </div>
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
        {tab === 'emoney'      && <EMoneyAdmin />}
      </div>
    </div>
  );
}
