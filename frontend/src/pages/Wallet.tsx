import { useCallback, useEffect, useState } from 'react';
import { ArrowUpRight, ArrowDownLeft } from 'lucide-react';
import type { LedgerEntry, Withdrawal } from '../lib/models';
import { formatCredits, useStore } from '../store/useStore';
import { formatCreditsFull, getErrorMessage } from '../lib/utils';

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
      const { walletApi } = await import('../lib/api');
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
      const { paymentsApi } = await import('../lib/api');
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
    const amountMinor = Math.round(credits * 100);
    if (amountMinor > (wallet?.availableMinor ?? 0)) {
      addToast('error', 'Insufficient available balance');
      return;
    }
    if (!withdrawPhone.trim()) {
      addToast('error', 'Please enter your Telebirr phone number');
      return;
    }

    setIsWithdrawing(true);
    try {
      const { walletApi } = await import('../lib/api');
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
        <h1 className="hero-title">{formatCredits(wallet?.availableMinor ?? 0)} Credits</h1>
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
            style={{ flex: 1, minWidth: 160 }}
          >
            {showTopup ? '✕ Cancel Top-Up' : '↑ Top Up (Telebirr)'}
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => { setShowWithdraw(!showWithdraw); setShowTopup(false); }}
            style={{ flex: 1, minWidth: 160, backgroundColor: 'rgba(255,255,255,0.05)' }}
          >
            {showWithdraw ? '✕ Cancel Payout' : '↓ Request Payout'}
          </button>
        </div>

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
            <p className="text-muted" style={{ fontSize: 13, marginBottom: 16 }}>
              Request to withdraw your available credits. The amount will be reserved immediately,
              and an agent will process the Telebirr transfer to your phone number.
            </p>
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', fontSize: 13, marginBottom: 4 }}>Amount (Credits)</label>
              <input
                type="number"
                step="any"
                className="input"
                placeholder="e.g. 50"
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
                      {formatCredits(w.amountMinor)}
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
          <button className="btn btn-ghost btn-sm" onClick={() => void loadWallet()}>
            Refresh
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
                    {formatCredits(entry.amountMinor)}
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
