import type { AppTab } from '../lib/navigation';
import { useStore } from '../store/useStore';

type Props = {
  active: AppTab;
  onChange: (tab: AppTab) => void;
};

const PLAYER_TABS: Array<{ id: AppTab; icon: string; label: string }> = [
  { id: 'home', icon: 'Home', label: 'Home' },
  { id: 'games', icon: 'Play', label: 'Games' },
  { id: 'wallet', icon: 'Pay', label: 'Wallet' },
];

export function BottomNav({ active, onChange }: Props) {
  const user = useStore((s) => s.user);
  const isAdmin = user?.roles.includes('admin') ?? false;

  const tabs = isAdmin ? [...PLAYER_TABS, { id: 'admin' as const, icon: 'Ops', label: 'Admin' }] : PLAYER_TABS;
  const isActive = (tabId: AppTab) => active === tabId || (tabId === 'games' && (active === 'keno' || active === 'bingo'));

  return (
    <nav className="bottom-nav" aria-label="Primary navigation">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          className={`nav-item${isActive(tab.id) ? ' active' : ''}`}
          onClick={() => onChange(tab.id)}
          type="button"
        >
          <span className="nav-icon">{tab.icon}</span>
          <span>{tab.label}</span>
        </button>
      ))}
    </nav>
  );
}
