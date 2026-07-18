import { useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { Zap, Users, Clock, Trophy, Star, TrendingUp, Target } from 'lucide-react';
import type { AppTab } from '../lib/navigation';
import { useStore } from '../store/useStore';

type Props = { onNavigate: (tab: AppTab) => void; };

type Filter = 'all' | 'keno' | 'bingo' | 'crash' | 'pool';

const BINGO_LETTERS = ['B', 'I', 'N', 'G', 'O'];
const BINGO_COLORS = ['#4ade80', '#facc15', '#60a5fa', '#f87171', '#c084fc'];
const KENO_BALLS = [7, 23, 45, 68, 80];
const CRASH_MULTS = ['1.23×', '2.50×', '5.00×', '1.05×'];
const CRASH_COLORS = ['#10b981', '#10b981', '#ef4444', '#ef4444'];

const FILTER_CHIPS: { id: Filter; labelKey: string; icon: string }[] = [
  { id: 'all',   labelKey: 'games.filterAll',   icon: '🎮' },
  { id: 'keno',  labelKey: 'games.filterKeno',  icon: '⚡' },
  { id: 'bingo', labelKey: 'games.filterBingo', icon: '🎯' },
  { id: 'crash', labelKey: 'games.filterCrash', icon: '🚀' },
  { id: 'pool',  labelKey: 'games.filterPool',  icon: '🎱' },
];

const containerVariants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  show:   { opacity: 1, y: 0,  transition: { type: 'spring' as const, stiffness: 320, damping: 26 } },
};

export function Games({ onNavigate }: Props) {
  const { t } = useTranslation();
  const liveCounts = useStore((s) => s.liveCounts);
  const gameCatalog = useStore((s) => s.gameCatalog);
  const addToast = useStore((s) => s.addToast);
  const [filter, setFilter] = useState<Filter>('all');

  // Availability: while the catalog is loading (null) default to visible+playable.
  // Once loaded, a game missing from the catalog is hidden by the backend.
  const gameInfo = (code: 'keno' | 'bingo' | 'crash' | 'pool') => {
    if (!gameCatalog) return { hidden: false, maint: false, msg: '' };
    const entry = gameCatalog.find((g) => g.code === code);
    if (!entry) return { hidden: true, maint: false, msg: '' };
    return {
      hidden: entry.state === 'hidden',
      maint: entry.state === 'maintenance',
      msg: entry.maintenanceMessage || `${entry.name} is under maintenance. Please try again later.`,
    };
  };
  const keno = gameInfo('keno');
  const bingo = gameInfo('bingo');
  const crash = gameInfo('crash');
  const pool = gameInfo('pool');

  const open = (code: 'keno' | 'bingo' | 'crash' | 'pool', info: { maint: boolean; msg: string }) =>
    info.maint ? addToast('info', info.msg) : onNavigate(code);

  const showKeno  = (filter === 'all' || filter === 'keno')  && !keno.hidden;
  const showBingo = (filter === 'all' || filter === 'bingo') && !bingo.hidden;
  const showCrash = (filter === 'all' || filter === 'crash') && !crash.hidden;
  const showPool  = (filter === 'all' || filter === 'pool')  && !pool.hidden;

  return (
    <motion.div
      className="stack-lg"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 28 }}
    >
      {/* ── Hero ── */}
      <section className="games-hero">
        <motion.div
          className="badge badge-gold"
          initial={{ scale: 0.7, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 400, damping: 20, delay: 0.05 }}
        >
          {t('nav.games')}
        </motion.div>
        <motion.h1
          className="hero-title"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.3 }}
        >
          {t('games.chooseGame')}
        </motion.h1>
        {liveCounts && (
          <motion.div
            className="stat-pill-row"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.18 }}
            style={{ justifyContent: 'center', flexWrap: 'wrap', gap: 8 }}
          >
            <span className="stat-pill">
              <Users size={11} style={{ display: 'inline', marginRight: 4, color: 'var(--green)' }} />
              <span className="stat-pill-val">{liveCounts.totalOnline}</span>
              <span className="stat-pill-lbl"> {t('common.online')}</span>
            </span>
            {liveCounts.kenoOnline > 0 && (
              <span className="stat-pill">
                <Zap size={11} style={{ display: 'inline', marginRight: 4, color: 'var(--gold)' }} />
                <span className="stat-pill-val">{liveCounts.kenoOnline}</span>
                <span className="stat-pill-lbl"> {t('home.inKeno')}</span>
              </span>
            )}
            {liveCounts.bingoOnline > 0 && (
              <span className="stat-pill">
                <Star size={11} style={{ display: 'inline', marginRight: 4, color: '#c084fc' }} />
                <span className="stat-pill-val">{liveCounts.bingoOnline}</span>
                <span className="stat-pill-lbl"> {t('home.inBingo')}</span>
              </span>
            )}
          </motion.div>
        )}
      </section>

      {/* ── Filter chips ── */}
      <motion.div
        className="game-filter-row"
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
      >
        {FILTER_CHIPS.map((chip) => (
          <motion.button
            key={chip.id}
            className={`game-filter-chip${filter === chip.id ? ' active' : ''}`}
            onClick={() => setFilter(chip.id)}
            whileTap={{ scale: 0.92 }}
            transition={{ type: 'spring', stiffness: 400, damping: 22 }}
            style={{ position: 'relative', overflow: 'hidden' }}
          >
            <span style={{ marginRight: 5 }}>{chip.icon}</span>
            {t(chip.labelKey)}
            {filter === chip.id && (
              <motion.span
                layoutId="filter-pill"
                style={{
                  position: 'absolute', inset: 0, borderRadius: 'inherit',
                  background: 'rgba(250,204,21,0.08)',
                  border: '1px solid rgba(250,204,21,0.3)',
                  zIndex: -1,
                }}
                transition={{ type: 'spring', stiffness: 340, damping: 26 }}
              />
            )}
          </motion.button>
        ))}
      </motion.div>

      {/* ── Game banners ── */}
      <motion.div
        className="game-banner-list"
        variants={containerVariants}
        initial="hidden"
        animate="show"
      >
        <AnimatePresence mode="popLayout">
          {/* ── Bingo ── */}
          {showBingo && (
            <motion.button
              layout
              key="bingo"
              variants={itemVariants}
              className="game-banner game-banner-bingo"
              onClick={() => open('bingo', bingo)}
              exit={{ opacity: 0, y: -12, scale: 0.97 }}
              whileHover={{ scale: 1.015, y: -3 }}
              whileTap={{ scale: 0.975 }}
              transition={{ type: 'spring', stiffness: 340, damping: 24 }}
              style={{ opacity: bingo.maint ? 0.6 : 1 }}
            >
              <div className="game-banner-content">
                <span className="game-banner-tag">
                  {bingo.maint ? t('games.maintenance') : t('games.bingoTag')}
                  {liveCounts && liveCounts.bingoOnline > 0 && (
                    <span className="live-pill-inline" style={{ marginLeft: 6 }}>🟢 {t('home.playing', { count: liveCounts.bingoOnline })}</span>
                  )}
                </span>
                <h2 className="game-banner-title">Bingo</h2>
                <p className="game-banner-desc">
                  {t('games.bingoDesc')}
                </p>
                <div className="game-banner-stats">
                  <span className="game-stat-pill"><Trophy size={10} style={{ display:'inline', marginRight:3 }} />{t('games.bingoStat1')}</span>
                  <span className="game-stat-pill">{t('games.bingoStat2')}</span>
                  <span className="game-stat-pill"><Users size={10} style={{ display:'inline', marginRight:3 }} />{t('games.bingoStat3')}</span>
                </div>
                <span className="game-banner-cta">{t('common.playNow')} →</span>
              </div>
              <div className="game-banner-deco">
                {BINGO_LETTERS.map((letter, i) => (
                  <motion.span
                    key={letter}
                    className="bingo-tile"
                    style={{ '--tile-color': BINGO_COLORS[i] } as CSSProperties}
                    animate={{ y: [0, -6, 0] }}
                    transition={{ duration: 2.2, delay: i * 0.22, repeat: Infinity, ease: 'easeInOut' }}
                  >
                    {letter}
                  </motion.span>
                ))}
              </div>
            </motion.button>
          )}

          {/* ── Keno ── */}
          {showKeno && (
            <motion.button
              layout
              key="keno"
              variants={itemVariants}
              className="game-banner game-banner-keno"
              onClick={() => open('keno', keno)}
              exit={{ opacity: 0, y: -12, scale: 0.97 }}
              whileHover={{ scale: 1.015, y: -3 }}
              whileTap={{ scale: 0.975 }}
              transition={{ type: 'spring', stiffness: 340, damping: 24 }}
              style={{ opacity: keno.maint ? 0.6 : 1 }}
            >
              <div className="game-banner-content">
                <span className="game-banner-tag">
                  {keno.maint ? t('games.maintenance') : t('games.kenoTag')}
                  {liveCounts && liveCounts.kenoOnline > 0 && (
                    <span className="live-pill-inline" style={{ marginLeft: 6 }}>🟢 {t('home.playing', { count: liveCounts.kenoOnline })}</span>
                  )}
                </span>
                <h2 className="game-banner-title">Keno</h2>
                <p className="game-banner-desc">
                  {t('games.kenoDesc')}
                </p>
                <div className="game-banner-stats">
                  <span className="game-stat-pill"><Zap size={10} style={{ display:'inline', marginRight:3 }} />{t('games.kenoStat1')}</span>
                  <span className="game-stat-pill">{t('games.kenoStat2')}</span>
                  <span className="game-stat-pill"><Clock size={10} style={{ display:'inline', marginRight:3 }} />{t('games.kenoStat3')}</span>
                </div>
                <span className="game-banner-cta">{t('common.playNow')} →</span>
              </div>
              <div className="game-banner-deco game-banner-deco-keno">
                {KENO_BALLS.map((n, i) => (
                  <motion.span
                    key={n}
                    className="keno-ball-deco"
                    style={{ '--bsize': `${32 + i * 5}px` } as CSSProperties}
                    animate={{ scale: [1, 1.12, 1], opacity: [0.7, 1, 0.7] }}
                    transition={{ duration: 2 + i * 0.3, delay: i * 0.18, repeat: Infinity, ease: 'easeInOut' }}
                  >
                    {n}
                  </motion.span>
                ))}
              </div>
            </motion.button>
          )}
          {/* ── Crash ── */}
          {showCrash && (
            <motion.button
              layout
              key="crash"
              variants={itemVariants}
              className="game-banner game-banner-crash"
              onClick={() => open('crash', crash)}
              exit={{ opacity: 0, y: -12, scale: 0.97 }}
              whileHover={{ scale: 1.015, y: -3 }}
              whileTap={{ scale: 0.975 }}
              transition={{ type: 'spring', stiffness: 340, damping: 24 }}
              style={{ opacity: crash.maint ? 0.6 : 1 }}
            >
              <div className="game-banner-content">
                <span className="game-banner-tag">
                  {crash.maint ? t('games.maintenance') : t('games.crashTag')}
                </span>
                <h2 className="game-banner-title">Crash</h2>
                <p className="game-banner-desc">
                  {t('games.crashDesc')}
                </p>
                <div className="game-banner-stats">
                  <span className="game-stat-pill"><TrendingUp size={10} style={{ display:'inline', marginRight:3 }} />{t('games.crashStat1')}</span>
                  <span className="game-stat-pill">{t('games.crashStat2')}</span>
                  <span className="game-stat-pill">{t('games.crashStat3')}</span>
                </div>
                <span className="game-banner-cta">{t('common.playNow')} →</span>
              </div>
              <div className="game-banner-deco" style={{ gap: 6 }}>
                {CRASH_MULTS.map((m, i) => (
                  <motion.span
                    key={m + i}
                    style={{
                      fontSize: 13, fontWeight: 800,
                      color: CRASH_COLORS[i],
                      fontFamily: 'var(--font-display)',
                      opacity: 0.9,
                    }}
                    animate={{ y: [0, -5, 0] }}
                    transition={{ duration: 1.8 + i * 0.3, delay: i * 0.2, repeat: Infinity, ease: 'easeInOut' }}
                  >
                    {m}
                  </motion.span>
                ))}
              </div>
            </motion.button>
          )}
          {/* ── Pool ── */}
          {showPool && (
            <motion.button
              layout
              key="pool"
              variants={itemVariants}
              className="game-banner game-banner-pool"
              onClick={() => open('pool', pool)}
              exit={{ opacity: 0, y: -12, scale: 0.97 }}
              whileHover={{ scale: 1.015, y: -3 }}
              whileTap={{ scale: 0.975 }}
              transition={{ type: 'spring', stiffness: 340, damping: 24 }}
              style={{ opacity: pool.maint ? 0.6 : 1 }}
            >
              <div className="game-banner-content">
                <span className="game-banner-tag">
                  {pool.maint ? t('games.maintenance') : t('games.poolTag')}
                </span>
                <h2 className="game-banner-title">Pool</h2>
                <p className="game-banner-desc">
                  {t('games.poolDesc')}
                </p>
                <div className="game-banner-stats">
                  <span className="game-stat-pill"><Target size={10} style={{ display:'inline', marginRight:3 }} />{t('games.poolStat1')}</span>
                  <span className="game-stat-pill"><Users size={10} style={{ display:'inline', marginRight:3 }} />{t('games.poolStat2')}</span>
                  <span className="game-stat-pill"><Trophy size={10} style={{ display:'inline', marginRight:3 }} />{t('games.poolStat3')}</span>
                </div>
                <span className="game-banner-cta">{t('common.playNow')} →</span>
              </div>
              <div className="game-banner-deco" style={{ gap: 8 }}>
                {['8', '9', '3', '11'].map((n, i) => (
                  <motion.span
                    key={n}
                    style={{
                      width: 34, height: 34, borderRadius: '50%',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 13, fontWeight: 800, color: '#fff',
                      background: n === '8' ? '#1a1a1a' : ['#eab308', '#ef4444', '#a855f7'][i % 3],
                      border: '2px solid rgba(255,255,255,0.25)',
                      fontFamily: 'var(--font-display)',
                    }}
                    animate={{ y: [0, -6, 0] }}
                    transition={{ duration: 2 + i * 0.3, delay: i * 0.2, repeat: Infinity, ease: 'easeInOut' }}
                  >
                    {n}
                  </motion.span>
                ))}
              </div>
            </motion.button>
          )}
        </AnimatePresence>
      </motion.div>

      {/* ── Feature strip ── */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
        style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}
      >
        {[
          { icon: '🔒', label: t('games.featureFair') },
          { icon: '⚡', label: t('games.featurePayouts') },
          { icon: '🎲', label: t('games.featureRng') },
        ].map((f) => (
          <div
            key={f.label}
            style={{
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: 10,
              padding: '10px 8px',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: 20, marginBottom: 4 }}>{f.icon}</div>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{f.label}</div>
          </div>
        ))}
      </motion.div>
    </motion.div>
  );
}
