import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft, TrendingUp, Clock, Zap, AlertTriangle, Shield, Plane,
} from 'lucide-react';
import { crashApi, walletApi } from '../lib/api';
import type { CrashBet, CrashConfig, CrashRound } from '../lib/models';
import { getSocket } from '../hooks/useSocketConnection';
import { useStore } from '../store/useStore';

type Phase = 'loading' | 'waiting' | 'running' | 'crashed' | 'error';
type GraphPoint = { x: number; y: number };
type LiveBet = {
  betId: string;
  name: string;
  stakeMinor: number;
  autoCashoutX100: number | null;
  cashedOutAtX100: number | null;
  payoutMinor: number;
  status: 'active' | 'won' | 'lost';
};

function multiplierColor(mx100: number, crashed = false): string {
  if (crashed || mx100 < 150) return '#ef4444';
  if (mx100 >= 500) return '#ef4444';
  if (mx100 >= 300) return '#f59e0b';
  return '#10b981';
}

function multiplierColorRunning(mx100: number): string {
  if (mx100 >= 500) return '#ef4444';
  if (mx100 >= 300) return '#f59e0b';
  if (mx100 >= 150) return '#10b981';
  return 'rgba(16,185,129,0.7)';
}

function fmtMult(mx100: number): string {
  return (mx100 / 100).toFixed(2) + '×';
}

function buildPath(points: GraphPoint[], W: number, H: number): string {
  if (points.length < 2) return '';
  const maxX = Math.max(points[points.length - 1].x, 1);
  const maxY = Math.max(...points.map(p => p.y), 200);
  const pad = 10;
  const toXY = (p: GraphPoint) => ({
    sx: pad + (p.x / maxX) * (W - pad * 2),
    sy: H - pad - ((p.y - 100) / (maxY - 99)) * (H - pad * 2),
  });
  return points.map((p, i) => {
    const { sx, sy } = toXY(p);
    return `${i === 0 ? 'M' : 'L'} ${sx.toFixed(1)} ${sy.toFixed(1)}`;
  }).join(' ');
}

function buildArea(points: GraphPoint[], W: number, H: number): string {
  if (points.length < 2) return '';
  const line = buildPath(points, W, H);
  const maxX = Math.max(points[points.length - 1].x, 1);
  const pad = 10;
  const lastSx = pad + (points[points.length - 1].x / maxX) * (W - pad * 2);
  return `${line} L ${lastSx.toFixed(1)} ${H - pad} L ${pad} ${H - pad} Z`;
}

const QUICK_STAKES = [10, 50, 100, 500]; // whole ETB (flat 1:1)

export function Crash({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase>('loading');
  const [round, setRound] = useState<CrashRound | null>(null);
  const [multiplierX100, setMultiplierX100] = useState(100);
  const [graphPoints, setGraphPoints] = useState<GraphPoint[]>([]);
  const [waitingSecsLeft, setWaitingSecsLeft] = useState(12);

  const [stake, setStake] = useState('');
  const [autoCashout, setAutoCashout] = useState('');
  const [isBetting, setIsBetting] = useState(false);
  const [myBet, setMyBet] = useState<CrashBet | null>(null);
  const [isCashingOut, setIsCashingOut] = useState(false);
  const [betError, setBetError] = useState('');
  const [cashoutResult, setCashoutResult] = useState<{ mx100: number; payoutMinor: number } | null>(null);

  const [config, setConfig] = useState<CrashConfig | null>(null);
  const [recentRounds, setRecentRounds] = useState<CrashRound[]>([]);
  const [myBetHistory, setMyBetHistory] = useState<CrashBet[]>([]);
  const [liveBets, setLiveBets] = useState<LiveBet[]>([]);
  const [betMode, setBetMode] = useState<'bet' | 'auto'>('bet');

  const configRef = useRef<CrashConfig | null>(null);
  const myBetRef = useRef<CrashBet | null>(null);
  const waitingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const phaseRef = useRef<Phase>('loading');

  const wallet = useStore(s => s.wallet);
  const setWallet = useStore(s => s.setWallet);
  const isSocketConnected = useStore(s => s.isSocketConnected);

  useEffect(() => { configRef.current = config; }, [config]);
  useEffect(() => { myBetRef.current = myBet; }, [myBet]);
  useEffect(() => { phaseRef.current = phase; }, [phase]);

  const clearTimer = () => {
    if (waitingTimerRef.current) {
      clearInterval(waitingTimerRef.current);
      waitingTimerRef.current = null;
    }
  };

  const startWaitingTimer = useCallback((totalSecs: number) => {
    clearTimer();
    const end = Date.now() + totalSecs * 1000;
    setWaitingSecsLeft(totalSecs);
    waitingTimerRef.current = setInterval(() => {
      const left = Math.max(0, Math.ceil((end - Date.now()) / 1000));
      setWaitingSecsLeft(left);
      if (left <= 0) clearTimer();
    }, 250);
  }, []);

  // Initial load
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      crashApi.getConfig(),
      crashApi.getRecentRounds(12),
      crashApi.getActiveRound().catch(() => null),
      crashApi.getMyBets(8).catch(() => [] as CrashBet[]),
    ]).then(([cfg, rounds, active, bets]) => {
      if (cancelled) return;
      setConfig(cfg);
      configRef.current = cfg;
      setStake(prev => prev || String(cfg.minBetMinor || 10));
      setRecentRounds(rounds);
      setMyBetHistory(bets);
      if (active) {
        setRound(active);
        if (active.status === 'waiting') {
          setPhase('waiting');
          startWaitingTimer(cfg.waitingDurationSeconds);
        } else if (active.status === 'running') {
          setPhase('running');
        } else {
          setPhase('crashed');
        }
      } else {
        setPhase('waiting');
        setWaitingSecsLeft(cfg.waitingDurationSeconds);
      }
    }).catch(() => { if (!cancelled) setPhase('error'); });

    return () => {
      cancelled = true;
      clearTimer();
    };
  }, [startWaitingTimer]);

  // Socket subscriptions
  useEffect(() => {
    if (!isSocketConnected) return;
    const socket = getSocket();
    if (!socket) return;

    socket.emit('enter.game', { game: 'crash' });

    const onWaiting = (payload: { roundId: string; seedHash: string }) => {
      clearTimer();
      setRound({ id: payload.roundId, status: 'waiting', seedHash: payload.seedHash });
      setPhase('waiting');
      setMultiplierX100(100);
      setGraphPoints([]);
      setMyBet(null);
      myBetRef.current = null;
      setCashoutResult(null);
      setBetError('');
      setLiveBets([]); // fresh round → clear the live bets feed
      const secs = configRef.current?.waitingDurationSeconds ?? 12;
      startWaitingTimer(secs);
    };

    const onStarted = (payload: { roundId: string; seedHash: string }) => {
      clearTimer();
      setRound(prev =>
        prev
          ? { ...prev, status: 'running' }
          : { id: payload.roundId, status: 'running', seedHash: payload.seedHash },
      );
      setPhase('running');
      setMultiplierX100(100);
      setGraphPoints([{ x: 0, y: 100 }]);
    };

    const onTick = (payload: { multiplierX100: number; elapsedMs: number }) => {
      setMultiplierX100(payload.multiplierX100);
      setGraphPoints(prev => [...prev.slice(-300), { x: payload.elapsedMs, y: payload.multiplierX100 }]);
    };

    const onCrashed = (payload: {
      roundId: string;
      crashPointX100: number;
      seed: string;
      seedHash: string;
    }) => {
      clearTimer();
      const cp = payload.crashPointX100 ?? 100;
      setPhase('crashed');
      setMultiplierX100(cp);
      setRound(prev =>
        prev
          ? { ...prev, status: 'crashed', crashPointX100: cp, seed: payload.seed }
          : null,
      );
      if (myBetRef.current?.status === 'active') {
        setMyBet(prev => prev ? { ...prev, status: 'lost' } : null);
      }
      // Everyone still in the round busted with the plane.
      setLiveBets(prev => prev.map(b => (b.status === 'active' ? { ...b, status: 'lost' } : b)));
      Promise.all([
        crashApi.getRecentRounds(12).catch(() => [] as CrashRound[]),
        crashApi.getMyBets(8).catch(() => [] as CrashBet[]),
        walletApi.getWallet().catch(() => null),
      ]).then(([rounds, bets, wallet]) => {
        setRecentRounds(rounds);
        setMyBetHistory(bets);
        if (wallet) setWallet(wallet);
      });
    };

    const onBetPlaced = (bet: CrashBet) => {
      setMyBet(bet);
      myBetRef.current = bet;
    };

    const onCashedOut = (bet: CrashBet) => {
      setMyBet(bet);
      myBetRef.current = bet;
      setCashoutResult({ mx100: bet.cashedOutAtX100 ?? 100, payoutMinor: bet.payoutMinor });
      walletApi.getWallet().then(setWallet).catch(() => {});
    };

    // Public live "All Bets" feed (all players + bots).
    const onBetPublic = (e: { betId: string; name: string; stakeMinor: number; autoCashoutX100: number | null }) => {
      const bet: LiveBet = { betId: e.betId, name: e.name, stakeMinor: e.stakeMinor, autoCashoutX100: e.autoCashoutX100 ?? null, cashedOutAtX100: null, payoutMinor: 0, status: 'active' };
      setLiveBets(prev => (prev.some(b => b.betId === e.betId) ? prev : [bet, ...prev].slice(0, 80)));
    };
    const onCashoutPublic = (e: { betId: string; cashedOutAtX100: number; payoutMinor: number }) => {
      setLiveBets(prev => prev.map(b =>
        b.betId === e.betId ? { ...b, cashedOutAtX100: e.cashedOutAtX100, payoutMinor: e.payoutMinor, status: 'won' } : b,
      ));
    };

    socket.on('crash.round.waiting', onWaiting);
    socket.on('crash.round.started', onStarted);
    socket.on('crash.tick', onTick);
    socket.on('crash.round.crashed', onCrashed);
    socket.on('crash.bet.placed', onBetPlaced);
    socket.on('crash.bet.cashedout', onCashedOut);
    socket.on('crash.bet.public', onBetPublic);
    socket.on('crash.cashout.public', onCashoutPublic);

    return () => {
      socket.off('crash.round.waiting', onWaiting);
      socket.off('crash.round.started', onStarted);
      socket.off('crash.tick', onTick);
      socket.off('crash.round.crashed', onCrashed);
      socket.off('crash.bet.placed', onBetPlaced);
      socket.off('crash.bet.cashedout', onCashedOut);
      socket.off('crash.bet.public', onBetPublic);
      socket.off('crash.cashout.public', onCashoutPublic);
      socket.emit('leave.game', { game: 'crash' });
    };
  }, [isSocketConnected, setWallet, startWaitingTimer]);

  // Reconciliation fallback — self-heals if a socket phase event was missed
  // (e.g. the round transitioned in the gap between initial load and the socket
  // subscription, or an event was dropped). Without this the UI can get stuck on
  // "waiting" forever while the server has already moved on.
  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const active = await crashApi.getActiveRound();
        const p = phaseRef.current;
        if (!active) return;
        if (active.status === 'running' && p !== 'running') {
          clearTimer();
          setRound(active);
          setGraphPoints(g => (g.length ? g : [{ x: 0, y: 100 }]));
          setPhase('running');
        } else if (active.status === 'waiting' && p !== 'waiting') {
          setRound(active);
          setMultiplierX100(100);
          setGraphPoints([]);
          setMyBet(null);
          myBetRef.current = null;
          setPhase('waiting');
          startWaitingTimer(configRef.current?.waitingDurationSeconds ?? 12);
        }
      } catch { /* transient — try again next tick */ }
    }, 3000);
    return () => clearInterval(id);
  }, [startWaitingTimer]);

  const handlePlaceBet = async () => {
    if (isBetting || phase !== 'waiting' || myBet) return;
    const stakeVal = parseFloat(stake);
    if (!stake || isNaN(stakeVal) || stakeVal <= 0) {
      setBetError(t('crash.enterValidStake'));
      return;
    }
    const stakeMinor = Math.round(stakeVal);
    const cfg = configRef.current;
    if (cfg && stakeMinor < cfg.minBetMinor) {
      setBetError(t('crash.minBet', { amount: cfg.minBetMinor }));
      return;
    }
    if (cfg && stakeMinor > cfg.maxBetMinor) {
      setBetError(t('crash.maxBet', { amount: cfg.maxBetMinor }));
      return;
    }
    const acVal = autoCashout ? parseFloat(autoCashout) : undefined;
    if (acVal !== undefined && (isNaN(acVal) || acVal < 1.01)) {
      setBetError(t('crash.autoCashoutMin'));
      return;
    }
    if (!round) { setBetError(t('crash.noActiveRound')); return; }

    setBetError('');
    setIsBetting(true);
    try {
      const key = `crash-bet:${round.id}:${stakeMinor}:${Date.now()}`;
      const bet = await crashApi.placeBet(round.id, stakeMinor, key, acVal);
      setMyBet(bet);
      myBetRef.current = bet;
      walletApi.getWallet().then(setWallet).catch(() => {});
    } catch (e: unknown) {
      const raw = (e as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
      setBetError(typeof raw === 'string' ? raw : t('crash.betFailed'));
    } finally {
      setIsBetting(false);
    }
  };

  const handleCashOut = async () => {
    if (!round || !myBet || myBet.status !== 'active' || isCashingOut || phase !== 'running') return;
    setIsCashingOut(true);
    try {
      const bet = await crashApi.cashOut(round.id, multiplierX100);
      setMyBet(bet);
      myBetRef.current = bet;
      setCashoutResult({ mx100: bet.cashedOutAtX100 ?? multiplierX100, payoutMinor: bet.payoutMinor });
      walletApi.getWallet().then(setWallet).catch(() => {});
    } catch {
      // if the HTTP fails (e.g. round already crashed), silently ignore
    } finally {
      setIsCashingOut(false);
    }
  };

  const liveColor = phase === 'crashed'
    ? '#ef4444'
    : phase === 'running'
    ? multiplierColorRunning(multiplierX100)
    : 'var(--text-muted)';

  const W = 400, H = 180;
  const svgPath = buildPath(graphPoints, W, H);
  const svgArea = buildArea(graphPoints, W, H);

  const hasActiveBet = myBet?.status === 'active';
  const isCrashed = phase === 'crashed';

  // ── Bet controls (Aviator-style stepper + chips) ──
  const minBet = config?.minBetMinor ?? 1;
  const maxBet = config?.maxBetMinor ?? 100000;
  const walletMinor = wallet?.availableMinor ?? 0;
  const stakeNum = Math.max(0, Math.floor(parseFloat(stake) || 0));
  const insufficient = stakeNum > walletMinor;
  const stepAmount = Math.max(1, Math.round(minBet));
  const adjustStake = (delta: number) => setStake(String(Math.max(minBet, Math.min(maxBet, stakeNum + delta))));
  const addStake = (v: number) => setStake(String(Math.min(maxBet, stakeNum + v)));
  const potentialWin = myBet ? Math.floor((myBet.stakeMinor * multiplierX100) / 100) : 0;
  const canBet = phase === 'waiting' && !myBet && stakeNum >= minBet && !insufficient && !isBetting;

  // Screen-space position (as % of the graph box) of the curve's leading tip —
  // where the Aviator plane rides. Mirrors buildPath's coordinate mapping.
  const planeTip = (() => {
    if (graphPoints.length < 2) return { left: 7, top: 84 };
    const maxX = Math.max(graphPoints[graphPoints.length - 1].x, 1);
    const maxY = Math.max(...graphPoints.map(p => p.y), 200);
    const pad = 10;
    const last = graphPoints[graphPoints.length - 1];
    const sx = pad + (last.x / maxX) * (W - pad * 2);
    const sy = H - pad - ((last.y - 100) / (maxY - 99)) * (H - pad * 2);
    return { left: (sx / W) * 100, top: (sy / H) * 100 };
  })();

  return (
    <motion.div
      className="stack-lg"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 28 }}
    >
      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          type="button"
          className="btn btn-secondary btn-sm icon-btn"
          onClick={onBack}
          aria-label={t('common.back')}
          style={{ padding: '8px 10px' }}
        >
          <ArrowLeft size={18} />
        </button>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: 18, fontWeight: 800, fontFamily: 'var(--font-display)', lineHeight: 1 }}>Crash</h1>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{t('crash.tagline')}</p>
        </div>
        <PhaseBadge phase={phase} secsLeft={waitingSecsLeft} />
      </div>

      {/* ── Game area (Aviator-style) ── */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="crash-stage">
          {/* Rotating sunburst rays — only while the round is live/pending */}
          {(phase === 'running' || phase === 'waiting') && <div className="crash-rays" />}
          {/* Soft gold glow at the launch origin (bottom-left) */}
          <div className="crash-origin-glow" />

          {/* Flight curve */}
          {(phase === 'running' || phase === 'crashed') && (
            <svg
              viewBox={`0 0 ${W} ${H}`}
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
              preserveAspectRatio="none"
            >
              <defs>
                <linearGradient id="cg-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.45" />
                  <stop offset="100%" stopColor="#5c3b00" stopOpacity="0.05" />
                </linearGradient>
              </defs>
              {svgArea && <path d={svgArea} fill="url(#cg-fill)" />}
              {svgPath && (
                <path
                  d={svgPath}
                  fill="none"
                  stroke="#f59e0b"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ filter: 'drop-shadow(0 0 6px rgba(245,158,11,0.6))' }}
                />
              )}
            </svg>
          )}

          {/* The plane, riding the curve tip — flies away on crash */}
          {(phase === 'running' || phase === 'crashed') && (
            <motion.div
              style={{ position: 'absolute', left: `${planeTip.left}%`, top: `${planeTip.top}%`, zIndex: 3, pointerEvents: 'none' }}
              animate={isCrashed ? { x: 300, y: -260, opacity: 0 } : { x: 0, y: 0, opacity: 1 }}
              transition={isCrashed ? { duration: 0.9, ease: 'easeIn' } : { duration: 0.12 }}
            >
              <motion.div
                style={{ transform: 'translate(-50%, -50%)' }}
                animate={{ y: [0, -3, 0] }}
                transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
              >
                <Plane
                  size={40}
                  color="#f59e0b"
                  fill="#f59e0b"
                  style={{ filter: 'drop-shadow(0 0 10px rgba(245,158,11,0.75))', transform: 'rotate(-6deg)' }}
                />
              </motion.div>
            </motion.div>
          )}

          {/* Center overlay */}
          <div style={{
            position: 'absolute', inset: 0, zIndex: 4,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            pointerEvents: 'none', gap: 6,
          }}>
            {phase === 'loading' && <div className="spinner" />}

            {phase === 'waiting' && (
              <motion.div
                key="waiting"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                style={{ textAlign: 'center' }}
              >
                <Plane size={30} color="#f59e0b" fill="#f59e0b" style={{ filter: 'drop-shadow(0 0 10px rgba(245,158,11,0.6))' }} />
                <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.14em', color: '#fff', textTransform: 'uppercase', marginTop: 10 }}>
                  {t('crash.waitingForNextRound')}
                </div>
                <div className="crash-loading-bar"><span /></div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
                  {t('crash.startingIn', { secs: waitingSecsLeft })}
                </div>
              </motion.div>
            )}

            {(phase === 'running' || phase === 'crashed') && (
              <>
                {isCrashed && (
                  <motion.div
                    key="flew"
                    initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }}
                    style={{ fontSize: 15, color: '#ef4444', fontWeight: 900, letterSpacing: '0.14em', textTransform: 'uppercase' }}
                  >
                    {t('crash.flewAway')}
                  </motion.div>
                )}
                <motion.div
                  key={`${phase}-${Math.floor(multiplierX100 / 50)}`}
                  style={{
                    fontSize: 'clamp(46px, 13vw, 76px)',
                    fontWeight: 900,
                    fontFamily: 'var(--font-display)',
                    color: isCrashed ? '#ef4444' : '#ffffff',
                    lineHeight: 1,
                    textShadow: isCrashed ? '0 0 44px rgba(239,68,68,0.6)' : '0 0 44px rgba(255,255,255,0.28)',
                    letterSpacing: '-0.03em',
                    transition: 'color 0.2s ease, text-shadow 0.2s ease',
                  }}
                >
                  {fmtMult(multiplierX100)}
                </motion.div>
              </>
            )}
          </div>
        </div>

        {/* Cashout win banner */}
        <AnimatePresence>
          {cashoutResult && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              style={{ overflow: 'hidden' }}
            >
              <div style={{
                background: 'rgba(16,185,129,0.12)',
                borderBottom: '1px solid rgba(16,185,129,0.25)',
                padding: '10px 16px',
                display: 'flex', alignItems: 'center', gap: 8,
                color: '#10b981', fontSize: 13, fontWeight: 700,
              }}>
                <Zap size={14} />
                {t('crash.cashedOutWon', { mult: fmtMult(cashoutResult.mx100), amount: cashoutResult.payoutMinor })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Bet / cashout panel (Aviator-style, tap-to-play) ── */}
        <div style={{ padding: 14, borderTop: '1px solid var(--border)' }}>
          {phase === 'loading' ? (
            <div style={{ textAlign: 'center', padding: '10px 0' }}><div className="spinner" /></div>
          ) : phase === 'error' ? (
            <p style={{ fontSize: 13, color: 'var(--danger)', textAlign: 'center', padding: '10px 0', margin: 0 }}>{t('crash.failedToLoad')}</p>
          ) : (
            <>
              {/* Amount picker — only while betting is open */}
              {phase === 'waiting' && !myBet && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
                  {/* Bet / Auto toggle */}
                  <div style={{ display: 'flex', gap: 4, background: 'rgba(255,255,255,0.04)', borderRadius: 10, padding: 3 }}>
                    {(['bet', 'auto'] as const).map(m => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setBetMode(m)}
                        style={{
                          flex: 1, padding: '6px 0', borderRadius: 8, border: 'none', cursor: 'pointer',
                          fontSize: 12, fontWeight: 700,
                          background: betMode === m ? 'var(--surface-2)' : 'transparent',
                          color: betMode === m ? 'var(--text-primary)' : 'var(--text-muted)',
                        }}
                      >
                        {m === 'bet' ? t('crash.tabBet') : t('crash.tabAuto')}
                      </button>
                    ))}
                  </div>

                  {/* − amount + stepper */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#0c0e18', border: '1px solid var(--border)', borderRadius: 12, padding: '6px 8px' }}>
                    <button type="button" className="crash-step" aria-label="decrease" onClick={() => adjustStake(-stepAmount)}>−</button>
                    <div style={{ flex: 1, textAlign: 'center', minWidth: 0 }}>
                      <input
                        value={stake}
                        onChange={e => { setStake(e.target.value.replace(/[^0-9]/g, '')); setBetError(''); }}
                        inputMode="numeric"
                        style={{ width: '100%', textAlign: 'center', background: 'transparent', border: 'none', color: '#fff', fontSize: 26, fontWeight: 800, fontFamily: 'var(--font-display)', outline: 'none' }}
                      />
                      <div style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '0.12em', marginTop: -2 }}>ETB</div>
                    </div>
                    <button type="button" className="crash-step" aria-label="increase" onClick={() => adjustStake(stepAmount)}>+</button>
                  </div>

                  {/* quick-add chips */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
                    {QUICK_STAKES.map(v => (
                      <button key={v} type="button" className="btn btn-secondary btn-sm" style={{ fontSize: 12, padding: '7px 0' }} onClick={() => addStake(v)}>
                        +{v}
                      </button>
                    ))}
                  </div>

                  {betMode === 'auto' && (
                    <input
                      className="input"
                      type="number"
                      min="1.01"
                      step="0.1"
                      placeholder={t('crash.autoCashoutPlaceholder')}
                      value={autoCashout}
                      onChange={e => { setAutoCashout(e.target.value); setBetError(''); }}
                    />
                  )}

                  {betError && <p style={{ fontSize: 12, color: 'var(--danger)', margin: 0 }}>{betError}</p>}
                </div>
              )}

              {/* One big button that morphs with the phase */}
              {phase === 'running' && hasActiveBet ? (
                <motion.button
                  type="button"
                  onClick={handleCashOut}
                  disabled={isCashingOut}
                  className="crash-action"
                  style={{ background: '#f59e0b', color: '#1a1200', cursor: isCashingOut ? 'not-allowed' : 'pointer', opacity: isCashingOut ? 0.7 : 1 }}
                  animate={{ boxShadow: ['0 0 0 0 rgba(245,158,11,0)', '0 0 22px 6px rgba(245,158,11,0.4)', '0 0 0 0 rgba(245,158,11,0)'] }}
                  transition={{ duration: 1.3, repeat: Infinity, ease: 'easeInOut' }}
                >
                  <span style={{ fontSize: 15, fontWeight: 800, letterSpacing: '0.04em' }}>{isCashingOut ? t('crash.cashingOut') : t('crash.cashOut')}</span>
                  {!isCashingOut && <span style={{ fontSize: 20, fontWeight: 900, fontFamily: 'var(--font-display)' }}>{potentialWin} ETB</span>}
                </motion.button>
              ) : phase === 'waiting' && myBet ? (
                <div className="crash-action" style={{ background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.3)', color: '#10b981', cursor: 'default' }}>
                  <span style={{ fontSize: 14, fontWeight: 800 }}>✓ {t('crash.betLocked', { amount: myBet.stakeMinor })}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>{t('crash.waitingForRound')}</span>
                </div>
              ) : phase === 'running' ? (
                <div className="crash-action" style={{ background: 'rgba(255,255,255,0.04)', color: 'var(--text-muted)', cursor: 'default' }}>
                  <span style={{ fontSize: 13, fontWeight: 700 }}>{t('crash.roundInProgress')}</span>
                </div>
              ) : phase === 'crashed' ? (
                <div className="crash-action" style={{ background: myBet?.status === 'lost' ? 'rgba(239,68,68,0.1)' : 'rgba(255,255,255,0.04)', color: myBet?.status === 'lost' ? '#ef4444' : 'var(--text-muted)', cursor: 'default' }}>
                  {myBet?.status === 'lost'
                    ? <span style={{ fontSize: 14, fontWeight: 800 }}>{t('crash.lostAmount', { amount: myBet.stakeMinor })}</span>
                    : <span style={{ fontSize: 13, fontWeight: 700 }}>{t('crash.nextRoundSoon')}</span>}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={handlePlaceBet}
                  disabled={!canBet}
                  className="crash-action"
                  style={{ background: insufficient ? 'rgba(255,255,255,0.06)' : '#10b981', color: insufficient ? 'var(--text-muted)' : '#04140c', cursor: canBet ? 'pointer' : 'not-allowed', opacity: canBet ? 1 : 0.75 }}
                >
                  {isBetting
                    ? <span style={{ fontSize: 15, fontWeight: 800 }}>{t('crash.placingBet')}</span>
                    : insufficient
                      ? <span style={{ fontSize: 14, fontWeight: 800 }}>{t('crash.insufficientBalance')}</span>
                      : (<>
                          <span style={{ fontSize: 15, fontWeight: 800, letterSpacing: '0.04em' }}>{t('crash.bet')}</span>
                          <span style={{ fontSize: 20, fontWeight: 900, fontFamily: 'var(--font-display)' }}>{stakeNum} ETB</span>
                        </>)}
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Live "All Bets" feed ── */}
      <div className="card" style={{ padding: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
            {t('crash.allBets')}
          </span>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)' }}>{liveBets.length}</span>
        </div>
        {liveBets.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '18px 0', color: 'var(--text-muted)', fontSize: 12 }}>
            {t('crash.noBetsYet')}
          </div>
        ) : (
          <div style={{ maxHeight: 260, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {liveBets.map(b => (
              <div
                key={b.betId}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr auto auto',
                  alignItems: 'center',
                  gap: 8,
                  padding: '7px 10px',
                  borderRadius: 8,
                  fontSize: 12,
                  background: b.status === 'won' ? 'rgba(16,185,129,0.10)' : 'rgba(255,255,255,0.03)',
                  border: `1px solid ${b.status === 'won' ? 'rgba(16,185,129,0.25)' : 'var(--border)'}`,
                  opacity: b.status === 'lost' ? 0.5 : 1,
                }}
              >
                <span style={{ fontWeight: 600, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {b.name}
                </span>
                {b.status === 'won' && b.cashedOutAtX100 != null ? (
                  <span style={{ fontFamily: 'monospace', fontWeight: 800, color: '#10b981', fontSize: 11 }}>
                    {fmtMult(b.cashedOutAtX100)}
                  </span>
                ) : (
                  <span />
                )}
                <span style={{ fontWeight: 700, textAlign: 'right', color: b.status === 'won' ? '#10b981' : 'var(--text-primary)' }}>
                  {b.status === 'won' ? `+${b.payoutMinor}` : b.stakeMinor} ETB
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Provably fair seed hash */}
      {round?.seedHash && (
        <div className="card" style={{ padding: '10px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <Shield size={12} color="var(--text-muted)" />
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {t('crash.provablyFairHash')}
            </span>
          </div>
          <p style={{
            fontSize: 10, color: 'var(--text-muted)', marginTop: 5,
            fontFamily: 'monospace', wordBreak: 'break-all', lineHeight: 1.5,
          }}>
            {round.seedHash}
          </p>
        </div>
      )}

      {/* Recent rounds */}
      <div>
        <h3 style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          {t('crash.recentRounds')}
        </h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {recentRounds.length === 0 ? (
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('crash.noRoundsYet')}</span>
          ) : recentRounds.map(r => {
            const cp = r.crashPointX100 ?? 100;
            const col = multiplierColor(cp, true);
            return (
              <div
                key={r.id}
                title={r.seed ? t('crash.seedLabel', { seed: r.seed }) : undefined}
                style={{
                  padding: '4px 10px', borderRadius: 6,
                  fontSize: 12, fontWeight: 700,
                  background: `${col}18`,
                  border: `1px solid ${col}44`,
                  color: col,
                  cursor: r.seed ? 'help' : 'default',
                }}
              >
                {fmtMult(cp)}
              </div>
            );
          })}
        </div>
      </div>

      {/* My bet history */}
      {myBetHistory.length > 0 && (
        <div>
          <h3 style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            {t('crash.myRecentBets')}
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {myBetHistory.map(b => {
              const won = b.status === 'won';
              const lost = b.status === 'lost';
              return (
                <div
                  key={b.id}
                  className="card"
                  style={{
                    padding: '10px 14px',
                    display: 'flex', alignItems: 'center', gap: 10,
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>
                      {b.stakeMinor} ETB
                    </span>
                    {b.cashedOutAtX100 && (
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 7 }}>
                        @ {fmtMult(b.cashedOutAtX100)}
                      </span>
                    )}
                  </div>
                  <span style={{
                    fontSize: 12, fontWeight: 700,
                    color: won ? '#10b981' : lost ? '#ef4444' : 'var(--text-muted)',
                  }}>
                    {won
                      ? `+${b.payoutMinor} ETB`
                      : lost
                      ? `-${b.stakeMinor} ETB`
                      : t('crash.active')}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* How it works */}
      <div className="card" style={{ padding: '14px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}>
          <TrendingUp size={13} color="var(--text-muted)" />
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {t('crash.howToPlay')}
          </span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[
            { icon: '1', text: t('crash.step1') },
            { icon: '2', text: t('crash.step2') },
            { icon: '3', text: t('crash.step3') },
            { icon: '4', text: t('crash.step4') },
          ].map(step => (
            <div key={step.icon} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 22, height: 22, borderRadius: '50%',
                background: 'var(--surface-2)', border: '1px solid var(--border-2)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', flexShrink: 0,
              }}>
                {step.icon}
              </div>
              <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{step.text}</p>
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}

function PhaseBadge({ phase, secsLeft }: { phase: Phase; secsLeft: number }) {
  const { t } = useTranslation();
  const base: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 5,
    padding: '4px 10px', borderRadius: 20,
    fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap',
  };
  if (phase === 'waiting') return (
    <div style={{ ...base, background: 'rgba(245,158,11,0.12)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.28)' }}>
      <Clock size={11} /> {secsLeft}s
    </div>
  );
  if (phase === 'running') return (
    <motion.div
      style={{ ...base, background: 'rgba(16,185,129,0.12)', color: '#10b981', border: '1px solid rgba(16,185,129,0.28)' }}
      animate={{ opacity: [1, 0.6, 1] }}
      transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
    >
      <TrendingUp size={11} /> {t('crash.live')}
    </motion.div>
  );
  if (phase === 'crashed') return (
    <div style={{ ...base, background: 'rgba(239,68,68,0.12)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.28)' }}>
      <AlertTriangle size={11} /> {t('crash.crashed')}
    </div>
  );
  return null;
}
