import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import confetti from 'canvas-confetti';
import { ArrowLeft, Bot, Swords, Trophy } from 'lucide-react';
import { useStore } from '../store/useStore';
import { getErrorMessage } from '../lib/utils';
import { poolApi } from '../lib/poolApi';
import type { PoolConfig, PoolGroup, PoolMatchView, PoolTournament, Seat } from '../lib/poolApi';
import { usePoolMatchFound, usePoolMatchSocket, type PoolShotResolvedEvent } from '../hooks/usePoolSocket';
import { PoolTable, type PoolTableHandle } from '../components/PoolTable';
import type { Ball, ShotInput } from '@pool-engine';

type EndState = { winnerSeat?: Seat | null; reason?: string; aborted?: boolean } | null;

const BALL_COLORS: Record<number, string> = {
  1: '#e6b422', 2: '#1f4fa0', 3: '#c62828', 4: '#6a3d9a', 5: '#e2711d',
  6: '#1f7a3f', 7: '#7a2418', 8: '#141414',
  9: '#e6b422', 10: '#1f4fa0', 11: '#c62828', 12: '#6a3d9a', 13: '#e2711d', 14: '#1f7a3f', 15: '#7a2418',
};

/** A small potted ball chip (solid = filled; stripe = white with a colour band). */
function BallChip({ n, size = 18 }: { n: number; size?: number }) {
  const color = BALL_COLORS[n] ?? '#ccc';
  const stripe = n >= 9 && n <= 15;
  return (
    <span
      style={{
        position: 'relative', width: size, height: size, borderRadius: '50%',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        background: stripe ? '#f2ecdf' : color, overflow: 'hidden',
        border: '1px solid rgba(0,0,0,0.35)', flexShrink: 0,
      }}
    >
      {stripe && <span style={{ position: 'absolute', left: 0, right: 0, top: '30%', bottom: '30%', background: color }} />}
      <span style={{ position: 'relative', width: '46%', height: '46%', borderRadius: '50%', background: '#fbf7ee', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.42, fontWeight: 700, color: '#1a1712', fontFamily: 'ui-monospace, monospace' }}>{n}</span>
    </span>
  );
}

/** Shows which balls have been pocketed, split into solids / stripes / the 8. */
function PocketedTray({ board, size = 18 }: { board: Ball[]; size?: number }) {
  const potted = board.filter((b) => b.pocketed && b.number !== 0).map((b) => b.number);
  if (potted.length === 0) return null;
  const solids = potted.filter((n) => n >= 1 && n <= 7).sort((a, b) => a - b);
  const stripes = potted.filter((n) => n >= 9 && n <= 15).sort((a, b) => a - b);
  const eight = potted.includes(8);
  const group = (balls: number[]) => (
    <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
      {balls.map((n) => <BallChip key={n} n={n} size={size} />)}
    </div>
  );
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
      {solids.length > 0 && group(solids)}
      {stripes.length > 0 && (
        <>
          {solids.length > 0 && <span style={{ width: 1, height: size, background: 'rgba(255,255,255,0.15)' }} />}
          {group(stripes)}
        </>
      )}
      {eight && <BallChip n={8} size={size} />}
    </div>
  );
}

/** Two-player match header: avatars (glow = whose turn), POT, timer / thinking. */
function MatchHeader({
  onBack, meName, oppName, oppIsBot, myGroup, oppGroup, isMyTurn, ballInHand, opponentThinking, remaining, pot,
}: {
  onBack: () => void;
  meName: string;
  oppName: string;
  oppIsBot: boolean;
  myGroup: PoolGroup | null;
  oppGroup: PoolGroup | null;
  isMyTurn: boolean;
  ballInHand: boolean;
  opponentThinking: boolean;
  remaining: number | null;
  pot: number;
}) {
  const initial = (s: string) => (s.trim()[0] ?? '?').toUpperCase();
  const Avatar = ({ text, active, bot }: { text: string; active: boolean; bot?: boolean }) => (
    <div style={{
      width: 34, height: 34, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: bot ? 17 : 14, fontWeight: 800, color: '#fff', flexShrink: 0,
      background: bot ? '#3a2f52' : '#254a63',
      border: `2px solid ${active ? 'var(--green,#6fce9a)' : 'transparent'}`,
      boxShadow: active ? '0 0 10px rgba(111,206,154,0.55)' : 'none',
      transition: 'border-color 0.2s, box-shadow 0.2s',
    }}>{bot ? '🤖' : text}</div>
  );
  const Group = ({ g }: { g: PoolGroup | null }) => !g ? null : (
    <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: g === 'solids' ? '#e6b422' : '#cfd6df' }}>
      {g === 'solids' ? '● Solids' : '◐ Stripes'}
    </span>
  );
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', borderRadius: 12, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border, rgba(255,255,255,0.08))' }}>
      <button className="btn" onClick={onBack} style={{ padding: '4px 8px', flexShrink: 0 }} aria-label="Back to lobby"><ArrowLeft size={15} /></button>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        <Avatar text={initial(meName)} active={isMyTurn} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 96 }}>{meName}</div>
          <Group g={myGroup} />
        </div>
      </div>
      <div style={{ marginLeft: 'auto', marginRight: 'auto', textAlign: 'center', lineHeight: 1.25 }}>
        {pot > 0 && <div style={{ fontSize: 11, fontWeight: 800, color: '#f6c945' }}>POT {pot}</div>}
        {isMyTurn
          ? (
            <div style={{ fontSize: 11, color: ballInHand ? 'var(--green,#6fce9a)' : 'var(--text-muted)', fontFamily: ballInHand ? 'inherit' : 'ui-monospace, monospace' }}>
              {ballInHand ? '✋ ball in hand' : remaining != null ? `⏱ ${remaining}s` : 'your turn'}
            </div>
          )
          : opponentThinking
            ? <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10.5, color: 'var(--text-muted)' }}><span className="spinner" style={{ width: 11, height: 11 }} />thinking…</div>
            : null}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, justifyContent: 'flex-end' }}>
        <div style={{ minWidth: 0, textAlign: 'right' }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 96 }}>{oppName}</div>
          <Group g={oppGroup} />
        </div>
        <Avatar text={initial(oppName)} active={opponentThinking} bot={oppIsBot} />
      </div>
    </div>
  );
}

export function Pool({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation();
  const user = useStore((s) => s.user);
  const addToast = useStore((s) => s.addToast);
  const isSocketConnected = useStore((s) => s.isSocketConnected);
  const seatLabel = (seat: Seat) => (seat === 'A' ? t('pool.player1') : t('pool.player2'));

  const [config, setConfig] = useState<PoolConfig | null>(null);
  const [match, setMatch] = useState<PoolMatchView | null>(null);
  const [queuedStake, setQueuedStake] = useState<number | null>(null);
  const [stake, setStake] = useState(10);
  const [feed, setFeed] = useState<string[]>([]);
  const [ended, setEnded] = useState<EndState>(null);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const tableRef = useRef<PoolTableHandle>(null);

  // Orientation drives the whole play layout: portrait = tall vertical table in
  // the page; landscape = immersive fullscreen with a wide table.
  const [landscape, setLandscape] = useState(
    () => typeof window !== 'undefined' && window.matchMedia?.('(orientation: landscape)').matches,
  );

  useEffect(() => {
    poolApi.getConfig().then(setConfig).catch(() => {});
  }, []);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    const mq = window.matchMedia('(orientation: landscape)');
    const onChange = () => setLandscape(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const mySeat: Seat | null = useMemo(() => {
    if (!match || !user) return null;
    if (match.seatAUserId === user.id) return 'A';
    if (match.seatBUserId === user.id) return 'B';
    return null;
  }, [match, user]);

  const enterMatch = (view: PoolMatchView) => {
    setMatch(view);
    setQueuedStake(null);
    setEnded(null);
    setFeed([]);
  };

  usePoolMatchFound((view) => {
    addToast('success', t('pool.matchFound'));
    enterMatch(view);
  });

  usePoolMatchSocket(match?.id ?? null, {
    onMatchUpdated: (v) => {
      setMatch(v);
      if (v.status !== 'active') setEnded((e) => e ?? { winnerSeat: v.winnerSeat });
    },
    onShotResolved: (e: PoolShotResolvedEvent) => {
      setFeed((f) => [`${seatLabel(e.seat)}: ${e.reason}`, ...f].slice(0, 6));
      if (mySeat && e.seat !== mySeat) tableRef.current?.enqueueShot(e.input);
    },
    onMatchEnded: (e) => setEnded(e),
  });

  // Resync the authoritative match state whenever we return to the foreground or
  // the socket reconnects. Backgrounding a tab drops socket events, so a turn that
  // advanced while away (e.g. the AI played, or our turn came back) would otherwise
  // leave the board frozen. This guarantees we never get stuck out of sync.
  const matchId = match?.id ?? null;
  useEffect(() => {
    if (!matchId) return;
    const resync = () => {
      poolApi.getMatch(matchId)
        .then((v) => {
          setMatch(v);
          if (v.status !== 'active') setEnded((e) => e ?? { winnerSeat: v.winnerSeat });
        })
        .catch(() => {});
    };
    const onVisible = () => { if (document.visibilityState === 'visible') resync(); };
    window.addEventListener('focus', resync);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', resync);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [matchId]);

  // Re-fetch on socket (re)connect so a reconnect pulls the latest board.
  useEffect(() => {
    if (matchId && isSocketConnected) {
      poolApi.getMatch(matchId).then(setMatch).catch(() => {});
    }
  }, [matchId, isSocketConnected]);

  useEffect(() => {
    if (ended && mySeat && ended.winnerSeat === mySeat) {
      confetti({ particleCount: 120, spread: 75, origin: { y: 0.6 } });
    }
  }, [ended, mySeat]);

  const err = (e: unknown, context: string) => {
    // Log the raw error (status, server payload, or network/timeout) so failures
    // are diagnosable from the browser console, not just a toast.
    console.error(`[pool] ${context}`, e);
    addToast('error', getErrorMessage(e) || context);
  };

  const startSingle = async () => {
    setBusy(true);
    try {
      enterMatch(await poolApi.startSingle());
    } catch (e) {
      err(e, t('pool.errStartSingle'));
    } finally {
      setBusy(false);
    }
  };

  const joinQueue = async () => {
    setBusy(true);
    try {
      const res = await poolApi.joinQueue(stake);
      if (res.matched) enterMatch(res.match);
      else setQueuedStake(res.stakeMinor);
    } catch (e) {
      err(e, t('pool.errJoinQueue'));
    } finally {
      setBusy(false);
    }
  };

  const leaveQueue = async () => {
    try {
      await poolApi.leaveQueue();
    } finally {
      setQueuedStake(null);
    }
  };

  const submitShot = (input: ShotInput) => {
    if (!match) return;
    poolApi.submitShot(match.id, input).catch((e) => {
      err(e, t('pool.errShotRejected'));
      // Resync to the authoritative board if our optimistic shot was refused.
      poolApi.getMatch(match.id).then(setMatch).catch(() => {});
    });
  };

  const backToLobby = () => {
    setMatch(null);
    setEnded(null);
    setFeed([]);
  };

  // ── Match screen ────────────────────────────────────────────────────────────
  if (match) {
    const isMyTurn = match.turn === mySeat && match.status === 'active';
    const canShoot = isMyTurn && !!mySeat;
    const myGroup = mySeat ? match.groups[mySeat] : null;
    // On the 8: my group is assigned and none of its object balls remain — I must
    // call a pocket for the 8 (server enforces wrong-pocket = loss).
    const myGroupLeft = myGroup
      ? match.board.filter((b) => !b.pocketed && b.number !== 0 && b.number !== 8 && (myGroup === 'solids' ? b.number < 8 : b.number > 8)).length
      : 1;
    const onEight = !!myGroup && !match.tableOpen && myGroupLeft === 0;
    // Must call a pocket: always on the 8, and on every shot in strict mode.
    const mustCall = canShoot && (onEight || !!config?.strictCallShot);
    const deadlineMs = match.turnDeadline ? new Date(match.turnDeadline).getTime() : null;
    const remaining = deadlineMs ? Math.max(0, Math.ceil((deadlineMs - now) / 1000)) : null;
    const opponentName = match.mode === 'single' ? t('pool.opponentAI') : t('pool.opponent');
    const opponentThinking = match.status === 'active' && !isMyTurn;
    const oppGroup = mySeat ? match.groups[mySeat === 'A' ? 'B' : 'A'] : null;
    const header = (
      <MatchHeader
        onBack={backToLobby}
        meName={user?.displayName ?? 'You'}
        oppName={opponentName}
        oppIsBot={match.mode === 'single'}
        myGroup={myGroup}
        oppGroup={oppGroup}
        isMyTurn={isMyTurn}
        ballInHand={isMyTurn && match.ballInHand}
        opponentThinking={opponentThinking}
        remaining={remaining}
        pot={match.stakeMinor * 2}
      />
    );

    const resultCard = ended && (
      <div style={{ padding: 18, borderRadius: 14, textAlign: 'center', background: 'rgba(18,22,28,0.97)', border: '1px solid var(--border, rgba(255,255,255,0.12))', maxWidth: 340, boxShadow: '0 24px 60px -20px rgba(0,0,0,0.8)' }}>
        <div style={{ fontSize: 40, marginBottom: 6 }}>
          {ended.aborted ? '↩️' : ended.winnerSeat === mySeat ? '🏆' : '💔'}
        </div>
        <h3 style={{ margin: '0 0 6px', fontSize: 19, fontWeight: 800 }}>
          {ended.aborted ? t('pool.matchAborted') : ended.winnerSeat === mySeat ? t('pool.youWin') : t('pool.youLost')}
        </h3>
        <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--text-muted)' }}>
          {ended.aborted ? t('pool.stakeRefunded') : ended.reason ?? ''}
        </p>
        <button className="btn btn-primary" onClick={backToLobby} style={{ width: '100%' }}>{t('pool.backToLobby')}</button>
      </div>
    );

    // ── Landscape: immersive fullscreen (covers the app chrome) ────────────────
    if (landscape) {
      return (
        <div style={{ position: 'fixed', inset: 0, zIndex: 2000, background: '#0b0f14', display: 'flex', flexDirection: 'column', padding: '8px 12px 10px', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>{header}</div>
            <PocketedTray board={match.board} size={16} />
          </div>
          <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
            <PoolTable ref={tableRef} view={match} mySeat={mySeat} canShoot={canShoot} onSubmit={submitShot} orientation="landscape" mustCall={mustCall} />
          </div>
          {ended && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.55)' }}>
              {resultCard}
            </div>
          )}
        </div>
      );
    }

    // ── Portrait: in-page, tall vertical table ─────────────────────────────────
    return (
      <div style={{ padding: '4px 10px 14px', maxWidth: 640, margin: '0 auto' }}>
        <div style={{ marginBottom: 8 }}>{header}</div>

        {match.board.some((b) => b.pocketed && b.number !== 0) && (
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8 }}>
            <PocketedTray board={match.board} size={18} />
          </div>
        )}

        <PoolTable ref={tableRef} view={match} mySeat={mySeat} canShoot={canShoot} onSubmit={submitShot} orientation="portrait" mustCall={mustCall} />

        {/* Shot feed */}
        {feed.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 10.5, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6 }}>{t('pool.shotLog')}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {feed.map((line, i) => (
                <div key={i} style={{ fontSize: 12.5, color: i === 0 ? 'var(--text)' : 'var(--text-muted)' }}>{line}</div>
              ))}
            </div>
          </div>
        )}

        {/* Result overlay */}
        {ended && (
          <div style={{ marginTop: 16, display: 'flex', justifyContent: 'center' }}>
            {resultCard}
          </div>
        )}
      </div>
    );
  }

  // ── Lobby ───────────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: '12px 14px 28px', maxWidth: 640, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <button className="btn" onClick={onBack} style={{ padding: '6px 10px', display: 'flex', alignItems: 'center', gap: 6 }}>
          <ArrowLeft size={16} /> {t('nav.games')}
        </button>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>🎱 {t('pool.title')}</h2>
      </div>

      {/* Single player */}
      {config?.singlePlayerEnabled !== false && (
        <LobbyCard
          icon={<Bot size={22} />}
          title={t('pool.playVsAI')}
          subtitle={config && config.singlePlayerStakeMinor > 0 ? t('pool.stakeAmount', { amount: config.singlePlayerStakeMinor }) : t('pool.freePractice')}
        >
          <button className="btn btn-primary" disabled={busy} onClick={startSingle} style={{ width: '100%' }}>
            {t('pool.startGame')}
          </button>
        </LobbyCard>
      )}

      {/* Two player */}
      {config?.twoPlayerEnabled !== false && (
        <LobbyCard icon={<Swords size={22} />} title={t('pool.ranked2p')} subtitle={t('pool.rankedSubtitle')}>
          {queuedStake != null ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div className="spinner" style={{ width: 18, height: 18 }} />
              <span style={{ fontSize: 13 }}>{t('pool.searchingStake', { amount: queuedStake })}</span>
              <button className="btn" onClick={leaveQueue} style={{ marginLeft: 'auto', padding: '6px 10px' }}>{t('common.cancel')}</button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <label style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{t('pool.stake')}</label>
              <input
                type="number"
                value={stake}
                min={config?.minStakeMinor ?? 1}
                max={config?.maxStakeMinor ?? 1000}
                onChange={(e) => setStake(parseInt(e.target.value, 10) || 0)}
                style={{ width: 90, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border, rgba(255,255,255,0.15))', background: 'var(--surface,#0c0a08)', color: 'inherit', fontFamily: 'ui-monospace, monospace' }}
              />
              <button className="btn btn-primary" disabled={busy} onClick={joinQueue} style={{ marginLeft: 'auto' }}>{t('pool.findMatch')}</button>
            </div>
          )}
          {config && (
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 8 }}>
              {t('pool.stakesRange', { min: config.minStakeMinor, max: config.maxStakeMinor, rake: config.rakePct })}
            </div>
          )}
        </LobbyCard>
      )}

      {/* Tournament */}
      {config?.tournamentEnabled && (
        <TournamentPanel onPlay={enterMatch} myUserId={user?.id ?? null} onError={err} />
      )}
    </div>
  );
}

function LobbyCard({ icon, title, subtitle, children }: { icon: React.ReactNode; title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--surface, rgba(255,255,255,0.04))', border: '1px solid var(--border, rgba(255,255,255,0.1))', borderRadius: 14, padding: 16, marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <div style={{ color: 'var(--brand, #d9a441)' }}>{icon}</div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{title}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{subtitle}</div>
        </div>
      </div>
      {children}
    </div>
  );
}

function TournamentPanel({ onPlay, myUserId, onError }: { onPlay: (v: PoolMatchView) => void; myUserId: string | null; onError: (e: unknown, msg: string) => void }) {
  const { t } = useTranslation();
  const [id, setId] = useState('');
  const [tournament, setTournament] = useState<PoolTournament | null>(null);
  const [matches, setMatches] = useState<PoolMatchView[]>([]);

  const load = async (tid: string) => {
    try {
      setTournament(await poolApi.getTournament(tid));
      setMatches(await poolApi.getTournamentMatches(tid));
    } catch (e) {
      onError(e, t('pool.errTournamentNotFound'));
    }
  };

  const register = async () => {
    try {
      const tourney = await poolApi.registerTournament(id.trim());
      setTournament(tourney);
      setMatches(await poolApi.getTournamentMatches(tourney.id));
    } catch (e) {
      onError(e, t('pool.errRegister'));
    }
  };

  const myActive = matches.find(
    (m) => m.status === 'active' && (m.seatAUserId === myUserId || m.seatBUserId === myUserId),
  );

  // Localised tournament status (falls back to the raw value if unmapped).
  const statusLabel = (status: string) => t(`pool.tStatus.${status}`, { defaultValue: status });

  return (
    <LobbyCard icon={<Trophy size={22} />} title={t('pool.tournaments')} subtitle={t('pool.tournamentsSubtitle')}>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          placeholder={t('pool.tournamentIdPlaceholder')}
          value={id}
          onChange={(e) => setId(e.target.value)}
          style={{ flex: 1, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border, rgba(255,255,255,0.15))', background: 'var(--surface,#0c0a08)', color: 'inherit', fontSize: 12.5 }}
        />
        <button className="btn" onClick={() => load(id.trim())} disabled={!id.trim()}>{t('pool.view')}</button>
        <button className="btn btn-primary" onClick={register} disabled={!id.trim()}>{t('pool.join')}</button>
      </div>
      {tournament && (
        <div style={{ marginTop: 12, fontSize: 12.5 }}>
          <div style={{ fontWeight: 700 }}>{tournament.name}</div>
          <div style={{ color: 'var(--text-muted)' }}>
            {statusLabel(tournament.status)} · {t('pool.tournamentPlayers', { count: tournament.size })} · {t('pool.tournamentPrize', { amount: tournament.prizePoolMinor })}
          </div>
          {myActive && (
            <button className="btn btn-primary" onClick={() => onPlay(myActive)} style={{ width: '100%', marginTop: 10 }}>
              {t('pool.playYourMatch')}
            </button>
          )}
        </div>
      )}
    </LobbyCard>
  );
}
