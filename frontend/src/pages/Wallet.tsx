import { useCallback, useEffect, useState } from 'react';
import { ArrowUpRight, ArrowDownLeft, ArrowUpToLine, ArrowDownToLine, X, RefreshCw } from 'lucide-react';
import type { LedgerEntry, Withdrawal } from '../lib/models';
import { useStore } from '../store/useStore';
import { formatCreditsFull, getErrorMessage } from '../lib/utils';
import { authApi, walletApi, paymentsApi } from '../lib/api';

const ENTRY_LABELS: Record<string, string> = {
  ticket_purchase: 'Ticket Purchase',
  ticket_win: 'Winnings',
  ticket_refund: 'Ticket Refund',
  deposit: 'Deposit',
  withdrawal: 'Withdrawal',
  bonus: 'Bonus Credit',
  admin_adjustment: 'Balance Adjustment',
  agent_receipt: 'Agent Transfer',
  reserve: 'Hold',
  release: 'Hold Released',
};

function formatLedgerTitle(entry: LedgerEntry): string {
  return ENTRY_LABELS[entry.entryType] ?? ENTRY_LABELS[entry.sourceType] ?? 'Transaction';
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
      addToast('success', `Added ${amountMinor / 100} credits to your wallet.`);
    } catch (e) {
      addToast('error', getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ marginTop: 12, padding: '10px 12px', background: 'rgba(250,204,21,0.08)', border: '1px dashed rgba(250,204,21,0.3)', borderRadius: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', flex: 1 }}>DEV — add test credits:</span>
      {[1000, 10000, 100000].map((amt) => (
        <button key={amt} className="btn btn-ghost" disabled={loading} onClick={() => topup(amt)}
          style={{ fontSize: '0.75rem', padding: '4px 10px', border: '1px solid rgba(250,204,21,0.4)' }}>
          +{amt / 100}
        </button>
      ))}
    </div>
  );
}

export function Wallet() {
  const wallet = useStore((state) => state.wallet);
  const setWallet = useStore((state) => state.setWallet);
  const addToast = useStore((state) => state.addToast);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [loading, setLoading] = useState(true);

  const [showTopup, setShowTopup] = useState(false);
  const [receiptInput, setReceiptInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [showWithdraw, setShowWithdraw] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawPhone, setWithdrawPhone] = useState('');
  const [isWithdrawing, setIsWithdrawing] = useState(false);

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

  useEffect(() => {
    void loadWallet();
  }, [loadWallet]);

  const handleTopup = async () => {
    if (!receiptInput.trim()) return;
    setIsSubmitting(true);
    try {
      await paymentsApi.submitTelebirrReceipt(receiptInput.trim());
      addToast('success', 'Telebirr receipt verified! Account credited.');
      setReceiptInput('');
      setShowTopup(false);
      await loadWallet();
    } catch (e) {
      addToast('error', getErrorMessage(e));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleWithdraw = async () => {
    const credits = parseFloat(withdrawAmount);
    if (isNaN(credits) || credits <= 0) {
      addToast('error', 'Please enter a valid amount');
      return;
    }
    // withdrawAmount is in e-Birr units (minor); user types the minor amount directly
    const amountMinor = Math.round(credits);
    const available = wallet?.availableMinor ?? 0;
    if (amountMinor > available) {
      addToast(
        'error',
        `Insufficient balance — your available balance is ${new Intl.NumberFormat().format(available)} e\u2011Birr`,
      );
      return;
    }
    if (!withdrawPhone.trim()) {
      addToast('error', 'Please enter your Telebirr phone number');
      return;
    }

    setIsWithdrawing(true);
    try {
      await walletApi.requestWithdrawal(amountMinor, withdrawPhone.trim());
      addToast('success', 'Withdrawal request submitted successfully!');
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

  return (
    <div className="stack-lg">
      <section className="card wallet-hero">
        <div className="badge badge-green">Wallet</div>
        <h1 className="hero-title">{new Intl.NumberFormat().format(wallet?.availableMinor ?? 0)} e‑Birr</h1>
        <p className="hero-copy">
          Your balance is shared across Keno stakes, Bingo tickets, deposits, and winnings.
        </p>
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
            <strong style={{ textTransform: 'capitalize' }}>{wallet?.status ?? 'loading'}</strong>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            className="btn btn-primary"
            onClick={() => { setShowTopup(!showTopup); setShowWithdraw(false); }}
            style={{ flex: 1, minWidth: 140 }}
          >
            {showTopup ? <><X size={15} /> Cancel</> : <><ArrowUpToLine size={15} /> Top Up</>}
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => { setShowWithdraw(!showWithdraw); setShowTopup(false); }}
            style={{ flex: 1, minWidth: 140 }}
          >
            {showWithdraw ? <><X size={15} /> Cancel</> : <><ArrowDownToLine size={15} /> Payout</>}
          </button>
        </div>

        {import.meta.env.DEV && <DevTopup onSuccess={loadWallet} />}

        {showTopup && (
          <div className="admin-form" style={{ marginTop: 16, backgroundColor: 'rgba(0,0,0,0.2)' }}>
            <h3 style={{ margin: '0 0 8px', fontSize: 16 }}>Telebirr Manual Deposit</h3>
            <p className="text-muted" style={{ fontSize: 13, marginBottom: 16 }}>
              Transfer the desired amount via your Telebirr app. Then paste the confirmation SMS
              message or Receipt URL here to instantly credit your account.
            </p>
            <textarea
              className="input"
              rows={4}
              placeholder="Paste Telebirr SMS receipt..."
              value={receiptInput}
              onChange={(e) => setReceiptInput(e.target.value)}
              style={{ width: '100%', marginBottom: 16, resize: 'vertical' }}
            />
            <button
              className="btn btn-success btn-full"
              onClick={handleTopup}
              disabled={isSubmitting || !receiptInput.trim()}
            >
              {isSubmitting ? 'Verifying Receipt...' : 'Verify & Claim Deposit'}
            </button>
          </div>
        )}

        {showWithdraw && (
          <div className="admin-form" style={{ marginTop: 16, backgroundColor: 'rgba(0,0,0,0.2)' }}>
            <h3 style={{ margin: '0 0 8px', fontSize: 16 }}>Telebirr Cashout Request</h3>
            <p className="text-muted" style={{ fontSize: 13, marginBottom: 8 }}>
              Request to withdraw your available e‑Birr. The amount will be reserved immediately,
              and an agent will process the Telebirr transfer to your phone number.
            </p>
            <p style={{ fontSize: 12, color: 'var(--green)', marginBottom: 16 }}>
              Available: <strong>{new Intl.NumberFormat().format(wallet?.availableMinor ?? 0)} e&#x2011;Birr</strong>
            </p>
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', fontSize: 13, marginBottom: 4 }}>Amount (e‑Birr)</label>
              <input
                type="number"
                step="1"
                min="1"
                max={wallet?.availableMinor ?? undefined}
                className="input"
                placeholder={`e.g. ${Math.floor((wallet?.availableMinor ?? 1000) / 2)}`}
                value={withdrawAmount}
                onChange={(e) => setWithdrawAmount(e.target.value)}
                style={{ width: '100%' }}
              />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 13, marginBottom: 4 }}>Telebirr Phone Number</label>
              <input
                type="text"
                className="input"
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
              {isWithdrawing ? 'Submitting Request...' : 'Submit Withdrawal Request'}
            </button>
          </div>
        )}
      </section>

      {withdrawals.length > 0 && (
        <section className="card">
          <div className="section-header">
            <div>
              <div className="section-title">Withdrawal Requests</div>
              <p className="section-copy">Review the status of your Telebirr cashout requests.</p>
            </div>
          </div>
          <div className="list-stack">
            {withdrawals.map((w) => (
              <article key={w.id} className="list-card">
                <div className="list-card-header">
                  <div>
                    <h3>Telebirr Cashout</h3>
                    <p style={{ margin: '4px 0 0', fontSize: 13 }}>Phone: {w.destinationAccount}</p>
                    {w.adminNotes && (
                      <p style={{ color: 'var(--yellow-1)', fontSize: 12, marginTop: 4 }}>
                        Note: {w.adminNotes}
                      </p>
                    )}
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span className="badge" style={{ display: 'block', marginBottom: 4 }}>
                      {new Intl.NumberFormat().format(w.amountMinor)} e‑Birr
                    </span>
                    <span className={`badge ${
                      w.status === 'completed' ? 'badge-green' :
                      w.status === 'rejected' ? 'badge-red' :
                      w.status === 'processing' ? 'badge-violet' : 'badge-gold'
                    }`}>
                      {w.status === 'pending' ? 'Pending' :
                       w.status === 'processing' ? 'Processing' :
                       w.status === 'completed' ? 'Completed' :
                       w.status === 'rejected' ? 'Rejected' : w.status}
                    </span>
                  </div>
                </div>
                <div className="ticket-meta">
                  <span>Requested: {new Date(w.createdAt).toLocaleString()}</span>
                  {w.processedAt && <span>Processed: {new Date(w.processedAt).toLocaleString()}</span>}
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      <section className="card">
        <div className="section-header">
          <div>
            <div className="section-title">Recent Activity</div>
            <p className="section-copy">Your transactions and balance history.</p>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => void loadWallet()} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <RefreshCw size={13} /> Refresh
          </button>
        </div>

        {loading && ledger.length === 0 ? (
          <div className="card-muted">Loading activity...</div>
        ) : ledger.length === 0 ? (
          <div className="card-muted">No activity yet. Play a game to get started.</div>
        ) : (
          <div className="list-stack">
            {ledger.map((entry) => (
              <article key={entry.id} className="list-card">
                <div className="list-card-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span className={`ledger-icon ${entry.direction === 'credit' ? 'ledger-icon-credit' : 'ledger-icon-debit'}`}>
                      {entry.direction === 'credit'
                        ? <ArrowDownLeft size={14} />
                        : <ArrowUpRight size={14} />}
                    </span>
                    <div>
                      <h3>{formatLedgerTitle(entry)}</h3>
                      {entry.createdAt && (
                        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                          {new Date(entry.createdAt).toLocaleString()}
                        </p>
                      )}
                    </div>
                  </div>
                  <span className={`badge ${entry.direction === 'credit' ? 'badge-green' : 'badge-red'}`}>
                    {entry.direction === 'credit' ? '+' : '-'}
                    {new Intl.NumberFormat().format(entry.amountMinor)}
                  </span>
                </div>
                <div className="ticket-meta">
                  <span>Balance after: {formatCreditsFull(entry.balanceAfterMinor)}</span>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
