import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Play, Pause, Trash2, RefreshCw, History, Ticket, Gamepad2,
  Volume2, VolumeX, Trophy, Award, Zap,
} from 'lucide-react';
import { GameTabs, type GameTabOption } from '../components/GameTabs';
import { kenoApi, walletApi } from '../lib/api';
import type { KenoConfig, KenoDraw, KenoTicket } from '../lib/models';
import { createIdempotencyKey, formatCreditsFull, formatDateTime, getErrorMessage } from '../lib/utils';
import { formatCredits, useStore } from '../store/useStore';
import { getSocket } from '../hooks/useSocketConnection';
import { soundEngine } from '../lib/audio';
import confetti from 'canvas-confetti';

// ─── Countdown ────────────────────────────────────────────────────────────────

function useCountdown(targetIso: string | null | undefined) {
  const [display, setDisplay] = useState('--:--');
  const [urgent, setUrgent] = useState(false);
  const [expired, setExpired] = useState(false);
  const [seconds, setSeconds] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    setExpired(false);
    if (!targetIso) { setDisplay('--:--'); setUrgent(false); setSeconds(null); return; }

    const tick = () => {
      const ms = new Date(targetIso).getTime() - Date.now();
      if (ms <= 0) {
        setDisplay('00:00'); setUrgent(false); setExpired(true); setSeconds(0);
        if (timerRef.current) clearInterval(timerRef.current);
        return;
      }
      const total = Math.floor(ms / 1000);
      const m = Math.floor(total / 60);
      const s = total % 60;
      setDisplay(`${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`);
      setUrgent(total < 15);
      setSeconds(total);
      setExpired(false);
    };

    tick();
    timerRef.current = setInterval(tick, 500);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [targetIso]);

  return { display, urgent, expired, seconds };
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_ALLOWED_SPOTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const DEFAULT_KENO_INTERVAL_SECONDS = 40;
const KENO_REVEAL_DELAY_MS = 120;

function getKenoIntervalSeconds(cfg: KenoConfig) {
  if (cfg.autoScheduleIntervalSeconds !== undefined) return cfg.autoScheduleIntervalSeconds;
  if (cfg.autoScheduleIntervalMinutes === 0) return 0;
  return DEFAULT_KENO_INTERVAL_SECONDS;
}

function formatKenoInterval(cfg: KenoConfig) {
  const secs = getKenoIntervalSeconds(cfg);
  if (secs <= 0) return 'Manual';
  if (secs < 60) return `${secs}s`;
  const mins = secs / 60;
  return Number.isInteger(mins) ? `${mins}m` : `${secs}s`;
}

// ─── Types ────────────────────────────────────────────────────────────────────

type KenoDrawCompletedPayload = { drawId?: string; drawnNumbers?: number[] };
type KenoProps = { onBack: () => void };
type KenoTab = 'active' | 'draws' | 'tickets';

const KENO_TABS: Array<GameTabOption<KenoTab>> = [
  { id: 'active', label: 'Play Keno', description: 'Interactive board, bets, and drawing.', icon: <Gamepad2 size={18} /> },
  { id: 'draws', label: 'Round History', description: 'Recent draws and outcomes.', icon: <History size={18} /> },
  { id: 'tickets', label: 'My Bets', description: 'Your active and past tickets.', icon: <Ticket size={18} /> },
];

// ─── Sub-components ───────────────────────────────────────────────────────────

type TileState = 'idle' | 'selected' | 'drawn' | 'hit' | 'miss';

function getTileState(
  value: number, selected: number[], revealed: number[], drawComplete: boolean,
): TileState {
  const isSel = selected.includes(value);
  const isRev = revealed.includes(value);
  if (isSel && isRev) return 'hit';
  if (isRev) return 'drawn';
  if (isSel && drawComplete) return 'miss';
  if (isSel) return 'selected';
  return 'idle';
}

const TILE_BASE = 'relative aspect-square rounded-lg border text-xs font-bold font-mono select-none flex items-center justify-center transition-colors duration-150';

const TILE_CLS: Record<TileState, string> = {
  idle:     'bg-[var(--bg-2)] border-white/[0.08] text-[var(--text-secondary)]',
  selected: 'bg-[var(--gold)] border-[var(--gold)] text-black',
  drawn:    'bg-violet-950/70 border-violet-500/50 text-violet-300',
  hit:      'bg-emerald-500 border-emerald-400 text-black',
  miss:     'bg-transparent border-white/[0.04] text-white/20',
};

const KenoTile = memo(({
  value, state, onClick, disabled,
}: {
  value: number; state: TileState; onClick: () => void; disabled: boolean;
}) => (
  <motion.button
    whileHover={(!disabled && state === 'idle') ? { scale: 1.12, borderColor: 'rgba(245,158,11,0.55)', color: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.08)' } : undefined}
    whileTap={!disabled ? { scale: 0.86 } : undefined}
    animate={
      state === 'hit'      ? { scale: [1, 1.28, 1.08], boxShadow: ['0 0 0px #10b981', '0 0 24px rgba(16,185,129,0.7)', '0 0 10px rgba(16,185,129,0.4)'] }
      : state === 'selected' ? { boxShadow: '0 0 14px rgba(245,158,11,0.45)' }
      : state === 'drawn'    ? { boxShadow: '0 0 8px rgba(139,92,246,0.4)' }
      : {}
    }
    transition={{ type: 'spring', stiffness: 420, damping: 22 }}
    onClick={onClick}
    disabled={disabled}
    aria-pressed={state === 'selected' || state === 'hit'}
    className={`${TILE_BASE} ${TILE_CLS[state]}`}
  >
    {value}
    {state === 'hit' && (
      <motion.span
        initial={{ scale: 0, opacity: 0.8 }}
        animate={{ scale: 3, opacity: 0 }}
        transition={{ duration: 0.5 }}
        className="absolute inset-0 rounded-lg bg-emerald-400/40 pointer-events-none"
      />
    )}
  </motion.button>
));
KenoTile.displayName = 'KenoTile';

function CircularTimer({
  seconds, totalSeconds, urgent, expired, display,
}: {
  seconds: number | null; totalSeconds: number; urgent: boolean; expired: boolean; display: string;
}) {
  const R = 46;
  const C = 2 * Math.PI * R;
  const pct = (seconds !== null && totalSeconds > 0) ? Math.max(0, Math.min(1, seconds / totalSeconds)) : 1;
  const offset = C * (1 - pct);
  const color = urgent ? '#ef4444' : '#f59e0b';

  return (
    <div className="relative w-28 h-28 flex items-center justify-center mx-auto">
      <svg className="w-full h-full -rotate-90 absolute inset-0" viewBox="0 0 112 112">
        <circle cx="56" cy="56" r={R} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="5" />
        <circle
          cx="56" cy="56" r={R}
          fill="none"
          stroke={color}
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 0.5s linear, stroke 0.3s ease', filter: `drop-shadow(0 0 6px ${color}99)` }}
        />
      </svg>
      <div className="flex flex-col items-center z-10">
        <span className={`text-xl font-black font-mono tracking-widest ${urgent ? 'text-red-400 animate-pulse' : 'text-amber-400'}`}>
          {expired ? 'LOCK' : display}
        </span>
        <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mt-0.5">
          {expired ? 'Processing' : 'Next Draw'}
        </span>
      </div>
    </div>
  );
}

function DrawnBallsStrip({
  revealedNumbers, selectedNumbers,
}: {
  revealedNumbers: number[]; selectedNumbers: number[];
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <AnimatePresence initial={false}>
        {revealedNumbers.map((num) => {
          const hit = selectedNumbers.includes(num);
          return (
            <motion.span
              key={num}
              initial={{ y: -28, opacity: 0, scale: 0.4, rotate: -90 }}
              animate={{ y: 0, opacity: 1, scale: 1, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 18 }}
              className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-[10px] font-black font-mono border flex-shrink-0 ${
                hit
                  ? 'bg-emerald-500 border-emerald-400 text-black shadow-[0_0_10px_rgba(16,185,129,0.55)]'
                  : 'bg-violet-950/80 border-violet-500/40 text-violet-300'
              }`}
            >
              {num}
            </motion.span>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function Keno({ onBack }: KenoProps) {
  const addToast    = useStore((s) => s.addToast);
  const wallet      = useStore((s) => s.wallet);
  const setWallet   = useStore((s) => s.setWallet);
  const liveCounts  = useStore((s) => s.liveCounts);
  const soundVolume = useStore((s) => s.soundVolume);
  const soundMuted  = useStore((s) => s.soundMuted);
  const setSoundVolume = useStore((s) => s.setSoundVolume);
  const setSoundMuted  = useStore((s) => s.setSoundMuted);

  const [config, setConfig]           = useState<KenoConfig | null>(null);
  const [draws, setDraws]             = useState<KenoDraw[]>([]);
  const [tickets, setTickets]         = useState<KenoTicket[]>([]);
  const [activeDraw, setActiveDraw]   = useState<KenoDraw | null>(null);
  const [selectedNumbers, setSelectedNumbers] = useState<number[]>([]);
  const [spotTarget, setSpotTarget]   = useState(4);
  const [loading, setLoading]         = useState(true);
  const [submitting, setSubmitting]   = useState(false);
  const [activeTab, setActiveTab]     = useState<KenoTab>('active');

  const [gameState, setGameState]     = useState<'idle' | 'waiting' | 'drawing' | 'celebrating' | 'finished'>('idle');
  const [animatingDrawId, setAnimatingDrawId] = useState<string | null>(null);
  const [revealedNumbers, setRevealedNumbers] = useState<number[]>([]);
  const [drawResult, setDrawResult]   = useState<{
    drawId: string; drawnNumbers: number[]; userTickets: KenoTicket[]; totalPayout: number;
  } | null>(null);

  const [autoPlayEnabled, setAutoPlayEnabled]           = useState(false);
  const [autoPlayRounds, setAutoPlayRounds]             = useState(10);
  const [autoPlayRoundsRemaining, setAutoPlayRoundsRemaining] = useState(0);
  const [autoPlayStartBalance, setAutoPlayStartBalance] = useState<number | null>(null);
  const [autoPlayStopProfit, setAutoPlayStopProfit]     = useState('');
  const [autoPlayStopLoss, setAutoPlayStopLoss]         = useState('');
  const [autoPlayStats, setAutoPlayStats]               = useState({ roundsPlayed: 0, netProfit: 0 });

  const ticketsRef             = useRef<KenoTicket[]>([]);
  const lastPurchasedDrawId    = useRef<string | null>(null);

  const scheduledAt = activeDraw?.status === 'open' ? activeDraw.scheduledAt : null;
  const { display: countdown, urgent: countdownUrgent, expired: countdownExpired, seconds: countdownSeconds } =
    useCountdown(scheduledAt);

  const allowedSpots = config?.allowedSpots?.length ? config.allowedSpots : DEFAULT_ALLOWED_SPOTS;
  const numbers = useMemo(() => {
    const min = config?.numberMin ?? 1;
    const max = config?.numberMax ?? 80;
    return Array.from({ length: max - min + 1 }, (_, i) => min + i);
  }, [config]);

  const ticketsByDrawId = useMemo(() => {
    const map = new Map<string, KenoTicket[]>();
    for (const t of tickets) {
      const list = map.get(t.drawId) ?? [];
      list.push(t);
      map.set(t.drawId, list);
    }
    return map;
  }, [tickets]);

  useEffect(() => { ticketsRef.current = tickets; }, [tickets]);

  const drawComplete = revealedNumbers.length >= (config?.drawSize ?? 20) && revealedNumbers.length > 0;

  const loadKeno = useCallback(async () => {
    try {
      const [nextConfig, nextDraws, nextTickets, nextActiveDraw] = await Promise.all([
        kenoApi.getConfig(),
        kenoApi.listDraws(10),
        kenoApi.listTickets(15),
        kenoApi.getActiveDraw(),
      ]);
      setConfig(nextConfig);
      setDraws(nextDraws);
      setTickets(nextTickets);
      setActiveDraw(nextActiveDraw);
      setSpotTarget((cur) => nextConfig.allowedSpots.includes(cur) ? cur : (nextConfig.allowedSpots[0] ?? 4));
    } catch (err) {
      addToast('error', getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  const attemptAutoPlayPurchase = useCallback(async (drawId: string) => {
    if (!config || !wallet) return;
    if (wallet.availableMinor < config.ticketPriceMinor) {
      addToast('error', 'Auto Play stopped: Insufficient balance.');
      setAutoPlayEnabled(false);
      return;
    }
    if (autoPlayStartBalance !== null) {
      const net = wallet.availableMinor - autoPlayStartBalance;
      if (autoPlayStopProfit && net >= parseFloat(autoPlayStopProfit) * 100) {
        addToast('success', 'Auto Play stopped: Profit limit reached!');
        setAutoPlayEnabled(false);
        return;
      }
      if (autoPlayStopLoss && net <= -parseFloat(autoPlayStopLoss) * 100) {
        addToast('info', 'Auto Play stopped: Loss limit reached!');
        setAutoPlayEnabled(false);
        return;
      }
    }

    setSubmitting(true);
    try {
      let picks = [...selectedNumbers];
      if (picks.length !== spotTarget) {
        const pool = [...numbers];
        const randoms: number[] = [];
        for (let i = 0; i < spotTarget; i++) {
          const idx = Math.floor(Math.random() * pool.length);
          randoms.push(pool.splice(idx, 1)[0]);
        }
        picks = randoms.sort((a, b) => a - b);
        setSelectedNumbers(picks);
      }
      await kenoApi.purchaseTicket(picks, createIdempotencyKey('keno'));
      lastPurchasedDrawId.current = drawId;
      const [nextWallet] = await Promise.all([walletApi.getWallet(), loadKeno()]);
      setWallet(nextWallet);
      setGameState('waiting');
      addToast('success', `Auto Play: Bet placed for Draw #${drawId.slice(-6)}`);
      setAutoPlayRoundsRemaining((prev) => {
        const next = prev - 1;
        if (next <= 0) { setAutoPlayEnabled(false); addToast('info', 'Auto Play completed all rounds.'); }
        return next;
      });
    } catch (err) {
      addToast('error', `Auto Play bet failed: ${getErrorMessage(err)}`);
      setAutoPlayEnabled(false);
    } finally {
      setSubmitting(false);
    }
  }, [config, wallet, selectedNumbers, spotTarget, numbers, addToast, loadKeno, setWallet,
      autoPlayStartBalance, autoPlayStopProfit, autoPlayStopLoss]);

  useEffect(() => {
    void loadKeno();
    const socket = getSocket();
    if (!socket) return;

    socket.emit('enter.game', { game: 'keno' });

    const handleDrawStarted = () => {
      setGameState('waiting');
      setActiveDraw((prev) => prev ? { ...prev, status: 'locked' } : prev);
    };

    const handleDrawCompleted = (payload: KenoDrawCompletedPayload) => {
      const drawn   = payload.drawnNumbers ?? [];
      const drawId  = payload.drawId ?? '';
      const hasTicket = ticketsRef.current.some((t) => t.drawId === drawId);

      setAnimatingDrawId(drawId);
      setRevealedNumbers([]);
      setGameState('drawing');

      drawn.forEach((num, idx) => {
        setTimeout(() => {
          if (hasTicket) {
            const myTicket = ticketsRef.current.find((t) => t.drawId === drawId);
            soundEngine.reveal(myTicket?.selectedNumbers.includes(num));
          } else {
            soundEngine.pop();
          }
          setRevealedNumbers((prev) => [...prev, num]);
        }, idx * KENO_REVEAL_DELAY_MS);
      });

      void loadKeno();
    };

    socket.on('keno.draw.started', handleDrawStarted);
    socket.on('keno.draw.completed', handleDrawCompleted);

    return () => {
      socket.emit('leave.game', { game: 'keno' });
      socket.off('keno.draw.started', handleDrawStarted);
      socket.off('keno.draw.completed', handleDrawCompleted);
    };
  }, [loadKeno]);

  useEffect(() => {
    if (autoPlayEnabled && activeDraw?.status === 'open' && lastPurchasedDrawId.current !== activeDraw.id) {
      void attemptAutoPlayPurchase(activeDraw.id);
    }
  }, [autoPlayEnabled, activeDraw, attemptAutoPlayPurchase]);

  useEffect(() => {
    if (!animatingDrawId || tickets.length === 0 || revealedNumbers.length < (config?.drawSize ?? 20)) return;
    const relevant = tickets.filter((t) => t.drawId === animatingDrawId && t.settlementStatus === 'settled');
    const resultDraw = draws.find((d) => d.id === animatingDrawId);
    if (!resultDraw?.drawnNumbers.length) return;
    const totalPayout = relevant.reduce((s, t) => s + t.payoutMinor, 0);

    setGameState(totalPayout > 0 ? 'celebrating' : 'finished');
    const timer = setTimeout(() => {
      if (totalPayout > 0) {
        soundEngine.win();
        confetti({ particleCount: 180, spread: 80, origin: { y: 0.65 }, colors: ['#FFE600', '#10B981', '#F59E0B', '#8B5CF6'] });
      }
      setDrawResult({ drawId: animatingDrawId, drawnNumbers: resultDraw.drawnNumbers, userTickets: relevant, totalPayout });
      if (autoPlayEnabled) {
        setAutoPlayStats((prev) => ({
          roundsPlayed: prev.roundsPlayed + 1,
          netProfit: prev.netProfit + (totalPayout - (relevant[0]?.stakeMinor ?? 0)),
        }));
      }
      setAnimatingDrawId(null);
    }, 1200);
    return () => clearTimeout(timer);
  }, [revealedNumbers, animatingDrawId, tickets, draws, config, autoPlayEnabled]);

  useEffect(() => {
    if (!countdownExpired || !activeDraw || activeDraw.status !== 'open') return;
    const id = setInterval(async () => {
      try {
        const next = await kenoApi.getActiveDraw();
        if (!next || next.id !== activeDraw.id) setActiveDraw(next);
      } catch { /* ignore */ }
    }, 2000);
    return () => clearInterval(id);
  }, [countdownExpired, activeDraw]);

  const handleQuickPick = () => {
    soundEngine.click();
    const pool = [...numbers];
    const picked: number[] = [];
    for (let i = 0; i < spotTarget; i++) {
      const idx = Math.floor(Math.random() * pool.length);
      picked.push(pool.splice(idx, 1)[0]);
    }
    setSelectedNumbers(picked.sort((a, b) => a - b));
  };

  const handleClearSelection = () => {
    soundEngine.click();
    setSelectedNumbers([]);
  };

  const toggleNumber = (value: number) => {
    soundEngine.click();
    setSelectedNumbers((cur) => {
      if (cur.includes(value)) return cur.filter((n) => n !== value);
      if (cur.length >= spotTarget) return cur;
      return [...cur, value].sort((a, b) => a - b);
    });
  };

  const handleBuyTicket = async () => {
    if (selectedNumbers.length !== spotTarget) {
      addToast('info', `Please select exactly ${spotTarget} numbers.`);
      return;
    }
    if (!activeDraw || activeDraw.status !== 'open') {
      addToast('info', 'Wait for next draw to open.');
      return;
    }
    setSubmitting(true);
    try {
      await kenoApi.purchaseTicket(selectedNumbers, createIdempotencyKey('keno'));
      const [nextWallet] = await Promise.all([walletApi.getWallet(), loadKeno()]);
      setWallet(nextWallet);
      setGameState('waiting');
      soundEngine.cashout();
      addToast('success', 'Ticket successfully purchased!');
    } catch (err) {
      addToast('error', getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleStartAutoPlay = () => {
    if (selectedNumbers.length > 0 && selectedNumbers.length !== spotTarget) {
      addToast('info', `Pick exactly ${spotTarget} numbers, or clear to auto-pick.`);
      return;
    }
    if (!wallet) return;
    soundEngine.click();
    setAutoPlayStartBalance(wallet.availableMinor);
    setAutoPlayRoundsRemaining(autoPlayRounds);
    setAutoPlayStats({ roundsPlayed: 0, netProfit: 0 });
    setAutoPlayEnabled(true);
    addToast('success', `Auto Play started for ${autoPlayRounds} rounds.`);
  };

  const handleStopAutoPlay = () => {
    soundEngine.click();
    setAutoPlayEnabled(false);
    addToast('info', 'Auto Play paused.');
  };

  const hasTicketForActiveDraw = useMemo(
    () => !!activeDraw && tickets.some((t) => t.drawId === activeDraw.id),
    [tickets, activeDraw],
  );

  const intervalSecs = config ? getKenoIntervalSeconds(config) : DEFAULT_KENO_INTERVAL_SECONDS;

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5 max-w-4xl mx-auto pb-20">
      <GameTabs tabs={KENO_TABS} activeTab={activeTab} onTabChange={setActiveTab} onBack={onBack} ariaLabel="Keno sections" />

      {/* Audio bar */}
      <div className="flex justify-between items-center">
        {liveCounts && liveCounts.kenoOnline > 0 && (
          <span className="live-badge-pulse">
            <span className="pulse-dot" />
            {liveCounts.kenoOnline} playing
          </span>
        )}
        <div className="flex items-center gap-2 ml-auto">
          <button onClick={() => setSoundMuted(!soundMuted)} className="btn btn-ghost btn-sm icon-btn">
            {soundMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>
          {!soundMuted && (
            <input type="range" min="0" max="1" step="0.05" value={soundVolume}
              onChange={(e) => setSoundVolume(parseFloat(e.target.value))}
              className="w-20 accent-amber-500 cursor-pointer h-1 rounded" />
          )}
        </div>
      </div>

      {/* ── PLAY TAB ── */}
      {activeTab === 'active' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">

          {/* LEFT COLUMN */}
          <div className="lg:col-span-4 space-y-4">

            {/* Circular countdown card */}
            <motion.div
              initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
              className="card text-center relative overflow-hidden"
            >
              <div className="absolute inset-0 pointer-events-none"
                style={{ background: 'radial-gradient(ellipse at 50% 0%, rgba(245,158,11,0.06) 0%, transparent 70%)' }} />
              {activeDraw && activeDraw.status !== 'open' ? (
                <div className="py-4">
                  <motion.div
                    animate={{ opacity: [1, 0.5, 1] }} transition={{ duration: 1.2, repeat: Infinity }}
                    className="text-2xl font-black text-amber-400 uppercase tracking-widest mb-1"
                  >
                    Drawing...
                  </motion.div>
                  <p className="text-xs text-slate-400">Numbers are being revealed</p>
                </div>
              ) : (
                <CircularTimer
                  seconds={countdownSeconds} totalSeconds={intervalSecs}
                  urgent={countdownUrgent} expired={countdownExpired} display={countdown}
                />
              )}
              {/* Config row */}
              {config && (
                <div className="grid grid-cols-3 gap-2 mt-4">
                  {[
                    { label: 'Price', value: `${formatCredits(config.ticketPriceMinor)} Cr`, color: 'text-amber-400' },
                    { label: 'Draws', value: `${config.drawSize}`, color: 'text-indigo-400' },
                    { label: 'Interval', value: formatKenoInterval(config), color: 'text-teal-400' },
                  ].map(({ label, value, color }) => (
                    <div key={label} className="rounded-xl p-2 bg-white/[0.03] border border-white/[0.05] text-center">
                      <span className="block text-[9px] font-bold uppercase tracking-wider text-slate-500">{label}</span>
                      <span className={`text-sm font-black ${color}`}>{value}</span>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>

            {/* Spot selector + paytable */}
            <div className="card space-y-3">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Spot Target</label>
              <div className="grid grid-cols-4 gap-1.5">
                {allowedSpots.map((spots) => (
                  <motion.button
                    key={spots}
                    whileTap={{ scale: 0.9 }}
                    onClick={() => { soundEngine.click(); setSpotTarget(spots); }}
                    className={`py-2 text-xs font-black rounded-xl border transition-all ${
                      spots === spotTarget
                        ? 'bg-[var(--gold)] border-[var(--gold)] text-black shadow-[0_0_12px_rgba(245,158,11,0.3)]'
                        : 'bg-white/[0.03] border-white/[0.07] text-slate-400 hover:border-amber-500/40 hover:text-amber-400'
                    }`}
                  >
                    {spots}
                  </motion.button>
                ))}
              </div>

              {/* Paytable */}
              {config?.paytable && (() => {
                const entries = config.paytable
                  .filter((e) => e.spots === spotTarget && e.payoutMultiplier > 0)
                  .sort((a, b) => a.matches - b.matches);
                if (!entries.length) return null;
                return (
                  <div className="rounded-xl bg-black/30 border border-white/[0.05] text-xs overflow-hidden">
                    <div className="flex justify-between items-center px-3 py-2 border-b border-white/[0.05] text-slate-400 font-bold text-[10px] uppercase tracking-wider">
                      <span>Matches</span><span>Multiplier</span>
                    </div>
                    <div className="max-h-28 overflow-y-auto divide-y divide-white/[0.04]">
                      {entries.map((e) => (
                        <div key={`${e.spots}-${e.matches}`} className="flex justify-between items-center px-3 py-1.5 text-slate-400">
                          <span>{e.matches}×</span>
                          <span className="font-black text-amber-400">{e.payoutMultiplier}×</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Auto Play */}
            <div className="card space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black text-slate-200 uppercase tracking-wider">Auto Play</span>
                <span className={`badge ${autoPlayEnabled ? 'badge-gold' : 'text-slate-500 bg-white/[0.03] border border-white/[0.07]'}`}>
                  {autoPlayEnabled ? 'ACTIVE' : 'OFF'}
                </span>
              </div>

              {!autoPlayEnabled ? (
                <div className="space-y-3">
                  <div>
                    <div className="flex justify-between text-[10px] text-slate-400 mb-1.5">
                      <span>Rounds</span>
                      <strong className="text-amber-400">{autoPlayRounds}</strong>
                    </div>
                    <input type="range" min="5" max="100" step="5" value={autoPlayRounds}
                      onChange={(e) => setAutoPlayRounds(parseInt(e.target.value))}
                      className="w-full accent-amber-500 cursor-pointer h-1 rounded" />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { label: 'Stop Profit', key: 'profit', value: autoPlayStopProfit, setter: setAutoPlayStopProfit },
                      { label: 'Stop Loss', key: 'loss', value: autoPlayStopLoss, setter: setAutoPlayStopLoss },
                    ].map(({ label, key, value, setter }) => (
                      <div key={key}>
                        <span className="block text-[9px] text-slate-500 font-bold uppercase mb-1">{label}</span>
                        <input type="number" placeholder="Optional"
                          value={value} onChange={(e) => setter(e.target.value)}
                          className="input text-xs py-1.5 px-2" />
                      </div>
                    ))}
                  </div>
                  <button onClick={handleStartAutoPlay} className="btn btn-primary btn-full btn-sm">
                    <Play size={13} fill="currentColor" /> Start Auto Play
                  </button>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {/* Progress ring */}
                  <div className="flex items-center gap-3">
                    <div className="relative w-12 h-12 flex-shrink-0">
                      <svg className="w-full h-full -rotate-90" viewBox="0 0 48 48">
                        <circle cx="24" cy="24" r="20" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="4" />
                        <circle cx="24" cy="24" r="20" fill="none" stroke="#f59e0b" strokeWidth="4"
                          strokeLinecap="round"
                          strokeDasharray={2 * Math.PI * 20}
                          strokeDashoffset={2 * Math.PI * 20 * (1 - autoPlayRoundsRemaining / autoPlayRounds)}
                          style={{ transition: 'stroke-dashoffset 0.4s ease' }} />
                      </svg>
                      <span className="absolute inset-0 flex items-center justify-center text-[10px] font-black text-amber-400">
                        {autoPlayRoundsRemaining}
                      </span>
                    </div>
                    <div className="text-xs text-slate-400 space-y-0.5">
                      <div>Played: <strong className="text-slate-200">{autoPlayStats.roundsPlayed}</strong></div>
                      <div>P&L: <strong className={autoPlayStats.netProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                        {autoPlayStats.netProfit >= 0 ? '+' : ''}{autoPlayStats.netProfit} Cr
                      </strong></div>
                    </div>
                  </div>
                  <button onClick={handleStopAutoPlay} className="btn btn-danger btn-full btn-sm">
                    <Pause size={13} fill="currentColor" /> Stop / Pause
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* RIGHT COLUMN */}
          <div className="lg:col-span-8 space-y-4">

            {/* Drawing reveal panel */}
            <AnimatePresence>
              {gameState === 'drawing' && (
                <motion.div
                  initial={{ opacity: 0, y: -8, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.97 }}
                  className="rounded-xl border border-violet-500/25 bg-violet-950/20 p-4 relative overflow-hidden"
                >
                  <div className="absolute inset-0 pointer-events-none"
                    style={{ background: 'radial-gradient(ellipse at 50% 0%, rgba(139,92,246,0.1) 0%, transparent 70%)' }} />
                  <div className="flex items-center gap-2.5 mb-3">
                    <motion.div animate={{ rotate: 360 }} transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}>
                      <Zap className="text-violet-400" size={18} />
                    </motion.div>
                    <div>
                      <span className="text-sm font-black text-violet-200">Drawing in Progress</span>
                      <p className="text-[10px] text-violet-400">
                        {revealedNumbers.length} / {config?.drawSize ?? 20} balls revealed
                      </p>
                    </div>
                    <div className="ml-auto flex gap-1 flex-shrink-0">
                      <span className="animate-ping absolute top-3 right-3 inline-flex h-2 w-2 rounded-full bg-violet-400 opacity-75" />
                      <span className="absolute top-3 right-3 inline-flex rounded-full h-2 w-2 bg-violet-500" />
                    </div>
                  </div>
                  <DrawnBallsStrip revealedNumbers={revealedNumbers} selectedNumbers={selectedNumbers} />
                </motion.div>
              )}
            </AnimatePresence>

            {/* Main board */}
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="card relative">
              <div className="absolute inset-0 pointer-events-none rounded-[var(--radius-lg)]"
                style={{ background: 'radial-gradient(ellipse at 50% -10%, rgba(245,158,11,0.04) 0%, transparent 60%)' }} />

              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 mb-4">
                <div>
                  <h3 className="section-title text-base">Number Grid</h3>
                  <p className="text-[11px] text-slate-500">
                    {selectedNumbers.length}/{spotTarget} selected
                    {selectedNumbers.length > 0 && (
                      <span className="ml-2 text-amber-400 font-bold">→ {selectedNumbers.join(', ')}</span>
                    )}
                  </p>
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  <button onClick={handleQuickPick} disabled={gameState === 'drawing'}
                    className="btn btn-ghost btn-sm text-amber-400">
                    <Zap size={13} /> Quick Pick
                  </button>
                  <button onClick={handleClearSelection} disabled={gameState === 'drawing' || selectedNumbers.length === 0}
                    className="btn btn-ghost btn-sm">
                    <Trash2 size={13} /> Clear
                  </button>
                </div>
              </div>

              {/* Grid */}
              <div className="grid grid-cols-10 gap-1 sm:gap-1.5">
                {numbers.map((value) => (
                  <KenoTile
                    key={value}
                    value={value}
                    state={getTileState(value, selectedNumbers, revealedNumbers, drawComplete)}
                    onClick={() => toggleNumber(value)}
                    disabled={gameState === 'drawing'}
                  />
                ))}
              </div>

              {/* Bet controls */}
              {!autoPlayEnabled && (
                <div className="mt-5 flex flex-col sm:flex-row gap-3 items-center justify-between border-t border-white/[0.05] pt-4">
                  <div className="text-center sm:text-left">
                    <span className="block text-[9px] font-black uppercase tracking-widest text-slate-500">Total Stake</span>
                    <strong className="text-lg font-black text-amber-400">
                      {config ? `${formatCredits(config.ticketPriceMinor)} e-Birr` : '—'}
                    </strong>
                  </div>
                  <motion.button
                    whileHover={selectedNumbers.length === spotTarget && activeDraw?.status === 'open' ? { scale: 1.03 } : {}}
                    whileTap={{ scale: 0.96 }}
                    onClick={handleBuyTicket}
                    disabled={submitting || selectedNumbers.length !== spotTarget || !activeDraw || activeDraw.status !== 'open'}
                    className={`btn btn-full sm:btn w-full sm:w-auto px-10 ${
                      selectedNumbers.length === spotTarget && activeDraw?.status === 'open'
                        ? 'btn-primary'
                        : 'btn-secondary opacity-50'
                    }`}
                  >
                    {submitting ? 'Submitting...'
                      : hasTicketForActiveDraw ? 'Ticket Purchased — Awaiting Draw'
                      : !activeDraw || activeDraw.status !== 'open' ? 'Draw Locked / Running'
                      : `Place ${spotTarget}-Spot Bet`}
                  </motion.button>
                </div>
              )}
            </motion.div>

            {/* Result panel */}
            <AnimatePresence>
              {drawResult && (
                <motion.div
                  initial={{ opacity: 0, y: 16, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 8, scale: 0.97 }}
                  transition={{ type: 'spring', stiffness: 280, damping: 22 }}
                  className={`card border-2 relative overflow-hidden ${
                    drawResult.totalPayout > 0 ? 'border-amber-500/40' : 'border-white/[0.07]'
                  }`}
                >
                  {drawResult.totalPayout > 0 && (
                    <div className="absolute inset-0 pointer-events-none"
                      style={{ background: 'radial-gradient(ellipse at 50% -10%, rgba(245,158,11,0.08) 0%, transparent 60%)' }} />
                  )}

                  <div className="flex flex-col sm:flex-row justify-between items-center gap-4 mb-4">
                    <div className="flex items-center gap-3">
                      <motion.div
                        initial={{ rotate: -20, scale: 0.7 }}
                        animate={{ rotate: 0, scale: 1 }}
                        transition={{ type: 'spring', stiffness: 260, damping: 14 }}
                        className={`p-3 rounded-2xl ${
                          drawResult.totalPayout > 0
                            ? 'bg-amber-500/10 border border-amber-500/20 text-amber-400'
                            : 'bg-white/[0.04] border border-white/[0.06] text-slate-400'
                        }`}
                      >
                        {drawResult.totalPayout > 0 ? <Trophy size={32} /> : <Award size={32} />}
                      </motion.div>
                      <div>
                        <h4 className="text-base font-black text-slate-100">
                          {drawResult.totalPayout > 0 ? 'You Won!' : 'Round Complete'}
                        </h4>
                        <p className="text-[11px] text-slate-500">Draw #{drawResult.drawId.slice(-6)}</p>
                      </div>
                    </div>
                    {drawResult.totalPayout > 0 ? (
                      <motion.div
                        initial={{ scale: 0.6 }} animate={{ scale: 1 }}
                        transition={{ type: 'spring', stiffness: 300, damping: 16, delay: 0.2 }}
                        className="text-right"
                      >
                        <span className="block text-[9px] font-black uppercase tracking-widest text-emerald-400">Total Win</span>
                        <span className="text-2xl font-black text-emerald-400 font-mono">
                          +{formatCreditsFull(drawResult.totalPayout)}
                        </span>
                      </motion.div>
                    ) : (
                      <span className="text-sm font-bold text-slate-500">No matches</span>
                    )}
                  </div>

                  <div className="space-y-2 border-t border-white/[0.05] pt-3">
                    {drawResult.userTickets.map((t) => {
                      const hits = t.selectedNumbers.filter((n) => drawResult.drawnNumbers.includes(n));
                      return (
                        <div key={t.id} className="rounded-xl bg-black/30 border border-white/[0.05] p-3 flex flex-col sm:flex-row gap-3 justify-between">
                          <div className="text-xs">
                            <span className="font-bold text-slate-300">{t.selectedNumbers.length}-Spot</span>
                            <span className="text-slate-500 ml-2">
                              {t.matches} match{t.matches !== 1 ? 'es' : ''}
                              {hits.length > 0 && <span className="text-amber-400 ml-1">({hits.join(', ')})</span>}
                            </span>
                          </div>
                          <div className="flex gap-1 flex-wrap">
                            {t.selectedNumbers.map((n) => (
                              <span key={n}
                                className={`w-6 h-6 rounded-full font-bold flex items-center justify-center text-[10px] ${
                                  hits.includes(n) ? 'bg-emerald-500 text-black' : 'bg-white/[0.06] text-slate-500'
                                }`}
                              >
                                {n}
                              </span>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <button
                    onClick={() => { soundEngine.click(); setDrawResult(null); }}
                    className="btn btn-secondary btn-full btn-sm mt-3"
                  >
                    Dismiss
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      )}

      {/* ── DRAW HISTORY TAB ── */}
      {activeTab === 'draws' && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-3">
          <div className="card">
            <div className="flex justify-between items-center mb-5">
              <div>
                <h3 className="section-title">Draw History</h3>
                <p className="hero-copy text-xs">Recent Keno draws and matched numbers.</p>
              </div>
              <button onClick={loadKeno} className="btn btn-secondary btn-sm">
                <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
              </button>
            </div>

            {draws.length === 0 ? (
              <div className="centered-loader">No draws found yet.</div>
            ) : (
              <div className="space-y-3">
                {draws.map((draw) => {
                  const drawTickets = ticketsByDrawId.get(draw.id) ?? [];
                  const userPicks = [...new Set(drawTickets.flatMap((t) => t.selectedNumbers))].sort((a, b) => a - b);
                  return (
                    <article key={draw.id} className="rounded-xl bg-white/[0.025] border border-white/[0.06] p-4 space-y-3">
                      <div className="flex justify-between items-start">
                        <div>
                          <h4 className="text-sm font-extrabold text-slate-200">Draw #{draw.id.slice(-6)}</h4>
                          <span className="text-[10px] text-slate-500">{formatDateTime(draw.scheduledAt)}</span>
                        </div>
                        <span className={
                          draw.status === 'settled' ? 'badge badge-green'
                          : draw.status === 'cancelled' ? 'badge badge-red'
                          : 'badge badge-violet'
                        }>
                          {draw.status}
                        </span>
                      </div>

                      {userPicks.length > 0 && (
                        <div className="text-xs">
                          <span className="text-slate-500 font-bold block mb-1.5">Your picks:</span>
                          <div className="flex flex-wrap gap-1">
                            {userPicks.map((p) => (
                              <span key={p}
                                className={`w-6 h-6 rounded-full font-bold flex items-center justify-center text-[10px] ${
                                  draw.drawnNumbers.includes(p) ? 'bg-emerald-500 text-black' : 'bg-white/[0.06] text-slate-500'
                                }`}
                              >{p}</span>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="flex flex-wrap gap-1">
                        {draw.drawnNumbers.map((n) => (
                          <span key={n}
                            className={`w-6 h-6 rounded-full font-bold font-mono text-[10px] flex items-center justify-center ${
                              userPicks.includes(n) ? 'bg-emerald-500 text-black shadow-sm' : 'bg-white/[0.05] text-slate-400'
                            }`}
                          >{n}</span>
                        ))}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </motion.div>
      )}

      {/* ── MY BETS TAB ── */}
      {activeTab === 'tickets' && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <div className="card">
            <div className="flex justify-between items-center mb-5">
              <div>
                <h3 className="section-title">My Keno Tickets</h3>
                <p className="hero-copy text-xs">Track your purchased tickets and results.</p>
              </div>
              <button onClick={loadKeno} className="btn btn-secondary btn-sm">
                <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
              </button>
            </div>

            {tickets.length === 0 ? (
              <div className="centered-loader">No tickets yet. Buy tickets under "Play Keno".</div>
            ) : (
              <div className="space-y-3">
                {tickets.map((t) => {
                  const settled = t.settlementStatus === 'settled';
                  const won = t.payoutMinor > 0;
                  const draw = draws.find((d) => d.id === t.drawId);
                  const drawnNums = draw?.drawnNumbers ?? [];
                  return (
                    <article key={t.id}
                      className="rounded-xl bg-white/[0.025] border border-white/[0.06] p-4 flex flex-col sm:flex-row justify-between gap-4"
                    >
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <h4 className="text-sm font-extrabold text-slate-200">#{t.id.slice(-6)}</h4>
                          <span className="text-[10px] text-slate-500">Draw #{t.drawId.slice(-6)}</span>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {t.selectedNumbers.map((n) => {
                            const isHit = settled && drawnNums.includes(n);
                            return (
                              <span key={n}
                                className={`w-6 h-6 rounded-full font-bold flex items-center justify-center text-[10px] ${
                                  isHit ? 'bg-emerald-500 text-black' : 'bg-white/[0.06] border border-white/[0.08] text-slate-400'
                                }`}
                              >{n}</span>
                            );
                          })}
                        </div>
                      </div>
                      <div className="flex items-center gap-4 sm:flex-col sm:items-end justify-between border-t border-white/[0.05] sm:border-0 pt-3 sm:pt-0">
                        <div className="text-xs text-slate-500 space-y-0.5">
                          <div>Bet: <strong className="text-slate-300">{formatCredits(t.stakeMinor)} Cr</strong></div>
                          {settled && won && <div>Win: <strong className="text-emerald-400">+{formatCredits(t.payoutMinor)} Cr</strong></div>}
                        </div>
                        <span className={`badge ${won ? 'badge-green' : settled ? 'text-slate-500 bg-white/[0.03] border border-white/[0.07]' : 'badge-gold'}`}>
                          {won ? 'Won' : settled ? 'No Win' : 'Pending'}
                        </span>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </motion.div>
      )}
    </div>
  );
}
