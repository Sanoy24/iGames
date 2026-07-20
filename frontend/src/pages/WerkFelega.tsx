import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import confetti from 'canvas-confetti';
import { ArrowLeft, Coins, Pause, Play, Settings, Volume2, VolumeX, X } from 'lucide-react';
import { useStore } from '../store/useStore';
import { walletApi } from '../lib/api';
import { getErrorMessage } from '../lib/utils';
import { werkApi, type WerkConfig, type WerkSessionView } from '../lib/werkApi';
import {
  WerkGame, CELL, COIN_COLOR, type HumanInput, type Player, type Standing,
} from '../lib/werkEngine';
import {
  resumeWerkAudio, setWerkMuted, coinPickup, goldPickup, powerPickup,
  sprintHorn, victoryFanfare, lossThud,
} from '../lib/werkSfx';
import { WerkAdmin } from '../components/WerkAdmin';

type Screen = 'lobby' | 'playing' | 'result';

const THEME_BG: Record<string, [string, string]> = {
  adwa: ['#0a3f28', '#062015'],
  highland: ['#3a2f14', '#1a140a'],
  desert: ['#3a2a10', '#1c1408'],
};

export function WerkFelega({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation();
  const user = useStore((s) => s.user);
  const isAdmin = !!user?.roles?.includes('admin');
  const addToast = useStore((s) => s.addToast);
  const setWallet = useStore((s) => s.setWallet);

  const [config, setConfig] = useState<WerkConfig | null>(null);
  const [screen, setScreen] = useState<Screen>('lobby');
  const [stake, setStake] = useState(10);
  const [busy, setBusy] = useState(false);
  const [showHowTo, setShowHowTo] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [muted, setMutedState] = useState(false);
  const [paused, setPaused] = useState(false);
  const [session, setSession] = useState<WerkSessionView | null>(null);
  const [result, setResult] = useState<{ standings: Standing[]; prizeMinor: number; rank: number; eliminated: boolean } | null>(null);
  const [, forceHud] = useState(0);

  const gameRef = useRef<WerkGame | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const inputRef = useRef<HumanInput>({ up: false, down: false, left: false, right: false, sprint: false, usePower: false });
  const rafRef = useRef<number>(0);
  const lastTsRef = useRef<number>(0);
  const pausedRef = useRef(false);
  const settlingRef = useRef(false);

  useEffect(() => { pausedRef.current = paused; }, [paused]);

  useEffect(() => {
    werkApi.getConfig().then((c) => { setConfig(c); setStake(c.entryStakeMinor); }).catch(() => {});
  }, []);

  const toggleMute = () => {
    const next = !muted;
    setMutedState(next);
    setWerkMuted(next);
  };

  // ── Settlement ──────────────────────────────────────────────────────────
  const finishGame = useCallback(async () => {
    const g = gameRef.current;
    if (!g || settlingRef.current || !session) return;
    settlingRef.current = true;
    const res = g.humanResult();
    const standings = g.standings();
    if (res.eliminated) lossThud(); else if (res.rank <= 3) victoryFanfare();
    try {
      const settled = await werkApi.settle(session.id, {
        rank: res.rank, tieCount: res.tieCount, coinValue: res.coinValue, eliminated: res.eliminated,
      });
      setResult({ standings, prizeMinor: settled.prizeMinor, rank: res.rank, eliminated: res.eliminated });
      if (settled.prizeMinor > 0) {
        confetti({ particleCount: 160, spread: 80, origin: { y: 0.6 }, colors: ['#078930', '#FCDD09', '#DA121A'] });
      }
      walletApi.getWallet().then(setWallet).catch(() => {});
    } catch (e) {
      addToast('error', getErrorMessage(e) || t('werk.errSettle'));
      setResult({ standings, prizeMinor: 0, rank: res.rank, eliminated: res.eliminated });
    } finally {
      setScreen('result');
    }
  }, [session, setWallet, addToast, t]);

  // ── Game loop ───────────────────────────────────────────────────────────
  const startLoop = useCallback(() => {
    let lastHud = 0;
    const loop = (ts: number) => {
      const g = gameRef.current;
      if (!g) return;
      const last = lastTsRef.current || ts;
      const dt = (ts - last) / 1000;
      lastTsRef.current = ts;
      if (!pausedRef.current) g.update(dt, inputRef.current);
      inputRef.current.usePower = false; // edge-triggered
      drawWorld(canvasRef.current, g, ts / 1000);
      if (ts - lastHud > 90) { lastHud = ts; forceHud((h) => h + 1); }
      if (g.finished) { void finishGame(); return; }
      rafRef.current = requestAnimationFrame(loop);
    };
    lastTsRef.current = 0;
    rafRef.current = requestAnimationFrame(loop);
  }, [finishGame]);

  const stopLoop = () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); rafRef.current = 0; };

  // ── Start a game ────────────────────────────────────────────────────────
  const startGame = async () => {
    if (!config) return;
    setBusy(true);
    resumeWerkAudio();
    try {
      const s = await werkApi.start(stake);
      setSession(s);
      const g = new WerkGame({
        seed: s.seed, mode: s.mode, durationSec: s.durationSec, totalPlayers: s.totalPlayers,
        botCount: s.botCount, coinDensityX100: s.coinDensityX100, finalSprintWarningSec: s.finalSprintWarningSec,
        powerupsEnabled: s.powerupsEnabled, theme: s.mazeTheme, humanName: user?.displayName ?? 'You',
        bots: s.bots,
      });
      g.onCollect = (_p, c) => { if (c.type === 'gold') goldPickup(); else coinPickup(); };
      g.onPower = () => powerPickup();
      g.onSprintWarn = () => sprintHorn();
      gameRef.current = g;
      settlingRef.current = false;
      setResult(null);
      setPaused(false);
      setScreen('playing');
    } catch (e) {
      addToast('error', getErrorMessage(e) || t('werk.errStart'));
    } finally {
      setBusy(false);
    }
  };

  // Keyboard input.
  useEffect(() => {
    if (screen !== 'playing') return;
    const set = (e: KeyboardEvent, v: boolean) => {
      const k = e.key.toLowerCase();
      const i = inputRef.current;
      if (k === 'w' || k === 'arrowup') i.up = v;
      else if (k === 's' || k === 'arrowdown') i.down = v;
      else if (k === 'a' || k === 'arrowleft') i.left = v;
      else if (k === 'd' || k === 'arrowright') i.right = v;
      else if (k === 'shift') i.sprint = v;
      else if (k === ' ' && v) i.usePower = true;
      else if (k === 'p' && v) setPaused((p) => !p);
      else return;
      e.preventDefault();
    };
    const down = (e: KeyboardEvent) => set(e, true);
    const up = (e: KeyboardEvent) => set(e, false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    startLoop();
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      stopLoop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen]);

  const leaveGame = async () => {
    stopLoop();
    const g = gameRef.current;
    if (g && !g.finished && session) {
      try { await werkApi.abort(session.id); walletApi.getWallet().then(setWallet).catch(() => {}); addToast('info', t('werk.stakeRefunded')); }
      catch { /* ignore */ }
    }
    gameRef.current = null;
    setSession(null);
    setScreen('lobby');
  };

  const backToLobby = () => { gameRef.current = null; setSession(null); setResult(null); setScreen('lobby'); };

  // ── Render: lobby ─────────────────────────────────────────────────────────
  if (screen === 'lobby') {
    const mults = config?.payoutMultsX100 ?? [];
    return (
      <div style={{ padding: '12px 14px 28px', maxWidth: 640, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <button className="btn" onClick={onBack} style={{ padding: '6px 10px', display: 'flex', alignItems: 'center', gap: 6 }}>
            <ArrowLeft size={16} /> {t('nav.games')}
          </button>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>⛏️ {t('werk.title')}</h2>
          {isAdmin && (
            <button className="btn" onClick={() => setShowAdmin(true)} style={{ marginLeft: 'auto', padding: '6px 10px' }} title={t('werk.adminPortal')}>
              <Settings size={16} />
            </button>
          )}
        </div>

        {/* Title card */}
        <div style={{
          borderRadius: 16, padding: '22px 18px', marginBottom: 16, textAlign: 'center',
          background: 'radial-gradient(circle at 50% 30%, rgba(255,215,0,0.14), rgba(0,107,63,0.25))',
          border: '1px solid rgba(212,160,23,0.35)',
        }}>
          <div style={{ fontSize: 30, fontWeight: 900, color: '#FCDD09', textShadow: '0 0 18px rgba(252,221,9,0.5)' }}>ወርቅ ፍለጋ</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', letterSpacing: '0.14em', textTransform: 'uppercase', marginTop: 2 }}>Gold Rush</div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 0, marginTop: 12, borderRadius: 6, overflow: 'hidden', width: 120, marginInline: 'auto', height: 6 }}>
            <div style={{ flex: 1, background: '#078930' }} /><div style={{ flex: 1, background: '#FCDD09' }} /><div style={{ flex: 1, background: '#DA121A' }} />
          </div>
        </div>

        {config && !config.enabled && (
          <div style={{ padding: 14, borderRadius: 12, background: 'rgba(220,18,26,0.12)', border: '1px solid rgba(220,18,26,0.3)', marginBottom: 14, fontSize: 13 }}>
            {t('werk.unavailable')}
          </div>
        )}

        {/* Play card */}
        <div style={{ background: 'var(--surface, rgba(255,255,255,0.04))', border: '1px solid var(--border, rgba(255,255,255,0.1))', borderRadius: 14, padding: 16, marginBottom: 14 }}>
          <InfoRow label={t('werk.mode')} value={config?.winningMode === 'B' ? t('werk.modeB') : t('werk.modeA')} />
          <InfoRow label={t('werk.players')} value={`${config?.totalPlayers ?? '–'} (${config?.botCount ?? 0} 🤖)`} />
          <InfoRow label={t('werk.duration')} value={`${config?.gameDurationSec ?? '–'}s`} />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '12px 0 8px' }}>
            <label style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{t('werk.stake')}</label>
            <input
              type="number" value={stake}
              min={config?.minStakeMinor ?? 1} max={config?.maxStakeMinor ?? 1000}
              onChange={(e) => setStake(parseInt(e.target.value, 10) || 0)}
              style={{ width: 90, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border, rgba(255,255,255,0.15))', background: 'var(--surface,#0c0a08)', color: 'inherit', fontFamily: 'ui-monospace, monospace' }}
            />
            <button className="btn btn-primary" disabled={busy || !config?.enabled} onClick={startGame} style={{ marginLeft: 'auto' }}>
              {busy ? '…' : t('werk.startGame')}
            </button>
          </div>
          {/* Prize table */}
          <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {mults.map((m, i) => m > 0 && (
              <span key={i} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 999, background: 'rgba(252,221,9,0.1)', border: '1px solid rgba(252,221,9,0.25)' }}>
                #{i + 1} · {(m / 100).toFixed(2)}× · {Math.floor((stake * m) / 100)}
              </span>
            ))}
          </div>
        </div>

        <button className="btn" onClick={() => setShowHowTo(true)} style={{ width: '100%' }}>{t('werk.howToPlay')}</button>

        {showHowTo && <HowToModal onClose={() => setShowHowTo(false)} />}
        {showAdmin && <WerkAdmin onClose={() => { setShowAdmin(false); werkApi.getConfig().then(setConfig).catch(() => {}); }} />}
      </div>
    );
  }

  // ── Render: result ────────────────────────────────────────────────────────
  if (screen === 'result' && result) {
    return <ResultScreen result={result} onNewGame={backToLobby} onMenu={onBack} />;
  }

  // ── Render: playing (canvas + HUD) ────────────────────────────────────────
  const g = gameRef.current;
  const bg = THEME_BG[config?.mazeTheme ?? 'adwa'] ?? THEME_BG.adwa;
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 2000, background: `radial-gradient(circle at 50% 40%, ${bg[0]}, ${bg[1]})`, overflow: 'hidden' }}>
      <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} />

      {g && <GameHud game={g} muted={muted} paused={paused} onLeave={leaveGame} onPause={() => setPaused((p) => !p)} onMute={toggleMute} />}
      {g && <TouchControls inputRef={inputRef} />}

      {paused && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.55)' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 14 }}>{t('werk.paused')}</div>
            <button className="btn btn-primary" onClick={() => setPaused(false)} style={{ marginRight: 8 }}><Play size={15} /> {t('werk.resume')}</button>
            <button className="btn" onClick={leaveGame}>{t('werk.leave')}</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── HUD ──────────────────────────────────────────────────────────────────────
function GameHud({ game, muted, paused, onLeave, onPause, onMute }: {
  game: WerkGame; muted: boolean; paused: boolean; onLeave: () => void; onPause: () => void; onMute: () => void;
}) {
  const { t } = useTranslation();
  const standings = game.standings();
  const mine = standings.find((s) => s.player.isHuman)!;
  const top = standings.slice(0, 6);
  const h = game.human;
  const secs = Math.ceil(game.timeLeft);
  const isSprint = game.isFinalSprint;

  return (
    <>
      {/* Top bar */}
      <div style={{ position: 'absolute', top: 8, left: 8, right: 8, display: 'flex', gap: 8, alignItems: 'flex-start', pointerEvents: 'none' }}>
        <button className="btn" onClick={onLeave} style={{ padding: '6px 8px', pointerEvents: 'auto' }} aria-label="Leave"><ArrowLeft size={15} /></button>
        {/* Timer */}
        <div style={{
          marginInline: 'auto', textAlign: 'center', padding: '4px 16px', borderRadius: 10,
          background: isSprint ? 'rgba(220,18,26,0.85)' : 'rgba(0,0,0,0.45)',
          border: `1px solid ${isSprint ? '#DA121A' : 'rgba(255,255,255,0.15)'}`,
          transform: isSprint ? `scale(${1 + 0.05 * Math.sin(Date.now() / 120)})` : 'none',
        }}>
          <div style={{ fontSize: 24, fontWeight: 900, fontFamily: 'ui-monospace, monospace', lineHeight: 1 }}>
            {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, pointerEvents: 'auto' }}>
          <button className="btn" onClick={onPause} style={{ padding: '6px 8px' }} aria-label="Pause">{paused ? <Play size={15} /> : <Pause size={15} />}</button>
          <button className="btn" onClick={onMute} style={{ padding: '6px 8px' }} aria-label="Mute">{muted ? <VolumeX size={15} /> : <Volume2 size={15} />}</button>
        </div>
      </div>

      {/* Leaderboard (top-right) */}
      <div style={{ position: 'absolute', top: 56, right: 8, width: 158, background: 'rgba(0,0,0,0.42)', borderRadius: 10, padding: '8px 9px', fontSize: 11.5, border: '1px solid rgba(255,255,255,0.1)' }}>
        <div style={{ fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-muted)', marginBottom: 5 }}>{t('werk.leaderboard')}</div>
        {top.map((s, i) => (
          <div key={s.player.id} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '2px 0', fontWeight: s.player.isHuman ? 800 : 500, color: s.player.isHuman ? '#FCDD09' : 'inherit' }}>
            <span style={{ width: 12, textAlign: 'right', color: 'var(--text-muted)' }}>{i + 1}</span>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: s.player.color, flexShrink: 0 }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{s.player.isHuman ? t('werk.you') : s.player.name}</span>
            <span style={{ fontFamily: 'ui-monospace, monospace' }}>{s.player.coinValue}</span>
          </div>
        ))}
      </div>

      {/* Personal stats (bottom-left) */}
      <div style={{ position: 'absolute', bottom: 96, left: 8, background: 'rgba(0,0,0,0.42)', borderRadius: 10, padding: '8px 10px', fontSize: 12, border: '1px solid rgba(255,255,255,0.1)', minWidth: 150 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 800, fontSize: 15 }}>
          <Coins size={14} style={{ color: '#FCDD09' }} /> {h.coinValue}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 3, color: 'var(--text-muted)', fontSize: 11 }}>
          <span style={{ color: COIN_COLOR.bronze }}>●{h.bronze}</span>
          <span style={{ color: COIN_COLOR.silver }}>●{h.silver}</span>
          <span style={{ color: COIN_COLOR.gold }}>●{h.gold}</span>
        </div>
        {/* Stamina */}
        <div style={{ marginTop: 6, height: 5, background: 'rgba(255,255,255,0.12)', borderRadius: 3, overflow: 'hidden' }}>
          <div style={{ width: `${h.stamina}%`, height: '100%', background: h.stamina > 30 ? '#4ade80' : '#f87171' }} />
        </div>
        {/* Active power-ups */}
        <div style={{ display: 'flex', gap: 6, marginTop: 5, fontSize: 11 }}>
          {h.boost > 0 && <span title="Speed">⚡{h.boost.toFixed(0)}</span>}
          {h.magnet > 0 && <span title="Magnet">🧲{h.magnet.toFixed(0)}</span>}
          {h.shield > 0 && <span title="Shield">🛡{h.shield.toFixed(0)}</span>}
          {(h._pendingSpeed || h._pendingMagnet || h._pendingShield) && <span style={{ color: '#FCDD09' }}>{t('werk.powerReady')}</span>}
        </div>
      </div>

      {/* Rank (bottom-right) */}
      <div style={{ position: 'absolute', bottom: 96, right: 8, background: 'rgba(0,0,0,0.42)', borderRadius: 10, padding: '6px 12px', fontSize: 13, border: '1px solid rgba(255,255,255,0.1)', textAlign: 'center' }}>
        <div style={{ fontSize: 9.5, textTransform: 'uppercase', color: 'var(--text-muted)' }}>{t('werk.rank')}</div>
        <div style={{ fontSize: 18, fontWeight: 900 }}>#{mine.rank}<span style={{ fontSize: 11, color: 'var(--text-muted)' }}>/{game.players.length}</span></div>
      </div>

      {/* Minimap (top-left, under timer bar) */}
      <Minimap game={game} />

      {/* Final-sprint overlay */}
      {isSprint && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          <div style={{ fontSize: 120, fontWeight: 900, color: 'rgba(220,18,26,0.85)', textShadow: '0 0 40px rgba(220,18,26,0.9)' }}>
            {secs > 0 ? secs : t('werk.timeUp')}
          </div>
          <div style={{ position: 'absolute', top: '18%', fontSize: 15, fontWeight: 800, color: '#fff', background: 'rgba(220,18,26,0.7)', padding: '6px 14px', borderRadius: 8 }}>
            {t('werk.reachCenter')} ★
          </div>
        </div>
      )}
    </>
  );
}

function Minimap({ game }: { game: WerkGame }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const ctx = cv.getContext('2d'); if (!ctx) return;
    const S = 140;
    const scale = S / game.worldPx;
    ctx.clearRect(0, 0, S, S);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, 0, S, S);
    // center hub
    const [cx, cy] = game.center;
    ctx.fillStyle = 'rgba(252,221,9,0.9)';
    ctx.fillRect((cx * CELL) * scale, (cy * CELL) * scale, CELL * scale, CELL * scale);
    // coins (faint)
    ctx.fillStyle = 'rgba(255,215,0,0.35)';
    for (const c of game.coins) if (!c.collected) ctx.fillRect(c.x * scale - 0.5, c.y * scale - 0.5, 1.4, 1.4);
    // players
    for (const p of game.players) {
      if (p.state === 'eliminated') continue;
      ctx.fillStyle = p.isHuman ? '#fff' : p.color;
      ctx.beginPath();
      ctx.arc(p.x * scale, p.y * scale, p.isHuman ? 3 : 2, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  return (
    <canvas ref={ref} width={140} height={140}
      style={{ position: 'absolute', top: 56, left: 8, width: 120, height: 120, borderRadius: 10, border: '1px solid rgba(255,255,255,0.15)' }} />
  );
}

// ── Touch controls (mobile) ────────────────────────────────────────────────
function TouchControls({ inputRef }: { inputRef: React.MutableRefObject<HumanInput> }) {
  const press = (key: keyof HumanInput, v: boolean) => { inputRef.current[key] = v; };
  const Btn = ({ label, k, style }: { label: string; k: keyof HumanInput; style: React.CSSProperties }) => (
    <button
      onPointerDown={(e) => { e.preventDefault(); press(k, true); }}
      onPointerUp={() => press(k, false)}
      onPointerLeave={() => press(k, false)}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        position: 'absolute', width: 52, height: 52, borderRadius: 12, ...style,
        background: 'rgba(255,255,255,0.14)', border: '1px solid rgba(255,255,255,0.2)',
        color: '#fff', fontSize: 20, fontWeight: 800, touchAction: 'none', userSelect: 'none',
      }}
    >{label}</button>
  );
  return (
    <>
      {/* D-pad bottom-left */}
      <div style={{ position: 'absolute', bottom: 14, left: 14, width: 168, height: 168 }}>
        <Btn label="▲" k="up" style={{ left: 58, top: 0 }} />
        <Btn label="◀" k="left" style={{ left: 0, top: 58 }} />
        <Btn label="▶" k="right" style={{ left: 116, top: 58 }} />
        <Btn label="▼" k="down" style={{ left: 58, top: 116 }} />
      </div>
      {/* Action buttons bottom-right */}
      <div style={{ position: 'absolute', bottom: 14, right: 14, width: 120, height: 120 }}>
        <Btn label="⚡" k="sprint" style={{ right: 0, top: 58, width: 52 }} />
        <button
          onPointerDown={(e) => { e.preventDefault(); inputRef.current.usePower = true; }}
          style={{ position: 'absolute', right: 62, top: 20, width: 56, height: 56, borderRadius: '50%', background: 'rgba(252,221,9,0.25)', border: '1px solid rgba(252,221,9,0.5)', color: '#FCDD09', fontSize: 22, touchAction: 'none' }}
        >★</button>
      </div>
    </>
  );
}

// ── Result screen ──────────────────────────────────────────────────────────
function ResultScreen({ result, onNewGame, onMenu }: {
  result: { standings: Standing[]; prizeMinor: number; rank: number; eliminated: boolean };
  onNewGame: () => void; onMenu: () => void;
}) {
  const { t } = useTranslation();
  const podium = result.standings.filter((s) => s.eligible).slice(0, 3);
  return (
    <div style={{ padding: '20px 16px 32px', maxWidth: 560, margin: '0 auto' }}>
      <div style={{ textAlign: 'center', marginBottom: 18 }}>
        <div style={{ fontSize: 48 }}>{result.eliminated ? '💀' : result.prizeMinor > 0 ? '🏆' : '🎮'}</div>
        <h2 style={{ margin: '6px 0 2px', fontSize: 22, fontWeight: 900 }}>
          {result.eliminated ? t('werk.eliminated') : result.prizeMinor > 0 ? t('werk.youWon') : t('werk.gameOver')}
        </h2>
        <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>{t('werk.finishedRank', { rank: result.rank })}</div>
        {result.prizeMinor > 0 && (
          <div style={{ marginTop: 10, fontSize: 26, fontWeight: 900, color: '#FCDD09' }}>+{result.prizeMinor}</div>
        )}
      </div>

      {/* Podium */}
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'flex-end', gap: 8, marginBottom: 18 }}>
        {[1, 0, 2].map((idx) => {
          const s = podium[idx];
          if (!s) return <div key={idx} style={{ width: 84 }} />;
          const heights = [96, 72, 56];
          return (
            <div key={idx} style={{ textAlign: 'center', width: 84 }}>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {s.player.isHuman ? t('werk.you') : s.player.name}
              </div>
              <div style={{
                height: heights[idx], borderRadius: '8px 8px 0 0', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 6,
                background: idx === 1 ? 'linear-gradient(#FCDD09,#b8930a)' : idx === 0 ? 'linear-gradient(#c0c0c0,#8a8a8a)' : 'linear-gradient(#cd7f32,#8a5320)',
                fontWeight: 900, fontSize: 20, color: '#1a1a1a',
              }}>{idx === 1 ? 1 : idx === 0 ? 2 : 3}</div>
              <div style={{ fontSize: 12, fontFamily: 'ui-monospace, monospace', marginTop: 2 }}>{s.player.coinValue}</div>
            </div>
          );
        })}
      </div>

      {/* Full leaderboard */}
      <div style={{ background: 'var(--surface, rgba(255,255,255,0.04))', border: '1px solid var(--border, rgba(255,255,255,0.1))', borderRadius: 12, padding: 10, marginBottom: 16, maxHeight: 240, overflowY: 'auto' }}>
        {result.standings.map((s) => (
          <div key={s.player.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 4px', fontSize: 13, fontWeight: s.player.isHuman ? 800 : 500, color: s.player.isHuman ? '#FCDD09' : 'inherit', opacity: s.eligible ? 1 : 0.45 }}>
            <span style={{ width: 22, textAlign: 'right', color: 'var(--text-muted)' }}>{s.eligible ? `#${s.rank}` : '✗'}</span>
            <span style={{ width: 9, height: 9, borderRadius: '50%', background: s.player.color }} />
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.player.isHuman ? t('werk.you') : s.player.name}</span>
            <span style={{ fontFamily: 'ui-monospace, monospace' }}>{s.player.coinValue}</span>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 10 }}>
        <button className="btn btn-primary" onClick={onNewGame} style={{ flex: 1 }}>{t('werk.newGame')}</button>
        <button className="btn" onClick={onMenu} style={{ flex: 1 }}>{t('werk.mainMenu')}</button>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 13 }}>
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ fontWeight: 700 }}>{value}</span>
    </div>
  );
}

function HowToModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const rows = [
    ['🕹️', t('werk.htMove')],
    ['⚡', t('werk.htSprint')],
    ['★', t('werk.htPower')],
    ['🪙', t('werk.htCollect')],
    ['🏁', t('werk.htWin')],
  ];
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--surface,#12161c)', border: '1px solid var(--border, rgba(255,255,255,0.12))', borderRadius: 16, padding: 20, maxWidth: 380, width: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>{t('werk.howToPlay')}</h3>
          <button className="btn" onClick={onClose} style={{ marginLeft: 'auto', padding: '4px 8px' }}><X size={16} /></button>
        </div>
        {rows.map(([icon, text], i) => (
          <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 10, fontSize: 13.5 }}>
            <span style={{ fontSize: 18 }}>{icon}</span><span>{text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Canvas world renderer ────────────────────────────────────────────────────
function drawWorld(canvas: HTMLCanvasElement | null, game: WerkGame, time: number) {
  if (!canvas) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const vw = canvas.clientWidth, vh = canvas.clientHeight;
  if (canvas.width !== vw * dpr || canvas.height !== vh * dpr) {
    canvas.width = vw * dpr; canvas.height = vh * dpr;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, vw, vh);

  // Camera: follow human, clamp to world.
  const h = game.human;
  let camX = h.x - vw / 2, camY = h.y - vh / 2;
  camX = Math.max(0, Math.min(camX, game.worldPx - vw));
  camY = Math.max(0, Math.min(camY, game.worldPx - vh));
  if (game.worldPx < vw) camX = (game.worldPx - vw) / 2;
  if (game.worldPx < vh) camY = (game.worldPx - vh) / 2;

  ctx.save();
  ctx.translate(-camX, -camY);

  // Floor
  ctx.fillStyle = '#F5E6A3';
  ctx.fillRect(0, 0, game.worldPx, game.worldPx);

  // Center hub (pulsing)
  const [ccx, ccy] = game.center;
  const hubX = ccx * CELL + CELL / 2, hubY = ccy * CELL + CELL / 2;
  const pulse = 0.5 + 0.5 * Math.sin(time * 4);
  const isSprint = game.isFinalSprint;
  const grad = ctx.createRadialGradient(hubX, hubY, 2, hubX, hubY, CELL * (0.9 + pulse * 0.4));
  grad.addColorStop(0, isSprint ? `rgba(220,18,26,${0.6 + pulse * 0.4})` : `rgba(252,221,9,${0.5 + pulse * 0.35})`);
  grad.addColorStop(1, 'rgba(252,221,9,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(hubX - CELL * 1.4, hubY - CELL * 1.4, CELL * 2.8, CELL * 2.8);
  ctx.fillStyle = isSprint ? '#DA121A' : '#b8930a';
  ctx.font = `${CELL * 0.9}px serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('★', hubX, hubY + 2);

  // Walls (gold)
  const startCol = Math.max(0, Math.floor(camX / CELL) - 1);
  const endCol = Math.min(game.size - 1, Math.ceil((camX + vw) / CELL) + 1);
  const startRow = Math.max(0, Math.floor(camY / CELL) - 1);
  const endRow = Math.min(game.size - 1, Math.ceil((camY + vh) / CELL) + 1);
  ctx.strokeStyle = '#D4A017';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let gy = startRow; gy <= endRow; gy++) {
    for (let gx = startCol; gx <= endCol; gx++) {
      const cell = game.grid[gy][gx];
      const x0 = gx * CELL, y0 = gy * CELL, x1 = x0 + CELL, y1 = y0 + CELL;
      if (cell.top) { ctx.moveTo(x0, y0); ctx.lineTo(x1, y0); }
      if (cell.left) { ctx.moveTo(x0, y0); ctx.lineTo(x0, y1); }
      if (gx === game.size - 1 && cell.right) { ctx.moveTo(x1, y0); ctx.lineTo(x1, y1); }
      if (gy === game.size - 1 && cell.bottom) { ctx.moveTo(x0, y1); ctx.lineTo(x1, y1); }
    }
  }
  ctx.stroke();

  // Coins (bob + glow)
  for (const c of game.coins) {
    if (c.collected) continue;
    if (c.x < camX - CELL || c.x > camX + vw + CELL || c.y < camY - CELL || c.y > camY + vh + CELL) continue;
    const bob = Math.sin(time * 3 + c.cx + c.cy) * 3;
    const cy = c.y + bob;
    const r = c.type === 'gold' ? 8 : c.type === 'silver' ? 7 : 6;
    ctx.fillStyle = COIN_COLOR[c.type];
    ctx.shadowColor = COIN_COLOR[c.type];
    ctx.shadowBlur = c.type === 'gold' ? 14 : 6;
    ctx.beginPath(); ctx.arc(c.x, cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
  }

  // Power-ups
  if (game.opts.powerupsEnabled) {
    ctx.font = `${CELL * 0.55}px serif`;
    for (const pu of game.powerups) {
      if (pu.taken) continue;
      if (pu.x < camX - CELL || pu.x > camX + vw + CELL || pu.y < camY - CELL || pu.y > camY + vh + CELL) continue;
      ctx.fillText(pu.kind === 'speed' ? '⚡' : pu.kind === 'magnet' ? '🧲' : '🛡', pu.x, pu.y);
    }
  }

  // Players
  for (const p of game.players) {
    if (p.state === 'eliminated') continue;
    if (p.x < camX - CELL || p.x > camX + vw + CELL || p.y < camY - CELL || p.y > camY + vh + CELL) continue;
    drawPlayer(ctx, p, p.isHuman);
  }

  ctx.restore();
}

function drawPlayer(ctx: CanvasRenderingContext2D, p: Player, isHuman: boolean) {
  const r = CELL * 0.3;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.fillStyle = p.color;
  ctx.fill();
  ctx.lineWidth = isHuman ? 3 : 1.5;
  ctx.strokeStyle = isHuman ? '#fff' : 'rgba(0,0,0,0.4)';
  ctx.stroke();
  if (p.magnet > 0) {
    ctx.beginPath(); ctx.arc(p.x, p.y, r + 5, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(96,165,250,0.6)'; ctx.lineWidth = 2; ctx.stroke();
  }
  // Name tag
  const label = isHuman ? '★' : p.name;
  ctx.font = `${isHuman ? 12 : 10}px sans-serif`;
  ctx.textAlign = 'center';
  const w = ctx.measureText(label).width + 8;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(p.x - w / 2, p.y - r - 16, w, 13);
  ctx.fillStyle = isHuman ? '#FCDD09' : '#fff';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, p.x, p.y - r - 9);
}
