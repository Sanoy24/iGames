import { motion, AnimatePresence } from 'framer-motion';
import {
  Home, House,
  Gamepad2, Joystick,
  Wallet, WalletMinimal,
  ShieldCheck, Shield,
  Users, UserCheck,
  CircleUserRound, UserCircle,
  Trophy,
} from 'lucide-react';
import type { AppTab } from '../lib/navigation';
import { useStore } from '../store/useStore';
import { soundEngine } from '../lib/audio';

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
    active === id || (id === 'games' && (active === 'keno' || active === 'bingo' || active === 'crash'));

  const playerTabs: NavEntry[] = [
    { id: 'home',        label: 'Home',        icon: <Home size={22} strokeWidth={1.6} />,       activeIcon: <House size={22} strokeWidth={2.4} /> },
    { id: 'games',       label: 'Games',       icon: <Gamepad2 size={22} strokeWidth={1.6} />,   activeIcon: <Joystick size={22} strokeWidth={2.4} /> },
    { id: 'leaderboard', label: 'Top',         icon: <Trophy size={22} strokeWidth={1.6} />,     activeIcon: <Trophy size={22} strokeWidth={2.4} /> },
    { id: 'wallet',      label: 'Wallet',      icon: <Wallet size={22} strokeWidth={1.6} />,     activeIcon: <WalletMinimal size={22} strokeWidth={2.4} /> },
  ];

  const agentTabs: NavEntry[] = [
    { id: 'agent',  label: 'Agent',  icon: <Users size={22} strokeWidth={1.6} />,     activeIcon: <UserCheck size={22} strokeWidth={2.4} /> },
  ];

  const adminTabs: NavEntry[] = [
    { id: 'admin',  label: 'Admin',  icon: <Shield size={22} strokeWidth={1.6} />,    activeIcon: <ShieldCheck size={22} strokeWidth={2.4} /> },
  ];

  const profileTab: NavEntry = {
    id: 'profile', label: 'Profile',
    icon: <CircleUserRound size={22} strokeWidth={1.6} />,
    activeIcon: <UserCircle size={22} strokeWidth={2.4} />,
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
          <motion.button
            key={tab.id}
            className={`nav-item${on ? ' active' : ''}`}
            onClick={() => { soundEngine.click(); onChange(tab.id); }}
            type="button"
            aria-label={tab.label}
            aria-current={on ? 'page' : undefined}
            whileTap={{ scale: 0.85 }}
            transition={{ type: 'spring', stiffness: 400, damping: 20 }}
          >
            {/* Active glow bubble */}
            <AnimatePresence>
              {on && (
                <motion.span
                  key="bubble"
                  layoutId="nav-bubble"
                  className="nav-active-bubble"
                  initial={{ scale: 0.6, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.6, opacity: 0 }}
                  transition={{ type: 'spring', stiffness: 380, damping: 26 }}
                />
              )}
            </AnimatePresence>

            <motion.span
              className="nav-icon-wrap"
              animate={on ? { y: -2 } : { y: 0 }}
              transition={{ type: 'spring', stiffness: 400, damping: 22 }}
            >
              {on ? tab.activeIcon : tab.icon}
            </motion.span>
            <span>{tab.label}</span>
          </motion.button>
        );
      })}
    </nav>
  );
}
