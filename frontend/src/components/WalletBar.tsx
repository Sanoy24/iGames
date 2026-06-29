import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, Plus } from 'lucide-react';
import type { AppTab } from '../lib/navigation';
import { useStore } from '../store/useStore';
import { walletApi } from '../lib/api';
import { NotificationBell } from './NotificationBell';

type Props = { onNavigate: (tab: AppTab) => void; };

function EBirrIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
      <rect x="2" y="8" width="18" height="11" rx="2" fill="currentColor" opacity="0.15" transform="rotate(-5 2 8)" />
      <rect x="2" y="8" width="18" height="11" rx="2" stroke="currentColor" strokeWidth="1.3" fill="none" transform="rotate(-5 2 8)" />
      <circle cx="15.5" cy="11.5" r="5.5" fill="currentColor" opacity="0.22" />
      <circle cx="15.5" cy="11.5" r="5.5" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <circle cx="15.5" cy="11.5" r="3.2" stroke="currentColor" strokeWidth="0.9" fill="none" opacity="0.55" />
      <text x="15.5" y="14.8" textAnchor="middle" fontSize="5.5" fontWeight="900" fill="currentColor" fontFamily="system-ui, -apple-system, sans-serif">ε</text>
      <circle cx="5" cy="13.5" r="1.1" fill="currentColor" opacity="0.45" />
      <circle cx="5" cy="16.5" r="1.1" fill="currentColor" opacity="0.45" />
    </svg>
  );
}

export function WalletBar({ onNavigate }: Props) {
  const wallet = useStore((s) => s.wallet);
  const setWallet = useStore((s) => s.setWallet);
  const isSocketConnected = useStore((s) => s.isSocketConnected);

  const balance = wallet?.availableMinor ?? 0;
  const formatted = new Intl.NumberFormat().format(balance);

  const prevBalanceRef = useRef(balance);
  const [flashClass, setFlashClass] = useState('');
  const [spinning, setSpinning] = useState(false);

  useEffect(() => {
    if (prevBalanceRef.current === balance) return;
    setFlashClass(balance > prevBalanceRef.current ? 'balance-increase' : 'balance-decrease');
    prevBalanceRef.current = balance;
    const t = setTimeout(() => setFlashClass(''), 1400);
    return () => clearTimeout(t);
  }, [balance]);

  const refreshWallet = useCallback(async () => {
    if (spinning) return;
    setSpinning(true);
    try {
      const updated = await walletApi.getWallet();
      setWallet(updated);
    } catch { /* ignore */ } finally {
      setSpinning(false);
    }
  }, [spinning, setWallet]);

  return (
    <div className="wallet-bar" style={{ cursor: 'default' }}>
      <div
        role="button"
        tabIndex={0}
        onClick={() => onNavigate('wallet')}
        onKeyDown={(e) => e.key === 'Enter' && onNavigate('wallet')}
        style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, cursor: 'pointer', minWidth: 0 }}
      >
        <div
          className={`wallet-bar-status ${isSocketConnected ? 'wallet-bar-status-ok' : 'wallet-bar-status-off'}`}
          title={isSocketConnected ? 'Live — connected' : 'Offline'}
        />
        <EBirrIcon size={20} />
        <span className={`wallet-bar-balance ${flashClass}`}>
          {formatted}
          <span className="wallet-bar-unit"> e‑Birr</span>
        </span>
      </div>

      <button
        className="wallet-bar-add"
        type="button"
        onClick={(e) => { e.stopPropagation(); onNavigate('wallet'); }}
      >
        <Plus size={11} />
        Top Up
      </button>

      <NotificationBell />

      <button
        className="wallet-bar-refresh"
        type="button"
        aria-label="Refresh wallet"
        disabled={spinning}
        onClick={(e) => { e.stopPropagation(); void refreshWallet(); }}
      >
        <RefreshCw
          size={15}
          style={{
            transition: 'transform 0.5s',
            transform: spinning ? 'rotate(180deg)' : 'rotate(0deg)',
          }}
        />
      </button>
    </div>
  );
}
