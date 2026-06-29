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
  adminUsersApi,
  walletApi,
  type AgentLedgerAction,
  type AgentWithdrawalAction,
  type BotUser,
  type PlatformStats,
  type SystemConfig,
} from '../lib/api';
import type { BingoConfig, BingoPattern, BingoRoom, KenoConfig, KenoDraw, KenoPaytableEntry, User, Wallet as WalletType, Withdrawal } from '../lib/models';
import { createIdempotencyKey, formatCreditsFull, formatDateTime, formatRelativeTime, getErrorMessage } from '../lib/utils';
import { formatCredits, useStore } from '../store/useStore';

type AdminTab = 'overview' | 'players' | 'agents' | 'agent-actions' | 'keno' | 'bingo' | 'bots' | 'withdrawals' | 'config' | 'emoney' | 'account';

const TABS: Array<{ id: AdminTab; label: string; icon: React.ReactNode }> = [
  { id: 'overview',    label: 'Overview',    icon: <Activity size={15} /> },
  { id: 'players',     label: 'Players',     icon: <Users size={15} /> },
  { id: 'agents',      label: 'Agents',      icon: <Users size={15} /> },
  { id: 'agent-actions', label: 'Agent Actions', icon: <Activity size={15} /> },
  { id: 'keno',        label: 'Keno',        icon: <Dices size={15} /> },
  { id: 'bingo',       label: 'Bingo',       icon: <CircleDot size={15} /> },
  { id: 'bots',        label: 'Bots',        icon: <Bot size={15} /> },
  { id: 'withdrawals', label: 'Withdrawals', icon: <Wallet size={15} /> },
  { id: 'config',      label: 'Config',      icon: <Settings size={15} /> },
  { id: 'emoney',      label: 'E-Money',     icon: <Coins size={15} /> },
  { id: 'account',     label: 'Account',     icon: <Shield size={15} /> },
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
        <div className="adm-panel-head">User Engagement &amp; Active Players</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, padding: 16 }}>
          <Kpi label="Registered Players" value={String(bd.totalUsers ?? 0)} color="#10b981" />
          <Kpi label="Users Online Now" value={String(bd.onlineUsers ?? 0)} color="#3b82f6" />
          <Kpi label="Active Keno Players" value={String(bd.activeKenoPlayers ?? 0)} color="#8b5cf6" />
          <Kpi label="Active Bingo Players" value={String(bd.activeBingoPlayers ?? 0)} color="#ec4899" />
        </div>
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
// Players
// ══════════════════════════════════════════════════════════════════
function PlayersAdmin() {
  const addToast = useStore((s) => s.addToast);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [limit] = useState(15);
  const [totalPages, setTotalPages] = useState(1);
  const [totalUsers, setTotalUsers] = useState(0);
  
  // Filters
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('player'); // player by default

  // Wallet adjustment
  const [adjustingUser, setAdjustingUser] = useState<User | null>(null);
  const [adjustAmount, setAdjustAmount] = useState('');
  const [adjustDirection, setAdjustDirection] = useState<'credit' | 'debit'>('credit');
  const [adjustReason, setAdjustReason] = useState('');
  const [submittingAdjustment, setSubmittingAdjustment] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminUsersApi.listUsers(page, limit, role || undefined, search || undefined);
      setUsers(res.data);
      setTotalPages(Math.ceil(res.total / limit));
      setTotalUsers(res.total);
    } catch (e) {
      addToast('error', 'Failed to load users: ' + getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [page, limit, role, search, addToast]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleUpdateStatus = async (userId: string, newStatus: 'active' | 'suspended') => {
    try {
      await adminUsersApi.updateUserStatus(userId, newStatus);
      addToast('success', `User status updated to ${newStatus}.`);
      void load();
    } catch (e) {
      addToast('error', getErrorMessage(e));
    }
  };

  const handleAdjustWallet = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjustingUser) return;
    const amount = parseInt(adjustAmount, 10);
    if (!amount || amount <= 0) {
      addToast('error', 'Please enter a valid amount.');
      return;
    }
    if (!adjustReason.trim()) {
      addToast('error', 'Please provide a reason for the adjustment.');
      return;
    }
    setSubmittingAdjustment(true);
    try {
      await adminUsersApi.adjustWallet(adjustingUser.id, amount, adjustDirection, adjustReason.trim());
      addToast('success', `Successfully adjusted balance by ${adjustDirection === 'credit' ? '+' : '-'}${formatCreditsFull(amount)}`);
      setAdjustingUser(null);
      setAdjustAmount('');
      setAdjustReason('');
      void load();
    } catch (e) {
      addToast('error', getErrorMessage(e));
    } finally {
      setSubmittingAdjustment(false);
    }
  };

  return (
    <div className="stack-lg">
      <SectionHead title="Player Accounts" sub="View and manage player details, balances, status, and manual wallet adjustments.">
        <button className="adm-icon-btn" onClick={load} title="Refresh"><RefreshCw size={14} /></button>
      </SectionHead>

      {/* Adjust Wallet Form (Collapsible section) */}
      {adjustingUser && (
        <section className="card">
          <div className="section-header">
            <h3>Adjust Wallet Balance</h3>
            <button className="btn btn-ghost icon-btn" onClick={() => setAdjustingUser(null)}>
              <X size={16} />
            </button>
          </div>
          <form onSubmit={handleAdjustWallet} className="stack-md p-lg">
            <p className="section-copy" style={{ marginBottom: 12 }}>
              Modifying balance for <strong>{adjustingUser.displayName}</strong> ({adjustingUser.phoneNumber || 'No phone'}).
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div className="adm-field">
                <label>Operation Type</label>
                <select
                  className="input"
                  value={adjustDirection}
                  onChange={(e) => setAdjustDirection(e.target.value as 'credit' | 'debit')}
                >
                  <option value="credit">Credit (+) Add Credits</option>
                  <option value="debit">Debit (-) Deduct Credits</option>
                </select>
              </div>
              <div className="adm-field">
                <label>Amount (Credits / Minor Units — 100 Credits = 1 Birr)</label>
                <input
                  className="input"
                  type="number"
                  min="1"
                  placeholder="e.g. 50000 for 500 Credits"
                  value={adjustAmount}
                  onChange={(e) => setAdjustAmount(e.target.value)}
                />
              </div>
            </div>
            <div className="adm-field">
              <label>Reason / Audit Log Note</label>
              <input
                className="input"
                type="text"
                placeholder="e.g. Compensation for draw delay, manual correction, welcome bonus adjustment"
                value={adjustReason}
                onChange={(e) => setAdjustReason(e.target.value)}
              />
            </div>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 8 }}>
              <button type="button" className="btn btn-secondary" onClick={() => setAdjustingUser(null)}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={submittingAdjustment}>
                {submittingAdjustment ? 'Processing...' : 'Apply Adjustment'}
              </button>
            </div>
          </form>
        </section>
      )}

      {/* Filter panel */}
      <div className="adm-panel" style={{ padding: 16 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-end' }}>
          <div className="adm-field" style={{ flex: '1 1 200px', margin: 0 }}>
            <label style={{ fontSize: 11 }}>Search by name, phone or username</label>
            <input
              className="input"
              type="text"
              placeholder="Type keywords..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            />
          </div>
          <div className="adm-field" style={{ width: 150, margin: 0 }}>
            <label style={{ fontSize: 11 }}>Role Filter</label>
            <select
              className="input"
              value={role}
              onChange={(e) => { setRole(e.target.value); setPage(1); }}
            >
              <option value="player">Player</option>
              <option value="agent">Agent</option>
              <option value="admin">Admin</option>
              <option value="">All Roles</option>
            </select>
          </div>
        </div>
      </div>

      {/* Users table */}
      <div className="adm-panel">
        <div className="adm-panel-head">Registered Accounts ({totalUsers})</div>
        {loading && users.length === 0 ? (
          <div className="adm-empty">Loading user list...</div>
        ) : users.length === 0 ? (
          <div className="adm-empty">No matching users found.</div>
        ) : (
          <table className="adm-table">
            <thead>
              <tr className="adm-tr">
                <th>Display Name</th>
                <th>Roles</th>
                <th>Contact info</th>
                <th>Wallet Balance</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const bal = u.wallets?.[0]?.availableMinor ?? 0;
                return (
                  <tr key={u.id} className="adm-tr">
                    <td><strong>{u.displayName}</strong></td>
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        {u.roles.map((r) => (
                          <span key={r} className={`badge ${
                            r === 'admin' ? 'badge-red' :
                            r === 'agent' ? 'badge-violet' :
                            'badge-gold'
                          }`} style={{ fontSize: 9 }}>
                            {r}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="adm-td-muted">
                      {u.phoneNumber && <div>📞 {u.phoneNumber}</div>}
                      {!u.phoneNumber && <span style={{ opacity: 0.5 }}>—</span>}
                    </td>
                    <td>
                      <strong>{formatCredits(bal)}</strong>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 4 }}>e-Birr</span>
                    </td>
                    <td>
                      <span className={`badge ${u.status === 'active' || !u.status ? 'badge-green' : 'badge-red'}`}>
                        {u.status ?? 'active'}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          className="adm-btn adm-btn-secondary adm-btn-xs"
                          onClick={() => { setAdjustingUser(u); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                        >
                          Adjust Wallet
                        </button>
                        {u.status === 'suspended' ? (
                          <button
                            className="adm-btn adm-btn-secondary adm-btn-xs"
                            style={{ color: 'var(--green)', borderColor: 'rgba(16, 185, 129, 0.3)' }}
                            onClick={() => handleUpdateStatus(u.id, 'active')}
                          >
                            Activate
                          </button>
                        ) : (
                          <button
                            className="adm-btn adm-btn-secondary adm-btn-xs"
                            style={{ color: 'var(--danger)', borderColor: 'rgba(239, 68, 68, 0.3)' }}
                            onClick={() => handleUpdateStatus(u.id, 'suspended')}
                          >
                            Suspend
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderTop: '1px solid var(--border)' }}>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              Page <strong>{page}</strong> of <strong>{totalPages}</strong> ({totalUsers} entries)
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className="btn btn-secondary btn-sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </button>
              <button
                className="btn btn-secondary btn-sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Next
              </button>
            </div>
          </div>
        )}
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
    if (action === 'reject') {
      const note = (notes[id] ?? '').trim();
      if (note.length < 15) {
        addToast('error', 'Rejection remarks must be at least 15 characters.');
        return;
      }
    }
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
                        <input className="input" placeholder="Admin note (required for rejection, min 15 chars)"
                          value={notes[w.id] ?? ''}
                          onChange={(e) => setNotes((n) => ({ ...n, [w.id]: e.target.value }))} />
                        <div className="adm-w-actions">
                          <button className="adm-btn adm-btn-success" disabled={!!busy}
                            onClick={() => process(w.id, 'approve')}>
                            {busy === `approve-${w.id}` ? '…' : 'Approve'}
                          </button>
                          <button className="adm-btn adm-btn-danger" disabled={!!busy || (notes[w.id] ?? '').trim().length < 15}
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
type PatternPrizeEntry = { patternId: string; name: string; prizeMinor: number };

function BingoAdmin() {
  const addToast = useStore((s) => s.addToast);
  const [rooms, setRooms] = useState<BingoRoom[]>([]);
  const [cfg, setCfg] = useState<BingoConfig | null>(null);
  const [patterns, setPatterns] = useState<BingoPattern[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showPatterns, setShowPatterns] = useState(false);

  // Room creation form
  const [winMode, setWinMode] = useState<'line' | 'pattern'>('line');
  const [numberRange, setNumberRange] = useState(75);
  const [patternPrizes, setPatternPrizes] = useState<PatternPrizeEntry[]>([]);
  const [form, setForm] = useState({ name: 'Room Alpha', ticketPriceMinor: 500, maxTickets: 100, minutesFromNow: 5, oneLine: 20000, twoLines: 50000, fullHouse: 100000 });

  const [cfgForm, setCfgForm] = useState<Partial<BingoConfig>>({
    enabled: true,
    autoRepeatIntervalMinutes: 0,
    defaultTicketPriceMinor: 500,
    defaultMaxTickets: 200,
    defaultOneLineMinor: 20000,
    defaultTwoLinesMinor: 50000,
    defaultFullHouseMinor: 100000,
    drawIntervalSeconds: 2,
    salesWindowSeconds: 40,
    resultDisplaySeconds: 10,
    defaultWinMode: 'line',
    defaultNumberRange: 75,
    minDrawsBeforeWin: 0,
    minTicketsToStart: 0,
    houseEdgePct: 20,
    globalBingoBotWinInterval: 0,
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r, c, p] = await Promise.all([
        adminBingoApi.listAllRooms(),
        adminBingoApi.getConfig(),
        adminBingoApi.listPatterns(),
      ]);
      setRooms(r);
      setCfg(c);
      setPatterns(p);
      setCfgForm({
        enabled: c.enabled,
        autoRepeatIntervalMinutes: c.autoRepeatIntervalMinutes,
        defaultTicketPriceMinor: c.defaultTicketPriceMinor,
        defaultMaxTickets: c.defaultMaxTickets,
        defaultOneLineMinor: c.defaultOneLineMinor,
        defaultTwoLinesMinor: c.defaultTwoLinesMinor,
        defaultFullHouseMinor: c.defaultFullHouseMinor,
        drawIntervalSeconds: c.drawIntervalSeconds,
        salesWindowSeconds: c.salesWindowSeconds ?? 40,
        resultDisplaySeconds: c.resultDisplaySeconds ?? 10,
        defaultWinMode: c.defaultWinMode ?? 'line',
        defaultNumberRange: c.defaultNumberRange ?? 75,
        minDrawsBeforeWin: c.minDrawsBeforeWin ?? 0,
        minTicketsToStart: c.minTicketsToStart ?? 0,
        houseEdgePct: c.houseEdgePct ?? 20,
        globalBingoBotWinInterval: c.globalBingoBotWinInterval ?? 0,
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
        name: form.name,
        ticketPriceMinor: form.ticketPriceMinor,
        maxTickets: form.maxTickets,
        scheduledStartAt: new Date(Date.now() + form.minutesFromNow * 60_000).toISOString(),
        prizes: { oneLineMinor: form.oneLine, twoLinesMinor: form.twoLines, fullHouseMinor: form.fullHouse },
        winMode,
        numberRange: winMode === 'pattern' ? numberRange : undefined,
        patternPrizes: winMode === 'pattern' ? patternPrizes : undefined,
      });
      addToast('success', `Room "${form.name}" created.`);
      setShowCreate(false);
      await load();
    } catch (e) { addToast('error', getErrorMessage(e)); }
    finally { setBusy(null); }
  };

  const togglePattern = async (pattern: BingoPattern) => {
    setBusy(`p-${pattern.id}`);
    try {
      const updated = await adminBingoApi.updatePattern(pattern.id, { enabled: !pattern.enabled });
      setPatterns((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
    } catch (e) { addToast('error', getErrorMessage(e)); }
    finally { setBusy(null); }
  };

  const seedPatterns = async () => {
    setBusy('seed');
    try {
      await adminBingoApi.seedPatterns();
      addToast('success', 'Built-in patterns seeded.');
      const p = await adminBingoApi.listPatterns();
      setPatterns(p);
    } catch (e) { addToast('error', getErrorMessage(e)); }
    finally { setBusy(null); }
  };

  const setPatternPrize = (patternId: string, name: string, prizeMinor: number) => {
    setPatternPrizes((prev) => {
      const existing = prev.find((p) => p.patternId === patternId);
      if (existing) {
        return prev.map((p) => p.patternId === patternId ? { ...p, prizeMinor } : p);
      }
      return [...prev, { patternId, name, prizeMinor }];
    });
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

  const enabledPatterns = patterns.filter((p) => p.enabled);

  return (
    <div className="stack-lg">
      <SectionHead title="Bingo" sub="Auto-draw rooms with configurable prizes and patterns.">
        <button className="adm-icon-btn" onClick={load}><RefreshCw size={14} /></button>
        <button className="adm-btn adm-btn-secondary" onClick={() => setShowPatterns((v) => !v)}>
          <CircleDot size={13} />{showPatterns ? 'Hide Patterns' : 'Patterns'}
        </button>
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
          <span>{cfg.defaultTicketPriceMinor} Cr/ticket</span>
          <span>Max {cfg.defaultMaxTickets} tickets</span>
          <span>Draw every {cfg.drawIntervalSeconds}s</span>
          <span>Mode: {cfg.defaultWinMode ?? 'line'}</span>
          {(cfg.minDrawsBeforeWin ?? 0) > 0 && <span>Min draws: {cfg.minDrawsBeforeWin}</span>}
          {(cfg.globalBingoBotWinInterval ?? 0) > 0 && <span>Bot win every {cfg.globalBingoBotWinInterval} rooms</span>}
          <span>Edge: {cfg.houseEdgePct ?? 20}%</span>
        </div>
      )}

      {/* Patterns panel */}
      {showPatterns && (
        <div className="adm-panel">
          <div className="adm-panel-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Bingo Patterns ({patterns.length})</span>
            <button className="adm-btn adm-btn-secondary adm-btn-xs" disabled={busy === 'seed'} onClick={seedPatterns}>
              {busy === 'seed' ? 'Seeding…' : 'Seed Built-ins'}
            </button>
          </div>
          {patterns.length === 0 ? (
            <div className="adm-empty">No patterns. Click "Seed Built-ins" to add standard patterns.</div>
          ) : (
            <table className="adm-table">
              <thead><tr><th>Name</th><th>Type</th><th>Built-in</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {patterns.map((p) => (
                  <tr key={p.id} className="adm-tr">
                    <td><strong>{p.name}</strong>{p.description && <span className="adm-td-muted" style={{ display: 'block', fontSize: '11px' }}>{p.description}</span>}</td>
                    <td className="adm-td-muted">{p.patternType}</td>
                    <td className="adm-td-muted">{p.isBuiltIn ? 'Yes' : 'Custom'}</td>
                    <td><span className={`badge ${p.enabled ? 'badge-green' : 'badge-red'}`}>{p.enabled ? 'Enabled' : 'Disabled'}</span></td>
                    <td>
                      <button className="adm-btn adm-btn-secondary adm-btn-xs" disabled={busy === `p-${p.id}`} onClick={() => togglePattern(p)}>
                        {p.enabled ? 'Disable' : 'Enable'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
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
              <span>Default Win Mode</span>
              <select
                className="input"
                value={cfgForm.defaultWinMode ?? 'line'}
                onChange={(e) => setCfgForm((f) => ({ ...f, defaultWinMode: e.target.value }))}
              >
                <option value="line">Line (90-ball 3×9 card)</option>
                <option value="pattern">Pattern (5×5 BINGO card)</option>
              </select>
            </label>
            <label className="adm-field">
              <span>Default Number Range (pattern mode)</span>
              <input className="input" type="number" min={25} max={140} value={cfgForm.defaultNumberRange ?? 75}
                onChange={(e) => setCfgForm((f) => ({ ...f, defaultNumberRange: Number(e.target.value) }))} />
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
              <span>Buy-in / Sales Window (seconds)</span>
              <input className="input" type="number" min={5} max={600} value={cfgForm.salesWindowSeconds ?? 40}
                onChange={(e) => setCfgForm((f) => ({ ...f, salesWindowSeconds: Number(e.target.value) }))} />
            </label>
            <label className="adm-field">
              <span>Result Display (seconds)</span>
              <input className="input" type="number" min={0} max={120} value={cfgForm.resultDisplaySeconds ?? 10}
                onChange={(e) => setCfgForm((f) => ({ ...f, resultDisplaySeconds: Number(e.target.value) }))} />
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

          <div className="adm-panel-head" style={{ marginTop: 12 }}>Win Probability &amp; Bot Settings</div>
          <div className="adm-field-grid">
            <label className="adm-field">
              <span>Min Draws Before Any Win (0 = immediate)</span>
              <input className="input" type="number" min={0} value={cfgForm.minDrawsBeforeWin ?? 0}
                onChange={(e) => setCfgForm((f) => ({ ...f, minDrawsBeforeWin: Number(e.target.value) }))} />
              <span className="adm-field-hint">Prevents prizes until this many numbers are drawn. Increases perceived game depth.</span>
            </label>
            <label className="adm-field">
              <span>Min Tickets Before Draw Starts (0 = no minimum)</span>
              <input className="input" type="number" min={0} value={cfgForm.minTicketsToStart ?? 0}
                onChange={(e) => setCfgForm((f) => ({ ...f, minTicketsToStart: Number(e.target.value) }))} />
              <span className="adm-field-hint">Room will not auto-start until at least this many tickets are sold.</span>
            </label>
            <label className="adm-field">
              <span>House Edge % (display reference, 0–100)</span>
              <input className="input" type="number" min={0} max={100} value={cfgForm.houseEdgePct ?? 20}
                onChange={(e) => setCfgForm((f) => ({ ...f, houseEdgePct: Math.min(100, Number(e.target.value)) }))} />
              <span className="adm-field-hint">Shown in admin stats only — does not affect payout logic.</span>
            </label>
            <label className="adm-field">
              <span>Bot Guaranteed Win Every N Rooms (0 = disabled)</span>
              <input className="input" type="number" min={0} value={cfgForm.globalBingoBotWinInterval ?? 0}
                onChange={(e) => setCfgForm((f) => ({ ...f, globalBingoBotWinInterval: Number(e.target.value) }))} />
              <span className="adm-field-hint">After every N completed rooms a random active bot receives a bonus credit. Creates visible bot activity on the wins ticker.</span>
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
            <label className="adm-field" style={{ gridColumn: '1 / -1' }}>
              <span>Win Mode</span>
              <select className="input" value={winMode} onChange={(e) => setWinMode(e.target.value as 'line' | 'pattern')}>
                <option value="line">Line (90-ball 3×9 ticket)</option>
                <option value="pattern">Pattern (5×5 BINGO card)</option>
              </select>
            </label>

            {winMode === 'pattern' && (
              <label className="adm-field">
                <span>Number Range (1 to N) — e.g. 75, 90, 140</span>
                <input className="input" type="number" min={25} max={140} value={numberRange}
                  onChange={(e) => setNumberRange(Number(e.target.value))} />
              </label>
            )}

            {winMode === 'line' && (
              <>
                <label className="adm-field"><span>One Line Prize</span><input className="input" type="number" min={0} {...f('oneLine')} /></label>
                <label className="adm-field"><span>Two Lines Prize</span><input className="input" type="number" min={0} {...f('twoLines')} /></label>
                <label className="adm-field"><span>Full House Prize</span><input className="input" type="number" min={0} {...f('fullHouse')} /></label>
              </>
            )}

            {winMode === 'pattern' && enabledPatterns.length > 0 && (
              <div className="adm-field" style={{ gridColumn: '1 / -1' }}>
                <span style={{ display: 'block', marginBottom: 8, fontSize: 12, fontWeight: 700, color: '#94a3b8' }}>
                  Pattern Prizes (set prize per pattern; 0 = no prize for that pattern)
                </span>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  {enabledPatterns.map((p) => {
                    const existing = patternPrizes.find((pp) => pp.patternId === p.id);
                    return (
                      <label key={p.id} className="adm-field">
                        <span>{p.name}</span>
                        <input
                          className="input"
                          type="number"
                          min={0}
                          value={existing?.prizeMinor ?? 0}
                          onChange={(e) => setPatternPrize(p.id, p.name, Number(e.target.value))}
                        />
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
            {winMode === 'pattern' && enabledPatterns.length === 0 && (
              <div className="adm-field" style={{ gridColumn: '1 / -1' }}>
                <span style={{ color: '#ef4444', fontSize: 12 }}>
                  No enabled patterns found. Enable patterns in the Patterns panel first.
                </span>
              </div>
            )}
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
              <thead><tr><th>Room</th><th>Mode</th><th>Tickets</th><th>Status</th><th>Starts</th><th>Drawn</th><th></th></tr></thead>
              <tbody>
                {rooms.map((room) => {
                  const isActive = room.status === 'open' || room.status === 'running';
                  const maxNum = room.winMode === 'pattern' ? (room.numberRange ?? 75) : 90;
                  return (
                    <tr key={room.id} className="adm-tr">
                      <td><strong>{room.name}</strong></td>
                      <td className="adm-td-muted">
                        <span className={`badge ${room.winMode === 'pattern' ? 'badge-violet' : 'badge-gold'}`} style={{ fontSize: 10 }}>
                          {room.winMode === 'pattern' ? `Pattern 1-${room.numberRange ?? 75}` : 'Line 1-90'}
                        </span>
                      </td>
                      <td className="adm-td-muted">{room.soldTickets}/{room.maxTickets}</td>
                      <td><span className={`badge ${R_STATUS[room.status] ?? 'badge-gold'}`}>{room.status}</span></td>
                      <td className="adm-td-muted">{formatRelativeTime(room.scheduledStartAt)}</td>
                      <td className="adm-td-muted">{room.drawnNumbers?.length ?? 0}/{maxNum}</td>
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
  const [bots, setBots]           = useState<BotUser[]>([]);
  const [loading, setLoading]     = useState(true);
  const [busy, setBusy]           = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [topupId, setTopupId]     = useState<string | null>(null);
  const [topupAmount, setTopupAmount] = useState('');
  const [form, setForm] = useState({
    displayName: 'Bot Alpha',
    initialBalanceMinor: 10000,
    ticketsPerRound: 2,
    spotCount: 4,
  });
  const [editForm, setEditForm] = useState<{ ticketsPerRound: number; spotCount: number }>({
    ticketsPerRound: 1, spotCount: 3,
  });

  const load = useCallback(async () => {
    setLoading(true);
    try { setBots(await adminBotsApi.listBots()); }
    catch (e) { addToast('error', getErrorMessage(e)); }
    finally { setLoading(false); }
  }, [addToast]);

  useEffect(() => { void load(); }, [load]);

  const createBot = async () => {
    setBusy('create');
    try {
      await adminBotsApi.createBot(form);
      addToast('success', `Bot "${form.displayName}" created.`);
      setShowCreate(false);
      await load();
    } catch (e) { addToast('error', getErrorMessage(e)); }
    finally { setBusy(null); }
  };

  const toggleActive = async (bot: BotUser) => {
    setBusy(bot.id);
    try { await adminBotsApi.updateBot(bot.id, { active: !bot.botPolicy.active }); await load(); }
    catch (e) { addToast('error', getErrorMessage(e)); }
    finally { setBusy(null); }
  };

  const saveEdit = async (bot: BotUser) => {
    setBusy(bot.id + '-edit');
    try {
      await adminBotsApi.updateBot(bot.id, editForm);
      setEditingId(null);
      await load();
    } catch (e) { addToast('error', getErrorMessage(e)); }
    finally { setBusy(null); }
  };

  const handleTopup = async (bot: BotUser) => {
    const minor = Math.round(parseFloat(topupAmount) * 100);
    if (!minor || minor <= 0) { addToast('error', 'Enter a valid amount'); return; }
    setBusy(bot.id + '-topup');
    try {
      await adminBotsApi.topupBot(bot.id, minor);
      addToast('success', `Added ${topupAmount} Cr to ${bot.displayName}`);
      setTopupId(null);
      setTopupAmount('');
      await load();
    } catch (e) { addToast('error', getErrorMessage(e)); }
    finally { setBusy(null); }
  };

  const handleDelete = async (bot: BotUser) => {
    if (!confirm(`Delete bot "${bot.displayName}"? This will deactivate it from all games.`)) return;
    setBusy(bot.id + '-del');
    try {
      await adminBotsApi.deleteBot(bot.id);
      addToast('success', `Bot "${bot.displayName}" deleted.`);
      await load();
    } catch (e) { addToast('error', getErrorMessage(e)); }
    finally { setBusy(null); }
  };

  const f = (key: keyof typeof form) => ({
    value: form[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((prev) => ({ ...prev, [key]: typeof prev[key] === 'number' ? Number(e.target.value) : e.target.value })),
  });

  const activeBots = bots.filter(b => b.botPolicy?.active).length;

  return (
    <div className="stack-lg">
      <SectionHead title="Game Bots" sub="Virtual players that simulate activity when real player count is low.">
        <button className="adm-icon-btn" onClick={load}><RefreshCw size={14} /></button>
        <button className="adm-btn adm-btn-primary" onClick={() => setShowCreate((v) => !v)}>
          {showCreate ? <X size={13} /> : <Plus size={13} />}{showCreate ? 'Cancel' : 'New Bot'}
        </button>
      </SectionHead>

      {/* Summary KPIs */}
      <div className="adm-kpi-row">
        <Kpi label="Total Bots" value={String(bots.length)} color="#6366f1" />
        <Kpi label="Active" value={String(activeBots)} color="#10b981" />
        <Kpi label="Paused" value={String(bots.length - activeBots)} color="#94a3b8" />
        <Kpi label="Total Balance"
          value={`${formatCreditsFull(bots.reduce((s, b) => s + (b.walletBalanceMinor ?? 0), 0))} Cr`}
          color="#f59e0b" />
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="adm-panel">
          <div className="adm-panel-head">Create New Bot</div>
          <div className="adm-field-grid">
            <label className="adm-field"><span>Display Name</span><input className="input" {...f('displayName')} /></label>
            <label className="adm-field">
              <span>Starting Balance (Cr)</span>
              <input className="input" type="number" min={0} {...f('initialBalanceMinor')} />
            </label>
            <label className="adm-field">
              <span>Keno Tickets / Draw</span>
              <input className="input" type="number" min={1} max={10} {...f('ticketsPerRound')} />
            </label>
            <label className="adm-field">
              <span>Keno Spot Count (1–12)</span>
              <input className="input" type="number" min={1} max={12} {...f('spotCount')} />
            </label>
          </div>
          <div className="adm-panel-footer">
            <button className="adm-btn adm-btn-primary" disabled={busy === 'create'} onClick={createBot}>
              {busy === 'create' ? 'Creating…' : 'Create Bot'}
            </button>
          </div>
        </div>
      )}

      {/* Bot list */}
      <div className="adm-panel" style={{ overflowX: 'auto' }}>
        {loading && bots.length === 0
          ? <div className="adm-empty">Loading bots…</div>
          : bots.length === 0
          ? <div className="adm-empty">No bots yet. Create one to simulate player activity.</div>
          : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              {bots.map((bot) => {
                const isEditing = editingId === bot.id;
                const isTopping = topupId === bot.id;
                return (
                  <div key={bot.id} style={{
                    borderBottom: '1px solid var(--border)',
                    padding: '12px 0',
                  }}>
                    {/* Main row */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <div style={{ flex: 1, minWidth: 120 }}>
                        <strong style={{ fontSize: 13 }}>{bot.displayName}</strong>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                          {bot.botPolicy?.ticketsPerRound}t · {bot.botPolicy?.spotCount}-spot
                          · {bot.botPolicy?.drawParticipationCount ?? 0} draws played
                        </div>
                      </div>

                      <div style={{ textAlign: 'right', minWidth: 90 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--gold)' }}>
                          {formatCreditsFull(bot.walletBalanceMinor ?? 0)} Cr
                        </div>
                        <span className={`badge ${bot.botPolicy?.active ? 'badge-green' : 'badge-red'}`}
                          style={{ fontSize: 9, marginTop: 2 }}>
                          {bot.botPolicy?.active ? 'Active' : 'Paused'}
                        </span>
                      </div>

                      {/* Action buttons */}
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <button
                          className="adm-btn adm-btn-xs adm-btn-secondary"
                          onClick={() => {
                            setEditingId(isEditing ? null : bot.id);
                            setTopupId(null);
                            setEditForm({
                              ticketsPerRound: bot.botPolicy.ticketsPerRound,
                              spotCount: bot.botPolicy.spotCount,
                            });
                          }}>
                          {isEditing ? 'Cancel' : 'Edit'}
                        </button>
                        <button
                          className="adm-btn adm-btn-xs adm-btn-secondary"
                          onClick={() => {
                            setTopupId(isTopping ? null : bot.id);
                            setEditingId(null);
                            setTopupAmount('');
                          }}>
                          {isTopping ? 'Cancel' : 'Top Up'}
                        </button>
                        <button
                          className={`adm-btn adm-btn-xs ${bot.botPolicy?.active ? 'adm-btn-warning' : 'adm-btn-secondary'}`}
                          disabled={busy === bot.id}
                          onClick={() => toggleActive(bot)}>
                          {busy === bot.id ? '…' : bot.botPolicy?.active ? 'Pause' : 'Activate'}
                        </button>
                        <button
                          className="adm-btn adm-btn-xs adm-btn-danger"
                          disabled={busy === bot.id + '-del'}
                          onClick={() => handleDelete(bot)}>
                          {busy === bot.id + '-del' ? '…' : 'Delete'}
                        </button>
                      </div>
                    </div>

                    {/* Inline edit */}
                    {isEditing && (
                      <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                        <label className="adm-field" style={{ flex: 1, minWidth: 130 }}>
                          <span>Keno Tickets / Draw</span>
                          <input className="input" type="number" min={1} max={12}
                            value={editForm.ticketsPerRound}
                            onChange={e => setEditForm(p => ({ ...p, ticketsPerRound: Number(e.target.value) }))} />
                        </label>
                        <label className="adm-field" style={{ flex: 1, minWidth: 130 }}>
                          <span>Keno Spot Count</span>
                          <input className="input" type="number" min={1} max={12}
                            value={editForm.spotCount}
                            onChange={e => setEditForm(p => ({ ...p, spotCount: Number(e.target.value) }))} />
                        </label>
                        <button
                          className="adm-btn adm-btn-primary"
                          disabled={busy === bot.id + '-edit'}
                          onClick={() => saveEdit(bot)}
                          style={{ alignSelf: 'flex-end', marginBottom: 2 }}>
                          {busy === bot.id + '-edit' ? 'Saving…' : 'Save'}
                        </button>
                      </div>
                    )}

                    {/* Inline top-up */}
                    {isTopping && (
                      <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                        <label className="adm-field" style={{ flex: 1, minWidth: 160 }}>
                          <span>Add credits (Cr)</span>
                          <input className="input" type="number" min={1}
                            placeholder="e.g. 500"
                            value={topupAmount}
                            onChange={e => setTopupAmount(e.target.value)} />
                        </label>
                        {[100, 500, 1000, 5000].map(preset => (
                          <button key={preset} className="adm-btn adm-btn-xs adm-btn-secondary"
                            style={{ alignSelf: 'flex-end', marginBottom: 2 }}
                            onClick={() => setTopupAmount(String(preset))}>
                            +{preset}
                          </button>
                        ))}
                        <button
                          className="adm-btn adm-btn-primary"
                          disabled={busy === bot.id + '-topup'}
                          onClick={() => handleTopup(bot)}
                          style={{ alignSelf: 'flex-end', marginBottom: 2 }}>
                          {busy === bot.id + '-topup' ? 'Adding…' : 'Add Credits'}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// Agent Actions (Audit Trail)
// ══════════════════════════════════════════════════════════════════
function AgentActionsAdmin() {
  const addToast = useStore((s) => s.addToast);
  const [ledgerActions, setLedgerActions] = useState<AgentLedgerAction[]>([]);
  const [withdrawalActions, setWithdrawalActions] = useState<AgentWithdrawalAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedLedger, setExpandedLedger] = useState<string | null>(null);
  const [expandedWithdrawal, setExpandedWithdrawal] = useState<string | null>(null);
  const [filterAgent, setFilterAgent] = useState<string>('');
  const [viewMode, setViewMode] = useState<'ledger' | 'withdrawals'>('ledger');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await adminAgentsApi.listActions(200);
      setLedgerActions(data.ledger);
      setWithdrawalActions(data.withdrawals);
    } catch (e) {
      addToast('error', getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => { void load(); }, [load]);

  const filteredLedger = filterAgent
    ? ledgerActions.filter((a) => a.agentId === filterAgent)
    : ledgerActions;

  const filteredWithdrawals = filterAgent
    ? withdrawalActions.filter((w) => w.agentId === filterAgent)
    : withdrawalActions;

  const uniqueAgents = Array.from(
    new Map(
      [...ledgerActions, ...withdrawalActions].map((a) => [
        a.agentId ?? '',
        { id: a.agentId ?? '', name: a.agentName || (a.agentId ?? '').slice(-8) }
      ])
    ).values()
  );

  const DIR_BADGE: Record<string, string> = { credit: 'badge-green', debit: 'badge-red' };
  const W_STATUS: Record<string, string> = {
    pending: 'badge-gold',
    claimed: 'badge-violet',
    processing: 'badge-violet',
    completed: 'badge-green',
    rejected: 'badge-red',
  };

  return (
    <div className="stack-lg">
      <SectionHead title="Agent Actions Audit Trail" sub="Track all money movements and withdrawal processing by every agent.">
        <button className="adm-icon-btn" onClick={load}><RefreshCw size={14} /></button>
      </SectionHead>

      {/* Filters */}
      <div className="adm-panel" style={{ padding: 16 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-end' }}>
          <div className="adm-field" style={{ flex: '1 1 200px', margin: 0 }}>
            <label style={{ fontSize: 11 }}>Filter by Agent</label>
            <select
              className="input"
              value={filterAgent}
              onChange={(e) => setFilterAgent(e.target.value)}
            >
              <option value="">All Agents</option>
              {uniqueAgents.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>
          <div className="adm-field" style={{ width: 200, margin: 0 }}>
            <label style={{ fontSize: 11 }}>View</label>
            <select
              className="input"
              value={viewMode}
              onChange={(e) => setViewMode(e.target.value as 'ledger' | 'withdrawals')}
            >
              <option value="ledger">Ledger Transactions</option>
              <option value="withdrawals">Withdrawal Processing</option>
            </select>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="adm-empty">Loading agent actions…</div>
      ) : viewMode === 'ledger' ? (
        <div className="adm-panel">
          <div className="adm-panel-head">
            Ledger Transactions
            <span className="adm-badge-count">{filteredLedger.length}</span>
          </div>
          {filteredLedger.length === 0 ? (
            <div className="adm-empty">No ledger transactions found.</div>
          ) : (
            <div className="adm-list">
              {filteredLedger.map((entry) => (
                <div key={entry.id} className="adm-w-row">
                  <div className="adm-w-main" onClick={() => setExpandedLedger(expandedLedger === entry.id ? null : entry.id)}>
                    <div className="adm-w-info">
                      <strong>{entry.agentName || entry.agentId.slice(-8)}</strong>
                      <span className="adm-td-muted">{formatCreditsFull(entry.amountMinor)} · {entry.entryType} · {entry.sourceType}</span>
                      <span className="adm-td-muted">{formatDateTime(entry.createdAt)}</span>
                    </div>
                    <div className="adm-w-right">
                      <span className={`badge ${DIR_BADGE[entry.direction] ?? 'badge-gold'}`}>{entry.direction}</span>
                      {expandedLedger === entry.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </div>
                  </div>
                  {expandedLedger === entry.id && (
                    <div className="adm-w-expand" style={{ flexDirection: 'column', gap: 8 }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12 }}>
                        <div><strong>Agent ID:</strong> <span className="adm-mono">{entry.agentId}</span></div>
                        <div><strong>Entry ID:</strong> <span className="adm-mono">{entry.id.slice(-8)}</span></div>
                        <div><strong>Direction:</strong> {entry.direction}</div>
                        <div><strong>Amount:</strong> {formatCreditsFull(entry.amountMinor)}</div>
                        <div><strong>Entry Type:</strong> {entry.entryType}</div>
                        <div><strong>Source Type:</strong> {entry.sourceType}</div>
                        <div><strong>Source ID:</strong> <span className="adm-mono">{entry.sourceId?.slice(-8) || '—'}</span></div>
                        <div><strong>Balance After:</strong> {formatCreditsFull(entry.balanceAfterMinor)}</div>
                        <div><strong>Created:</strong> {formatDateTime(entry.createdAt)}</div>
                      </div>
                      {entry.metadata && Object.keys(entry.metadata).length > 0 && (
                        <div style={{ background: 'var(--bg-2)', borderRadius: 6, padding: 8, fontSize: 11, fontFamily: 'monospace' }}>
                          <strong>Metadata:</strong>
                          <pre style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>{JSON.stringify(entry.metadata, null, 2)}</pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="adm-panel">
          <div className="adm-panel-head">
            Withdrawal Processing
            <span className="adm-badge-count">{filteredWithdrawals.length}</span>
          </div>
          {filteredWithdrawals.length === 0 ? (
            <div className="adm-empty">No withdrawal actions found.</div>
          ) : (
            <div className="adm-list">
              {filteredWithdrawals.map((w) => (
                <div key={w.id} className="adm-w-row">
                  <div className="adm-w-main" onClick={() => setExpandedWithdrawal(expandedWithdrawal === w.id ? null : w.id)}>
                    <div className="adm-w-info">
                      <strong>{w.agentName || w.agentId?.slice(-8) || '—'}</strong>
                      <span className="adm-td-muted">{formatCreditsFull(w.amountMinor)} → {w.destinationAccount}</span>
                      <span className="adm-td-muted">{formatDateTime(w.createdAt)}</span>
                    </div>
                    <div className="adm-w-right">
                      <span className={`badge ${W_STATUS[w.status] ?? 'badge-gold'}`}>{w.status}</span>
                      {expandedWithdrawal === w.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </div>
                  </div>
                  {expandedWithdrawal === w.id && (
                    <div className="adm-w-expand" style={{ flexDirection: 'column', gap: 8 }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12 }}>
                        <div><strong>Withdrawal ID:</strong> <span className="adm-mono">{w.id.slice(-8)}</span></div>
                        <div><strong>User:</strong> {w.userName || w.userId?.slice(-8) || '—'}</div>
                        <div><strong>Agent:</strong> {w.agentName || w.agentId?.slice(-8) || '—'}</div>
                        <div><strong>Amount:</strong> {formatCreditsFull(w.amountMinor)}</div>
                        <div><strong>Service Charge:</strong> {w.serviceChargeMinor ? formatCreditsFull(w.serviceChargeMinor) : '—'}</div>
                        <div><strong>Net Amount:</strong> {w.netAmountMinor ? formatCreditsFull(w.netAmountMinor) : '—'}</div>
                        <div><strong>Destination:</strong> {w.destinationAccount}</div>
                        <div><strong>Telebirr Ref:</strong> {w.telebirrReference || '—'}</div>
                        <div><strong>Status:</strong> {w.status}</div>
                        <div><strong>Claimed At:</strong> {w.claimedAt ? formatDateTime(w.claimedAt) : '—'}</div>
                        <div><strong>Processed At:</strong> {w.processedAt ? formatDateTime(w.processedAt) : '—'}</div>
                        {w.adminNotes && <div style={{ gridColumn: '1 / -1' }}><strong>Admin Notes:</strong> {w.adminNotes}</div>}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
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
// Account — admin's own wallet, top-up, and transfer-to-agent
// ══════════════════════════════════════════════════════════════════
function AccountAdmin() {
  const addToast = useStore((s) => s.addToast);
  const user = useStore((s) => s.user);
  const setWallet = useStore((s) => s.setWallet);

  const [wallet, setLocalWallet] = useState<WalletType | null>(null);
  const [agents, setAgents] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const [topupCr, setTopupCr] = useState('');
  const [transferAgentId, setTransferAgentId] = useState('');
  const [transferCr, setTransferCr] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [w, agentsPage] = await Promise.all([
        walletApi.getWallet(),
        adminAgentsApi.listAgents(1, 100),
      ]);
      setLocalWallet(w);
      setWallet(w);
      setAgents(agentsPage.data);
      if (!transferAgentId && agentsPage.data.length > 0) setTransferAgentId(agentsPage.data[0].id);
    } catch (e) { addToast('error', getErrorMessage(e)); }
    finally { setLoading(false); }
  }, [addToast, setWallet, transferAgentId]);

  useEffect(() => { void load(); }, [load]);

  const doTopup = async () => {
    const cr = parseFloat(topupCr);
    if (!cr || cr <= 0) { addToast('info', 'Enter a valid amount.'); return; }
    setBusy('topup');
    try {
      const w = await adminApi.topupWallet(Math.round(cr * 100), createIdempotencyKey('admin-topup'));
      setLocalWallet(w);
      setWallet(w);
      setTopupCr('');
      addToast('success', `Topped up ${cr} Cr.`);
    } catch (e) { addToast('error', getErrorMessage(e)); }
    finally { setBusy(null); }
  };

  const doTransfer = async () => {
    const cr = parseFloat(transferCr);
    if (!transferAgentId) { addToast('info', 'Select an agent.'); return; }
    if (!cr || cr <= 0) { addToast('info', 'Enter a valid amount.'); return; }
    setBusy('transfer');
    try {
      const { adminWallet } = await adminApi.transferToAgent(transferAgentId, Math.round(cr * 100), createIdempotencyKey('admin-transfer'));
      setLocalWallet(adminWallet);
      setWallet(adminWallet);
      setTransferCr('');
      addToast('success', `Transferred ${cr} Cr to agent.`);
    } catch (e) { addToast('error', getErrorMessage(e)); }
    finally { setBusy(null); }
  };

  if (loading) return <div className="adm-empty">Loading account…</div>;

  return (
    <div className="stack-lg">
      <SectionHead title="My Admin Account" sub="Your administrator identity, wallet balance, and treasury actions.">
        <button className="adm-icon-btn" onClick={load} title="Refresh"><RefreshCw size={14} /></button>
      </SectionHead>

      {/* Identity + balance */}
      <div className="adm-kpi-grid">
        <Kpi label="Display Name" value={user?.displayName ?? '—'} color="#8b5cf6" />
        <Kpi label="Roles" value={(user?.roles ?? []).join(', ') || '—'} color="#3b82f6" />
        <Kpi label="Wallet Available" value={formatCreditsFull(wallet?.availableMinor ?? 0)} color="#10b981" />
        <Kpi label="Wallet Reserved" value={formatCreditsFull(wallet?.reservedMinor ?? 0)} color="#f59e0b" />
      </div>

      {/* Top up own wallet */}
      <div className="adm-panel">
        <div className="adm-panel-head">Top Up My Wallet</div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', padding: 16 }}>
          <label className="adm-field" style={{ flex: 1, minWidth: 180 }}>
            <span>Amount (Cr)</span>
            <input className="input" type="number" min={1} placeholder="e.g. 1000"
              value={topupCr} onChange={(e) => setTopupCr(e.target.value)} />
          </label>
          <button className="btn btn-primary" disabled={busy === 'topup'} onClick={doTopup}>
            {busy === 'topup' ? 'Processing…' : 'Top Up'}
          </button>
        </div>
      </div>

      {/* Transfer to agent */}
      <div className="adm-panel">
        <div className="adm-panel-head">Transfer Credits to Agent</div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', padding: 16 }}>
          <label className="adm-field" style={{ flex: 1, minWidth: 180 }}>
            <span>Agent</span>
            <select className="input" value={transferAgentId} onChange={(e) => setTransferAgentId(e.target.value)}>
              {agents.length === 0 && <option value="">No agents</option>}
              {agents.map((a) => (
                <option key={a.id} value={a.id}>{a.displayName ?? a.id.slice(-6)}</option>
              ))}
            </select>
          </label>
          <label className="adm-field" style={{ flex: 1, minWidth: 140 }}>
            <span>Amount (Cr)</span>
            <input className="input" type="number" min={1} placeholder="e.g. 500"
              value={transferCr} onChange={(e) => setTransferCr(e.target.value)} />
          </label>
          <button className="btn btn-primary" disabled={busy === 'transfer' || agents.length === 0} onClick={doTransfer}>
            {busy === 'transfer' ? 'Processing…' : 'Transfer'}
          </button>
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

      {/* Body: sidebar nav + content */}
      <div className="adm-body">
        <nav className="adm-tab-bar">
          {TABS.map((t) => (
            <button key={t.id} className={`adm-tab${tab === t.id ? ' active' : ''}`} onClick={() => setTab(t.id)}>
              {t.icon}
              <span>{t.label}</span>
            </button>
          ))}
        </nav>

        <div className="adm-content">
          {tab === 'overview'      && <OverviewAdmin />}
          {tab === 'players'       && <PlayersAdmin />}
          {tab === 'agents'        && <AgentsAdmin />}
          {tab === 'agent-actions' && <AgentActionsAdmin />}
          {tab === 'keno'          && <KenoAdmin />}
          {tab === 'bingo'         && <BingoAdmin />}
          {tab === 'bots'          && <BotsAdmin />}
          {tab === 'withdrawals'   && <WithdrawalsAdmin />}
          {tab === 'config'        && <ConfigAdmin />}
          {tab === 'emoney'        && <EMoneyAdmin />}
          {tab === 'account'       && <AccountAdmin />}
        </div>
      </div>
    </div>
  );
}
