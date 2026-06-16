import type { AppTab } from '../lib/navigation';
import { useStore } from '../store/useStore';

type Props = {
  onNavigate: (tab: AppTab) => void;
};

// Custom e-Birr money icon — coin-stack + bill layered illustration
function EBirrIcon({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ flexShrink: 0 }}
    >
      {/* Bill background (slightly rotated) */}
      <rect
        x="2" y="8" width="18" height="11" rx="2"
        fill="currentColor" opacity="0.15"
        transform="rotate(-5 2 8)"
      />
      <rect
        x="2" y="8" width="18" height="11" rx="2"
        stroke="currentColor" strokeWidth="1.3" fill="none"
        transform="rotate(-5 2 8)"
      />

      {/* Front coin (gold circle) */}
      <circle cx="15.5" cy="11.5" r="5.5" fill="currentColor" opacity="0.22" />
      <circle cx="15.5" cy="11.5" r="5.5" stroke="currentColor" strokeWidth="1.5" fill="none" />

      {/* Inner ring on coin */}
      <circle cx="15.5" cy="11.5" r="3.2" stroke="currentColor" strokeWidth="0.9" fill="none" opacity="0.55" />

      {/* "ε" / Birr symbol on coin */}
      <text
        x="15.5"
        y="14.8"
        textAnchor="middle"
        fontSize="5.5"
        fontWeight="900"
        fill="currentColor"
        fontFamily="system-ui, -apple-system, sans-serif"
      >
        ε
      </text>

      {/* Dollar-sign dot detail on bill */}
      <circle cx="5" cy="13.5" r="1.1" fill="currentColor" opacity="0.45" />
      <circle cx="5" cy="16.5" r="1.1" fill="currentColor" opacity="0.45" />
    </svg>
  );
}

export function WalletBar({ onNavigate }: Props) {
  const wallet = useStore((s) => s.wallet);
  const balance = wallet?.availableMinor ?? 0;

  // Format with full number, no K/M abbreviation for the bar
  const formatted = new Intl.NumberFormat().format(balance);

  return (
    <button className="wallet-bar" onClick={() => onNavigate('wallet')} type="button">
      <EBirrIcon size={22} />
      <span className="wallet-bar-balance">
        {formatted}
        <span className="wallet-bar-unit"> e‑Birr</span>
      </span>
    </button>
  );
}
