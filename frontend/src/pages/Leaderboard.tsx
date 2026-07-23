import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { Trophy } from 'lucide-react';
import { walletApi } from '../lib/api';
import type { LeaderboardEntry } from '../lib/models';

type Period = 'all' | 'monthly' | 'weekly';

const PERIOD_KEY: Record<Period, string> = {
  all: 'leaderboard.all',
  monthly: 'leaderboard.monthly',
  weekly: 'leaderboard.weekly',
};

const MEDAL: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' };

function formatMinor(minor: number) {
  if (minor >= 1_000_000) return `${(minor / 1_000_000).toFixed(1)}M`;
  if (minor >= 1_000) return `${(minor / 1_000).toFixed(minor % 1000 === 0 ? 0 : 1)}K`;
  return String(minor);
}

export function Leaderboard() {
  const { t } = useTranslation();
  const [period, setPeriod] = useState<Period>('all');
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    walletApi.getLeaderboard(period, 20)
      .then(setEntries)
      .catch(() => setEntries([]))
      .finally(() => setLoading(false));
  }, [period]);

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', padding: '16px 12px 80px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
        <Trophy size={22} strokeWidth={1.8} style={{ color: 'var(--accent)' }} />
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>{t('leaderboard.title')}</h2>
      </div>

      {/* Period switcher */}
      <div style={{
        display: 'flex',
        gap: 6,
        marginBottom: 20,
        background: 'var(--card-bg)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: 4,
      }}>
        {(['all', 'monthly', 'weekly'] as Period[]).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setPeriod(p)}
            style={{
              flex: 1,
              padding: '7px 0',
              borderRadius: 7,
              border: 'none',
              cursor: 'pointer',
              fontWeight: period === p ? 700 : 500,
              fontSize: 13,
              background: period === p ? 'var(--accent)' : 'transparent',
              color: period === p ? '#fff' : 'var(--text-secondary)',
              transition: 'all 0.18s',
            }}
          >
            {t(PERIOD_KEY[p])}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
          <div className="spinner" />
        </div>
      ) : entries.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)', fontSize: 14 }}>
          {t('leaderboard.empty')}
        </div>
      ) : (
        <AnimatePresence mode="wait">
          <motion.div
            key={period}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
          >
            {entries.map((entry) => (
              <motion.div
                key={entry.rank}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: entry.rank * 0.04 }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  background: entry.rank <= 3 ? 'var(--card-bg)' : 'var(--surface)',
                  border: `1px solid ${entry.rank === 1 ? 'var(--accent)' : 'var(--border)'}`,
                  borderRadius: 12,
                  padding: '12px 14px',
                  boxShadow: entry.rank === 1 ? '0 0 0 1px var(--accent)22' : 'none',
                }}
              >
                {/* Rank */}
                <div style={{
                  minWidth: 30,
                  fontWeight: 700,
                  fontSize: entry.rank <= 3 ? 22 : 15,
                  textAlign: 'center',
                  color: entry.rank <= 3 ? undefined : 'var(--text-muted)',
                }}>
                  {MEDAL[entry.rank] ?? `#${entry.rank}`}
                </div>

                {/* Name + win count */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {entry.displayName}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>
                    {entry.winCount} {t('leaderboard.wins')}
                  </div>
                </div>

                {/* Total won */}
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--accent)' }}>
                    {formatMinor(entry.totalWinMinor)}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>ETB</div>
                </div>
              </motion.div>
            ))}
          </motion.div>
        </AnimatePresence>
      )}
    </div>
  );
}
