import { useStore } from '../store/useStore';

type Tab = 'home' | 'keno' | 'bingo' | 'wallet' | 'admin';

type Props = {
  active: Tab;
  onChange: (tab: Tab) => void;
};

const PLAYER_TABS = [
  { id: 'home' as const, icon: '🏠', label: 'Home' },
  { id: 'keno' as const, icon: '🎰', label: 'Keno' },
  { id: 'bingo' as const, icon: '🎱', label: 'Bingo' },
  { id: 'wallet' as const, icon: '💳', label: 'Wallet' },
];

export function BottomNav({ active, onChange }: Props) {
  const user = useStore((s) => s.user);
  const isAdmin = user?.roles.includes('admin') ?? false;

  const tabs = isAdmin
    ? [...PLAYER_TABS, { id: 'admin' as const, icon: '⚙️', label: 'Admin' }]
    : PLAYER_TABS;

  return (
    <nav className="bottom-nav">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          className={`nav-item${active === tab.id ? ' active' : ''}`}
          onClick={() => onChange(tab.id)}
        >
          <span className="nav-icon">{tab.icon}</span>
          {tab.label}
        </button>
      ))}
    </nav>
  );
}
