import { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle, ChevronDown, ChevronUp, Clock, RefreshCw, Send, Undo2, Users, X } from 'lucide-react';
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

function Step({ n, done, label }: { n: number; done?: boolean; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{
        width: 24, height: 24, borderRadius: 99, flexShrink: 0,
        background: done ? 'var(--accent)' : 'var(--card-bg)',
        border: `2px solid ${done ? 'var(--accent)' : 'var(--border)'}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 11, fontWeight: 700, color: done ? '#fff' : 'var(--text-muted)',
      }}>
        {done ? '✓' : n}
      </div>
      <span style={{ fontSize: 12, color: done ? 'var(--text-secondary)' : 'var(--text-primary)', fontWeight: done ? 400 : 600 }}>
        {label}
      </span>
    </div>
  );
}

export function Agent() {
  const addToast = useStore((s) => s.addToast);

  const [available, setAvailable] = useState<Withdrawal[]>([]);
  const [mine, setMine] = useState<Withdrawal[]>([]);
  const [config, setConfig] = useState<{ withdrawalServiceChargePct: number } | null>(null);
  const [agentWallet, setAgentWallet] = useState<Wallet | null>(null);
  const [_ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [_withdrawalHistory, setWithdrawalHistory] = useState<Withdrawal[]>([]);
  const [loading, setLoading] = useState(true);

  const [refInputs, setRefInputs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [rejectRemarks, setRejectRemarks] = useState<Record<string, string>>({});
  const [showRejectForm, setShowRejectForm] = useState<string | null>(null);
  const [showPool, setShowPool] = useState(false);

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
    if (!transferPhone.trim()) { addToast('error', 'Please enter player phone number'); return; }
    if (!amount || amount <= 0) { addToast('error', 'Please enter a valid amount'); return; }
    setSubmittingTransfer(true);
    try {
      const result = await agentApi.transferToUser(transferPhone.trim(), amount);
      setAgentWallet(result.agentWallet);
      addToast('success', `Transferred ${formatCreditsFull(amount)} to ${transferPhone}`);
      setTransferAmount('');
      setTransferPhone('');
    } catch (err) {
      addToast('error', getErrorMessage(err));
    } finally {
      setSubmittingTransfer(false);
    }
  };

  useEffect(() => { void load(); }, [load]);

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
    if (remarks.length < 15) { addToast('error', 'Rejection remarks must be at least 15 characters.'); return; }
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
    if (ref.length < 4) { addToast('info', 'Enter the Telebirr reference number (min 4 characters).'); return; }
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
  const netAmount = (gross: number) => gross - Math.floor((gross * serviceChargePct) / 100);

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div style={{ maxWidth: 520, margin: '0 auto', padding: '12px 12px 80px' }}>

      {/* Stats bar */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 8,
        marginBottom: 16,
      }}>
        {[
          { label: 'Balance', value: formatCredits(agentWallet?.availableMinor ?? 0), accent: true },
          { label: 'Fee', value: `${serviceChargePct}%` },
          { label: 'Pool', value: String(available.length) },
          { label: 'Active', value: String(mine.length) },
        ].map(({ label, value, accent }) => (
          <div key={label} style={{
            background: 'var(--card-bg)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            padding: '10px 8px',
            textAlign: 'center',
          }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }}>{label}</div>
            <div style={{ fontWeight: 700, fontSize: 14, color: accent ? 'var(--accent)' : 'var(--text-primary)' }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Header actions */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Users size={16} style={{ color: 'var(--accent)' }} />
          <span style={{ fontWeight: 700, fontSize: 16 }}>Agent Panel</span>
        </div>
        <button className="btn btn-ghost btn-sm icon-btn" onClick={() => void load()} style={{ minWidth: 32 }}>
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Transfer to player */}
      <div style={{
        background: 'var(--card-bg)',
        border: '1px solid var(--border)',
        borderRadius: 14,
        padding: 16,
        marginBottom: 12,
      }}>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12 }}>Transfer ETB to Player</div>
        <form onSubmit={handleTransferToUser} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input
            className="input"
            placeholder="Player phone (e.g. 09XXXXXXXX)"
            value={transferPhone}
            onChange={(e) => setTransferPhone(e.target.value)}
            required
          />
          <input
            className="input"
            type="number"
            min="1"
            placeholder="Amount in ETB"
            value={transferAmount}
            onChange={(e) => setTransferAmount(e.target.value)}
            required
          />
          {transferAmount && parseInt(transferAmount) > 0 && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              = {formatCreditsFull(parseInt(transferAmount, 10))}
            </div>
          )}
          <button className="btn btn-primary" type="submit" disabled={submittingTransfer}>
            <Send size={14} />
            {submittingTransfer ? 'Transferring...' : 'Transfer'}
          </button>
        </form>
      </div>

      {/* My active requests */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 10 }}>
          My Active Requests
          {mine.length > 0 && (
            <span style={{
              marginLeft: 8, background: 'var(--accent)', color: '#fff',
              fontSize: 10, padding: '1px 6px', borderRadius: 99, fontWeight: 700,
            }}>{mine.length}</span>
          )}
        </div>

        {loading && mine.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)', fontSize: 13 }}>Loading...</div>
        ) : mine.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)', fontSize: 13 }}>
            No active requests — claim one from the pool below.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {mine.map((w) => {
              const net = netAmount(w.amountMinor);
              const serviceCharge = w.amountMinor - net;
              const isBusy = busy[w.id] ?? false;
              return (
                <motion.article
                  key={w.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  style={{
                    background: 'var(--card-bg)',
                    border: '1px solid var(--border)',
                    borderRadius: 14,
                    overflow: 'hidden',
                  }}
                >
                  {/* Card header */}
                  <div style={{
                    background: 'var(--surface)',
                    padding: '12px 14px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>#{w.id.slice(-6)}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{formatDateTime(w.createdAt)}</div>
                    </div>
                    <span className={`badge ${STATUS_BADGE[w.status] ?? 'badge-gold'}`}>{w.status}</span>
                  </div>

                  <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
                    {/* Steps */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <Step n={1} done label="Claimed by you" />
                      <Step n={2} label={`Send Telebirr to ${w.destinationAccount}`} />
                      <Step n={3} label="Enter reference number below" />
                    </div>

                    {/* Transfer details */}
                    <div style={{
                      background: 'var(--surface)',
                      borderRadius: 10,
                      padding: '10px 12px',
                      fontSize: 13,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: 'var(--text-muted)' }}>To (Telebirr)</span>
                        <strong style={{ fontSize: 14 }}>{w.destinationAccount}</strong>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: 'var(--text-muted)' }}>Gross</span>
                        <span>{formatCredits(w.amountMinor)} ETB</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: 'var(--text-muted)' }}>Fee ({serviceChargePct}%)</span>
                        <span>−{formatCredits(serviceCharge)} ETB</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border)', paddingTop: 6, marginTop: 2 }}>
                        <strong>You transfer</strong>
                        <strong style={{ color: 'var(--accent)', fontSize: 15 }}>{formatCreditsFull(net)}</strong>
                      </div>
                    </div>

                    {/* Reference input + complete */}
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input
                        className="input"
                        placeholder="Telebirr reference…"
                        value={refInputs[w.id] ?? ''}
                        onChange={(e) => setRefInputs((prev) => ({ ...prev, [w.id]: e.target.value }))}
                        disabled={isBusy}
                        style={{ flex: 1 }}
                      />
                      <button
                        className="btn btn-primary"
                        disabled={isBusy || !(refInputs[w.id] ?? '').trim()}
                        onClick={() => void handleComplete(w)}
                      >
                        <CheckCircle size={14} />
                        {isBusy ? '...' : 'Done'}
                      </button>
                    </div>

                    {/* Secondary actions */}
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        className="btn btn-ghost btn-sm"
                        style={{ flex: 1 }}
                        disabled={isBusy}
                        onClick={() => void handleRelease(w.id)}
                      >
                        <Undo2 size={13} /> Release
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        style={{ flex: 1, color: 'var(--danger)' }}
                        disabled={isBusy}
                        onClick={() => setShowRejectForm(showRejectForm === w.id ? null : w.id)}
                      >
                        <X size={13} /> Reject
                      </button>
                    </div>

                    {/* Reject form */}
                    <AnimatePresence>
                      {showRejectForm === w.id && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          style={{ overflow: 'hidden' }}
                        >
                          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                            <div style={{ fontSize: 12, color: 'var(--danger)', marginBottom: 8 }}>
                              Reason (min 15 chars):
                            </div>
                            <div style={{ display: 'flex', gap: 8 }}>
                              <input
                                className="input"
                                placeholder="Rejection reason…"
                                value={rejectRemarks[w.id] ?? ''}
                                onChange={(e) => setRejectRemarks((prev) => ({ ...prev, [w.id]: e.target.value }))}
                                disabled={isBusy}
                                style={{ flex: 1 }}
                              />
                              <button
                                className="btn btn-sm"
                                style={{ background: 'var(--danger)', color: '#fff', border: 'none' }}
                                disabled={isBusy || (rejectRemarks[w.id] ?? '').trim().length < 15}
                                onClick={() => void handleReject(w)}
                              >
                                {isBusy ? '...' : 'Reject'}
                              </button>
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </motion.article>
              );
            })}
          </div>
        )}
      </div>

      {/* Pending pool — collapsible */}
      <div style={{
        background: 'var(--card-bg)',
        border: '1px solid var(--border)',
        borderRadius: 14,
        overflow: 'hidden',
      }}>
        <button
          type="button"
          onClick={() => setShowPool((o) => !o)}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '14px 16px', background: 'none', border: 'none', cursor: 'pointer',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Clock size={15} style={{ color: 'var(--text-muted)' }} />
            <span style={{ fontWeight: 600, fontSize: 14 }}>
              Pending Pool
            </span>
            {available.length > 0 && (
              <span style={{
                background: '#f59e0b22', color: '#f59e0b', border: '1px solid #f59e0b44',
                fontSize: 10, padding: '1px 6px', borderRadius: 99, fontWeight: 700,
              }}>{available.length}</span>
            )}
          </div>
          {showPool ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
        </button>

        <AnimatePresence initial={false}>
          {showPool && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              style={{ overflow: 'hidden' }}
            >
              <div style={{ padding: '0 12px 12px' }}>
                {available.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--text-muted)', fontSize: 13 }}>
                    No pending withdrawals right now.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {available.map((w) => {
                      const net = netAmount(w.amountMinor);
                      const isBusy = busy[w.id] ?? false;
                      return (
                        <div key={w.id} style={{
                          background: 'var(--surface)',
                          borderRadius: 12,
                          padding: 12,
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          gap: 10,
                        }}>
                          <div>
                            <div style={{ fontWeight: 600, fontSize: 13 }}>#{w.id.slice(-6)}</div>
                            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                              {w.destinationAccount} · {formatCredits(w.amountMinor)} ETB
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                              You send: {formatCreditsFull(net)}
                            </div>
                          </div>
                          <button
                            className="btn btn-primary btn-sm"
                            disabled={isBusy}
                            onClick={() => void handleClaim(w.id)}
                            style={{ flexShrink: 0 }}
                          >
                            <Send size={12} />
                            {isBusy ? '...' : 'Claim'}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
