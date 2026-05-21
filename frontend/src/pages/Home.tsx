import { formatCredits, useStore } from '../store/useStore';
import { formatCreditsFull } from '../lib/utils';
import type { AppTab } from '../lib/navigation';

type Props = {
  onNavigate: (tab: AppTab) => void;
};

const FEATURE_CARDS: Array<{
  id: 'keno' | 'bingo' | 'wallet';
  eyebrow: string;
  title: string;
  description: string;
  cta: string;
}> = [
  {
    id: 'keno',
    eyebrow: 'Fast Picks',
    title: 'Play Keno',
    description: 'Choose your lucky numbers, join the next draw, and track results in real time.',
    cta: 'Open Keno',
  },
  {
    id: 'bingo',
    eyebrow: 'Live Rooms',
    title: 'Join Bingo',
    description: 'Browse rooms, buy tickets, and follow live ball draws as prize tiers settle.',
    cta: 'View Rooms',
  },
  {
    id: 'wallet',
    eyebrow: 'Balance',
    title: 'Check Wallet',
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
        <div className="badge badge-gold">Telegram Mini App</div>
        <h1 className="hero-title">Welcome back, {user?.displayName ?? 'Player'}</h1>
        <p className="hero-copy">
          The backend stays standalone and reusable, while this frontend gives you a Telegram-first
          mini app experience for games, wallet activity, and live draw updates.
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
          <p className="section-copy">Tap into the core flows already available in the backend.</p>
        </div>
      </section>

      <div className="feature-grid">
        {FEATURE_CARDS.map((card) => (
          <button key={card.id} className="feature-card" onClick={() => onNavigate(card.id)}>
            <span className="feature-eyebrow">{card.eyebrow}</span>
            <h2>{card.title}</h2>
            <p>{card.description}</p>
            <span className="feature-cta">{card.cta}</span>
          </button>
        ))}
      </div>

      <section className="card info-card">
        <div className="section-header">
          <div>
            <div className="section-title">Session Summary</div>
            <p className="section-copy">Current app identity and wallet snapshot.</p>
          </div>
        </div>
        <div className="key-value-list">
          <div className="key-value-row">
            <span>Player</span>
            <strong>{user?.displayName ?? 'Unknown'}</strong>
          </div>
          <div className="key-value-row">
            <span>Roles</span>
            <strong>{user?.roles.join(', ') ?? 'player'}</strong>
          </div>
          <div className="key-value-row">
            <span>Spendable</span>
            <strong>{formatCreditsFull(wallet?.availableMinor ?? 0)} Credits</strong>
          </div>
          <div className="key-value-row">
            <span>Wallet Status</span>
            <strong>{wallet?.status ?? 'loading'}</strong>
          </div>
        </div>
      </section>
    </div>
  );
}
