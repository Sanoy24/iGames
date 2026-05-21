import { Home, Gamepad2, Wallet, ShieldCheck, Users, UserCircle } from 'lucide-react';
import type { AppTab } from '../lib/navigation';
import { useStore } from '../store/useStore';

type Props = {
  active: AppTab;
  onChange: (tab: AppTab) => void;
};

export function BottomNav({ active, onChange }: Props) {
  const user = useStore((s) => s.user);
  const isAdmin = user?.roles.includes('admin') ?? false;
  const isAgent = user?.roles.includes('agent') ?? false;

  const isActive = (tabId: AppTab) =>
    active === tabId || (tabId === 'games' && (active === 'keno' || active === 'bingo'));

  return (
    <nav className="bottom-nav" aria-label="Primary navigation">
      <button className={`nav-item${isActive('home') ? ' active' : ''}`} onClick={() => onChange('home')} type="button">
        <Home size={20} strokeWidth={2} />
        <span>Home</span>
      </button>
      <button className={`nav-item${isActive('games') ? ' active' : ''}`} onClick={() => onChange('games')} type="button">
        <Gamepad2 size={20} strokeWidth={2} />
        <span>Games</span>
      </button>
      <button className={`nav-item${isActive('wallet') ? ' active' : ''}`} onClick={() => onChange('wallet')} type="button">
        <Wallet size={20} strokeWidth={2} />
        <span>Wallet</span>
      </button>
      <button className={`nav-item${isActive('profile') ? ' active' : ''}`} onClick={() => onChange('profile')} type="button">
        <UserCircle size={20} strokeWidth={2} />
        <span>Profile</span>
      </button>
      {isAdmin && (
        <button className={`nav-item${isActive('admin') ? ' active' : ''}`} onClick={() => onChange('admin')} type="button">
          <ShieldCheck size={20} strokeWidth={2} />
          <span>Admin</span>
        </button>
      )}
      {isAgent && (
        <button className={`nav-item${isActive('agent') ? ' active' : ''}`} onClick={() => onChange('agent')} type="button">
          <Users size={20} strokeWidth={2} />
          <span>Agent</span>
        </button>
      )}
    </nav>
  );
}
