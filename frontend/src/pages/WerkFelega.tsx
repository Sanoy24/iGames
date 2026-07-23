import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import confetti from 'canvas-confetti';
import {
  ArrowLeft, Eye, Play, Settings, Users, Volume2, VolumeX, X, Zap,
} from 'lucide-react';
import { useStore } from '../store/useStore';
import { walletApi } from '../lib/api';
import { getErrorMessage } from '../lib/utils';
import { werkApi, type WerkConfig, type WerkRoundView, type WerkStanding } from '../lib/werkApi';
import { WerkGame, CELL, COIN_COLOR, type HumanInput, type MazeTheme, type Player } from '../lib/werkEngine';
import { useWerkSocket, sendWerkInput } from '../hooks/useWerkSocket';
import {
  resumeWerkAudio, setWerkMuted, coinPickup, goldPickup, powerPickup, sprintHorn, victoryFanfare, lossThud,
} from '../lib/werkSfx';
import { WerkAdmin } from '../components/WerkAdmin';

type Screen = 'lobby' | 'playing' | 'result';

/** Premium palette from the design brief (dark, atmospheric, neon accents). */
const C = {
  bg: '#0B0F14', surface: '#161B22', surface2: '#1E242D',
  accent: '#00D4FF', accent2: '#7C5CFF', success: '#34D399', warn: '#FBBF24', danger: '#FF5C5C',
  coin: '#FFD54A', text: '#FFFFFF', dim: '#A8B3C2', border: 'rgba(255,255,255,0.08)',
};
const glass: React.CSSProperties = {
  background: 'rgba(22,27,34,0.72)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)',
  border: `1px solid ${C.border}`, borderRadius: 16,
};

export function WerkFelega({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation();
  const user = useStore((s) => s.user);
  const isAdmin = !!user?.roles?.includes('admin');
  const addToast = useStore((s) => s.addToast);
  const setWallet = useStore((s) => s.setWallet);

  const [config, setConfig] = useState<WerkConfig | null>(null);
  const [round, setRound] = useState<WerkRoundView | null>(null);
  const [screen, setScreen] = useState<Screen>('lobby');
  const [stake, setStake] = useState(10);
  const [busy, setBusy] = useState(false);
  const [showHowTo, setShowHowTo] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [muted, setMutedState] = useState(false);
  const [spectating, setSpectating] = useState(false);
  const [result, setResult] = useState<{ standings: WerkStanding[]; prizeMinor: number; rank: number; eliminated: boolean } | null>(null);
  const [, forceHud] = useState(0);

  const gameRef = useRef<WerkGame | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const inputRef = useRef<HumanInput>({ up: false, down: false, left: false, right: false, sprint: false, usePower: false });
  const rafRef = useRef<number>(0);
  const lastTsRef = useRef<number>(0);
  const sendAccRef = useRef<number>(0);
  const screenRef = useRef<Screen>('lobby');

  useEffect(() => { screenRef.current = screen; }, [screen]);
  const toggleMute = () => { const n = !muted; setMutedState(n); setWerkMuted(n); };

  useEffect(() => {
    werkApi.getConfig().then((c) => { setConfig(c); setStake(c.entryStakeMinor); }).catch(() => {});
    werkApi.getCurrent().then((r) => { if (r.status !== 'none') setRound(r); }).catch(() => {});
  }, []);

  const roundId = round && round.status !== 'none' ? round.id : null;

  const startPlaying = useCallback((v: WerkRoundView, asSpectator: boolean) => {
    if (!config) return;
    const g = new WerkGame({
      seed: v.seed, mode: v.mode, durationSec: v.durationSec, maxPlayers: v.maxPlayers,
      botCount: v.botCount, coinDensityX100: v.coinDensityX100, finalSprintWarningSec: v.finalSprintWarningSec,
      powerupsEnabled: v.powerupsEnabled, theme: (v.mazeTheme ?? config.mazeTheme) as MazeTheme,
      yourSeat: asSpectator ? null : v.yourSeat, yourName: user?.displayName ?? 'You',
    });
    g.onCollect = (type) => { if (type === 'gold') goldPickup(); else coinPickup(); };
    g.onPower = () => powerPickup();
    g.onSprintWarn = () => sprintHorn();
    g.applyRoundState(v);
    gameRef.current = g;
    setSpectating(asSpectator);
    setResult(null);
    setScreen('playing');
  }, [config, user]);

  const handleCompleted = useCallback((v: WerkRoundView) => {
    gameRef.current?.markCompleted();
    setRound(v);
    const mine = v.standings.find((s) => s.participantId && s.participantId === v.yourParticipantId)
      ?? v.standings.find((s) => s.isHuman && s.userId === user?.id);
    if (!mine) {
      // Spectator — return to the lobby to join the next round.
      gameRef.current = null;
      setScreen('lobby');
      return;
    }
    const rank = mine.rank;
    const eliminated = mine.eligible === false;
    const prizeMinor = mine.prizeMinor ?? 0;
    if (eliminated) lossThud(); else if (rank <= 3 && prizeMinor > 0) victoryFanfare();
    setResult({ standings: v.standings, prizeMinor, rank, eliminated });
    if (prizeMinor > 0) confetti({ particleCount: 180, spread: 85, origin: { y: 0.6 }, colors: [C.success, C.coin, C.accent] });
    walletApi.getWallet().then(setWallet).catch(() => {});
    setScreen('result');
  }, [user, setWallet]);

  useWerkSocket(roundId, {
    onRoundState: (v) => {
      setRound(v);
      gameRef.current?.applyRoundState(v);
      if (v.status === 'running' && v.yourParticipantId && screenRef.current !== 'playing') {
        startPlaying(v, false);
      }
    },
    onSnapshot: (s) => { gameRef.current?.applySnapshot(s); },
    onCompleted: (v) => { handleCompleted(v); },
  });

  // ── Foreground resync: server owns the clock, so we just re-pull current state. ──
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      werkApi.getCurrent().then((r) => {
        if (r.status === 'none') return;
        setRound(r);
        gameRef.current?.applyRoundState(r);
        if (screenRef.current === 'playing' && (r.status === 'completed' || r.status === 'cancelled')) {
          handleCompleted(r);
        }
      }).catch(() => {});
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [handleCompleted]);

  // ── Game loop ───────────────────────────────────────────────────────────────
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
      else return;
      e.preventDefault();
    };
    const down = (e: KeyboardEvent) => set(e, true);
    const up = (e: KeyboardEvent) => set(e, false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);

    let lastHud = 0;
    const loop = (ts: number) => {
      const g = gameRef.current;
      if (!g) return;
      const last = lastTsRef.current || ts;
      const dt = (ts - last) / 1000;
      lastTsRef.current = ts;
      const msg = g.update(dt, inputRef.current);
      inputRef.current.usePower = false;
      drawWorld(canvasRef.current, g, ts / 1000);
      if (g.human) {
        sendAccRef.current += dt;
        if (sendAccRef.current >= 0.06) { sendAccRef.current = 0; sendWerkInput(msg); }
      }
      if (ts - lastHud > 90) { lastHud = ts; forceHud((h) => h + 1); }
      rafRef.current = requestAnimationFrame(loop);
    };
    lastTsRef.current = 0;
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    };
  }, [screen]);

  const joinGame = async () => {
    if (!config) return;
    setBusy(true);
    resumeWerkAudio();
    try {
      const v = await werkApi.join(stake);
      setRound(v);
      if (v.status === 'running' && v.yourParticipantId) startPlaying(v, false);
    } catch (e) {
      addToast('error', getErrorMessage(e) || t('werk.errStart'));
    } finally {
      setBusy(false);
    }
  };

  const spectate = () => { if (round && round.status !== 'none') startPlaying(round, true); };

  const leaveGame = async () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    const wasPlayer = !!gameRef.current?.human;
    gameRef.current = null;
    setSpectating(false);
    if (wasPlayer) {
      try { await werkApi.leave(); walletApi.getWallet().then(setWallet).catch(() => {}); } catch { /* ignore */ }
    }
    setScreen('lobby');
    werkApi.getCurrent().then((r) => { if (r.status !== 'none') setRound(r); else setRound(null); }).catch(() => {});
  };

  const backToLobby = () => {
    gameRef.current = null;
    setResult(null);
    setScreen('lobby');
    werkApi.getCurrent().then((r) => { if (r.status !== 'none') setRound(r); else setRound(null); }).catch(() => {});
  };

  const leaveLobby = async () => {
    try { await werkApi.leave(); walletApi.getWallet().then(setWallet).catch(() => {}); } catch { /* ignore */ }
    werkApi.getCurrent().then((r) => { if (r.status !== 'none') setRound(r); else setRound(null); }).catch(() => {});
  };

  // ── LOBBY ─────────────────────────────────────────────────────────────────
  if (screen === 'lobby') {
    const mults = config?.payoutMultsX100 ?? [];
    const status = round?.status ?? 'none';
    const inProgress = status === 'running' || status === 'settling';
    const iAmInLobby = status === 'lobby' && !!round?.yourParticipantId;
    return (
      <div style={{ minHeight: '70vh', background: `radial-gradient(1200px 600px at 50% -10%, rgba(124,92,255,0.14), transparent), radial-gradient(900px 500px at 50% 120%, rgba(0,212,255,0.10), transparent), ${C.bg}`, borderRadius: 20, padding: '14px 14px 28px', maxWidth: 680, margin: '0 auto', color: C.text }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
          <button onClick={onBack} style={ghostBtn}><ArrowLeft size={16} /> {t('nav.games')}</button>
          {isAdmin && <button onClick={() => setShowAdmin(true)} style={{ ...ghostBtn, marginLeft: 'auto' }}><Settings size={16} /></button>}
        </div>

        <MazeBackdrop />

        <div style={{ textAlign: 'center', margin: '6px 0 22px', position: 'relative' }}>
          <div style={{ fontSize: 42, fontWeight: 900, letterSpacing: '0.02em', color: C.coin, textShadow: `0 0 30px rgba(255,213,74,0.45)`, lineHeight: 1.1 }}>ወርቅ ፍለጋ</div>
          <div style={{ fontSize: 13, color: C.dim, letterSpacing: '0.32em', textTransform: 'uppercase', marginTop: 6 }}>Gold Rush</div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 0, marginTop: 14, borderRadius: 6, overflow: 'hidden', width: 140, marginInline: 'auto', height: 5 }}>
            <div style={{ flex: 1, background: '#078930' }} /><div style={{ flex: 1, background: '#FCDD09' }} /><div style={{ flex: 1, background: '#DA121A' }} />
          </div>
        </div>

        {config && !config.enabled && (
          <div style={{ ...glass, padding: 14, marginBottom: 16, fontSize: 13, borderColor: 'rgba(255,92,92,0.35)', color: C.danger }}>{t('werk.unavailable')}</div>
        )}

        {/* A round is live — spectate now, join the next one. */}
        {inProgress && !iAmInLobby && (
          <div style={{ ...glass, padding: 18, marginBottom: 14, textAlign: 'center' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '4px 12px', borderRadius: 999, background: 'rgba(52,211,153,0.14)', border: '1px solid rgba(52,211,153,0.35)', color: C.success, fontSize: 12.5, fontWeight: 700, marginBottom: 12 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: C.success }} /> {t('werk.roundInProgress')}
            </div>
            <div style={{ fontSize: 13.5, color: C.dim, marginBottom: 14 }}>
              <Users size={14} style={{ verticalAlign: -2, marginRight: 4 }} />{round?.playerCount ?? 0} · {Math.ceil(round?.timeLeft ?? 0)}s {t('werk.left')}
            </div>
            <button onClick={spectate} style={{ ...primaryBtn, width: '100%', justifyContent: 'center' }}><Eye size={16} /> {t('werk.spectate')}</button>
            <div style={{ fontSize: 11.5, color: C.dim, marginTop: 10 }}>{t('werk.joinNextHint')}</div>
          </div>
        )}

        {/* Waiting in the lobby after joining. */}
        {iAmInLobby && (
          <div style={{ ...glass, padding: 18, marginBottom: 14, textAlign: 'center' }}>
            <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 6 }}>{t('werk.youreIn')}</div>
            <div style={{ fontSize: 34, fontWeight: 900, color: C.accent, fontFamily: 'ui-monospace, monospace' }}>{round?.countdown != null ? round.countdown : '…'}</div>
            <div style={{ fontSize: 12, color: C.dim, marginBottom: 12 }}>{t('werk.startingSoon')}</div>
            <PlayerChips round={round} youId={user?.id} t={t} />
            <button onClick={leaveLobby} style={{ ...ghostBtn, width: '100%', justifyContent: 'center', marginTop: 12 }}>{t('werk.leave')}</button>
          </div>
        )}

        {/* Open lobby — join panel. */}
        {!inProgress && !iAmInLobby && (
          <div style={{ ...glass, padding: 18, marginBottom: 14 }}>
            <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
              <Stat label={t('werk.mode')} value={config?.winningMode === 'B' ? t('werk.modeB') : t('werk.modeA')} />
              <Stat label={t('werk.players')} value={`${round?.playerCount ?? 0}/${config?.totalPlayers ?? '–'}`} />
              <Stat label={t('werk.duration')} value={`${config?.gameDurationSec ?? '–'}s`} />
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
              {mults.map((m, i) => m > 0 && (
                <span key={i} style={{ fontSize: 11.5, padding: '4px 10px', borderRadius: 999, background: 'rgba(0,212,255,0.08)', border: '1px solid rgba(0,212,255,0.25)', color: C.accent }}>
                  #{i + 1} · {Math.floor((stake * m) / 100)}
                </span>
              ))}
            </div>
            {(round?.playerCount ?? 0) > 0 && <div style={{ marginBottom: 12 }}><PlayerChips round={round} youId={user?.id} t={t} /></div>}
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
              <div style={{ flex: '0 0 auto' }}>
                <div style={{ fontSize: 10.5, color: C.dim, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 3 }}>{t('werk.stake')}</div>
                <input type="number" value={stake} min={config?.minStakeMinor ?? 1} max={config?.maxStakeMinor ?? 1000}
                  onChange={(e) => setStake(parseInt(e.target.value, 10) || 0)}
                  style={{ width: 92, padding: '10px 12px', borderRadius: 12, border: `1px solid ${C.border}`, background: C.surface2, color: C.text, fontFamily: 'ui-monospace, monospace', fontSize: 15 }} />
              </div>
              <button disabled={busy || !config?.enabled} onClick={joinGame} style={{ ...primaryBtn, flex: 1, opacity: busy || !config?.enabled ? 0.6 : 1 }}>
                <Play size={17} /> {busy ? '…' : t('werk.joinRound')}
              </button>
            </div>
          </div>
        )}

        <button onClick={() => setShowHowTo(true)} style={{ ...ghostBtn, width: '100%', justifyContent: 'center', padding: '11px' }}>{t('werk.howToPlay')}</button>

        {showHowTo && <HowToModal onClose={() => setShowHowTo(false)} />}
        {showAdmin && <WerkAdmin onClose={() => { setShowAdmin(false); werkApi.getConfig().then(setConfig).catch(() => {}); }} />}
      </div>
    );
  }

  if (screen === 'result' && result) return <ResultScreen result={result} onNewGame={backToLobby} onMenu={onBack} />;

  // ── PLAYING / SPECTATING ─────────────────────────────────────────────────────
  const g = gameRef.current;
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 2000, background: C.bg, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {g && <TopHud game={g} name={user?.displayName ?? t('werk.you')} muted={muted} spectating={spectating} onLeave={leaveGame} onMute={toggleMute} />}

      <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} />
        {g && <SprintOverlay game={g} />}
        {spectating && (
          <div style={{ position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', padding: '5px 14px', borderRadius: 999, background: 'rgba(0,212,255,0.16)', border: '1px solid rgba(0,212,255,0.4)', color: C.accent, fontSize: 12.5, fontWeight: 700, pointerEvents: 'none' }}>
            <Eye size={13} style={{ verticalAlign: -2, marginRight: 5 }} />{t('werk.spectating')}
          </div>
        )}
      </div>

      {g && !spectating && <ControlDeck game={g} inputRef={inputRef} />}
      {g && spectating && (
        <div style={{ ...glass, borderRadius: 0, borderInline: 'none', borderBottomWidth: 0, padding: '12px', paddingBottom: 'calc(12px + env(safe-area-inset-bottom))', display: 'flex', gap: 10, alignItems: 'center', flexShrink: 0 }}>
          <Minimap game={g} size={54} />
          <div style={{ flex: 1, fontSize: 12.5, color: C.dim }}>{t('werk.joinNextHint')}</div>
          <button onClick={leaveGame} style={{ ...primaryBtn, justifyContent: 'center' }}>{t('werk.backToLobby')}</button>
        </div>
      )}
    </div>
  );
}

/** Small horizontal list of joined players' names. */
function PlayerChips({ round, youId, t }: { round: WerkRoundView | null; youId?: string; t: (k: string) => string }) {
  const players = round?.players ?? [];
  if (!players.length) return <div style={{ fontSize: 12, color: C.dim }}>{t('werk.noPlayersYet')}</div>;
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
      {players.map((p) => (
        <span key={p.participantId} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '3px 10px', borderRadius: 999, background: p.userId === youId ? 'rgba(0,212,255,0.14)' : 'rgba(30,36,45,0.7)', border: `1px solid ${p.userId === youId ? 'rgba(0,212,255,0.4)' : C.border}`, fontSize: 12 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: p.color }} />
          {p.userId === youId ? t('werk.you') : p.name}
        </span>
      ))}
    </div>
  );
}

// ── Top HUD bar (a real bar — never drawn over the maze) ─────────────────────
function TopHud({ game, name, muted, spectating, onLeave, onMute }: {
  game: WerkGame; name: string; muted: boolean; spectating: boolean; onLeave: () => void; onMute: () => void;
}) {
  const { t } = useTranslation();
  const h = game.human;
  const mine = h ? game.standings().find((s) => s.player.isHuman) : undefined;
  const secs = Math.ceil(game.timeLeft);
  const isSprint = game.isFinalSprint;
  const initial = (name || '?').trim().charAt(0).toUpperCase() || '?';
  return (
    <div style={{ ...glass, borderRadius: 0, borderTopWidth: 0, borderInline: 'none', padding: '8px 10px calc(8px)', paddingTop: 'calc(8px + env(safe-area-inset-top))', display: 'flex', flexDirection: 'column', gap: 7, zIndex: 10, flexShrink: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button onClick={onLeave} style={iconBtn} aria-label="Leave"><ArrowLeft size={16} /></button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
          <div style={{ width: 32, height: 32, borderRadius: 9, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 15, color: '#06121a', background: `linear-gradient(135deg, ${C.accent}, ${C.accent2})` }}>{spectating ? <Eye size={16} /> : initial}</div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{spectating ? t('werk.spectating') : name}</div>
            <div style={{ fontSize: 10, color: C.dim, letterSpacing: '0.05em' }}>{mine ? <>#{mine.rank}<span style={{ opacity: 0.6 }}> / {game.players.length}</span></> : <>{game.players.length} {t('werk.players')}</>}</div>
          </div>
        </div>
        <div style={{ padding: '4px 14px', borderRadius: 12, background: isSprint ? 'rgba(255,92,92,0.85)' : 'rgba(30,36,45,0.7)', border: `1px solid ${isSprint ? C.danger : C.border}` }}>
          <span style={{ fontSize: 20, fontWeight: 900, fontFamily: 'ui-monospace, monospace', color: '#fff', letterSpacing: '0.02em' }}>{Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')}</span>
        </div>
        <button onClick={onMute} style={iconBtn} aria-label="Mute">{muted ? <VolumeX size={16} /> : <Volume2 size={16} />}</button>
      </div>
      {h && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '3px 10px', borderRadius: 999, background: 'rgba(255,213,74,0.12)', border: '1px solid rgba(255,213,74,0.3)', color: C.coin, fontWeight: 800, fontSize: 13 }}>🪙 {h.coinValue}</span>
          <span style={{ display: 'flex', gap: 8, fontSize: 11, color: C.dim }}>
            <span style={{ color: COIN_COLOR.bronze }}>●{h.bronze}</span>
            <span style={{ color: COIN_COLOR.silver }}>●{h.silver}</span>
            <span style={{ color: COIN_COLOR.gold }}>●{h.gold}</span>
          </span>
          <div style={{ flex: 1, height: 6, background: 'rgba(255,255,255,0.1)', borderRadius: 3, overflow: 'hidden', minWidth: 36 }} title="Energy">
            <div style={{ width: `${h.stamina}%`, height: '100%', background: h.stamina > 30 ? C.success : C.danger, transition: 'width 0.1s' }} />
          </div>
          <span style={{ fontSize: 10, color: C.dim, textTransform: 'uppercase', letterSpacing: '0.08em', flexShrink: 0 }}>
            {game.opts.mode === 'B' ? t('werk.modeB') : t('werk.modeA')}
          </span>
        </div>
      )}
    </div>
  );
}

/** Big transient countdown during the Mode-B final sprint; click-through over the maze. */
function SprintOverlay({ game }: { game: WerkGame }) {
  const { t } = useTranslation();
  if (!game.isFinalSprint) return null;
  const secs = Math.ceil(game.timeLeft);
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
      <div style={{ fontSize: 120, fontWeight: 900, color: 'rgba(255,92,92,0.9)', textShadow: `0 0 50px ${C.danger}` }}>{secs > 0 ? secs : t('werk.timeUp')}</div>
      <div style={{ position: 'absolute', top: '12%', fontSize: 14, fontWeight: 800, color: '#fff', background: 'rgba(255,92,92,0.75)', padding: '6px 14px', borderRadius: 10 }}>{t('werk.reachCenter')} ★</div>
    </div>
  );
}

// ── Bottom control deck: live board + D-pad + actions ────────────────────────
function ControlDeck({ game, inputRef }: { game: WerkGame; inputRef: React.MutableRefObject<HumanInput> }) {
  const { t } = useTranslation();
  const h = game.human!;
  const top = game.standings().slice(0, 4);
  const powerReady = !!(h._pendingSpeed || h._pendingMagnet || h._pendingShield);
  return (
    <div style={{ ...glass, borderRadius: 0, borderBottomWidth: 0, borderInline: 'none', padding: '10px 12px', paddingBottom: 'calc(12px + env(safe-area-inset-bottom))', display: 'flex', flexDirection: 'column', gap: 12, zIndex: 10, flexShrink: 0 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <Minimap game={game} size={58} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 8.5, textTransform: 'uppercase', letterSpacing: '0.14em', color: C.dim, marginBottom: 3 }}>{t('werk.leaderboard')}</div>
          <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
            {top.map((s, i) => (
              <span key={s.player.id} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 999, flexShrink: 0, background: s.player.isHuman ? 'rgba(0,212,255,0.14)' : 'rgba(30,36,45,0.7)', border: `1px solid ${s.player.isHuman ? 'rgba(0,212,255,0.4)' : C.border}` }}>
                <span style={{ fontSize: 9, color: C.dim }}>{i + 1}</span>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: s.player.color, flexShrink: 0 }} />
                <span style={{ fontSize: 11, fontWeight: s.player.isHuman ? 800 : 600, color: s.player.isHuman ? C.accent : C.text, maxWidth: 64, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.player.isHuman && s.player.id >= 1_000_000 && s.player.name === (game.human?.name) ? t('werk.you') : s.player.name}</span>
                <span style={{ fontSize: 11, fontFamily: 'ui-monospace, monospace', color: C.coin }}>{s.player.coinValue}</span>
              </span>
            ))}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
          <button
            onPointerDown={(e) => { e.preventDefault(); inputRef.current.usePower = true; }}
            aria-label="Use power-up"
            style={{ width: 62, height: 62, borderRadius: '50%', background: 'rgba(255,213,74,0.16)', border: `2px solid ${powerReady ? C.coin : 'rgba(255,213,74,0.4)'}`, color: C.coin, fontSize: 24, touchAction: 'none', boxShadow: powerReady ? '0 0 20px rgba(255,213,74,0.5)' : 'none' }}>★</button>
          <button
            onPointerDown={(e) => { e.preventDefault(); inputRef.current.sprint = true; }}
            onPointerUp={() => { inputRef.current.sprint = false; }}
            onPointerLeave={() => { inputRef.current.sprint = false; }}
            onPointerCancel={() => { inputRef.current.sprint = false; }}
            aria-label="Sprint"
            style={{ width: 62, height: 62, borderRadius: '50%', background: 'rgba(0,212,255,0.16)', border: '2px solid rgba(0,212,255,0.55)', color: C.accent, touchAction: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Zap size={24} /></button>
        </div>
        <Joystick inputRef={inputRef} />
      </div>
    </div>
  );
}

// ── Virtual analog thumbstick ────────────────────────────────────────────────
const JOY_SIZE = 150;
const JOY_KNOB = 62;
const JOY_TRAVEL = (JOY_SIZE - JOY_KNOB) / 2;
const JOY_DEADZONE = 0.14;

function Joystick({ inputRef }: { inputRef: React.MutableRefObject<HumanInput> }) {
  const baseRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const activeId = useRef<number | null>(null);

  const reset = () => {
    activeId.current = null;
    if (knobRef.current) knobRef.current.style.transform = 'translate(-50%, -50%)';
    inputRef.current.moveX = 0;
    inputRef.current.moveY = 0;
  };
  const track = (clientX: number, clientY: number) => {
    const base = baseRef.current; if (!base) return;
    const rect = base.getBoundingClientRect();
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    const dx = clientX - cx, dy = clientY - cy;
    const dist = Math.hypot(dx, dy);
    const nx = dist > 0 ? dx / dist : 0, ny = dist > 0 ? dy / dist : 0;
    const clamped = Math.min(dist, JOY_TRAVEL);
    if (knobRef.current) {
      knobRef.current.style.transform = `translate(calc(-50% + ${nx * clamped}px), calc(-50% + ${ny * clamped}px))`;
    }
    const raw = clamped / JOY_TRAVEL;
    const mag = raw <= JOY_DEADZONE ? 0 : (raw - JOY_DEADZONE) / (1 - JOY_DEADZONE);
    inputRef.current.moveX = nx * mag;
    inputRef.current.moveY = ny * mag;
  };
  const onDown = (e: React.PointerEvent) => {
    e.preventDefault();
    activeId.current = e.pointerId;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    track(e.clientX, e.clientY);
  };
  const onMove = (e: React.PointerEvent) => {
    if (activeId.current !== e.pointerId) return;
    track(e.clientX, e.clientY);
  };
  const onUp = (e: React.PointerEvent) => {
    if (activeId.current !== e.pointerId) return;
    reset();
  };
  return (
    <div
      ref={baseRef}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      aria-label="Move"
      style={{
        position: 'relative', width: JOY_SIZE, height: JOY_SIZE, borderRadius: '50%', flexShrink: 0,
        touchAction: 'none', userSelect: 'none', WebkitTapHighlightColor: 'transparent', cursor: 'pointer',
        background: 'radial-gradient(circle at 50% 38%, rgba(40,48,60,0.92), rgba(18,22,28,0.92))',
        border: `2px solid ${C.border}`, boxShadow: 'inset 0 2px 12px rgba(0,0,0,0.55)',
      }}
    >
      <div style={{ position: 'absolute', inset: 12, borderRadius: '50%', border: '1px dashed rgba(255,255,255,0.08)' }} />
      <div
        ref={knobRef}
        style={{
          position: 'absolute', top: '50%', left: '50%', width: JOY_KNOB, height: JOY_KNOB, borderRadius: '50%',
          transform: 'translate(-50%, -50%)', pointerEvents: 'none',
          background: 'radial-gradient(circle at 40% 34%, rgba(0,212,255,0.95), rgba(0,140,190,0.9))',
          border: '2px solid rgba(0,212,255,0.7)', boxShadow: '0 4px 16px rgba(0,0,0,0.55), 0 0 14px rgba(0,212,255,0.35)',
        }}
      />
    </div>
  );
}

function Minimap({ game, size = 118 }: { game: WerkGame; size?: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const ctx = cv.getContext('2d'); if (!ctx) return;
    const S = 128; const scale = S / game.worldPx;
    ctx.clearRect(0, 0, S, S);
    const [cx, cy] = game.center;
    ctx.fillStyle = 'rgba(255,213,74,0.85)';
    ctx.fillRect(cx * CELL * scale, cy * CELL * scale, CELL * scale, CELL * scale);
    ctx.fillStyle = 'rgba(255,213,74,0.3)';
    for (const c of game.coins) if (!c.collected) ctx.fillRect(c.x * scale - 0.5, c.y * scale - 0.5, 1.3, 1.3);
    for (const p of game.players) {
      ctx.fillStyle = p.isHuman ? C.accent : p.color;
      ctx.beginPath(); ctx.arc(p.x * scale, p.y * scale, p.isHuman ? 3 : 2, 0, Math.PI * 2); ctx.fill();
    }
  });
  return <canvas ref={ref} width={128} height={128} style={{ width: size, height: size, borderRadius: 12, ...glass, flexShrink: 0 }} />;
}

// ── Result screen ──────────────────────────────────────────────────────────
function ResultScreen({ result, onNewGame, onMenu }: {
  result: { standings: WerkStanding[]; prizeMinor: number; rank: number; eliminated: boolean }; onNewGame: () => void; onMenu: () => void;
}) {
  const { t } = useTranslation();
  const [shownPrize, setShownPrize] = useState(0);
  useEffect(() => {
    if (result.prizeMinor <= 0) return;
    let raf = 0; const start = performance.now(); const dur = 900;
    const tick = (now: number) => { const p = Math.min(1, (now - start) / dur); setShownPrize(Math.round(result.prizeMinor * (1 - Math.pow(1 - p, 3)))); if (p < 1) raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [result.prizeMinor]);
  const podium = result.standings.filter((s) => s.eligible).slice(0, 3);

  return (
    <div style={{ minHeight: '80vh', background: `radial-gradient(1000px 500px at 50% -10%, rgba(124,92,255,0.16), transparent), ${C.bg}`, borderRadius: 20, padding: '26px 18px 34px', maxWidth: 580, margin: '0 auto', color: C.text }}>
      <div style={{ textAlign: 'center', marginBottom: 20 }}>
        <div style={{ fontSize: 54 }}>{result.eliminated ? '💀' : result.prizeMinor > 0 ? '🏆' : '🎮'}</div>
        <h2 style={{ margin: '6px 0 2px', fontSize: 24, fontWeight: 900 }}>{result.eliminated ? t('werk.eliminated') : result.prizeMinor > 0 ? t('werk.youWon') : t('werk.gameOver')}</h2>
        <div style={{ color: C.dim, fontSize: 14 }}>{t('werk.finishedRank', { rank: result.rank })}</div>
        {result.prizeMinor > 0 && <div style={{ marginTop: 12, fontSize: 34, fontWeight: 900, color: C.coin, textShadow: '0 0 26px rgba(255,213,74,0.5)' }}>+{shownPrize}</div>}
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'flex-end', gap: 10, marginBottom: 20 }}>
        {[1, 0, 2].map((idx) => {
          const s = podium[idx]; if (!s) return <div key={idx} style={{ width: 86 }} />;
          const heights = [102, 76, 58];
          const grad = idx === 1 ? 'linear-gradient(#FFD54A,#c79b16)' : idx === 0 ? 'linear-gradient(#cfd6df,#8a8f99)' : 'linear-gradient(#cd7f32,#8a5320)';
          return (
            <div key={idx} style={{ textAlign: 'center', width: 86 }}>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: s.isHuman ? C.accent : C.text }}>{s.isHuman ? s.name : s.name}</div>
              <div style={{ height: heights[idx], borderRadius: '10px 10px 0 0', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 7, background: grad, fontWeight: 900, fontSize: 20, color: '#151a1f' }}>{idx === 1 ? 1 : idx === 0 ? 2 : 3}</div>
              <div style={{ fontSize: 12, fontFamily: 'ui-monospace, monospace', marginTop: 3, color: C.coin }}>{s.coinValue}</div>
            </div>
          );
        })}
      </div>

      <div style={{ ...glass, padding: 10, marginBottom: 18, maxHeight: 250, overflowY: 'auto' }}>
        {result.standings.map((s) => (
          <div key={`${s.isHuman ? 'h' : 'b'}-${s.id}`} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px', fontSize: 13, fontWeight: s.isHuman ? 800 : 500, color: s.isHuman ? C.accent : C.text, opacity: s.eligible ? 1 : 0.45 }}>
            <span style={{ width: 22, textAlign: 'right', color: C.dim }}>{s.eligible ? `#${s.rank}` : '✗'}</span>
            <span style={{ width: 9, height: 9, borderRadius: '50%', background: s.color }} />
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
            {(s.prizeMinor ?? 0) > 0 && <span style={{ fontSize: 11, color: C.success }}>+{s.prizeMinor}</span>}
            <span style={{ fontFamily: 'ui-monospace, monospace', color: C.coin }}>{s.coinValue}</span>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 10 }}>
        <button onClick={onNewGame} style={{ ...primaryBtn, flex: 1, justifyContent: 'center' }}>{t('werk.newGame')}</button>
        <button onClick={onMenu} style={{ ...ghostBtn, flex: 1, justifyContent: 'center' }}>{t('werk.mainMenu')}</button>
      </div>
    </div>
  );
}

// ── Small presentational pieces ─────────────────────────────────────────────
function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ flex: 1, textAlign: 'center', padding: '8px 4px', borderRadius: 12, background: 'rgba(30,36,45,0.6)', border: `1px solid ${C.border}` }}>
      <div style={{ fontSize: 9.5, color: C.dim, textTransform: 'uppercase', letterSpacing: '0.1em' }}>{label}</div>
      <div style={{ fontSize: 17, fontWeight: 800, marginTop: 2 }}>{value}</div>
      {sub && <div style={{ fontSize: 10.5, color: C.dim }}>{sub}</div>}
    </div>
  );
}

function MazeBackdrop() {
  return (
    <div aria-hidden style={{ position: 'absolute', inset: 0, opacity: 0.06, backgroundImage: 'linear-gradient(rgba(0,212,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(0,212,255,0.6) 1px, transparent 1px)', backgroundSize: '28px 28px', maskImage: 'radial-gradient(circle at 50% 30%, black, transparent 70%)', WebkitMaskImage: 'radial-gradient(circle at 50% 30%, black, transparent 70%)', pointerEvents: 'none', borderRadius: 20 }} />
  );
}

function HowToModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const rows = [['🕹️', t('werk.htMove')], ['⚡', t('werk.htSprint')], ['★', t('werk.htPower')], ['🪙', t('werk.htCollect')], ['🏁', t('werk.htWin')]];
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(11,15,20,0.7)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...glass, padding: 22, maxWidth: 390, width: '100%', color: C.text }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>{t('werk.howToPlay')}</h3>
          <button onClick={onClose} style={{ ...iconBtn, marginLeft: 'auto' }}><X size={16} /></button>
        </div>
        {rows.map(([icon, text], i) => (
          <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', marginBottom: 12, fontSize: 13.5, color: C.dim }}>
            <span style={{ fontSize: 20 }}>{icon}</span><span>{text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const primaryBtn: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 7, padding: '12px 18px', borderRadius: 14, border: 'none', background: `linear-gradient(135deg, ${C.accent}, ${C.accent2})`, color: '#06121a', fontWeight: 800, fontSize: 15, cursor: 'pointer', boxShadow: '0 6px 20px rgba(0,212,255,0.25)' };
const ghostBtn: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderRadius: 12, background: 'rgba(30,36,45,0.7)', border: `1px solid ${C.border}`, color: C.text, fontWeight: 600, fontSize: 13.5, cursor: 'pointer' };
const iconBtn: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36, borderRadius: 12, ...glass, color: C.text, cursor: 'pointer' };

// ── Maze themes (admin-selectable "sector" look) ─────────────────────────────
type ThemeKey = 'adwa' | 'highland' | 'desert';
const THEMES: Record<ThemeKey, { floor: string; tile: string; tileEdge: string; wall: string; wallGlow: string; hub: string }> = {
  adwa: { floor: '#0e131a', tile: 'rgba(124,92,255,0.05)', tileEdge: 'rgba(0,212,255,0.10)', wall: '#C79B36', wallGlow: 'rgba(212,160,23,0.4)', hub: '#FCDD09' },
  highland: { floor: '#0b1613', tile: 'rgba(52,211,153,0.05)', tileEdge: 'rgba(52,211,153,0.14)', wall: '#2FBF8F', wallGlow: 'rgba(47,191,143,0.4)', hub: '#34D399' },
  desert: { floor: '#191308', tile: 'rgba(251,191,36,0.06)', tileEdge: 'rgba(251,191,36,0.15)', wall: '#E0A23A', wallGlow: 'rgba(224,162,58,0.4)', hub: '#FBBF24' },
};

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ── Canvas world renderer (premium dark maze) ────────────────────────────────
function drawWorld(canvas: HTMLCanvasElement | null, game: WerkGame, time: number) {
  if (!canvas) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const vw = canvas.clientWidth, vh = canvas.clientHeight;
  if (canvas.width !== vw * dpr || canvas.height !== vh * dpr) { canvas.width = vw * dpr; canvas.height = vh * dpr; }
  const ctx = canvas.getContext('2d'); if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, vw, vh);
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, vw, vh);

  // Camera follows the local avatar, or the maze center when spectating.
  const focus = game.human ?? { x: game.center[0] * CELL + CELL / 2, y: game.center[1] * CELL + CELL / 2 };
  let camX = focus.x - vw / 2, camY = focus.y - vh / 2;
  camX = Math.max(0, Math.min(camX, game.worldPx - vw));
  camY = Math.max(0, Math.min(camY, game.worldPx - vh));
  if (game.worldPx < vw) camX = (game.worldPx - vw) / 2;
  if (game.worldPx < vh) camY = (game.worldPx - vh) / 2;

  ctx.save();
  ctx.translate(-camX, -camY);

  const th = THEMES[(game.opts.theme as ThemeKey)] ?? THEMES.adwa;

  ctx.fillStyle = th.floor;
  ctx.fillRect(0, 0, game.worldPx, game.worldPx);

  {
    const tsc = Math.max(0, Math.floor(camX / CELL) - 1), tec = Math.min(game.size - 1, Math.ceil((camX + vw) / CELL) + 1);
    const tsr = Math.max(0, Math.floor(camY / CELL) - 1), ter = Math.min(game.size - 1, Math.ceil((camY + vh) / CELL) + 1);
    ctx.fillStyle = th.tile; ctx.strokeStyle = th.tileEdge; ctx.lineWidth = 1;
    for (let gy = tsr; gy <= ter; gy++) for (let gx = tsc; gx <= tec; gx++) {
      roundRectPath(ctx, gx * CELL + 3, gy * CELL + 3, CELL - 6, CELL - 6, 6);
      ctx.fill(); ctx.stroke();
    }
  }

  const [ccx, ccy] = game.center;
  const hubX = ccx * CELL + CELL / 2, hubY = ccy * CELL + CELL / 2;
  const pulse = 0.5 + 0.5 * Math.sin(time * 4);
  const isSprint = game.isFinalSprint;
  const grad = ctx.createRadialGradient(hubX, hubY, 2, hubX, hubY, CELL * (0.9 + pulse * 0.4));
  grad.addColorStop(0, isSprint ? `rgba(255,92,92,${0.6 + pulse * 0.4})` : `rgba(255,213,74,${0.5 + pulse * 0.35})`);
  grad.addColorStop(1, 'rgba(255,213,74,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(hubX - CELL * 1.4, hubY - CELL * 1.4, CELL * 2.8, CELL * 2.8);
  ctx.fillStyle = isSprint ? C.danger : th.hub;
  ctx.font = `${CELL * 0.9}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('★', hubX, hubY + 2);

  const sc = Math.max(0, Math.floor(camX / CELL) - 1), ec = Math.min(game.size - 1, Math.ceil((camX + vw) / CELL) + 1);
  const sr = Math.max(0, Math.floor(camY / CELL) - 1), er = Math.min(game.size - 1, Math.ceil((camY + vh) / CELL) + 1);
  ctx.strokeStyle = th.wall; ctx.lineWidth = 3.5; ctx.lineCap = 'round';
  ctx.shadowColor = th.wallGlow; ctx.shadowBlur = 6;
  ctx.beginPath();
  for (let gy = sr; gy <= er; gy++) for (let gx = sc; gx <= ec; gx++) {
    const cell = game.grid[gy][gx];
    const x0 = gx * CELL, y0 = gy * CELL, x1 = x0 + CELL, y1 = y0 + CELL;
    if (cell.top) { ctx.moveTo(x0, y0); ctx.lineTo(x1, y0); }
    if (cell.left) { ctx.moveTo(x0, y0); ctx.lineTo(x0, y1); }
    if (gx === game.size - 1 && cell.right) { ctx.moveTo(x1, y0); ctx.lineTo(x1, y1); }
    if (gy === game.size - 1 && cell.bottom) { ctx.moveTo(x0, y1); ctx.lineTo(x1, y1); }
  }
  ctx.stroke(); ctx.shadowBlur = 0;

  for (const c of game.coins) {
    if (c.collected) continue;
    if (c.x < camX - CELL || c.x > camX + vw + CELL || c.y < camY - CELL || c.y > camY + vh + CELL) continue;
    const bob = Math.sin(time * 3 + c.cx + c.cy) * 3;
    const r = c.type === 'gold' ? 8 : c.type === 'silver' ? 7 : 6;
    ctx.fillStyle = COIN_COLOR[c.type]; ctx.shadowColor = COIN_COLOR[c.type]; ctx.shadowBlur = c.type === 'gold' ? 14 : 6;
    ctx.beginPath(); ctx.arc(c.x, c.y + bob, r, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
  }

  if (game.opts.powerupsEnabled) {
    ctx.font = `${CELL * 0.55}px serif`;
    for (const pu of game.powerups) {
      if (pu.taken) continue;
      if (pu.x < camX - CELL || pu.x > camX + vw + CELL || pu.y < camY - CELL || pu.y > camY + vh + CELL) continue;
      ctx.fillText(pu.kind === 'speed' ? '⚡' : pu.kind === 'magnet' ? '🧲' : '🛡', pu.x, pu.y);
    }
  }

  for (const p of game.players) {
    if (p.x < camX - CELL || p.x > camX + vw + CELL || p.y < camY - CELL || p.y > camY + vh + CELL) continue;
    drawPlayer(ctx, p, p.isHuman && !!game.human && p.id === game.human.id);
  }
  ctx.restore();
}

function drawPlayer(ctx: CanvasRenderingContext2D, p: Player, isSelf: boolean) {
  const r = CELL * 0.3;
  ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.fillStyle = p.color; ctx.fill();
  ctx.lineWidth = isSelf ? 3 : 1.5;
  ctx.strokeStyle = isSelf ? C.accent : 'rgba(0,0,0,0.4)';
  if (isSelf) { ctx.shadowColor = C.accent; ctx.shadowBlur = 10; }
  ctx.stroke(); ctx.shadowBlur = 0;
  if (p.magnet > 0) { ctx.beginPath(); ctx.arc(p.x, p.y, r + 5, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(124,92,255,0.6)'; ctx.lineWidth = 2; ctx.stroke(); }
  const label = isSelf ? '★' : p.name;
  ctx.font = `${isSelf ? 12 : 10}px sans-serif`; ctx.textAlign = 'center';
  const w = ctx.measureText(label).width + 8;
  ctx.fillStyle = 'rgba(11,15,20,0.6)'; ctx.fillRect(p.x - w / 2, p.y - r - 16, w, 13);
  ctx.fillStyle = isSelf ? C.accent : '#fff'; ctx.textBaseline = 'middle';
  ctx.fillText(label, p.x, p.y - r - 9);
}
