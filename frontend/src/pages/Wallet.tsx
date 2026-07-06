import { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence, useMotionValue, useSpring } from 'framer-motion';
import { ArrowUpRight, ArrowDownLeft, ArrowUpToLine, ArrowDownToLine, CheckCircle, X, RefreshCw, Wallet as WalletIcon, TrendingUp, Search, Phone, User as UserIcon, Copy } from 'lucide-react';
import type { LedgerEntry, Withdrawal } from '../lib/models';
import { useStore } from '../store/useStore';
import { formatCreditsFull, getErrorMessage } from '../lib/utils';
import { authApi, walletApi, paymentsApi, type TelebirrPreview, type ActiveAgent } from '../lib/api';

// Keys are the backend ledger `entryType` values
// (see LedgerEntryType: stake | win | refund | adjustment | bonus | deposit |
//  reversal | withdrawal | agent_receipt).
const ENTRY_LABELS: Record<string, string> = {
  stake: 'Ticket Purchase',
  win: 'Winnings',
  refund: 'Refund',
  deposit: 'Deposit',
  withdrawal: 'Withdrawal',
  bonus: 'Bonus ETB',
  adjustment: 'Balance Adjustment',
  agent_receipt: 'Agent Transfer',
  reversal: 'Reversal',
};

type TxFilter = 'all' | 'wins' | 'purchases' | 'deposits';

const TX_FILTERS: { id: TxFilter; label: string; icon: string }[] = [
  { id: 'all',       label: 'All',       icon: '📋' },
  { id: 'wins',      label: 'Wins',      icon: '🏆' },
  { id: 'purchases', label: 'Purchases', icon: '🎟' },
  { id: 'deposits',  label: 'Deposits',  icon: '💰' },
];

function formatLedgerTitle(entry: LedgerEntry): string {
  return ENTRY_LABELS[entry.entryType] ?? ENTRY_LABELS[entry.sourceType] ?? 'Transaction';
}

function matchesTxFilter(entry: LedgerEntry, filter: TxFilter): boolean {
  if (filter === 'all') return true;
  const type = entry.entryType ?? entry.sourceType ?? '';
  if (filter === 'wins')      return type === 'win' || type === 'bonus';
  if (filter === 'purchases') return type === 'stake';
  if (filter === 'deposits')  return type === 'deposit' || type === 'agent_receipt';
  return true;
}

const WITHDRAW_PRESETS = [500, 1000, 5000, 10000];

function AnimatedBalance({ value }: { value: number }) {
  const mv     = useMotionValue(value);
  const spring = useSpring(mv, { stiffness: 80, damping: 18 });
  const [display, setDisplay] = useState(value);

  useEffect(() => { mv.set(value); }, [value, mv]);
  useEffect(() => spring.on('change', (v) => setDisplay(Math.round(v))), [spring]);

  return <>{new Intl.NumberFormat().format(display)}</>;
}

function DevTopup({ onSuccess }: { onSuccess: () => Promise<void> }) {
  const addToast = useStore((s) => s.addToast);
  const setWallet = useStore((s) => s.setWallet);
  const user = useStore((s) => s.user);
  const [loading, setLoading] = useState(false);

  const topup = async (amountMinor: number) => {
    if (!user?.id) return;
    setLoading(true);
    try {
      await authApi.devTopup(user.id, amountMinor);
      const w = await walletApi.getWallet();
      setWallet(w);
      await onSuccess();
      addToast('success', `Added ${amountMinor} ETB to your wallet.`);
    } catch (e) {
      addToast('error', getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ marginTop: 12, padding: '10px 12px', background: 'rgba(250,204,21,0.08)', border: '1px dashed rgba(250,204,21,0.3)', borderRadius: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', flex: 1 }}>DEV — add test ETB:</span>
      {[10, 100, 1000].map((amt) => (
        <button key={amt} className="btn btn-ghost" disabled={loading} onClick={() => topup(amt)}
          style={{ fontSize: '0.75rem', padding: '4px 10px', border: '1px solid rgba(250,204,21,0.4)' }}>
          +{amt}
        </button>
      ))}
    </div>
  );
}

const staggerList = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05 } },
};
const listItem = {
  hidden: { opacity: 0, x: -8 },
  show:   { opacity: 1, x: 0, transition: { type: 'spring' as const, stiffness: 300, damping: 28 } },
};

export function Wallet() {
  const wallet    = useStore((state) => state.wallet);
  const setWallet = useStore((state) => state.setWallet);
  const addToast  = useStore((state) => state.addToast);
  const [ledger,       setLedger]       = useState<LedgerEntry[]>([]);
  const [withdrawals,  setWithdrawals]  = useState<Withdrawal[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [txFilter,     setTxFilter]     = useState<TxFilter>('all');

  const [showTopup,      setShowTopup]      = useState(false);
  const [receiptInput,   setReceiptInput]   = useState('');
  const [isPreviewing,   setIsPreviewing]   = useState(false);
  const [preview,        setPreview]        = useState<TelebirrPreview | null>(null);
  const [isSubmitting,   setIsSubmitting]   = useState(false);
  const [activeAgent,    setActiveAgent]    = useState<ActiveAgent | null>(null);
  const [agentLoading,   setAgentLoading]   = useState(false);

  const [showWithdraw,   setShowWithdraw]   = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawPhone,  setWithdrawPhone]  = useState('');
  const [isWithdrawing,  setIsWithdrawing]  = useState(false);

  const loadWallet = useCallback(async () => {
    try {
      const [nextWallet, nextLedger, nextWithdrawals] = await Promise.all([
        walletApi.getWallet(),
        walletApi.getLedger(30),
        walletApi.getWithdrawals(),
      ]);
      setWallet(nextWallet);
      setLedger(nextLedger);
      setWithdrawals(nextWithdrawals);
    } catch (error) {
      addToast('error', getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [addToast, setWallet]);

  useEffect(() => { void loadWallet(); }, [loadWallet]);

  const toggleTopup = () => {
    setShowTopup((open) => {
      const next = !open;
      if (next) {
        setShowWithdraw(false);
        setAgentLoading(true);
        paymentsApi.getActiveAgent()
          .then(setActiveAgent)
          .catch(() => setActiveAgent(null))
          .finally(() => setAgentLoading(false));
      } else {
        resetTopup();
      }
      return next;
    });
  };

  const handlePreview = async () => {
    if (!receiptInput.trim()) return;
    setIsPreviewing(true);
    setPreview(null);
    try {
      const result = await paymentsApi.previewTelebirrReceipt(receiptInput.trim());
      setPreview(result);
    } catch (e) {
      addToast('error', getErrorMessage(e));
    } finally {
      setIsPreviewing(false);
    }
  };

  const handleTopup = async () => {
    if (!receiptInput.trim()) return;
    setIsSubmitting(true);
    try {
      await paymentsApi.submitTelebirrReceipt(receiptInput.trim());
      addToast('success', 'Deposit confirmed! Your account has been credited.');
      setReceiptInput('');
      setPreview(null);
      setShowTopup(false);
      await loadWallet();
    } catch (e) {
      addToast('error', getErrorMessage(e));
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetTopup = () => {
    setReceiptInput('');
    setPreview(null);
  };

  const handleWithdraw = async () => {
    const credits = parseFloat(withdrawAmount);
    if (isNaN(credits) || credits <= 0) { addToast('error', 'Please enter a valid amount'); return; }
    const amountMinor = Math.round(credits);
    const available   = wallet?.availableMinor ?? 0;
    if (amountMinor > available) {
      addToast('error', `Insufficient balance — available: ${new Intl.NumberFormat().format(available)} ETB`);
      return;
    }
    if (!withdrawPhone.trim()) { addToast('error', 'Please enter your Telebirr phone number'); return; }
    setIsWithdrawing(true);
    try {
      await walletApi.requestWithdrawal(amountMinor, withdrawPhone.trim());
      addToast('success', 'Withdrawal request submitted!');
      setWithdrawAmount('');
      setWithdrawPhone('');
      setShowWithdraw(false);
      await loadWallet();
    } catch (e) {
      addToast('error', getErrorMessage(e));
    } finally {
      setIsWithdrawing(false);
    }
  };

  const filteredLedger = ledger.filter(e => matchesTxFilter(e, txFilter));
  const available = wallet?.availableMinor ?? 0;

  return (
    <motion.div
      className="stack-lg"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 28 }}
    >
      {/* ── Balance hero ── */}
      <motion.section
        className="card"
        style={{ background: 'linear-gradient(135deg, rgba(250,204,21,0.06) 0%, rgba(139,92,246,0.04) 100%)', border: '1px solid rgba(250,204,21,0.12)' }}
        initial={{ scale: 0.97, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 280, damping: 24 }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <div className="badge badge-gold" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <WalletIcon size={11} /> Wallet
          </div>
          {wallet?.status === 'active' && (
            <span style={{ fontSize: 10, color: 'var(--green)', fontWeight: 700 }}>● Active</span>
          )}
        </div>

        <div className="jackpot-value" style={{ fontSize: '2.2rem', margin: '8px 0 4px' }}>
          <AnimatedBalance value={available} />
          <span style={{ fontSize: '1rem', marginLeft: 6, color: 'var(--text-muted)', fontWeight: 600 }}>ETB</span>
        </div>

        <div className="stats-grid" style={{ marginBottom: 16 }}>
          <div className="stat-card">
            <span className="stat-label">Available</span>
            <strong>{formatCreditsFull(wallet?.availableMinor ?? 0)}</strong>
          </div>
          <div className="stat-card">
            <span className="stat-label">Reserved</span>
            <strong>{formatCreditsFull(wallet?.reservedMinor ?? 0)}</strong>
          </div>
          <div className="stat-card">
            <span className="stat-label">Status</span>
            <strong style={{ textTransform: 'capitalize', color: wallet?.status === 'active' ? 'var(--green)' : 'var(--danger)' }}>
              {wallet?.status ?? '—'}
            </strong>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <motion.button
            className="btn btn-primary"
            onClick={toggleTopup}
            style={{ flex: 1, minWidth: 140 }}
            whileTap={{ scale: 0.96 }}
          >
            {showTopup ? <><X size={15} /> Cancel</> : <><ArrowUpToLine size={15} /> Deposit</>}
          </motion.button>
          <motion.button
            className="btn btn-secondary"
            onClick={() => { setShowWithdraw(v => !v); setShowTopup(false); }}
            style={{ flex: 1, minWidth: 140 }}
            whileTap={{ scale: 0.96 }}
          >
            {showWithdraw ? <><X size={15} /> Cancel</> : <><ArrowDownToLine size={15} /> Withdraw</>}
          </motion.button>
        </div>

        {import.meta.env.DEV && <DevTopup onSuccess={loadWallet} />}

        {/* ── Topup form ── */}
        <AnimatePresence initial={false}>
          {showTopup && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.22 }}
              style={{ overflow: 'hidden' }}
            >
              <div className="admin-form" style={{ marginTop: 16 }}>
                <h3 style={{ margin: '0 0 6px', fontSize: 16 }}>Telebirr Deposit</h3>
                <p className="text-muted" style={{ fontSize: 13, marginBottom: 14 }}>
                  Send your Telebirr transfer to the agent below, then paste your SMS confirmation message or the receipt link.
                </p>

                {/* Active agent — where to send the Telebirr transfer */}
                {agentLoading ? (
                  <div className="card-muted" style={{ marginBottom: 14, fontSize: 13 }}>
                    <RefreshCw size={13} style={{ animation: 'spin 1s linear infinite', marginRight: 6, verticalAlign: 'middle' }} />
                    Finding the agent on duty…
                  </div>
                ) : activeAgent ? (
                  <div style={{
                    background: 'rgba(250,204,21,0.07)',
                    border: '1px solid rgba(250,204,21,0.25)',
                    borderRadius: 10,
                    padding: '14px 16px',
                    marginBottom: 14,
                  }}>
                    <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: 10 }}>
                      Send Telebirr to
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <UserIcon size={14} style={{ color: 'var(--gold)' }} />
                      <strong style={{ fontSize: 14 }}>{activeAgent.displayName}</strong>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Phone size={14} style={{ color: 'var(--gold)' }} />
                      {activeAgent.phoneNumber ? (
                        <>
                          <strong style={{ fontSize: 15, letterSpacing: '0.02em' }}>{activeAgent.phoneNumber}</strong>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => {
                              void navigator.clipboard?.writeText(activeAgent.phoneNumber!);
                              addToast('success', 'Phone number copied');
                            }}
                            style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4, padding: '3px 8px' }}
                          >
                            <Copy size={12} /> Copy
                          </button>
                        </>
                      ) : (
                        <span className="text-muted" style={{ fontSize: 13 }}>No phone number on file</span>
                      )}
                    </div>
                  </div>
                ) : (
                  <div style={{
                    background: 'rgba(239,68,68,0.07)',
                    border: '1px solid rgba(239,68,68,0.25)',
                    borderRadius: 10,
                    padding: '12px 14px',
                    marginBottom: 14,
                    fontSize: 13,
                    color: 'var(--danger)',
                  }}>
                    No agent is on duty right now. Please try again shortly before sending your deposit.
                  </div>
                )}

                {/* Step 1 — paste & verify */}
                {!preview && (
                  <>
                    <textarea
                      className="input"
                      rows={4}
                      placeholder="Paste your Telebirr SMS message or receipt link…"
                      value={receiptInput}
                      onChange={(e) => { setReceiptInput(e.target.value); }}
                      style={{ width: '100%', marginBottom: 12, resize: 'vertical' }}
                    />
                    <button
                      className="btn btn-primary btn-full"
                      onClick={handlePreview}
                      disabled={isPreviewing || !receiptInput.trim()}
                    >
                      {isPreviewing
                        ? <><RefreshCw size={14} style={{ animation: 'spin 1s linear infinite' }} /> Fetching receipt…</>
                        : <><Search size={14} /> Verify Receipt</>}
                    </button>
                  </>
                )}

                {/* Step 2 — confirm details */}
                {preview && (
                  <motion.div
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ type: 'spring', stiffness: 300, damping: 26 }}
                  >
                    <div style={{
                      background: 'rgba(16,185,129,0.07)',
                      border: '1px solid rgba(16,185,129,0.25)',
                      borderRadius: 10,
                      padding: '14px 16px',
                      marginBottom: 14,
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}>
                        <CheckCircle size={15} color="#10b981" />
                        <span style={{ fontSize: 13, fontWeight: 700, color: '#10b981' }}>Receipt Verified</span>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto' }}>#{preview.receiptNo}</span>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px', fontSize: 12 }}>
                        <div>
                          <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Amount</span>
                          <strong style={{ fontSize: 18, color: '#10b981' }}>{formatCreditsFull(preview.amountMinor)} ETB</strong>
                        </div>
                        {preview.payerName && (
                          <div>
                            <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>From</span>
                            <strong>{preview.payerName}</strong>
                          </div>
                        )}
                        {preview.payerPhone && (
                          <div>
                            <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Phone</span>
                            <strong>{preview.payerPhone}</strong>
                          </div>
                        )}
                        {preview.receiverName && (
                          <div>
                            <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>To (Agent)</span>
                            <strong>{preview.receiverName}</strong>
                          </div>
                        )}
                        {preview.date && (
                          <div>
                            <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Date</span>
                            <strong>{new Date(preview.date).toLocaleString()}</strong>
                          </div>
                        )}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        className="btn btn-secondary"
                        onClick={resetTopup}
                        style={{ flex: 1 }}
                      >
                        <X size={13} /> Change
                      </button>
                      <button
                        className="btn btn-success"
                        onClick={handleTopup}
                        disabled={isSubmitting}
                        style={{ flex: 2 }}
                      >
                        {isSubmitting
                          ? <><RefreshCw size={13} style={{ animation: 'spin 1s linear infinite' }} /> Processing…</>
                          : <><CheckCircle size={13} /> Confirm Deposit</>}
                      </button>
                    </div>
                  </motion.div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Withdraw form ── */}
        <AnimatePresence initial={false}>
          {showWithdraw && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.22 }}
              style={{ overflow: 'hidden' }}
            >
              <div className="admin-form" style={{ marginTop: 16 }}>
                <h3 style={{ margin: '0 0 4px', fontSize: 16 }}>Telebirr Cashout Request</h3>
                <p style={{ fontSize: 12, color: 'var(--green)', margin: '0 0 12px' }}>
                  Available: <strong>{new Intl.NumberFormat().format(available)} ETB</strong>
                </p>

                <div className="preset-amounts" style={{ marginBottom: 12 }}>
                  {WITHDRAW_PRESETS.filter(p => p <= available).map(preset => (
                    <motion.button
                      key={preset}
                      className="preset-amount"
                      onClick={() => setWithdrawAmount(String(preset))}
                      type="button"
                      whileTap={{ scale: 0.9 }}
                      style={withdrawAmount === String(preset)
                        ? { borderColor: 'var(--gold)', color: 'var(--gold)', background: 'rgba(250,204,21,0.1)' }
                        : {}}
                    >
                      {new Intl.NumberFormat().format(preset)}
                    </motion.button>
                  ))}
                  {available > 0 && (
                    <motion.button
                      className="preset-amount"
                      onClick={() => setWithdrawAmount(String(available))}
                      type="button"
                      whileTap={{ scale: 0.9 }}
                      style={withdrawAmount === String(available)
                        ? { borderColor: 'var(--green)', color: 'var(--green)', background: 'rgba(16,185,129,0.1)' }
                        : { borderColor: 'rgba(16,185,129,0.35)', color: 'var(--green)' }}
                    >
                      All ({new Intl.NumberFormat().format(available)})
                    </motion.button>
                  )}
                </div>

                <div style={{ marginBottom: 12 }}>
                  <label style={{ display: 'block', fontSize: 13, marginBottom: 4 }}>Amount (ETB)</label>
                  <input
                    type="number" step="1" min="1" max={available}
                    className="input"
                    placeholder={`e.g. ${Math.floor(available / 2)}`}
                    value={withdrawAmount}
                    onChange={(e) => setWithdrawAmount(e.target.value)}
                    style={{ width: '100%' }}
                  />
                </div>
                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: 'block', fontSize: 13, marginBottom: 4 }}>Telebirr Phone Number</label>
                  <input
                    type="tel" className="input"
                    placeholder="e.g. 0912345678"
                    value={withdrawPhone}
                    onChange={(e) => setWithdrawPhone(e.target.value)}
                    style={{ width: '100%' }}
                  />
                </div>
                <button
                  className="btn btn-success btn-full"
                  onClick={handleWithdraw}
                  disabled={isWithdrawing || !withdrawAmount || !withdrawPhone.trim()}
                >
                  {isWithdrawing ? 'Submitting…' : 'Submit Withdrawal Request'}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.section>

      {/* ── Withdrawal requests ── */}
      <AnimatePresence>
        {withdrawals.length > 0 && (
          <motion.section
            className="card"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            <div className="section-header">
              <div>
                <div className="section-title">Withdrawal Requests</div>
                <p className="section-copy">Track your Telebirr cashout requests.</p>
              </div>
            </div>
            <motion.div className="list-stack" variants={staggerList} initial="hidden" animate="show">
              {withdrawals.map((w) => (
                <motion.article key={w.id} className="list-card" variants={listItem}>
                  <div className="list-card-header">
                    <div>
                      <h3>Telebirr Cashout</h3>
                      <p style={{ margin: '4px 0 0', fontSize: 13 }}>Phone: {w.destinationAccount}</p>
                      {w.adminNotes && (
                        <p style={{ color: 'var(--yellow-1)', fontSize: 12, marginTop: 4 }}>Note: {w.adminNotes}</p>
                      )}
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <span className="badge" style={{ display: 'block', marginBottom: 4 }}>
                        {new Intl.NumberFormat().format(w.amountMinor)} ETB
                      </span>
                      <span className={`badge ${
                        w.status === 'completed'  ? 'badge-green'  :
                        w.status === 'rejected'   ? 'badge-red'    :
                        w.status === 'processing' ? 'badge-violet' : 'badge-gold'
                      }`}>
                        {w.status === 'pending'    ? 'Pending'    :
                         w.status === 'processing' ? 'Processing' :
                         w.status === 'completed'  ? 'Completed'  :
                         w.status === 'rejected'   ? 'Rejected'   : w.status}
                      </span>
                    </div>
                  </div>
                  <div className="ticket-meta">
                    <span>Requested: {new Date(w.createdAt).toLocaleString()}</span>
                    {w.processedAt && <span>Processed: {new Date(w.processedAt).toLocaleString()}</span>}
                  </div>
                </motion.article>
              ))}
            </motion.div>
          </motion.section>
        )}
      </AnimatePresence>

      {/* ── Transaction history ── */}
      <motion.section
        className="card"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        <div className="section-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <TrendingUp size={16} style={{ color: 'var(--gold)' }} />
            <div>
              <div className="section-title">Transaction History</div>
              <p className="section-copy">Your balance activity and game results.</p>
            </div>
          </div>
          <motion.button
            className="btn btn-ghost btn-sm"
            onClick={() => void loadWallet()}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            whileTap={{ scale: 0.9, rotate: 180 }}
          >
            <RefreshCw size={13} /> Refresh
          </motion.button>
        </div>

        {/* Filter chips */}
        <div className="tx-filter-row" style={{ marginBottom: 12 }}>
          {TX_FILTERS.map(f => (
            <motion.button
              key={f.id}
              className={`tx-filter-chip${txFilter === f.id ? ' active' : ''}`}
              onClick={() => setTxFilter(f.id)}
              whileTap={{ scale: 0.9 }}
              style={{ position: 'relative', overflow: 'hidden' }}
            >
              <span style={{ marginRight: 4 }}>{f.icon}</span>
              {f.label}
              {txFilter === f.id && (
                <motion.span
                  layoutId="tx-pill"
                  style={{ position: 'absolute', inset: 0, borderRadius: 'inherit', background: 'rgba(250,204,21,0.08)', zIndex: -1 }}
                  transition={{ type: 'spring', stiffness: 340, damping: 26 }}
                />
              )}
            </motion.button>
          ))}
        </div>

        {loading && ledger.length === 0 ? (
          <div className="card-muted">Loading activity…</div>
        ) : filteredLedger.length === 0 ? (
          <motion.div className="card-muted" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            {txFilter === 'all' ? 'No activity yet. Play a game to get started.' : 'No transactions in this category.'}
          </motion.div>
        ) : (
          <motion.div
            className="list-stack"
            key={txFilter}
            variants={staggerList}
            initial="hidden"
            animate="show"
          >
            {filteredLedger.map((entry) => (
              <motion.article key={entry.id} className="list-card" variants={listItem}>
                <div className="list-card-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <motion.span
                      className={`ledger-icon ${entry.direction === 'credit' ? 'ledger-icon-credit' : 'ledger-icon-debit'}`}
                      whileHover={{ scale: 1.15 }}
                    >
                      {entry.direction === 'credit'
                        ? <ArrowDownLeft size={14} />
                        : <ArrowUpRight  size={14} />}
                    </motion.span>
                    <div>
                      <h3>{formatLedgerTitle(entry)}</h3>
                      {entry.createdAt && (
                        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                          {new Date(entry.createdAt).toLocaleString()}
                        </p>
                      )}
                    </div>
                  </div>
                  <motion.span
                    className={`badge ${entry.direction === 'credit' ? 'badge-green' : 'badge-red'}`}
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: 'spring', stiffness: 300, damping: 22 }}
                  >
                    {entry.direction === 'credit' ? '+' : '-'}
                    {new Intl.NumberFormat().format(entry.amountMinor)}
                  </motion.span>
                </div>
                <div className="ticket-meta">
                  <span>Balance after: {formatCreditsFull(entry.balanceAfterMinor)}</span>
                </div>
              </motion.article>
            ))}
          </motion.div>
        )}
      </motion.section>
    </motion.div>
  );
}
