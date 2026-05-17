import { formatCredits, useStore } from '../store/useStore';

export function WalletBar() {
  const wallet = useStore((s) => s.wallet);
  const balance = wallet?.availableMinor ?? 0;

  return (
    <div className="wallet-bar">
      <span className="wallet-bar-icon">💰</span>
      <span className="wallet-bar-balance">
        {formatCredits(balance)}
        <span className="wallet-bar-unit"> Credits</span>
      </span>
    </div>
  );
}
