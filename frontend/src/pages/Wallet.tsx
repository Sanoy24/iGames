import { useCallback, useEffect, useState } from 'react';
import type { LedgerEntry } from '../lib/models';
import { formatCredits, useStore } from '../store/useStore';
import { formatCreditsFull, getErrorMessage, titleCase } from '../lib/utils';

function formatLedgerTitle(entry: LedgerEntry): string {
  const entryType = titleCase(entry.entryType);
  const sourceType = titleCase(entry.sourceType);
  return `${entryType} · ${sourceType}`;
}

export function Wallet() {
  const wallet = useStore((state) => state.wallet);
  const setWallet = useStore((state) => state.setWallet);
  const addToast = useStore((state) => state.addToast);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const [showTopup, setShowTopup] = useState(false);
  const [receiptInput, setReceiptInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const loadWallet = useCallback(async () => {
    try {
      const { walletApi } = await import('../lib/api');
      const [nextWallet, nextLedger] = await Promise.all([
        walletApi.getWallet(),
        walletApi.getLedger(30),
      ]);
      setWallet(nextWallet);
      setLedger(nextLedger);
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

  return (
    <div className="stack-lg">
      <section className="card wallet-hero">
        <div className="badge badge-green">Wallet</div>
        <h1 className="hero-title">{formatCredits(wallet?.availableMinor ?? 0)} Credits</h1>
        <p className="hero-copy">
          Your wallet is the shared balance source for Keno stakes, Bingo tickets, deposits, and wins.
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
            <strong>{wallet?.status ?? 'loading'}</strong>
          </div>
        </div>
        
        <button 
          className="btn btn-primary" 
          onClick={() => setShowTopup(!showTopup)}
        >
          {showTopup ? '✕ Cancel Top-Up' : '↑ Top Up with Telebirr'}
        </button>

        {showTopup && (
          <div className="admin-form" style={{ marginTop: 16, backgroundColor: 'rgba(0,0,0,0.2)' }}>
            <h3 style={{ margin: '0 0 8px', fontSize: 16 }}>Telebirr Manual Deposit</h3>
            <p className="text-muted" style={{ fontSize: 13, marginBottom: 16 }}>
              Transfer the desired amount via your Telebirr app. Then paste the confirmation SMS message or Receipt URL here to instantly credit your account.
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
      </section>

      <section className="card">
        <div className="section-header">
          <div>
            <div className="section-title">Recent Ledger</div>
            <p className="section-copy">Immutable financial activity from the backend ledger.</p>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => void loadWallet()}>
            Refresh
          </button>
        </div>

        {loading && ledger.length === 0 ? (
          <div className="card-muted">Loading wallet activity...</div>
        ) : ledger.length === 0 ? (
          <div className="card-muted">No ledger entries yet.</div>
        ) : (
          <div className="list-stack">
            {ledger.map((entry) => (
              <article key={entry.id} className="list-card">
                <div className="list-card-header">
                  <div>
                    <h3>{formatLedgerTitle(entry)}</h3>
                    <p>{entry.sourceId}</p>
                  </div>
                  <span className={`badge ${entry.direction === 'credit' ? 'badge-green' : 'badge-red'}`}>
                    {entry.direction === 'credit' ? '+' : '-'}
                    {formatCredits(entry.amountMinor)}
                  </span>
                </div>
                <div className="ticket-meta">
                  <span>Balance After: {formatCreditsFull(entry.balanceAfterMinor)}</span>
                  <span>Type: {entry.entryType}</span>
                  <span>Source: {entry.sourceType}</span>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
