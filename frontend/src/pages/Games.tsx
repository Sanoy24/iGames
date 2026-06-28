import { useState, type CSSProperties } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { AppTab } from '../lib/navigation';
import { useStore } from '../store/useStore';

type Props = { onNavigate: (tab: AppTab) => void; };

type Filter = 'all' | 'keno' | 'bingo';

const BINGO_LETTERS = ['B', 'I', 'N', 'G', 'O'];
const BINGO_COLORS = ['#4ade80', '#facc15', '#60a5fa', '#f87171', '#c084fc'];
const KENO_BALLS = [7, 23, 45, 68, 80];

const FILTER_CHIPS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All Games' },
  { id: 'keno', label: '⚡ Fast Draw' },
  { id: 'bingo', label: '🎯 Live Rooms' },
];

export function Games({ onNavigate }: Props) {
  const liveCounts = useStore((s) => s.liveCounts);
  const [filter, setFilter] = useState<Filter>('all');

  const showKeno = filter === 'all' || filter === 'keno';
  const showBingo = filter === 'all' || filter === 'bingo';

  return (
    <div className="stack-lg">
      <section className="games-hero">
        <div className="badge badge-gold">Games</div>
        <h1 className="hero-title">Choose a game</h1>
        {liveCounts && (
          <p className="hero-copy">
            {liveCounts.totalOnline} players online
            {liveCounts.totalPlaying > 0 ? ` · ${liveCounts.totalPlaying} playing` : ''}
          </p>
        )}
      </section>

      {/* Filter chips */}
      <div className="game-filter-row">
        {FILTER_CHIPS.map(chip => (
          <button
            key={chip.id}
            className={`game-filter-chip${filter === chip.id ? ' active' : ''}`}
            onClick={() => setFilter(chip.id)}
          >
            {chip.label}
          </button>
        ))}
      </div>

      <div className="game-banner-list">
        <AnimatePresence>
          {/* ── Bingo ── */}
          {showBingo && (
            <motion.button
              layout
              key="bingo"
              className="game-banner game-banner-bingo"
              onClick={() => onNavigate('bingo')}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12, scale: 0.97 }}
              whileHover={{ scale: 1.015, y: -2 }}
              whileTap={{ scale: 0.98 }}
              transition={{ type: 'spring', stiffness: 340, damping: 24 }}
            >
              <div className="game-banner-content">
                <span className="game-banner-tag">
                  Room based
                  {liveCounts && liveCounts.bingoOnline > 0 && (
                    <span className="live-pill-inline" style={{ marginLeft: 6 }}>🟢 {liveCounts.bingoOnline} online</span>
                  )}
                </span>
                <h2 className="game-banner-title">Bingo</h2>
                <p className="game-banner-desc">
                  Join scheduled rooms, buy cards, and chase one-line, two-line, and full-house prizes.
                </p>
                <div className="game-banner-stats">
                  <span className="game-stat-pill">🎟 Buy 1-5 cards</span>
                  <span className="game-stat-pill">🏆 3 prize tiers</span>
                  <span className="game-stat-pill">90 balls drawn</span>
                </div>
                <span className="game-banner-cta">Play Now →</span>
              </div>
              <div className="game-banner-deco">
                {BINGO_LETTERS.map((letter, i) => (
                  <span
                    key={letter}
                    className="bingo-tile"
                    style={{ '--tile-color': BINGO_COLORS[i], animationDelay: `${i * 0.18}s` } as CSSProperties}
                  >
                    {letter}
                  </span>
                ))}
              </div>
            </motion.button>
          )}

          {/* ── Keno ── */}
          {showKeno && (
            <motion.button
              layout
              key="keno"
              className="game-banner game-banner-keno"
              onClick={() => onNavigate('keno')}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12, scale: 0.97 }}
              whileHover={{ scale: 1.015, y: -2 }}
              whileTap={{ scale: 0.98 }}
              transition={{ type: 'spring', stiffness: 340, damping: 24 }}
            >
              <div className="game-banner-content">
                <span className="game-banner-tag">
                  Fast draw
                  {liveCounts && liveCounts.kenoOnline > 0 && (
                    <span className="live-pill-inline" style={{ marginLeft: 6 }}>🟢 {liveCounts.kenoOnline} online</span>
                  )}
                </span>
                <h2 className="game-banner-title">Keno</h2>
                <p className="game-banner-desc">
                  Pick 1–12 numbers, buy a ticket, and watch 20 numbers drawn live every round.
                </p>
                <div className="game-banner-stats">
                  <span className="game-stat-pill">⚡ Fast rounds</span>
                  <span className="game-stat-pill">🎯 Pick 1-12 spots</span>
                  <span className="game-stat-pill">80 number grid</span>
                </div>
                <span className="game-banner-cta">Play Now →</span>
              </div>
              <div className="game-banner-deco game-banner-deco-keno">
                {KENO_BALLS.map((n, i) => (
                  <span
                    key={n}
                    className="keno-ball-deco"
                    style={{ animationDelay: `${i * 0.2}s`, '--bsize': `${32 + i * 5}px` } as CSSProperties}
                  >
                    {n}
                  </span>
                ))}
              </div>
            </motion.button>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
