import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft, TrendingUp, Clock, Zap, AlertTriangle, Shield,
} from 'lucide-react';
import { crashApi, walletApi } from '../lib/api';
import type { CrashBet, CrashConfig, CrashRound } from '../lib/models';
import { getSocket } from '../hooks/useSocketConnection';
import { useStore } from '../store/useStore';

type Phase = 'loading' | 'waiting' | 'running' | 'crashed' | 'error';
type GraphPoint = { x: number; y: number };

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

const QUICK_STAKES = [100, 500, 1000, 5000]; // minor units

export function Crash({ onBack }: { onBack: () => void }) {
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

  const configRef = useRef<CrashConfig | null>(null);
  const myBetRef = useRef<CrashBet | null>(null);
  const waitingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const setWallet = useStore(s => s.setWallet);
  const isSocketConnected = useStore(s => s.isSocketConnected);

  useEffect(() => { configRef.current = config; }, [config]);
  useEffect(() => { myBetRef.current = myBet; }, [myBet]);

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

    socket.on('crash.round.waiting', onWaiting);
    socket.on('crash.round.started', onStarted);
    socket.on('crash.tick', onTick);
    socket.on('crash.round.crashed', onCrashed);
    socket.on('crash.bet.placed', onBetPlaced);
    socket.on('crash.bet.cashedout', onCashedOut);

    return () => {
      socket.off('crash.round.waiting', onWaiting);
      socket.off('crash.round.started', onStarted);
      socket.off('crash.tick', onTick);
      socket.off('crash.round.crashed', onCrashed);
      socket.off('crash.bet.placed', onBetPlaced);
      socket.off('crash.bet.cashedout', onCashedOut);
      socket.emit('leave.game', { game: 'crash' });
    };
  }, [isSocketConnected, setWallet, startWaitingTimer]);

  const handlePlaceBet = async () => {
    if (isBetting || phase !== 'waiting' || myBet) return;
    const stakeVal = parseFloat(stake);
    if (!stake || isNaN(stakeVal) || stakeVal <= 0) {
      setBetError('Enter a valid stake');
      return;
    }
    const stakeMinor = Math.round(stakeVal * 100);
    const cfg = configRef.current;
    if (cfg && stakeMinor < cfg.minBetMinor) {
      setBetError(`Min bet: ${cfg.minBetMinor / 100} Cr`);
      return;
    }
    if (cfg && stakeMinor > cfg.maxBetMinor) {
      setBetError(`Max bet: ${cfg.maxBetMinor / 100} Cr`);
      return;
    }
    const acVal = autoCashout ? parseFloat(autoCashout) : undefined;
    if (acVal !== undefined && (isNaN(acVal) || acVal < 1.01)) {
      setBetError('Auto cashout must be ≥ 1.01×');
      return;
    }
    if (!round) { setBetError('No active round'); return; }

    setBetError('');
    setIsBetting(true);
    try {
      const key = `crash-bet:${round.id}:${stakeMinor}:${Date.now()}`;
      await crashApi.placeBet(round.id, stakeMinor, key, acVal);
    } catch (e: unknown) {
      const raw = (e as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
      setBetError(typeof raw === 'string' ? raw : 'Bet failed — check balance');
    } finally {
      setIsBetting(false);
    }
  };

  const handleCashOut = async () => {
    if (!round || !myBet || myBet.status !== 'active' || isCashingOut || phase !== 'running') return;
    setIsCashingOut(true);
    try {
      await crashApi.cashOut(round.id, multiplierX100);
    } catch {
      // socket event confirms result
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
          aria-label="Back"
          style={{ padding: '8px 10px' }}
        >
          <ArrowLeft size={18} />
        </button>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: 18, fontWeight: 800, fontFamily: 'var(--font-display)', lineHeight: 1 }}>Crash</h1>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>Cash out before it crashes</p>
        </div>
        <PhaseBadge phase={phase} secsLeft={waitingSecsLeft} />
      </div>

      {/* ── Game area ── */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {/* Graph + multiplier overlay */}
        <div style={{ position: 'relative', background: '#0c0e18' }}>
          <svg
            viewBox={`0 0 ${W} ${H}`}
            style={{ width: '100%', height: H, display: 'block' }}
            preserveAspectRatio="none"
          >
            <defs>
              <linearGradient id="cg-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={liveColor} stopOpacity="0.2" />
                <stop offset="100%" stopColor={liveColor} stopOpacity="0.02" />
              </linearGradient>
            </defs>
            {/* Subtle grid */}
            {graphPoints.length > 4 && [200, 300, 500, 1000].map(threshold => {
              const maxY = Math.max(...graphPoints.map(p => p.y), 200);
              if (threshold > maxY * 1.2) return null;
              const sy = H - 10 - ((threshold - 100) / (maxY - 99)) * (H - 20);
              return (
                <g key={threshold}>
                  <line x1={10} y1={sy} x2={W - 10} y2={sy}
                    stroke="rgba(255,255,255,0.05)" strokeWidth="1" strokeDasharray="4 6" />
                  <text x={W - 12} y={sy - 3} fontSize="9" fill="rgba(255,255,255,0.2)" textAnchor="end">
                    {(threshold / 100).toFixed(0)}×
                  </text>
                </g>
              );
            })}
            {svgArea && <path d={svgArea} fill="url(#cg-fill)" />}
            {svgPath && (
              <path
                d={svgPath}
                fill="none"
                stroke={liveColor}
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
          </svg>

          {/* Multiplier overlay */}
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            pointerEvents: 'none',
          }}>
            <div style={{ textAlign: 'center' }}>
              <motion.div
                key={`${phase}-${Math.floor(multiplierX100 / 50)}`}
                style={{
                  fontSize: 'clamp(42px, 11vw, 68px)',
                  fontWeight: 900,
                  fontFamily: 'var(--font-display)',
                  color: liveColor,
                  lineHeight: 1,
                  textShadow: `0 0 40px ${liveColor}66`,
                  letterSpacing: '-0.03em',
                  transition: 'color 0.25s ease, text-shadow 0.25s ease',
                }}
              >
                {fmtMult(multiplierX100)}
              </motion.div>
              <AnimatePresence mode="wait">
                {phase === 'waiting' && (
                  <motion.div
                    key="wait-label"
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}
                  >
                    Starting in {waitingSecsLeft}s
                  </motion.div>
                )}
                {phase === 'crashed' && (
                  <motion.div
                    key="crash-label"
                    initial={{ opacity: 0, scale: 0.85 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0 }}
                    style={{ fontSize: 13, color: '#ef4444', fontWeight: 800, marginTop: 6, letterSpacing: '0.06em' }}
                  >
                    CRASHED
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
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
                Cashed out @ {fmtMult(cashoutResult.mx100)} — won {(cashoutResult.payoutMinor / 100).toFixed(0)} Cr
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Bet / cashout panel */}
        <div style={{ padding: '16px', borderTop: '1px solid var(--border)' }}>
          <AnimatePresence mode="wait">

            {/* Waiting — no bet yet */}
            {phase === 'waiting' && !myBet && (
              <motion.div
                key="bet-form"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
              >
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Stake (Cr)
                    </label>
                    <input
                      className="input"
                      type="number"
                      min="0"
                      step="1"
                      placeholder={config ? `Min ${config.minBetMinor / 100}` : '1'}
                      value={stake}
                      onChange={e => { setStake(e.target.value); setBetError(''); }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Auto Cashout (×)
                    </label>
                    <input
                      className="input"
                      type="number"
                      min="1.01"
                      step="0.1"
                      placeholder="e.g. 2.00"
                      value={autoCashout}
                      onChange={e => { setAutoCashout(e.target.value); setBetError(''); }}
                    />
                  </div>
                </div>

                {/* Quick stake chips */}
                <div style={{ display: 'flex', gap: 6 }}>
                  {QUICK_STAKES.map(v => (
                    <button
                      key={v}
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => setStake((v / 100).toString())}
                      style={{ flex: 1, fontSize: 11, padding: '6px 4px' }}
                    >
                      {v / 100}
                    </button>
                  ))}
                </div>

                {betError && (
                  <p style={{ fontSize: 12, color: 'var(--danger)', margin: '-4px 0 0' }}>{betError}</p>
                )}

                <button
                  type="button"
                  className="btn btn-primary btn-full"
                  disabled={!stake || isBetting}
                  onClick={handlePlaceBet}
                >
                  {isBetting ? 'Placing bet...' : 'Place Bet'}
                </button>
              </motion.div>
            )}

            {/* Waiting — bet locked in */}
            {phase === 'waiting' && myBet && (
              <motion.div
                key="bet-queued"
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                style={{
                  background: 'rgba(16,185,129,0.07)',
                  border: '1px solid rgba(16,185,129,0.2)',
                  borderRadius: 10,
                  padding: '14px 16px',
                  textAlign: 'center',
                }}
              >
                <div style={{ fontSize: 14, color: '#10b981', fontWeight: 700, marginBottom: 6 }}>
                  Bet locked — {(myBet.stakeMinor / 100).toFixed(0)} Cr
                </div>
                {myBet.autoCashoutX100 && (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    Auto cashout @ {fmtMult(myBet.autoCashoutX100)}
                  </div>
                )}
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
                  <Clock size={11} /> Waiting for round to start
                </div>
              </motion.div>
            )}

            {/* Running — cashout */}
            {phase === 'running' && hasActiveBet && (
              <motion.div
                key="cashout-btn"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
              >
                <motion.button
                  type="button"
                  onClick={handleCashOut}
                  disabled={isCashingOut}
                  animate={{
                    boxShadow: [
                      `0 0 0px 0px ${liveColor}00`,
                      `0 0 20px 6px ${liveColor}44`,
                      `0 0 0px 0px ${liveColor}00`,
                    ],
                  }}
                  transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
                  style={{
                    width: '100%',
                    padding: '18px 24px',
                    fontSize: 20,
                    fontWeight: 900,
                    fontFamily: 'var(--font-display)',
                    letterSpacing: '-0.02em',
                    background: liveColor,
                    color: '#000',
                    border: 'none',
                    borderRadius: 12,
                    cursor: isCashingOut ? 'not-allowed' : 'pointer',
                    opacity: isCashingOut ? 0.6 : 1,
                  }}
                >
                  {isCashingOut ? 'Cashing out...' : `CASH OUT @ ${fmtMult(multiplierX100)}`}
                </motion.button>
                <p style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', marginTop: 8 }}>
                  Potential win: <strong style={{ color: liveColor }}>
                    {((myBet!.stakeMinor * multiplierX100) / 10000).toFixed(0)} Cr
                  </strong>
                </p>
              </motion.div>
            )}

            {/* Running — spectating */}
            {phase === 'running' && !hasActiveBet && !cashoutResult && (
              <motion.div
                key="spectating"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                style={{ textAlign: 'center', padding: '8px 0', color: 'var(--text-muted)', fontSize: 13 }}
              >
                Round in progress — place your bet next round
              </motion.div>
            )}

            {/* Crashed */}
            {phase === 'crashed' && (
              <motion.div
                key="crashed-panel"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                style={{ textAlign: 'center', padding: '8px 0' }}
              >
                {myBet?.status === 'lost' && !cashoutResult && (
                  <p style={{ fontSize: 14, color: '#ef4444', fontWeight: 700, marginBottom: 6 }}>
                    Lost {(myBet.stakeMinor / 100).toFixed(0)} Cr
                  </p>
                )}
                {round?.seed && (
                  <p style={{
                    fontSize: 10,
                    color: 'var(--text-muted)',
                    fontFamily: 'monospace',
                    wordBreak: 'break-all',
                    marginBottom: 6,
                  }}>
                    Seed: {round.seed}
                  </p>
                )}
                <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Next round starting soon...</p>
              </motion.div>
            )}

            {/* Loading */}
            {phase === 'loading' && (
              <motion.div key="loading" style={{ textAlign: 'center', padding: '16px 0' }}>
                <div className="spinner" />
              </motion.div>
            )}

            {/* Error */}
            {phase === 'error' && (
              <motion.div key="error" style={{ textAlign: 'center', padding: '12px 0' }}>
                <p style={{ fontSize: 13, color: 'var(--danger)' }}>Failed to load game. Refresh to retry.</p>
              </motion.div>
            )}

          </AnimatePresence>
        </div>
      </div>

      {/* Provably fair seed hash */}
      {round?.seedHash && (
        <div className="card" style={{ padding: '10px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <Shield size={12} color="var(--text-muted)" />
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Provably Fair — Committed Seed Hash
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
          Recent Rounds
        </h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {recentRounds.length === 0 ? (
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>No rounds yet</span>
          ) : recentRounds.map(r => {
            const cp = r.crashPointX100 ?? 100;
            const col = multiplierColor(cp, true);
            return (
              <div
                key={r.id}
                title={r.seed ? `Seed: ${r.seed}` : undefined}
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
            My Recent Bets
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
                      {(b.stakeMinor / 100).toFixed(0)} Cr
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
                      ? `+${(b.payoutMinor / 100).toFixed(0)} Cr`
                      : lost
                      ? `-${(b.stakeMinor / 100).toFixed(0)} Cr`
                      : 'Active'}
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
            How to Play
          </span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[
            { icon: '1', text: 'Place your bet during the waiting phase' },
            { icon: '2', text: 'Watch the multiplier climb after launch' },
            { icon: '3', text: 'Cash out any time — higher = riskier' },
            { icon: '4', text: 'Wait too long and you lose your stake' },
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
      <TrendingUp size={11} /> LIVE
    </motion.div>
  );
  if (phase === 'crashed') return (
    <div style={{ ...base, background: 'rgba(239,68,68,0.12)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.28)' }}>
      <AlertTriangle size={11} /> CRASHED
    </div>
  );
  return null;
}
