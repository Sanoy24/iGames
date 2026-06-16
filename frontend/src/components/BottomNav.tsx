import {
  Home, House,
  Gamepad2, Joystick,
  Wallet, WalletMinimal,
  ShieldCheck, Shield,
  Users, UserCheck,
  CircleUserRound, UserCircle,
} from 'lucide-react';
import type { AppTab } from '../lib/navigation';
import { useStore } from '../store/useStore';

type Props = {
  active: AppTab;
  onChange: (tab: AppTab) => void;
};

type NavEntry = {
  id: AppTab;
  label: string;
  icon: React.ReactNode;
  activeIcon: React.ReactNode;
};

export function BottomNav({ active, onChange }: Props) {
  const user = useStore((s) => s.user);
  const roles = user?.roles ?? [];
  const isPlayer = roles.includes('player');
  const isAdmin  = roles.includes('admin');
  const isAgent  = roles.includes('agent');

  const isActive = (id: AppTab) =>
    active === id || (id === 'games' && (active === 'keno' || active === 'bingo'));

  const playerTabs: NavEntry[] = [
    { id: 'home',   label: 'Home',   icon: <Home size={21} strokeWidth={1.8} />,         activeIcon: <House size={21} strokeWidth={2.2} /> },
    { id: 'games',  label: 'Games',  icon: <Gamepad2 size={21} strokeWidth={1.8} />,      activeIcon: <Joystick size={21} strokeWidth={2.2} /> },
    { id: 'wallet', label: 'Wallet', icon: <Wallet size={21} strokeWidth={1.8} />,        activeIcon: <WalletMinimal size={21} strokeWidth={2.2} /> },
  ];

  const agentTabs: NavEntry[] = [
    { id: 'agent',  label: 'Agent',  icon: <Users size={21} strokeWidth={1.8} />,         activeIcon: <UserCheck size={21} strokeWidth={2.2} /> },
  ];

  const adminTabs: NavEntry[] = [
    { id: 'admin',  label: 'Admin',  icon: <Shield size={21} strokeWidth={1.8} />,        activeIcon: <ShieldCheck size={21} strokeWidth={2.2} /> },
  ];

  const profileTab: NavEntry = {
    id: 'profile', label: 'Profile',
    icon: <CircleUserRound size={21} strokeWidth={1.8} />,
    activeIcon: <UserCircle size={21} strokeWidth={2.2} />,
  };

  const tabs: NavEntry[] = [
    ...(isPlayer ? playerTabs : []),
    ...(isAgent  ? agentTabs  : []),
    ...(isAdmin  ? adminTabs  : []),
    profileTab,
  ];

  return (
    <nav className="bottom-nav" aria-label="Primary navigation">
      {tabs.map((tab) => {
        const on = isActive(tab.id);
        return (
          <button
            key={tab.id}
            className={`nav-item${on ? ' active' : ''}`}
            onClick={() => onChange(tab.id)}
            type="button"
            aria-label={tab.label}
            aria-current={on ? 'page' : undefined}
          >
            {on ? tab.activeIcon : tab.icon}
            <span>{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
