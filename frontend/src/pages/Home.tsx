import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence, useMotionValue, useSpring } from 'framer-motion';
import { ChevronRight, HelpCircle, Clock, TrendingUp, Zap, Target, Trophy } from 'lucide-react';
import { useStore } from '../store/useStore';
import { kenoApi, walletApi } from '../lib/api';
import type { KenoDraw, LedgerEntry } from '../lib/models';
import type { AppTab } from '../lib/navigation';
import { soundEngine } from '../lib/audio';

type Props = { onNavigate: (tab: AppTab) => void; };

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

function useAnimatedNumber(target: number) {
  const mv = useMotionValue(target);
  const spring = useSpring(mv, { stiffness: 80, damping: 18, mass: 0.8 });
  const [display, setDisplay] = useState(target);
  useEffect(() => { mv.set(target); }, [target, mv]);
  useEffect(() => spring.on('change', (v) => setDisplay(Math.round(v))), [spring]);
  return display;
}

// ─── Live wins ticker ─────────────────────────────────────────────────────────

const FAKE_NAMES = ['Abebe', 'Tigist', 'Dawit', 'Hana', 'Yonas', 'Selam', 'Bereket', 'Meron', 'Samuel', 'Bethlehem'];
const FAKE_GAMES = ['Keno', 'Bingo', 'Pattern Bingo'];

function makeFakeWins(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: i,
    name: FAKE_NAMES[i % FAKE_NAMES.length],
    game: FAKE_GAMES[i % FAKE_GAMES.length],
    amount: (Math.floor(Math.random() * 980) + 20) * 100,
  }));
}

function LiveWinsTicker() {
  const wins = useMemo(() => makeFakeWins(12), []);
  // Duplicate for seamless loop
  const doubled = [...wins, ...wins];

  return (
    <div className="ticker-wrap" style={{ borderRadius: 10, background: 'var(--surface)', border: '1px solid var(--border)', padding: '6px 0' }}>
      <div className="ticker-inner">
        {doubled.map((w, i) => (
          <span key={i} className="ticker-item">
            <Trophy size={11} style={{ color: 'var(--gold)', flexShrink: 0 }} />
            <span className="ticker-item-name">{w.name}</span>
            <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>won</span>
            <span className="ticker-item-win">{new Intl.NumberFormat().format(w.amount)} e‑Birr</span>
            <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>on {w.game}</span>
            <span style={{ color: 'rgba(255,255,255,0.1)', margin: '0 4px' }}>•</span>
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── FAQ ─────────────────────────────────────────────────────────────────────

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
  win: 'Winnings',
  ticket_purchase: 'Ticket Purchase',
  stake: 'Ticket Purchase',
  ticket_refund: 'Ticket Refund',
  refund: 'Refund',
  deposit: 'Deposit',
  withdrawal: 'Withdrawal',
  bonus: 'Bonus',
  admin_adjustment: 'Adjustment',
  agent_receipt: 'Agent Transfer',
};

function entryBadge(entry: LedgerEntry) {
  const type = (entry.entryType ?? entry.sourceType ?? '') as string;
  if (type === 'win' || type === 'ticket_win') return { emoji: '🏆', cls: 'activity-badge-bingo' };
  if (type === 'stake' || type === 'ticket_purchase') return { emoji: '🎟️', cls: 'activity-badge-keno' };
  if (type === 'deposit') return { emoji: '💰', cls: 'activity-badge-bingo' };
  if (type === 'withdrawal') return { emoji: '💸', cls: 'activity-badge-keno' };
  if (type === 'refund' || type === 'ticket_refund') return { emoji: '↩️', cls: 'activity-badge-keno' };
  return { emoji: '📋', cls: 'activity-badge-keno' };
}

// ─── Game Card ────────────────────────────────────────────────────────────────

function GameCard({ onClick, gradientFrom, gradientTo, glowColor, icon, tag, name, sub, badge, badgeColor }: {
  onClick: () => void;
  gradientFrom: string; gradientTo: string; glowColor: string;
  icon: React.ReactNode; tag: string; name: string; sub: React.ReactNode;
  badge?: string; badgeColor?: string;
}) {
  return (
    <motion.button
      onClick={onClick}
      className="lobby-card"
      whileHover={{ scale: 1.02, y: -3 }}
      whileTap={{ scale: 0.96 }}
      transition={{ type: 'spring', stiffness: 380, damping: 22 }}
      style={{ background: `linear-gradient(145deg, ${gradientFrom} 0%, ${gradientTo} 100%)` }}
    >
      <div
        className="lobby-card-overlay"
        style={{ background: `radial-gradient(ellipse at 80% 20%, ${glowColor} 0%, transparent 65%)` }}
      />

      {badge && (
        <span
          className="lobby-card-badge"
          style={{ background: badgeColor ?? 'rgba(245,158,11,0.2)', color: 'var(--gold)', border: `1px solid ${badgeColor ?? 'rgba(245,158,11,0.3)'}` }}
        >
          {badge}
        </span>
      )}

      {/* Icon */}
      <div style={{ position: 'absolute', top: 12, left: 14, fontSize: 28, zIndex: 1, filter: `drop-shadow(0 0 12px ${glowColor})` }}>
        {icon}
      </div>

      <div style={{ position: 'relative', zIndex: 1 }}>
        <div className="lobby-card-sub">{tag}</div>
        <div className="lobby-card-name">{name}</div>
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', marginTop: 3, fontWeight: 600 }}>{sub}</div>
      </div>
    </motion.button>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

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
  const animatedBalance = useAnimatedNumber(balance);
  const formattedBalance = new Intl.NumberFormat().format(animatedBalance);
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

      {/* ── Live wins ticker ── */}
      <LiveWinsTicker />

      {/* ── Balance hero ── */}
      <section className="jackpot-hero">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', fontWeight: 600, marginBottom: 4 }}>
              {timeGreeting()}, {user?.displayName ?? 'Player'}
            </p>
            <div className="jackpot-label" style={{ textAlign: 'left' }}>Your Balance</div>
            <motion.div
              key={balanceKey}
              className="jackpot-value"
              style={{ textAlign: 'left' }}
              initial={{ scale: 1.08, opacity: 0.8 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 300, damping: 20 }}
            >
              {formattedBalance}
            </motion.div>
            <div className="jackpot-sub" style={{ textAlign: 'left' }}>e‑Birr available</div>
          </div>
          <motion.button
            className="btn btn-primary btn-glow btn-sm"
            onClick={() => { soundEngine.click(); onNavigate('wallet'); }}
            whileHover={{ scale: 1.06 }}
            whileTap={{ scale: 0.94 }}
            style={{ marginTop: 8, flexShrink: 0 }}
          >
            <TrendingUp size={13} />
            Top Up
          </motion.button>
        </div>

        {/* Live pills */}
        <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
          {liveCounts && liveCounts.totalOnline > 0 && (
            <span className="live-badge-pulse" style={{ fontSize: 10 }}>
              <span className="pulse-dot" />
              {liveCounts.totalOnline} online now
            </span>
          )}
          {liveCounts && liveCounts.totalPlaying > 0 && (
            <span className="live-badge-pulse" style={{ fontSize: 10, background: 'rgba(239,68,68,0.1)', color: '#f87171', border: '1px solid rgba(239,68,68,0.2)' }}>
              <span className="pulse-dot" style={{ background: 'var(--danger)', boxShadow: '0 0 6px rgba(239,68,68,0.5)' }} />
              {liveCounts.totalPlaying} playing
            </span>
          )}
          {activeDraw && (
            <span className="live-badge-pulse" style={{ fontSize: 10, background: 'rgba(245,158,11,0.1)', color: 'var(--gold)', border: '1px solid rgba(245,158,11,0.2)' }}>
              <Clock size={10} />
              {activeDraw.status === 'open' && countdown ? `Keno in ${countdown}` : 'Keno drawing…'}
            </span>
          )}
        </div>
      </section>

      {/* ── Quick stats strip ── */}
      {liveCounts && (
        <div className="stat-pill-row">
          <span className="stat-pill">
            <Zap size={11} style={{ color: '#a78bfa' }} />
            <span className="stat-pill-val">{liveCounts.kenoOnline}</span>
            <span className="stat-pill-lbl">in Keno</span>
          </span>
          <span className="stat-pill">
            <Target size={11} style={{ color: '#ef4444' }} />
            <span className="stat-pill-val">{liveCounts.bingoOnline}</span>
            <span className="stat-pill-lbl">in Bingo</span>
          </span>
          <span className="stat-pill">
            <Trophy size={11} style={{ color: 'var(--gold)' }} />
            <span className="stat-pill-val">{liveCounts.totalOnline}</span>
            <span className="stat-pill-lbl">total online</span>
          </span>
        </div>
      )}

      {/* ── Game lobby ── */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <span className="section-title" style={{ fontSize: 15 }}>Play Now</span>
          <button className="btn btn-ghost btn-sm" onClick={() => onNavigate('games')}>All games →</button>
        </div>
        <div className="lobby-grid">
          <GameCard
            onClick={() => { soundEngine.click(); onNavigate('keno'); }}
            gradientFrom="rgba(139,92,246,0.18)" gradientTo="rgba(16,18,28,0.95)"
            glowColor="rgba(139,92,246,0.25)"
            icon={<Zap style={{ color: '#a78bfa' }} />}
            tag="Fast Draw" name="Keno"
            sub={countdown && activeDraw?.status === 'open' ? `Draw in ${countdown}` : 'Pick 1–12 numbers'}
            badge="LIVE" badgeColor="rgba(139,92,246,0.25)"
          />
          <GameCard
            onClick={() => { soundEngine.click(); onNavigate('bingo'); }}
            gradientFrom="rgba(239,68,68,0.15)" gradientTo="rgba(16,18,28,0.95)"
            glowColor="rgba(239,68,68,0.2)"
            icon={<Target style={{ color: '#f87171' }} />}
            tag="Live Rooms" name="Bingo"
            sub="90-ball & pattern cards"
            badge="HOT" badgeColor="rgba(239,68,68,0.2)"
          />
        </div>
      </div>

      {/* ── Recent activity ── */}
      {recentActivity.length > 0 && (
        <section className="card">
          <div className="section-header">
            <div className="section-title" style={{ fontSize: 14 }}>Recent Activity</div>
            <button className="btn btn-ghost btn-sm" onClick={() => onNavigate('wallet')}>See all →</button>
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
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.06, duration: 0.25 }}
                >
                  <div className={`activity-badge ${badge.cls}`}>{badge.emoji}</div>
                  <div className="activity-body">
                    <span className="activity-name">{label}</span>
                    <span className="activity-game">
                      {new Date(entry.createdAt ?? 0).toLocaleDateString(undefined, {
                        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                      })}
                    </span>
                  </div>
                  <span
                    className="activity-amount"
                    style={{ color: isCredit ? 'var(--green)' : 'var(--danger)' }}
                  >
                    {isCredit ? '+' : '−'}{new Intl.NumberFormat().format(entry.amountMinor)}
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
