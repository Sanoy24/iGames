import { Zap, Trophy, Wallet as WalletIcon } from 'lucide-react';
import { formatCredits, useStore } from '../store/useStore';
import type { AppTab } from '../lib/navigation';

type Props = {
  onNavigate: (tab: AppTab) => void;
};

const FEATURE_CARDS: Array<{
  id: 'keno' | 'bingo' | 'wallet';
  icon: React.ReactNode;
  eyebrow: string;
  title: string;
  description: string;
  cta: string;
}> = [
  {
    id: 'keno',
    icon: <Zap size={18} />,
    eyebrow: 'Fast Picks',
    title: 'Play Keno',
    description: 'Choose your lucky numbers, join the next draw, and track results in real time.',
    cta: 'Open Keno',
  },
  {
    id: 'bingo',
    icon: <Trophy size={18} />,
    eyebrow: 'Live Rooms',
    title: 'Join Bingo',
    description: 'Browse rooms, buy tickets, and follow live ball draws as prize tiers settle.',
    cta: 'View Rooms',
  },
  {
    id: 'wallet',
    icon: <WalletIcon size={18} />,
    eyebrow: 'Balance',
    title: 'Your Wallet',
    description: 'Review available credits, reserved funds, and your latest activity.',
    cta: 'Open Wallet',
  },
];

export function Home({ onNavigate }: Props) {
  const user = useStore((state) => state.user);
  const wallet = useStore((state) => state.wallet);

  return (
    <div className="stack-lg">
      <section className="hero-panel">
        <h1 className="hero-title">Welcome back, {user?.displayName ?? 'Player'}</h1>
        <p className="hero-copy">
          Play Keno and Bingo, top up your balance, and track live draw results — all in one place.
        </p>
        <div className="hero-stats">
          <div className="hero-stat">
            <span className="hero-stat-label">Available Credits</span>
            <strong>{formatCredits(wallet?.availableMinor ?? 0)}</strong>
          </div>
          <div className="hero-stat">
            <span className="hero-stat-label">Reserved</span>
            <strong>{formatCredits(wallet?.reservedMinor ?? 0)}</strong>
          </div>
        </div>
        <div className="hero-actions">
          <button className="btn btn-primary" onClick={() => onNavigate('games')}>
            Browse Games
          </button>
          <button className="btn btn-secondary" onClick={() => onNavigate('bingo')}>
            Join Bingo
          </button>
        </div>
      </section>

      <section className="section-header">
        <div>
          <div className="section-title">Quick Actions</div>
          <p className="section-copy">Jump into a game or check your balance.</p>
        </div>
      </section>

      <div className="feature-grid">
        {FEATURE_CARDS.map((card) => (
          <button key={card.id} className="feature-card" onClick={() => onNavigate(card.id)}>
            <span className="feature-eyebrow feature-eyebrow-icon">
              {card.icon}
              {card.eyebrow}
            </span>
            <h2>{card.title}</h2>
            <p>{card.description}</p>
            <span className="feature-cta">{card.cta}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
