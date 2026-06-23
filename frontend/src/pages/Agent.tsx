import { useCallback, useEffect, useState } from 'react';
import { CheckCircle, Clock, RefreshCw, Send, Undo2, Users, X } from 'lucide-react';
import { agentApi, walletApi } from '../lib/api';
import type { Wallet, Withdrawal, LedgerEntry } from '../lib/models';
import { formatCreditsFull, formatDateTime, getErrorMessage } from '../lib/utils';
import { formatCredits, useStore } from '../store/useStore';

const STATUS_BADGE: Record<string, string> = {
  pending: 'badge-gold',
  claimed: 'badge-violet',
  completed: 'badge-green',
  rejected: 'badge-red',
};

export function Agent() {
  const addToast = useStore((s) => s.addToast);

  const [available, setAvailable] = useState<Withdrawal[]>([]);
  const [mine, setMine] = useState<Withdrawal[]>([]);
  const [config, setConfig] = useState<{ withdrawalServiceChargePct: number } | null>(null);
  const [agentWallet, setAgentWallet] = useState<Wallet | null>(null);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [withdrawalHistory, setWithdrawalHistory] = useState<Withdrawal[]>([]);
  const [loading, setLoading] = useState(true);

  // per-withdrawal state for the complete form
  const [refInputs, setRefInputs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  // Reject state
  const [rejectRemarks, setRejectRemarks] = useState<Record<string, string>>({});
  const [showRejectForm, setShowRejectForm] = useState<string | null>(null);

  // Transfer E-Money to Player form states
  const [transferPhone, setTransferPhone] = useState('');
  const [transferAmount, setTransferAmount] = useState('');
  const [submittingTransfer, setSubmittingTransfer] = useState(false);

  const load = useCallback(async () => {
    try {
      const [avail, my, cfg, wallet] = await Promise.all([
        agentApi.getAvailableWithdrawals(),
        agentApi.getMyWithdrawals(),
        agentApi.getConfig(),
        walletApi.getWallet(),
      ]);
      setAvailable(avail);
      setMine(my);
      setConfig(cfg);
      setAgentWallet(wallet);
      const tx = await agentApi.getTransactions();
      setLedger(tx.ledger);
      setWithdrawalHistory(tx.withdrawals);
    } catch (err) {
      addToast('error', getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  const handleTransferToUser = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = parseInt(transferAmount, 10);
    if (!transferPhone.trim()) {
      addToast('error', 'Please enter player phone number');
      return;
    }
    if (!amount || amount <= 0) {
      addToast('error', 'Please enter a valid amount');
      return;
    }
    setSubmittingTransfer(true);
    try {
      const result = await agentApi.transferToUser(transferPhone.trim(), amount);
      setAgentWallet(result.agentWallet);
      addToast('success', `Successfully transferred ${formatCreditsFull(amount)} to player ${transferPhone}`);
      setTransferAmount('');
      setTransferPhone('');
    } catch (err) {
      addToast('error', getErrorMessage(err));
    } finally {
      setSubmittingTransfer(false);
    }
  };

  useEffect(() => {
    void load();
  }, [load]);

  

  const setBusyFor = (id: string, value: boolean) =>
    setBusy((prev) => ({ ...prev, [id]: value }));

  const handleClaim = async (id: string) => {
    setBusyFor(id, true);
    try {
      await agentApi.claimWithdrawal(id);
      await load();
      addToast('success', 'Withdrawal claimed — make the Telebirr transfer now.');
    } catch (err) {
      addToast('error', getErrorMessage(err));
    } finally {
      setBusyFor(id, false);
    }
  };

  const handleRelease = async (id: string) => {
    setBusyFor(id, true);
    try {
      await agentApi.releaseWithdrawal(id);
      await load();
      addToast('info', 'Withdrawal released back to the pending pool.');
    } catch (err) {
      addToast('error', getErrorMessage(err));
    } finally {
      setBusyFor(id, false);
    }
  };

  const handleReject = async (w: Withdrawal) => {
    const remarks = (rejectRemarks[w.id] ?? '').trim();
    if (remarks.length < 15) {
      addToast('error', 'Rejection remarks must be at least 15 characters.');
      return;
    }
    setBusyFor(w.id, true);
    try {
      await agentApi.rejectWithdrawal(w.id, remarks);
      await load();
      setShowRejectForm(null);
      setRejectRemarks((prev) => { const next = { ...prev }; delete next[w.id]; return next; });
      addToast('info', 'Withdrawal rejected.');
    } catch (err) {
      addToast('error', getErrorMessage(err));
    } finally {
      setBusyFor(w.id, false);
    }
  };

  const handleComplete = async (w: Withdrawal) => {
    const ref = (refInputs[w.id] ?? '').trim();
    if (ref.length < 4) {
      addToast('info', 'Enter the Telebirr reference number (min 4 characters).');
      return;
    }
    setBusyFor(w.id, true);
    try {
      await agentApi.completeWithdrawal(w.id, ref);
      await load();
      addToast('success', `Withdrawal completed. Ref: ${ref}`);
    } catch (err) {
      addToast('error', getErrorMessage(err));
    } finally {
      setBusyFor(w.id, false);
    }
  };

  const serviceChargePct = config?.withdrawalServiceChargePct ?? 0;
  const netAmount = (gross: number) =>
    gross - Math.floor((gross * serviceChargePct) / 100);

  return (
    <div className="stack-lg">
      <section className="card hero-subpanel">
        <div className="section-header">
          <div>
            <div className="section-title">
              <Users size={16} style={{ display: 'inline', marginRight: 6, verticalAlign: 'middle' }} />
              Agent Panel
            </div>
            <p className="section-copy">
              Claim pending withdrawals, make the Telebirr transfer, then confirm the reference.
            </p>
          </div>
          <button className="btn btn-ghost btn-sm icon-btn" onClick={() => void load()}>
            <RefreshCw size={14} />
          </button>
        </div>

        {config && (
          <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))' }}>
            <div className="stat-card">
              <span className="stat-label">My Balance</span>
              <strong style={{ color: '#10b981' }}>{formatCreditsFull(agentWallet?.availableMinor ?? 0)}</strong>
            </div>
            <div className="stat-card">
              <span className="stat-label">Service Charge</span>
              <strong>{serviceChargePct}%</strong>
            </div>
            <div className="stat-card">
              <span className="stat-label">Available</span>
              <strong>{available.length} pending</strong>
            </div>
            <div className="stat-card">
              <span className="stat-label">My Active</span>
              <strong>{mine.length} claimed</strong>
            </div>
          </div>
        )}
      </section>

      {/* ── Transfer E-Money to Player ── */}
      <section className="card">
        <div className="section-header">
          <div>
            <div className="section-title">Transfer E-Money to Player</div>
            <p className="section-copy">Directly transfer credits to a player's wallet using their phone number.</p>
          </div>
        </div>
        <form onSubmit={handleTransferToUser} className="stack-md" style={{ padding: '0 16px 16px 16px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: '0.9em', color: 'var(--text-muted)' }}>Player Phone Number</label>
              <input
                className="input"
                placeholder="e.g. +2519XXXXXXXX or 09XXXXXXXX"
                value={transferPhone}
                onChange={(e) => setTransferPhone(e.target.value)}
                required
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: '0.9em', color: 'var(--text-muted)' }}>Amount (Credits)</label>
              <input
                className="input"
                type="number"
                min="1"
                placeholder="e.g. 1000 for 10 Birr"
                value={transferAmount}
                onChange={(e) => setTransferAmount(e.target.value)}
                required
              />
              <span style={{ fontSize: '0.8em', color: 'var(--text-muted)' }}>
                Equivalent to: {formatCreditsFull(parseInt(transferAmount, 10) || 0)}
              </span>
            </div>
          </div>
          <button className="btn btn-primary" type="submit" disabled={submittingTransfer} style={{ alignSelf: 'flex-start', marginTop: 12 }}>
            <Send size={14} />
            {submittingTransfer ? 'Transferring...' : 'Transfer to Player'}
          </button>
        </form>
      </section>

      {/* ── My Claimed Withdrawals ── */}
      <section className="card">
        <div className="section-header">
          <div>
            <div className="section-title">My Active Requests</div>
            <p className="section-copy">Withdrawals you have claimed and are responsible for processing.</p>
          </div>
        </div>

        {loading && mine.length === 0 ? (
          <div className="card-muted">Loading...</div>
        ) : mine.length === 0 ? (
          <div className="card-muted">No active requests — claim one from the pool below.</div>
        ) : (
          <div className="list-stack">
            {mine.map((w) => {
              const net = netAmount(w.amountMinor);
              const serviceCharge = w.amountMinor - net;
              const isBusy = busy[w.id] ?? false;
              return (
                <article key={w.id} className="list-card agent-withdrawal-card">
                  <div className="list-card-header">
                    <div>
                      <h3>Withdrawal #{w.id.slice(-6)}</h3>
                      <p>{formatDateTime(w.createdAt)}</p>
                    </div>
                    <span className={`badge ${STATUS_BADGE[w.status] ?? 'badge-gold'}`}>
                      {w.status}
                    </span>
                  </div>

                  <div className="agent-transfer-detail">
                    <div className="agent-detail-row">
                      <span>Send to (Telebirr)</span>
                      <strong className="agent-phone">{w.destinationAccount}</strong>
                    </div>
                    <div className="agent-detail-row">
                      <span>Gross amount</span>
                      <strong>{formatCredits(w.amountMinor)} Credits</strong>
                    </div>
                    <div className="agent-detail-row">
                      <span>Service charge ({serviceChargePct}%)</span>
                      <strong>−{formatCredits(serviceCharge)} Credits</strong>
                    </div>
                    <div className="agent-detail-row agent-net-row">
                      <span>You transfer to user</span>
                      <strong className="agent-net">{formatCreditsFull(net)} Credits</strong>
                    </div>
                  </div>

                  <div className="agent-action-strip">
                    <p className="agent-confirm-label">
                      After the Telebirr transfer is done, enter the reference number and confirm:
                    </p>
                    <div className="agent-complete-row">
                      <input
                        className="input compact-input"
                        placeholder="Telebirr reference…"
                        value={refInputs[w.id] ?? ''}
                        onChange={(e) =>
                          setRefInputs((prev) => ({ ...prev, [w.id]: e.target.value }))
                        }
                        disabled={isBusy}
                      />
                      <button
                        className="btn btn-primary"
                        disabled={isBusy || !(refInputs[w.id] ?? '').trim()}
                        onClick={() => void handleComplete(w)}
                      >
                        <CheckCircle size={14} />
                        {isBusy ? 'Confirming…' : 'Mark Done'}
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        disabled={isBusy}
                        onClick={() => void handleRelease(w.id)}
                        title="Release back to the pending pool"
                      >
                        <Undo2 size={14} />
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        disabled={isBusy}
                        onClick={() => setShowRejectForm(showRejectForm === w.id ? null : w.id)}
                        title="Reject withdrawal"
                        style={{ color: 'var(--danger)' }}
                      >
                        <X size={14} />
                      </button>
                    </div>
                    {showRejectForm === w.id && (
                      <div style={{ marginTop: 8 }}>
                        <p className="agent-confirm-label" style={{ color: 'var(--danger)', marginBottom: 6 }}>
                          Rejection reason (minimum 15 characters):
                        </p>
                        <div className="agent-complete-row">
                          <input
                            className="input compact-input"
                            placeholder="Enter rejection reason…"
                            value={rejectRemarks[w.id] ?? ''}
                            onChange={(e) =>
                              setRejectRemarks((prev) => ({ ...prev, [w.id]: e.target.value }))
                            }
                            disabled={isBusy}
                          />
                          <button
                            className="btn btn-primary"
                            disabled={isBusy || (rejectRemarks[w.id] ?? '').trim().length < 15}
                            onClick={() => void handleReject(w)}
                            style={{ background: 'var(--danger)' }}
                          >
                            {isBusy ? 'Rejecting…' : 'Confirm Reject'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Available Withdrawals ── */}
      <section className="card">
        <div className="section-header">
          <div>
            <div className="section-title">Pending Pool</div>
            <p className="section-copy">Unclaimed withdrawal requests waiting to be processed.</p>
          </div>
        </div>

        {loading && available.length === 0 ? (
          <div className="card-muted">Loading...</div>
        ) : available.length === 0 ? (
          <div className="card-muted">
            <Clock size={16} style={{ display: 'inline', marginRight: 6, verticalAlign: 'middle' }} />
            No pending withdrawals right now.
          </div>
        ) : (
          <div className="list-stack">
            {available.map((w) => {
              const net = netAmount(w.amountMinor);
              const isBusy = busy[w.id] ?? false;
              return (
                <article key={w.id} className="list-card">
                  <div className="list-card-header">
                    <div>
                      <h3>Withdrawal #{w.id.slice(-6)}</h3>
                      <p>{formatDateTime(w.createdAt)}</p>
                    </div>
                    <span className="badge badge-gold">pending</span>
                  </div>
                  <div className="agent-transfer-detail">
                    <div className="agent-detail-row">
                      <span>Destination</span>
                      <strong>{w.destinationAccount}</strong>
                    </div>
                    <div className="agent-detail-row">
                      <span>Amount</span>
                      <strong>{formatCredits(w.amountMinor)} Credits</strong>
                    </div>
                    <div className="agent-detail-row">
                      <span>You will transfer</span>
                      <strong>{formatCreditsFull(net)} Credits (after {serviceChargePct}% fee)</strong>
                    </div>
                  </div>
                  <div className="agent-action-strip">
                    <button
                      className="btn btn-primary"
                      disabled={isBusy}
                      onClick={() => void handleClaim(w.id)}
                    >
                      <Send size={14} />
                      {isBusy ? 'Claiming…' : 'Claim & Process'}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
