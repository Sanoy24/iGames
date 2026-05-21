import { Coins } from 'lucide-react';
import type { AppTab } from '../lib/navigation';
import { formatCredits, useStore } from '../store/useStore';

type Props = {
  onNavigate: (tab: AppTab) => void;
};

export function WalletBar({ onNavigate }: Props) {
  const wallet = useStore((s) => s.wallet);
  const balance = wallet?.availableMinor ?? 0;

  return (
    <button className="wallet-bar" onClick={() => onNavigate('wallet')} type="button">
      <Coins size={17} strokeWidth={2.2} />
      <span className="wallet-bar-balance">
        {formatCredits(balance)}
        <span className="wallet-bar-unit"> Credits</span>
      </span>
    </button>
  );
}
