import type { AppTab } from '../lib/navigation';
import { formatCredits } from '../store/useStore';

type Props = {
  onNavigate: (tab: AppTab) => void;
};

const GAMES: Array<{
  id: Extract<AppTab, 'keno' | 'bingo'>;
  title: string;
  tag: string;
  description: string;
  details: string[];
  action: string;
}> = [
  {
    id: 'keno',
    title: 'Keno',
    tag: 'Fast draw',
    description: 'Pick numbers, buy a ticket, and follow settled draws in real time.',
    details: ['1-12 spots', 'Live draw updates', `${formatCredits(100)}+ credits`],
    action: 'Open Keno',
  },
  {
    id: 'bingo',
    title: '90-Ball Bingo',
    tag: 'Room based',
    description: 'Join scheduled rooms, buy cards, and track one-line, two-line, and full-house wins.',
    details: ['Live rooms', 'Multiple tickets', 'Tiered prizes'],
    action: 'Open Bingo',
  },
];

export function Games({ onNavigate }: Props) {
  return (
    <div className="stack-lg">
      <section className="games-hero">
        <div>
          <div className="badge badge-gold">Games</div>
          <h1 className="hero-title">Choose a game</h1>
          <p className="hero-copy">
            Start from one place, then jump into the game flow you want to play.
          </p>
        </div>
      </section>

      <section className="games-grid">
        {GAMES.map((game) => (
          <button key={game.id} className={`game-card game-card-${game.id}`} onClick={() => onNavigate(game.id)}>
            <span className="feature-eyebrow">{game.tag}</span>
            <h2>{game.title}</h2>
            <p>{game.description}</p>
            <div className="game-detail-row">
              {game.details.map((detail) => (
                <span key={detail}>{detail}</span>
              ))}
            </div>
            <span className="feature-cta">{game.action}</span>
          </button>
        ))}
      </section>
    </div>
  );
}
