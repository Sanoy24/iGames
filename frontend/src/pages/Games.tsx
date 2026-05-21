import type { CSSProperties } from 'react';
import type { AppTab } from '../lib/navigation';

type Props = {
  onNavigate: (tab: AppTab) => void;
};

const BINGO_LETTERS = ['B', 'I', 'N', 'G', 'O'];
const BINGO_COLORS = ['#4ade80', '#facc15', '#60a5fa', '#f87171', '#c084fc'];
const KENO_BALLS = [7, 23, 45, 68, 80];

export function Games({ onNavigate }: Props) {
  return (
    <div className="stack-lg">
      <section className="games-hero">
        <div className="badge badge-gold">Games</div>
        <h1 className="hero-title">Choose a game</h1>
        <p className="hero-copy">Pick a game and start playing — results settle in real time.</p>
      </section>

      <div className="game-banner-list">
        {/* ── Bingo ── */}
        <button className="game-banner game-banner-bingo" onClick={() => onNavigate('bingo')}>
          <div className="game-banner-content">
            <span className="game-banner-tag">Room based</span>
            <h2 className="game-banner-title">Bingo</h2>
            <p className="game-banner-desc">
              Join scheduled rooms, buy cards, and chase one-line, two-line, and full-house prizes.
            </p>
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
        </button>

        {/* ── Keno ── */}
        <button className="game-banner game-banner-keno" onClick={() => onNavigate('keno')}>
          <div className="game-banner-content">
            <span className="game-banner-tag">Fast draw</span>
            <h2 className="game-banner-title">Keno</h2>
            <p className="game-banner-desc">
              Pick 1–12 numbers, buy a ticket, and watch 20 numbers drawn live every round.
            </p>
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
        </button>
      </div>
    </div>
  );
}
