import { useCallback, useEffect, useState } from 'react';
import { CheckCircle, Clock, RefreshCw, Send, Undo2, Users } from 'lucide-react';
import { adminApi, agentApi } from '../lib/api';
import type { SystemConfig } from '../lib/api';
import type { Withdrawal } from '../lib/models';
import { formatCreditsFull, formatDateTime, getErrorMessage } from '../lib/utils';
import { formatCredits, useStore } from '../store/useStore';
import { getSocket } from '../hooks/useSocketConnection';

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
  const [config, setConfig] = useState<SystemConfig | null>(null);
  const [loading, setLoading] = useState(true);

  // per-withdrawal state for the complete form
  const [refInputs, setRefInputs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    try {
      const [avail, my, cfg] = await Promise.all([
        agentApi.getAvailableWithdrawals(),
        agentApi.getMyWithdrawals(),
        adminApi.getConfig(),
      ]);
      setAvailable(avail);
      setMine(my);
      setConfig(cfg);
    } catch (err) {
      addToast('error', getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    void load();

    const socket = getSocket();
    if (socket) {
      const handlePending = () => {
        void load();
        addToast('info', 'New withdrawal request arrived.');
      };
      socket.on('withdrawal.pending', handlePending);
      return () => { socket.off('withdrawal.pending', handlePending); };
    }
  }, [load, addToast]);

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
          <div className="stats-grid">
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
                    </div>
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
