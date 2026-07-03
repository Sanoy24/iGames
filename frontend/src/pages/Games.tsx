import { useState, type CSSProperties } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Zap, Users, Clock, Trophy, Star, TrendingUp } from 'lucide-react';
import type { AppTab } from '../lib/navigation';
import { useStore } from '../store/useStore';

type Props = { onNavigate: (tab: AppTab) => void; };

type Filter = 'all' | 'keno' | 'bingo' | 'crash';

const BINGO_LETTERS = ['B', 'I', 'N', 'G', 'O'];
const BINGO_COLORS = ['#4ade80', '#facc15', '#60a5fa', '#f87171', '#c084fc'];
const KENO_BALLS = [7, 23, 45, 68, 80];
const CRASH_MULTS = ['1.23×', '2.50×', '5.00×', '1.05×'];
const CRASH_COLORS = ['#10b981', '#10b981', '#ef4444', '#ef4444'];

const FILTER_CHIPS: { id: Filter; label: string; icon: string }[] = [
  { id: 'all',   label: 'All Games',   icon: '🎮' },
  { id: 'keno',  label: 'Fast Draw',   icon: '⚡' },
  { id: 'bingo', label: 'Live Rooms',  icon: '🎯' },
  { id: 'crash', label: 'Crash',       icon: '🚀' },
];

const containerVariants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  show:   { opacity: 1, y: 0,  transition: { type: 'spring' as const, stiffness: 320, damping: 26 } },
};

export function Games({ onNavigate }: Props) {
  const liveCounts = useStore((s) => s.liveCounts);
  const [filter, setFilter] = useState<Filter>('all');

  const showKeno  = filter === 'all' || filter === 'keno';
  const showBingo = filter === 'all' || filter === 'bingo';
  const showCrash = filter === 'all' || filter === 'crash';

  return (
    <motion.div
      className="stack-lg"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 28 }}
    >
      {/* ── Hero ── */}
      <section className="games-hero">
        <motion.div
          className="badge badge-gold"
          initial={{ scale: 0.7, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 400, damping: 20, delay: 0.05 }}
        >
          Games
        </motion.div>
        <motion.h1
          className="hero-title"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.3 }}
        >
          Choose a Game
        </motion.h1>
        {liveCounts && (
          <motion.div
            className="stat-pill-row"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.18 }}
            style={{ justifyContent: 'center', flexWrap: 'wrap', gap: 8 }}
          >
            <span className="stat-pill">
              <Users size={11} style={{ display: 'inline', marginRight: 4, color: 'var(--green)' }} />
              <span className="stat-pill-val">{liveCounts.totalOnline}</span>
              <span className="stat-pill-lbl"> online</span>
            </span>
            {liveCounts.kenoOnline > 0 && (
              <span className="stat-pill">
                <Zap size={11} style={{ display: 'inline', marginRight: 4, color: 'var(--gold)' }} />
                <span className="stat-pill-val">{liveCounts.kenoOnline}</span>
                <span className="stat-pill-lbl"> in Keno</span>
              </span>
            )}
            {liveCounts.bingoOnline > 0 && (
              <span className="stat-pill">
                <Star size={11} style={{ display: 'inline', marginRight: 4, color: '#c084fc' }} />
                <span className="stat-pill-val">{liveCounts.bingoOnline}</span>
                <span className="stat-pill-lbl"> in Bingo</span>
              </span>
            )}
          </motion.div>
        )}
      </section>

      {/* ── Filter chips ── */}
      <motion.div
        className="game-filter-row"
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
      >
        {FILTER_CHIPS.map((chip) => (
          <motion.button
            key={chip.id}
            className={`game-filter-chip${filter === chip.id ? ' active' : ''}`}
            onClick={() => setFilter(chip.id)}
            whileTap={{ scale: 0.92 }}
            transition={{ type: 'spring', stiffness: 400, damping: 22 }}
            style={{ position: 'relative', overflow: 'hidden' }}
          >
            <span style={{ marginRight: 5 }}>{chip.icon}</span>
            {chip.label}
            {filter === chip.id && (
              <motion.span
                layoutId="filter-pill"
                style={{
                  position: 'absolute', inset: 0, borderRadius: 'inherit',
                  background: 'rgba(250,204,21,0.08)',
                  border: '1px solid rgba(250,204,21,0.3)',
                  zIndex: -1,
                }}
                transition={{ type: 'spring', stiffness: 340, damping: 26 }}
              />
            )}
          </motion.button>
        ))}
      </motion.div>

      {/* ── Game banners ── */}
      <motion.div
        className="game-banner-list"
        variants={containerVariants}
        initial="hidden"
        animate="show"
      >
        <AnimatePresence mode="popLayout">
          {/* ── Bingo ── */}
          {showBingo && (
            <motion.button
              layout
              key="bingo"
              variants={itemVariants}
              className="game-banner game-banner-bingo"
              onClick={() => onNavigate('bingo')}
              exit={{ opacity: 0, y: -12, scale: 0.97 }}
              whileHover={{ scale: 1.015, y: -3 }}
              whileTap={{ scale: 0.975 }}
              transition={{ type: 'spring', stiffness: 340, damping: 24 }}
            >
              <div className="game-banner-content">
                <span className="game-banner-tag">
                  Room based
                  {liveCounts && liveCounts.bingoOnline > 0 && (
                    <span className="live-pill-inline" style={{ marginLeft: 6 }}>🟢 {liveCounts.bingoOnline} playing</span>
                  )}
                </span>
                <h2 className="game-banner-title">Bingo</h2>
                <p className="game-banner-desc">
                  Join a live room, grab cards, and race to fill lines and full house — real-time draws with real players.
                </p>
                <div className="game-banner-stats">
                  <span className="game-stat-pill"><Trophy size={10} style={{ display:'inline', marginRight:3 }} />3 prize tiers</span>
                  <span className="game-stat-pill">🎟 1–5 cards</span>
                  <span className="game-stat-pill"><Users size={10} style={{ display:'inline', marginRight:3 }} />Live chat</span>
                </div>
                <span className="game-banner-cta">Play Now →</span>
              </div>
              <div className="game-banner-deco">
                {BINGO_LETTERS.map((letter, i) => (
                  <motion.span
                    key={letter}
                    className="bingo-tile"
                    style={{ '--tile-color': BINGO_COLORS[i] } as CSSProperties}
                    animate={{ y: [0, -6, 0] }}
                    transition={{ duration: 2.2, delay: i * 0.22, repeat: Infinity, ease: 'easeInOut' }}
                  >
                    {letter}
                  </motion.span>
                ))}
              </div>
            </motion.button>
          )}

          {/* ── Keno ── */}
          {showKeno && (
            <motion.button
              layout
              key="keno"
              variants={itemVariants}
              className="game-banner game-banner-keno"
              onClick={() => onNavigate('keno')}
              exit={{ opacity: 0, y: -12, scale: 0.97 }}
              whileHover={{ scale: 1.015, y: -3 }}
              whileTap={{ scale: 0.975 }}
              transition={{ type: 'spring', stiffness: 340, damping: 24 }}
            >
              <div className="game-banner-content">
                <span className="game-banner-tag">
                  Fast draw
                  {liveCounts && liveCounts.kenoOnline > 0 && (
                    <span className="live-pill-inline" style={{ marginLeft: 6 }}>🟢 {liveCounts.kenoOnline} playing</span>
                  )}
                </span>
                <h2 className="game-banner-title">Keno</h2>
                <p className="game-banner-desc">
                  Pick your lucky numbers, buy a ticket, and watch 20 numbers drawn live — wins paid instantly every round.
                </p>
                <div className="game-banner-stats">
                  <span className="game-stat-pill"><Zap size={10} style={{ display:'inline', marginRight:3 }} />Fast rounds</span>
                  <span className="game-stat-pill">🎯 Pick 1–12</span>
                  <span className="game-stat-pill"><Clock size={10} style={{ display:'inline', marginRight:3 }} />Instant payout</span>
                </div>
                <span className="game-banner-cta">Play Now →</span>
              </div>
              <div className="game-banner-deco game-banner-deco-keno">
                {KENO_BALLS.map((n, i) => (
                  <motion.span
                    key={n}
                    className="keno-ball-deco"
                    style={{ '--bsize': `${32 + i * 5}px` } as CSSProperties}
                    animate={{ scale: [1, 1.12, 1], opacity: [0.7, 1, 0.7] }}
                    transition={{ duration: 2 + i * 0.3, delay: i * 0.18, repeat: Infinity, ease: 'easeInOut' }}
                  >
                    {n}
                  </motion.span>
                ))}
              </div>
            </motion.button>
          )}
          {/* ── Crash ── */}
          {showCrash && (
            <motion.button
              layout
              key="crash"
              variants={itemVariants}
              className="game-banner game-banner-crash"
              onClick={() => onNavigate('crash')}
              exit={{ opacity: 0, y: -12, scale: 0.97 }}
              whileHover={{ scale: 1.015, y: -3 }}
              whileTap={{ scale: 0.975 }}
              transition={{ type: 'spring', stiffness: 340, damping: 24 }}
            >
              <div className="game-banner-content">
                <span className="game-banner-tag">
                  Provably Fair
                </span>
                <h2 className="game-banner-title">Crash</h2>
                <p className="game-banner-desc">
                  Watch the multiplier climb, cash out before it crashes — the longer you wait, the bigger the risk.
                </p>
                <div className="game-banner-stats">
                  <span className="game-stat-pill"><TrendingUp size={10} style={{ display:'inline', marginRight:3 }} />Live multiplier</span>
                  <span className="game-stat-pill">🚀 Auto cashout</span>
                  <span className="game-stat-pill">🔒 Seed hash</span>
                </div>
                <span className="game-banner-cta">Play Now →</span>
              </div>
              <div className="game-banner-deco" style={{ gap: 6 }}>
                {CRASH_MULTS.map((m, i) => (
                  <motion.span
                    key={m + i}
                    style={{
                      fontSize: 13, fontWeight: 800,
                      color: CRASH_COLORS[i],
                      fontFamily: 'var(--font-display)',
                      opacity: 0.9,
                    }}
                    animate={{ y: [0, -5, 0] }}
                    transition={{ duration: 1.8 + i * 0.3, delay: i * 0.2, repeat: Infinity, ease: 'easeInOut' }}
                  >
                    {m}
                  </motion.span>
                ))}
              </div>
            </motion.button>
          )}
        </AnimatePresence>
      </motion.div>

      {/* ── Feature strip ── */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
        style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}
      >
        {[
          { icon: '🔒', label: 'Provably Fair' },
          { icon: '⚡', label: 'Instant Payouts' },
          { icon: '🎲', label: 'RNG Certified' },
        ].map((f) => (
          <div
            key={f.label}
            style={{
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: 10,
              padding: '10px 8px',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: 20, marginBottom: 4 }}>{f.icon}</div>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{f.label}</div>
          </div>
        ))}
      </motion.div>
    </motion.div>
  );
}
