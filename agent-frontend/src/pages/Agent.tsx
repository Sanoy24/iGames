import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle, ChevronDown, ChevronUp, Clock, LifeBuoy, MapPin, RefreshCw, Send, Undo2, Users, Wallet as WalletIcon, X } from 'lucide-react';
import { agentApi, walletApi, type AgentSelfPerformance, type AgentDashboardSummary } from '../lib/api';
import { SupportConsole } from '../components/SupportConsole';
import { AreaPlayerList, PlayerDrillDown, ReferralCard } from '../components/AgentAreaViews';
import { AgentSettlementsView } from '../components/AgentSettlementsView';
import type { Wallet, Withdrawal, LedgerEntry } from '../lib/models';
import { formatCreditsFull, formatDateTime, getErrorMessage } from '../lib/utils';
import { formatCredits, useStore } from '../store/useStore';

const STATUS_BADGE: Record<string, string> = {
  pending: 'badge-gold',
  claimed: 'badge-violet',
  awaiting_verification: 'badge-indigo',
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
  const { t } = useTranslation();
  const addToast = useStore((s) => s.addToast);

  const [available, setAvailable] = useState<Withdrawal[]>([]);
  const [mine, setMine] = useState<Withdrawal[]>([]);
  const [config, setConfig] = useState<{ withdrawalFeeRanges: Array<{ minAmountMinor: number; maxAmountMinor: number | null; feeMinor: number }> } | null>(null);
  const [agentWallet, setAgentWallet] = useState<Wallet | null>(null);
  const [perf, setPerf] = useState<AgentSelfPerformance | null>(null);
  const [dashboard, setDashboard] = useState<AgentDashboardSummary | null>(null);
  const [_ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [_withdrawalHistory, setWithdrawalHistory] = useState<Withdrawal[]>([]);
  const [loading, setLoading] = useState(true);

  const [refInputs, setRefInputs] = useState<Record<string, string>>({});
  // Per-withdrawal payout rail the agent used; defaults to Telebirr.
  const [proofProvider, setProofProvider] = useState<Record<string, 'telebirr' | 'mpesa'>>({});
  const [receiptFiles, setReceiptFiles] = useState<Record<string, File>>({});
  const [transferCompletedAtInputs, setTransferCompletedAtInputs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [rejectRemarks, setRejectRemarks] = useState<Record<string, string>>({});
  const [showRejectForm, setShowRejectForm] = useState<string | null>(null);
  const [showPool, setShowPool] = useState(false);
  const [view, setView] = useState<'withdrawals' | 'area' | 'settlements' | 'support'>('withdrawals');
  const [selectedAreaPlayer, setSelectedAreaPlayer] = useState<string | null>(null);

  const [transferPhone, setTransferPhone] = useState('');
  const [transferAmount, setTransferAmount] = useState('');
  const [submittingTransfer, setSubmittingTransfer] = useState(false);
  const [requestingSettlement, setRequestingSettlement] = useState(false);

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
      agentApi.getPerformance().then(setPerf).catch(() => undefined);
      agentApi.getDashboard().then(setDashboard).catch(() => undefined);
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

  const handleRequestSettlement = async () => {
    setRequestingSettlement(true);
    try {
      await agentApi.requestSettlement();
      addToast('success', t('agent.settlementRequested', { defaultValue: 'Settlement requested — an admin will review it shortly.' }));
      agentApi.getDashboard().then(setDashboard).catch(() => undefined);
    } catch (err) {
      addToast('error', getErrorMessage(err));
    } finally {
      setRequestingSettlement(false);
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

  const nowLocalInputValue = () => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const handleComplete = async (w: Withdrawal) => {
    const provider = proofProvider[w.id] ?? 'telebirr';
    const proof = (refInputs[w.id] ?? '').trim();
    const minLen = provider === 'mpesa' ? 20 : 6;
    if (proof.length < minLen) {
      addToast('info', provider === 'mpesa'
        ? 'Paste the full M-Pesa confirmation SMS.'
        : 'Enter the Telebirr receipt number or link.');
      return;
    }
    const receiptFile = receiptFiles[w.id];
    if (!receiptFile) {
      addToast('info', 'Attach a photo or PDF of the payout receipt.');
      return;
    }
    const transferCompletedAtLocal = transferCompletedAtInputs[w.id] || nowLocalInputValue();
    setBusyFor(w.id, true);
    try {
      const { fileUrl } = await agentApi.uploadWithdrawalReceipt(receiptFile);
      await agentApi.completeWithdrawal(w.id, provider, proof, fileUrl, new Date(transferCompletedAtLocal).toISOString());
      await load();
      addToast('success', 'Payout proof submitted — awaiting admin verification.');
    } catch (err) {
      addToast('error', getErrorMessage(err));
    } finally {
      setBusyFor(w.id, false);
    }
  };

  // The agent keeps 100% of the flat fee — no platform split.
  const feeOf = (gross: number): number => {
    const match = config?.withdrawalFeeRanges.find(
      (r) => gross >= r.minAmountMinor && (r.maxAmountMinor === null || gross <= r.maxAmountMinor),
    );
    return match ? match.feeMinor : 0;
  };
  const netAmount = (gross: number) => gross - feeOf(gross);

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div style={{ maxWidth: 520, margin: '0 auto', padding: '12px 12px 80px' }}>

      {/* View toggle: Withdrawals ↔ My Area ↔ Support */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        <button className={`btn btn-sm ${view === 'withdrawals' ? 'btn-primary' : 'btn-ghost'}`} style={{ flex: 1 }} onClick={() => setView('withdrawals')}>
          <WalletIcon size={14} /> {t('agent.withdrawalsTab')}
        </button>
        <button className={`btn btn-sm ${view === 'area' ? 'btn-primary' : 'btn-ghost'}`} style={{ flex: 1 }} onClick={() => setView('area')}>
          <MapPin size={14} /> {t('agent.areaTab', { defaultValue: 'My Area' })}
        </button>
        <button className={`btn btn-sm ${view === 'settlements' ? 'btn-primary' : 'btn-ghost'}`} style={{ flex: 1 }} onClick={() => setView('settlements')}>
          <Clock size={14} /> {t('agent.settlementsTab', { defaultValue: 'Settlements' })}
        </button>
        <button className={`btn btn-sm ${view === 'support' ? 'btn-primary' : 'btn-ghost'}`} style={{ flex: 1 }} onClick={() => setView('support')}>
          <LifeBuoy size={14} /> {t('agent.supportTab')}
        </button>
      </div>

      {view === 'support' && <SupportConsole />}

      {view === 'settlements' && <AgentSettlementsView />}

      {view === 'area' && (
        selectedAreaPlayer
          ? <PlayerDrillDown userId={selectedAreaPlayer} onBack={() => setSelectedAreaPlayer(null)} />
          : <><ReferralCard /><AreaPlayerList onSelectPlayer={setSelectedAreaPlayer} /></>
      )}

      {view === 'withdrawals' && (<>
      {/* Stats bar */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 8,
        marginBottom: 16,
      }}>
        {[
          { key: 'balance', label: t('agent.balance'), value: formatCredits(agentWallet?.availableMinor ?? 0), accent: true },
          { key: 'feeComm', label: t('agent.feeComm'), value: `${config?.withdrawalFeeRanges.length ?? 0} tiers` },
          { key: 'pool', label: t('agent.pool'), value: String(available.length) },
          { key: 'active', label: t('agent.active'), value: String(mine.length) },
        ].map(({ key, label, value, accent }) => (
          <div key={key} style={{
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

      {/* Agent Dashboard — earnings by source and time window, player/withdrawal counts */}
      {dashboard && (
        <div style={{
          background: 'var(--card-bg)', border: '1px solid var(--border)',
          borderRadius: 12, padding: 14, marginBottom: 16,
        }}>
          <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 10 }}>
            {t('agent.dashboard', { defaultValue: 'Dashboard' })}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 12 }}>
            {[
              { label: t('agent.referredPlayers', { defaultValue: 'Referred' }), value: String(dashboard.totalReferredPlayers) },
              { label: t('agent.activePlayers', { defaultValue: 'Active (30d)' }), value: String(dashboard.activePlayers) },
              { label: t('agent.totalEarnings', { defaultValue: 'Total Earnings' }), value: formatCredits(dashboard.totalEarningsMinor), accent: true },
            ].map((s) => (
              <div key={s.label} style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }}>{s.label}</div>
                <div style={{ fontWeight: 800, fontSize: 14, color: s.accent ? 'var(--accent)' : 'var(--text-primary)' }}>{s.value}</div>
              </div>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, marginBottom: 12 }}>
            <div style={{ background: 'var(--surface)', borderRadius: 8, padding: 8, textAlign: 'center' }}>
              <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                {t('agent.gameCommission', { defaultValue: 'Game Commission' })}
              </div>
              <div style={{ fontWeight: 800, fontSize: 14, color: 'var(--accent)' }}>{formatCredits(dashboard.gameCommission.totalMinor)}</div>
              <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 2 }}>
                {t('agent.commissionCount', { count: dashboard.gameCommission.count, defaultValue: `${dashboard.gameCommission.count} commissions` })}
              </div>
            </div>
            <div style={{ background: 'var(--surface)', borderRadius: 8, padding: 8, textAlign: 'center' }}>
              <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                {t('agent.withdrawalFees', { defaultValue: 'Withdrawal Fees' })}
              </div>
              <div style={{ fontWeight: 800, fontSize: 14, color: 'var(--accent)' }}>{formatCredits(dashboard.withdrawalFeesEarnedMinor)}</div>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, marginBottom: 12 }}>
            <div style={{ background: 'var(--surface)', borderRadius: 8, padding: 8, textAlign: 'center' }}>
              <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                {t('agent.totalSettled', { defaultValue: 'Total Settled' })}
              </div>
              <div style={{ fontWeight: 800, fontSize: 14 }}>{formatCredits(dashboard.totalSettledMinor)}</div>
            </div>
            <div style={{ background: 'var(--surface)', borderRadius: 8, padding: 8, textAlign: 'center' }}>
              <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                {t('agent.remaining', { defaultValue: 'Remaining' })}
              </div>
              <div style={{ fontWeight: 800, fontSize: 14, color: 'var(--accent)' }}>{formatCredits(dashboard.remainingMinor)}</div>
            </div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <button
              type="button"
              className="btn btn-primary"
              style={{ width: '100%' }}
              disabled={!dashboard.canRequestSettlement || requestingSettlement}
              onClick={handleRequestSettlement}
            >
              {requestingSettlement
                ? t('agent.requestingSettlement', { defaultValue: 'Requesting…' })
                : t('agent.requestSettlement', { defaultValue: 'Request Settlement' })}
            </button>
            {!dashboard.canRequestSettlement && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', marginTop: 6 }}>
                {dashboard.settlementBlockReason === 'pending_exists' &&
                  t('agent.settlementPendingReview', { defaultValue: 'You already have a settlement request awaiting review.' })}
                {dashboard.settlementBlockReason === 'cooldown' && dashboard.settlementCooldownEndsAt &&
                  t('agent.settlementCooldown', {
                    time: formatDateTime(dashboard.settlementCooldownEndsAt),
                    defaultValue: `You can request again at ${formatDateTime(dashboard.settlementCooldownEndsAt)}.`,
                  })}
                {dashboard.settlementBlockReason === 'nothing_to_settle' &&
                  t('agent.settlementNothingToSettle', { defaultValue: 'No new earnings to settle yet.' })}
              </div>
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }}>{t('agent.pendingRequests', { defaultValue: 'Pending Requests' })}</div>
              <div style={{ fontWeight: 800, fontSize: 14 }}>{dashboard.pendingWithdrawalRequests}</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }}>{t('agent.completedRequests', { defaultValue: 'Completed Requests' })}</div>
              <div style={{ fontWeight: 800, fontSize: 14 }}>{dashboard.completedWithdrawalRequests}</div>
            </div>
          </div>
        </div>
      )}

      {/* My Bingo Room activity (Approach B) — traffic in the room I own, shows
          once there's activity. Commission isn't shown here: there's no
          room-owner commission — commission is earned on REFERRED players,
          a different population than this room's own traffic. */}
      {perf && (perf.tickets > 0 || perf.customersBrought > 0) && (
        <div style={{
          background: 'var(--card-bg)', border: '1px solid var(--border)',
          borderRadius: 12, padding: 14, marginBottom: 16,
        }}>
          <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 10 }}>
            {t('agent.myBingo', { defaultValue: 'My Bingo Room' })}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            {[
              { label: t('agent.customers', { defaultValue: 'Customers' }), value: String(perf.customersBrought) },
              { label: t('agent.players', { defaultValue: 'Players' }), value: String(perf.players) },
              { label: t('agent.staked', { defaultValue: 'Staked' }), value: formatCredits(perf.stakedMinor) },
            ].map((s) => (
              <div key={s.label} style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }}>{s.label}</div>
                <div style={{ fontWeight: 800, fontSize: 14, color: 'var(--text-primary)' }}>{s.value}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* My deposit activity (Phase 4) — deposits I processed + commission earned */}
      {perf && (perf.depositCount > 0 || perf.depositCommissionEarnedMinor > 0) && (
        <div style={{
          background: 'var(--card-bg)', border: '1px solid var(--border)',
          borderRadius: 12, padding: 14, marginBottom: 16,
        }}>
          <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 10 }}>
            {t('agent.myDeposits', { defaultValue: 'My Deposit Activity' })}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            {[
              { label: t('agent.depositCount', { defaultValue: 'Deposits' }), value: String(perf.depositCount) },
              { label: t('agent.depositVolume', { defaultValue: 'Volume' }), value: formatCredits(perf.depositVolumeMinor) },
              { label: t('agent.depositCommission', { defaultValue: 'Commission' }), value: formatCredits(perf.depositCommissionEarnedMinor), accent: true },
            ].map((s) => (
              <div key={s.label} style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }}>{s.label}</div>
                <div style={{ fontWeight: 800, fontSize: 14, color: s.accent ? 'var(--accent)' : 'var(--text-primary)' }}>{s.value}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Header actions */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Users size={16} style={{ color: 'var(--accent)' }} />
          <span style={{ fontWeight: 700, fontSize: 16 }}>{t('agent.panelTitle')}</span>
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
              const fee = feeOf(w.amountMinor);
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
                      <Step n={2} label={`Send the exact "You transfer" amount to ${w.destinationAccount}`} />
                      <Step n={3} label="Paste your payment proof below to verify & complete" />
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
                      {w.user && (
                        <>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ color: 'var(--text-muted)' }}>Player</span>
                            <span>{w.user.displayName}</span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ color: 'var(--text-muted)' }}>Player Phone</span>
                            <span>{w.user.phoneNumber ?? '—'}</span>
                          </div>
                        </>
                      )}
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: 'var(--text-muted)' }}>Recipient Phone</span>
                        <strong style={{ fontSize: 14 }}>{w.destinationAccount}</strong>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: 'var(--text-muted)' }}>Gross</span>
                        <span>{formatCredits(w.amountMinor)} ETB</span>
                      </div>
                      {fee > 0 && (
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: 'var(--text-muted)' }}>Your withdrawal fee</span>
                          <span style={{ color: 'var(--accent)' }}>+{formatCredits(fee)} ETB</span>
                        </div>
                      )}
                      <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border)', paddingTop: 6, marginTop: 2 }}>
                        <strong>You transfer</strong>
                        <strong style={{ color: 'var(--accent)', fontSize: 15 }}>{formatCreditsFull(net)}</strong>
                      </div>
                    </div>

                    {w.status !== 'claimed' ? (
                      <div style={{
                        background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.25)',
                        borderRadius: 10, padding: '10px 12px', fontSize: 12, color: 'var(--text-secondary)',
                      }}>
                        Payout proof submitted — waiting on an admin to verify the FT number and receipt.
                      </div>
                    ) : (<>
                    {/* Payout proof — provider toggle + proof, verified server-side */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ display: 'flex', gap: 8 }}>
                        {(['telebirr', 'mpesa'] as const).map((p) => {
                          const selected = (proofProvider[w.id] ?? 'telebirr') === p;
                          return (
                            <button
                              key={p}
                              type="button"
                              disabled={isBusy}
                              onClick={() => setProofProvider((prev) => ({ ...prev, [w.id]: p }))}
                              style={{
                                flex: 1, padding: '7px 10px', borderRadius: 8, cursor: 'pointer',
                                fontSize: 12, fontWeight: 700,
                                background: selected ? 'rgba(250,204,21,0.14)' : 'var(--surface)',
                                border: `1px solid ${selected ? 'rgba(250,204,21,0.55)' : 'var(--border)'}`,
                                color: selected ? 'var(--accent)' : 'var(--text-secondary)',
                              }}
                            >
                              {p === 'telebirr' ? 'Telebirr' : 'M-Pesa'}
                            </button>
                          );
                        })}
                      </div>
                      <textarea
                        className="input"
                        rows={(proofProvider[w.id] ?? 'telebirr') === 'mpesa' ? 3 : 1}
                        placeholder={(proofProvider[w.id] ?? 'telebirr') === 'mpesa'
                          ? 'Paste the M-Pesa confirmation SMS you received…'
                          : 'Telebirr receipt number or link…'}
                        value={refInputs[w.id] ?? ''}
                        onChange={(e) => setRefInputs((prev) => ({ ...prev, [w.id]: e.target.value }))}
                        disabled={isBusy}
                        style={{ width: '100%', resize: 'vertical' }}
                      />
                      <div>
                        <label style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
                          Payout receipt (photo/PDF) <span style={{ color: 'var(--danger)' }}>*</span>
                        </label>
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
                          disabled={isBusy}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            setReceiptFiles((prev) => {
                              const next = { ...prev };
                              if (file) next[w.id] = file; else delete next[w.id];
                              return next;
                            });
                          }}
                          style={{ width: '100%', fontSize: 12 }}
                        />
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
                          Transfer completed at <span style={{ color: 'var(--danger)' }}>*</span>
                        </label>
                        <input
                          type="datetime-local"
                          className="input"
                          disabled={isBusy}
                          value={transferCompletedAtInputs[w.id] ?? nowLocalInputValue()}
                          onChange={(e) => setTransferCompletedAtInputs((prev) => ({ ...prev, [w.id]: e.target.value }))}
                          style={{ width: '100%' }}
                        />
                      </div>
                      <button
                        className="btn btn-primary btn-full"
                        disabled={isBusy || !(refInputs[w.id] ?? '').trim() || !receiptFiles[w.id]}
                        onClick={() => void handleComplete(w)}
                      >
                        <CheckCircle size={14} />
                        {isBusy ? 'Submitting…' : 'Submit Payout Proof'}
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
                    </>)}
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
      </>)}
    </div>
  );
}
