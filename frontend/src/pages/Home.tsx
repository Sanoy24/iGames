import React, { memo, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronRight, HelpCircle, Clock, TrendingUp } from 'lucide-react';
import { useStore } from '../store/useStore';
import { kenoApi, walletApi } from '../lib/api';
import type { KenoDraw, LedgerEntry } from '../lib/models';
import type { AppTab } from '../lib/navigation';

type Props = { onNavigate: (tab: AppTab) => void; };

function timeGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function useCountdownSecs(targetIso: string | null | undefined) {
  const [secs, setSecs] = useState<number | null>(null);
  useEffect(() => {
    if (!targetIso) { setSecs(null); return; }
    const tick = () => {
      const ms = new Date(targetIso).getTime() - Date.now();
      setSecs(ms > 0 ? Math.floor(ms / 1000) : 0);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [targetIso]);
  if (secs === null) return null;
  if (secs <= 0) return 'Starting…';
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}m ${String(s).padStart(2, '0')}s` : `${s}s`;
}

const FAQ = [
  { q: 'How does Keno work?', a: 'Pick 1–12 numbers from 1–80. When the draw runs, 20 numbers are randomly selected. Your payout depends on how many of your picks match.' },
  { q: 'How does Bingo work?', a: 'Join a room and buy tickets. Numbers are drawn one at a time. Match one row, two rows, or a full card to win prize tiers.' },
  { q: 'What is e‑Birr?', a: '100 e‑Birr = 1 ETB Birr. All game stakes and payouts are in e‑Birr.' },
  { q: 'How do I top up?', a: 'Wallet → Top Up (Telebirr). Transfer the amount, then paste the SMS confirmation to instantly credit your account.' },
  { q: 'How do I withdraw?', a: 'Wallet → Request Payout. Enter the amount and your Telebirr phone number. An agent processes the transfer.' },
  { q: 'Are winnings instant?', a: 'Yes — credited to your wallet immediately after each draw or room settlement.' },
];

const FaqItem = memo(function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className={`rule-item${open ? ' open' : ''}`}>
      <button className="rule-question" onClick={() => setOpen(v => !v)}>
        <span>{q}</span>
        <motion.span animate={{ rotate: open ? 90 : 0 }} transition={{ duration: 0.18 }}>
          <ChevronRight size={14} />
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.p
            className="rule-answer"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{ overflow: 'hidden', margin: 0 }}
          >
            {a}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
});

const LEDGER_LABELS: Record<string, string> = {
  ticket_win: 'Winnings',
  ticket_purchase: 'Ticket Purchase',
  ticket_refund: 'Ticket Refund',
  deposit: 'Deposit',
  withdrawal: 'Withdrawal',
  bonus: 'Bonus',
  admin_adjustment: 'Adjustment',
  agent_receipt: 'Agent Transfer',
};

function entryBadge(entry: LedgerEntry) {
  const type = (entry.entryType ?? entry.sourceType ?? '') as string;
  if (type === 'ticket_win') return { emoji: '🏆', cls: 'activity-badge-bingo' };
  if (type === 'ticket_purchase') return { emoji: '🎟️', cls: 'activity-badge-keno' };
  if (type === 'deposit') return { emoji: '💰', cls: 'activity-badge-bingo' };
  if (type === 'withdrawal') return { emoji: '💸', cls: 'activity-badge-keno' };
  return { emoji: '📋', cls: 'activity-badge-keno' };
}

export function Home({ onNavigate }: Props) {
  const user = useStore(s => s.user);
  const wallet = useStore(s => s.wallet);
  const liveCounts = useStore(s => s.liveCounts);
  const [activeDraw, setActiveDraw] = useState<KenoDraw | null>(null);
  const [recentActivity, setRecentActivity] = useState<LedgerEntry[]>([]);

  useEffect(() => {
    kenoApi.getActiveDraw().then(d => setActiveDraw(d)).catch(() => {});
    walletApi.getLedger(5).then(entries => setRecentActivity(entries)).catch(() => {});
  }, []);

  const countdown = useCountdownSecs(
    activeDraw?.status === 'open' ? activeDraw.scheduledAt : null
  );

  const balance = wallet?.availableMinor ?? 0;
  const formattedBalance = new Intl.NumberFormat().format(balance);
  const prevBalanceRef = useRef(balance);
  const [balanceKey, setBalanceKey] = useState(0);

  useEffect(() => {
    if (prevBalanceRef.current !== balance) {
      setBalanceKey(k => k + 1);
      prevBalanceRef.current = balance;
    }
  }, [balance]);

  return (
    <div className="stack-lg">

      {/* ── Hero ── */}
      <section className="home-hero">
        <div className="home-hero-top">
          <div>
            <p className="home-greeting">{timeGreeting()}, {user?.displayName ?? 'Player'} 👋</p>
            <div className="home-balance-row">
              <motion.span
                key={balanceKey}
                className="home-balance-amount"
                initial={{ scale: 1.15, opacity: 0.7 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 280, damping: 18 }}
              >
                {formattedBalance}
              </motion.span>
              <span className="home-balance-unit">e‑Birr</span>
            </div>
          </div>

          <div className="home-hero-actions">
            <motion.button
              className="home-wallet-chip"
              onClick={() => onNavigate('wallet')}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              <TrendingUp size={13} />
              Wallet
            </motion.button>
          </div>
        </div>

        {/* Live status pills */}
        <div className="home-pills-row" style={{ marginTop: 10 }}>
          {liveCounts && (
            <span className="home-pill home-pill-live">
              <span className="pulse-dot" />
              {liveCounts.totalOnline} online
            </span>
          )}
          {liveCounts && liveCounts.totalPlaying > 0 && (
            <span className="home-pill home-pill-active">
              <span className="pulse-dot" style={{ background: 'var(--danger)', boxShadow: '0 0 6px rgba(239,68,68,0.5)' }} />
              {liveCounts.totalPlaying} playing
            </span>
          )}
          {activeDraw && (
            <span className={`home-pill ${activeDraw.status !== 'open' ? 'home-pill-active' : ''}`}>
              <Clock size={11} />
              {activeDraw.status === 'open' && countdown
                ? `Keno in ${countdown}`
                : 'Keno drawing…'}
            </span>
          )}
        </div>
      </section>

      {/* ── Live stats ── */}
      {liveCounts && (
        <div className="quick-stats-row">
          <div className="quick-stat">
            <span className="quick-stat-val">{liveCounts.kenoOnline}</span>
            <span className="quick-stat-lbl">Keno</span>
          </div>
          <div className="quick-stat">
            <span className="quick-stat-val">{liveCounts.bingoOnline}</span>
            <span className="quick-stat-lbl">Bingo</span>
          </div>
          <div className="quick-stat">
            <span className="quick-stat-val">{liveCounts.totalOnline}</span>
            <span className="quick-stat-lbl">Online</span>
          </div>
        </div>
      )}

      {/* ── Game entry cards ── */}
      <div className="home-game-grid">
        <motion.button
          className="home-game-card home-game-keno"
          onClick={() => onNavigate('keno')}
          whileHover={{ scale: 1.025, y: -2 }}
          whileTap={{ scale: 0.97 }}
          transition={{ type: 'spring', stiffness: 380, damping: 22 }}
        >
          <div className="home-game-card-inner">
            <div className="home-game-icon">⚡</div>
            <div className="home-game-info">
              <span className="home-game-tag">Fast Draw</span>
              <strong className="home-game-name">Keno</strong>
              <span className="home-game-sub">
                {countdown && activeDraw?.status === 'open'
                  ? `Draw in ${countdown}`
                  : 'Pick numbers & win'}
                {liveCounts && liveCounts.kenoOnline > 0 && (
                  <span className="live-pill-inline">🟢 {liveCounts.kenoOnline} online</span>
                )}
              </span>
            </div>
          </div>
          <span className="home-game-arrow">→</span>
        </motion.button>

        <motion.button
          className="home-game-card home-game-bingo"
          onClick={() => onNavigate('bingo')}
          whileHover={{ scale: 1.025, y: -2 }}
          whileTap={{ scale: 0.97 }}
          transition={{ type: 'spring', stiffness: 380, damping: 22 }}
        >
          <div className="home-game-card-inner">
            <div className="home-game-icon">🎯</div>
            <div className="home-game-info">
              <span className="home-game-tag">Live Rooms</span>
              <strong className="home-game-name">Bingo</strong>
              <span className="home-game-sub">
                Buy cards &amp; win prizes
                {liveCounts && liveCounts.bingoOnline > 0 && (
                  <span className="live-pill-inline">🟢 {liveCounts.bingoOnline} online</span>
                )}
              </span>
            </div>
          </div>
          <span className="home-game-arrow">→</span>
        </motion.button>
      </div>

      {/* ── Recent activity ── */}
      {recentActivity.length > 0 && (
        <section className="card">
          <div className="section-header">
            <div className="section-title">Recent Activity</div>
            <button className="btn btn-ghost btn-sm" onClick={() => onNavigate('wallet')}>View all</button>
          </div>
          <div className="activity-feed" style={{ marginTop: 8 }}>
            {recentActivity.slice(0, 4).map((entry, i) => {
              const badge = entryBadge(entry);
              const label = LEDGER_LABELS[(entry.entryType ?? entry.sourceType ?? '') as string] ?? 'Transaction';
              const isCredit = entry.direction === 'credit';
              return (
                <motion.div
                  key={entry.id}
                  className="activity-item"
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.07, duration: 0.28 }}
                >
                  <div className={`activity-badge ${badge.cls}`}>{badge.emoji}</div>
                  <div className="activity-body">
                    <span className="activity-name">{label}</span>
                    <span className="activity-game">
                      {new Date(entry.createdAt).toLocaleDateString(undefined, {
                        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                      })}
                    </span>
                  </div>
                  <span
                    className="activity-amount"
                    style={{ color: isCredit ? 'var(--green)' : 'var(--danger)' }}
                  >
                    {isCredit ? '+' : '-'}{new Intl.NumberFormat().format(entry.amountMinor)}
                  </span>
                </motion.div>
              );
            })}
          </div>
        </section>
      )}

      {/* ── Help & FAQ ── */}
      <section className="card">
        <div className="home-faq-header">
          <HelpCircle size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          <span className="section-title" style={{ fontSize: 14 }}>Help &amp; FAQ</span>
        </div>
        <div className="rules-accordion">
          {FAQ.map((item, i) => <FaqItem key={i} q={item.q} a={item.a} />)}
        </div>
      </section>

      <div style={{ height: 4 }} />
    </div>
  );
}
