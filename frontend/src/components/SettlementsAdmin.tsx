import { useCallback, useEffect, useState } from 'react';
import { Banknote, Plus } from 'lucide-react';
import { adminSettlementsApi, adminAgentsApi, type AgentSettlement, type AgentSettlementStatus, type AgentSettlementPaymentMethod } from '../lib/api';
import type { User } from '../lib/models';
import { getErrorMessage, formatCreditsFull, formatDateTime } from '../lib/utils';

const STATUS_BADGE: Record<string, string> = {
  pending: 'badge-gold',
  approved: 'badge-violet',
  paid: 'badge-green',
  rejected: 'badge-red',
};

const PAYMENT_METHODS: AgentSettlementPaymentMethod[] = ['bank_transfer', 'cash', 'mobile_money', 'other'];

export function SettlementsAdmin() {
  const [agents, setAgents] = useState<User[]>([]);
  const [settlements, setSettlements] = useState<AgentSettlement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const [newAgentId, setNewAgentId] = useState('');
  const [newPeriodStart, setNewPeriodStart] = useState('');
  const [newPeriodEnd, setNewPeriodEnd] = useState('');
  const [newNotes, setNewNotes] = useState('');

  const [payForm, setPayForm] = useState<Record<string, {
    paymentMethod: AgentSettlementPaymentMethod;
    ftNumber: string;
    receiptFile: File | null;
    paidAt: string;
    amountPaidMinor: string;
  }>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [agentList, res] = await Promise.all([
        adminAgentsApi.listAgents(1, 200),
        adminSettlementsApi.listAll(1, 100),
      ]);
      setAgents(agentList);
      setSettlements(res.data);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const createSettlement = async () => {
    if (!newAgentId || !newPeriodStart || !newPeriodEnd) {
      setError('Pick an agent and a period.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await adminSettlementsApi.create(newAgentId, new Date(newPeriodStart).toISOString(), new Date(newPeriodEnd).toISOString(), newNotes || undefined);
      setNewAgentId(''); setNewPeriodStart(''); setNewPeriodEnd(''); setNewNotes('');
      await load();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (id: string, status: AgentSettlementStatus) => {
    setSaving(true);
    try {
      await adminSettlementsApi.update(id, { status });
      await load();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const markPaid = async (s: AgentSettlement) => {
    const form = payForm[s.id];
    if (!form?.ftNumber?.trim()) {
      setError('An FT number is required to mark a settlement as paid.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      let receiptFileUrl = s.receiptFileUrl ?? undefined;
      if (form.receiptFile) {
        const uploaded = await adminSettlementsApi.uploadReceipt(form.receiptFile);
        receiptFileUrl = uploaded.fileUrl;
      }
      if (!receiptFileUrl) {
        setError('A payment receipt is required to mark a settlement as paid.');
        setSaving(false);
        return;
      }
      await adminSettlementsApi.update(s.id, {
        status: 'paid',
        paymentMethod: form.paymentMethod,
        ftNumber: form.ftNumber.trim(),
        receiptFileUrl,
        paidAt: form.paidAt ? new Date(form.paidAt).toISOString() : new Date().toISOString(),
        amountPaidMinor: form.amountPaidMinor ? Number(form.amountPaidMinor) : undefined,
      });
      await load();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const updatePayForm = (id: string, patch: Partial<{ paymentMethod: AgentSettlementPaymentMethod; ftNumber: string; receiptFile: File | null; paidAt: string; amountPaidMinor: string }>) => {
    setPayForm((prev) => ({
      ...prev,
      [id]: {
        paymentMethod: prev[id]?.paymentMethod ?? 'bank_transfer',
        ftNumber: prev[id]?.ftNumber ?? '',
        receiptFile: prev[id]?.receiptFile ?? null,
        paidAt: prev[id]?.paidAt ?? '',
        amountPaidMinor: prev[id]?.amountPaidMinor ?? '',
        ...patch,
      },
    }));
  };

  return (
    <div className="stack-lg">
      <div className="adm-panel">
        <div className="adm-panel-head" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Banknote size={18} /> Agent Settlements
        </div>
        <p className="adm-field-hint" style={{ padding: '0 16px' }}>
          A settlement is a real-world payout to an agent, kept separate from what they've earned — recording
          one doesn't touch their in-app wallet balance.
        </p>

        {error && <div className="adm-error-box" style={{ margin: '12px 16px' }}>{error}</div>}

        <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr 1.5fr auto', gap: 8, padding: '0 16px 16px', alignItems: 'end' }}>
          <label className="adm-field">
            <span>Agent</span>
            <select className="input" value={newAgentId} onChange={(e) => setNewAgentId(e.target.value)}>
              <option value="">Select agent…</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>{a.displayName}{a.phoneNumber ? ` · ${a.phoneNumber}` : ''}</option>
              ))}
            </select>
          </label>
          <label className="adm-field">
            <span>Period Start</span>
            <input className="input" type="date" value={newPeriodStart} onChange={(e) => setNewPeriodStart(e.target.value)} />
          </label>
          <label className="adm-field">
            <span>Period End</span>
            <input className="input" type="date" value={newPeriodEnd} onChange={(e) => setNewPeriodEnd(e.target.value)} />
          </label>
          <label className="adm-field">
            <span>Notes (optional)</span>
            <input className="input" value={newNotes} onChange={(e) => setNewNotes(e.target.value)} />
          </label>
          <button className="adm-btn adm-btn-primary" disabled={saving} onClick={createSettlement}>
            <Plus size={12} /> Record
          </button>
        </div>

        {loading ? (
          <div className="adm-empty">Loading settlements…</div>
        ) : settlements.length === 0 ? (
          <div className="adm-empty">No settlements recorded yet.</div>
        ) : (
          <div className="adm-list">
            {settlements.map((s) => {
              const form = payForm[s.id] ?? { paymentMethod: 'bank_transfer' as AgentSettlementPaymentMethod, ftNumber: '', receiptFile: null, paidAt: '', amountPaidMinor: '' };
              return (
                <div key={s.id} className="adm-w-row">
                  <div className="adm-w-main" onClick={() => setExpanded(expanded === s.id ? null : s.id)}>
                    <div className="adm-w-info">
                      <strong>{s.agent?.displayName ?? s.agentId.slice(0, 8)}</strong>
                      <span className="adm-td-muted">{formatDateTime(s.periodStart)} – {formatDateTime(s.periodEnd)}</span>
                      <span className="adm-td-muted">Earned {formatCreditsFull(s.totalEarnedMinor)} · Paid {formatCreditsFull(s.amountPaidMinor)}</span>
                    </div>
                    <div className="adm-w-right">
                      <span className={`badge ${STATUS_BADGE[s.status] ?? 'badge-gold'}`}>{s.status}</span>
                    </div>
                  </div>
                  {expanded === s.id && (
                    <div className="adm-w-expand" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6, fontSize: 12 }}>
                        <div>Game commission: {formatCreditsFull(s.gameCommissionMinor)}</div>
                        <div>Withdrawal fees: {formatCreditsFull(s.withdrawalFeesMinor)}</div>
                        <div>Outstanding balance: {formatCreditsFull(s.outstandingBalanceMinor)}</div>
                        <div>Notes: {s.notes ?? '—'}</div>
                      </div>

                      {s.status !== 'paid' && (
                        <>
                          <div className="adm-w-actions">
                            <button className="adm-btn" disabled={saving || s.status === 'approved'} onClick={() => setStatus(s.id, 'approved')}>Approve</button>
                            <button className="adm-btn adm-btn-danger" disabled={saving || s.status === 'rejected'} onClick={() => setStatus(s.id, 'rejected')}>Reject</button>
                          </div>

                          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8, display: 'grid', gap: 8 }}>
                            <div style={{ fontSize: 12, fontWeight: 700 }}>Mark as Paid</div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
                              <label className="adm-field">
                                <span>Payment Method</span>
                                <select className="input" value={form.paymentMethod} onChange={(e) => updatePayForm(s.id, { paymentMethod: e.target.value as AgentSettlementPaymentMethod })}>
                                  {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m.replace('_', ' ')}</option>)}
                                </select>
                              </label>
                              <label className="adm-field">
                                <span>Amount Paid (ETB)</span>
                                <input className="input" type="number" min={0} placeholder={String(s.amountPaidMinor)}
                                  value={form.amountPaidMinor} onChange={(e) => updatePayForm(s.id, { amountPaidMinor: e.target.value })} />
                              </label>
                              <label className="adm-field">
                                <span>FT Number</span>
                                <input className="input" value={form.ftNumber} onChange={(e) => updatePayForm(s.id, { ftNumber: e.target.value })} />
                              </label>
                              <label className="adm-field">
                                <span>Paid At</span>
                                <input className="input" type="datetime-local" value={form.paidAt} onChange={(e) => updatePayForm(s.id, { paidAt: e.target.value })} />
                              </label>
                              <label className="adm-field" style={{ gridColumn: 'span 2' }}>
                                <span>Payment Receipt (image/PDF)</span>
                                <input type="file" accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
                                  onChange={(e) => updatePayForm(s.id, { receiptFile: e.target.files?.[0] ?? null })} />
                              </label>
                            </div>
                            <button className="adm-btn adm-btn-success" disabled={saving} onClick={() => markPaid(s)}>
                              {saving ? '…' : 'Mark Paid'}
                            </button>
                          </div>
                        </>
                      )}

                      {s.status === 'paid' && (
                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                          <div>Paid {s.paidAt ? formatDateTime(s.paidAt) : '—'} via {s.paymentMethod ?? '—'}</div>
                          <div>FT Number: {s.ftNumber ?? '—'}</div>
                          {s.receiptFileUrl && <a href={`/uploads/${s.receiptFileUrl}`} target="_blank" rel="noreferrer">View receipt</a>}
                        </div>
                      )}
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
