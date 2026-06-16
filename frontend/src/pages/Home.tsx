import React, { useEffect, useState } from 'react';
import { Zap, Trophy, ChevronRight, HelpCircle, Clock, TrendingUp } from 'lucide-react';
import { useStore } from '../store/useStore';
import { kenoApi } from '../lib/api';
import type { KenoDraw } from '../lib/models';
import type { AppTab } from '../lib/navigation';

type Props = {
  onNavigate: (tab: AppTab) => void;
};

// ── Compact live countdown ─────────────────────────────────────────
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

// ── FAQ items — all in one place ──────────────────────────────────
const FAQ = [
  { q: 'How does Keno work?', a: 'Pick 1–12 numbers from 1–80. When the draw runs, 20 numbers are randomly selected. Your payout depends on how many of your picks match.' },
  { q: 'How does Bingo work?', a: 'Join a room and buy tickets. Numbers are drawn one at a time. Match one row, two rows, or a full card to win prize tiers.' },
  { q: 'What is e‑Birr?', a: '100 e‑Birr = 1 ETB Birr. All game stakes and payouts are in e‑Birr.' },
  { q: 'How do I top up?', a: 'Wallet → Top Up (Telebirr). Transfer the amount, then paste the SMS confirmation to instantly credit your account.' },
  { q: 'How do I withdraw?', a: 'Wallet → Request Payout. Enter the amount and your Telebirr phone number. An agent processes the transfer.' },
  { q: 'Are winnings instant?', a: 'Yes — credited to your wallet immediately after each draw or room settlement.' },
];

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className={`rule-item${open ? ' open' : ''}`}>
      <button className="rule-question" onClick={() => setOpen(v => !v)}>
        <span>{q}</span>
        <ChevronRight size={14} className="rule-chevron" />
      </button>
      {open && <p className="rule-answer">{a}</p>}
    </div>
  );
}

export function Home({ onNavigate }: Props) {
  const user = useStore(s => s.user);
  const wallet = useStore(s => s.wallet);
  const [activeDraw, setActiveDraw] = useState<KenoDraw | null>(null);

  useEffect(() => {
    kenoApi.getActiveDraw()
      .then(d => setActiveDraw(d))
      .catch(() => {/* silently ignore */});
  }, []);

  const countdown = useCountdownSecs(
    activeDraw?.status === 'open' ? activeDraw.scheduledAt : null
  );

  const balance = wallet?.availableMinor ?? 0;
  const formattedBalance = new Intl.NumberFormat().format(balance);

  return (
    <div className="stack-lg">

      {/* ── Hero ── compact, no filler copy ── */}
      <section className="home-hero">
        <div className="home-hero-top">
          <div>
            <p className="home-greeting">Hey, {user?.displayName ?? 'Player'} 👋</p>
            <div className="home-balance-row">
              <span className="home-balance-amount">{formattedBalance}</span>
              <span className="home-balance-unit">e‑Birr</span>
            </div>
          </div>
          <button
            className="home-wallet-chip"
            onClick={() => onNavigate('wallet')}
          >
            <TrendingUp size={14} />
            Wallet
          </button>
        </div>

        {/* Live draw status pill */}
        {activeDraw && (
          <div className={`home-draw-pill${countdown === 'Starting…' || activeDraw.status !== 'open' ? ' home-draw-pill-active' : ''}`}>
            <Clock size={13} />
            {activeDraw.status === 'open' && countdown
              ? <>Next Keno draw in <strong>{countdown}</strong></>
              : <strong>Keno draw in progress…</strong>
            }
          </div>
        )}
      </section>

      {/* ── Game entry cards ── big, visual, one action each ── */}
      <div className="home-game-grid">
        <button className="home-game-card home-game-keno" onClick={() => onNavigate('keno')}>
          <div className="home-game-card-inner">
            <div className="home-game-icon">⚡</div>
            <div className="home-game-info">
              <span className="home-game-tag">Fast Draw</span>
              <strong className="home-game-name">Keno</strong>
              <span className="home-game-sub">
                {countdown && activeDraw?.status === 'open'
                  ? `Draw in ${countdown}`
                  : 'Pick numbers & win'}
              </span>
            </div>
          </div>
          <span className="home-game-arrow">→</span>
        </button>

        <button className="home-game-card home-game-bingo" onClick={() => onNavigate('bingo')}>
          <div className="home-game-card-inner">
            <div className="home-game-icon">🎯</div>
            <div className="home-game-info">
              <span className="home-game-tag">Live Rooms</span>
              <strong className="home-game-name">Bingo</strong>
              <span className="home-game-sub">Buy cards & win prizes</span>
            </div>
          </div>
          <span className="home-game-arrow">→</span>
        </button>
      </div>

      {/* ── Help & FAQ — collapsed single section ── */}
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
