import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import confetti from 'canvas-confetti';
import { ArrowLeft, Bot, MessageCircle, Swords, Trophy } from 'lucide-react';
import { useStore } from '../store/useStore';
import { getErrorMessage } from '../lib/utils';
import { poolApi, POOL_EMOTES } from '../lib/poolApi';
import type { PoolConfig, PoolGroup, PoolMatchView, PoolTournament, Seat } from '../lib/poolApi';
import { usePoolMatchFound, usePoolMatchSocket, sendPoolEmote, type PoolShotResolvedEvent, type PoolEmoteEvent } from '../hooks/usePoolSocket';
import { PoolTable, type PoolTableHandle } from '../components/PoolTable';
import type { Ball, ShotInput } from '@pool-engine';

type EndState = { winnerSeat?: Seat | null; reason?: string; aborted?: boolean } | null;

// How long to look for a human opponent before offering the AI fallback.
const SEARCH_WINDOW_S = 30;

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

/**
 * Pocketed balls attributed to their owner: the player's own group sits on the
 * left (under their avatar), the opponent's on the right, and the 8-ball in the
 * middle. While the table is still open (no groups assigned yet) the potted
 * balls have no owner, so they're shown neutrally in the centre.
 */
function PocketedTray({
  board, myGroup, oppGroup, size = 18, stretch = false,
}: {
  board: Ball[];
  myGroup: PoolGroup | null;
  oppGroup: PoolGroup | null;
  size?: number;
  stretch?: boolean;
}) {
  const potted = board.filter((b) => b.pocketed && b.number !== 0).map((b) => b.number);
  if (potted.length === 0) return null;
  const solids = potted.filter((n) => n >= 1 && n <= 7).sort((a, b) => a - b);
  const stripes = potted.filter((n) => n >= 9 && n <= 15).sort((a, b) => a - b);
  const eight = potted.includes(8);
  const ofGroup = (g: PoolGroup | null) => (g === 'solids' ? solids : g === 'stripes' ? stripes : []);
  const mine = ofGroup(myGroup);
  const theirs = ofGroup(oppGroup);
  // Open table → nobody owns a group yet; keep those balls neutral in the middle.
  const neutral = myGroup || oppGroup ? [] : [...solids, ...stripes].sort((a, b) => a - b);

  const chips = (balls: number[]) => (
    <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
      {balls.map((n) => <BallChip key={n} n={n} size={size} />)}
    </div>
  );
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: stretch ? '100%' : undefined }}>
      <div style={{ flex: stretch ? 1 : undefined, display: 'flex', justifyContent: 'flex-start' }}>{chips(mine)}</div>
      {(neutral.length > 0 || eight) && (
        <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
          {chips(neutral)}
          {eight && <BallChip n={8} size={size} />}
        </div>
      )}
      <div style={{ flex: stretch ? 1 : undefined, display: 'flex', justifyContent: 'flex-end' }}>{chips(theirs)}</div>
    </div>
  );
}

/**
 * Compact two-player match header: avatars (glow = whose turn), POT, timer /
 * thinking, and — folded into the same card — each player's captured balls. Kept
 * deliberately short so the table is fully visible without scrolling.
 */
function MatchHeader({
  onBack, meName, oppName, oppIsBot, myGroup, oppGroup, isMyTurn, ballInHand, opponentThinking, remaining, pot, board, myEmote, oppEmote,
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
  board: Ball[];
  /** Localized quick-chat text currently shown for each side (undefined = none). */
  myEmote?: string;
  oppEmote?: string;
}) {
  const initial = (s: string) => (s.trim()[0] ?? '?').toUpperCase();
  const Avatar = ({ text, active, bot }: { text: string; active: boolean; bot?: boolean }) => (
    <div style={{
      width: 30, height: 30, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: bot ? 15 : 13, fontWeight: 800, color: '#fff', flexShrink: 0,
      background: bot ? '#3a2f52' : '#254a63',
      border: `2px solid ${active ? 'var(--green,#6fce9a)' : 'transparent'}`,
      boxShadow: active ? '0 0 9px rgba(111,206,154,0.55)' : 'none',
      transition: 'border-color 0.2s, box-shadow 0.2s',
    }}>{bot ? '🤖' : text}</div>
  );
  const Group = ({ g }: { g: PoolGroup | null }) => !g ? null : (
    <span style={{ fontSize: 8.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: g === 'solids' ? '#e6b422' : '#cfd6df' }}>
      {g === 'solids' ? '● Solids' : '◐ Stripes'}
    </span>
  );
  const hasPotted = board.some((b) => b.pocketed && b.number !== 0);
  // Quick-chat bubble hanging just under a player's avatar (auto-cleared by parent).
  const Bubble = ({ text, side }: { text: string; side: 'left' | 'right' }) => (
    <div style={{
      position: 'absolute', top: 'calc(100% + 5px)', zIndex: 20,
      ...(side === 'left' ? { left: 2 } : { right: 2 }),
      maxWidth: 190, background: '#f4efe4', color: '#1a1712',
      fontSize: 12, fontWeight: 600, lineHeight: 1.25, padding: '5px 9px', borderRadius: 12,
      boxShadow: '0 8px 20px -8px rgba(0,0,0,0.8)', pointerEvents: 'none',
      animation: 'pool-pop 0.22s cubic-bezier(0.2,0.9,0.3,1.2)',
    }}>{text}</div>
  );
  return (
    <div style={{ borderRadius: 12, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border, rgba(255,255,255,0.08))', overflow: 'visible' }}>
      {/* Row 1: players + pot + turn indicator */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 8px' }}>
        <button className="btn" onClick={onBack} style={{ padding: '3px 7px', flexShrink: 0 }} aria-label="Back to lobby"><ArrowLeft size={15} /></button>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <Avatar text={initial(meName)} active={isMyTurn} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 92, lineHeight: 1.15 }}>{meName}</div>
            <Group g={myGroup} />
          </div>
          {myEmote && <Bubble text={myEmote} side="left" />}
        </div>
        <div style={{ marginLeft: 'auto', marginRight: 'auto', textAlign: 'center', lineHeight: 1.2 }}>
          {pot > 0 && <div style={{ fontSize: 10.5, fontWeight: 800, color: '#f6c945' }}>POT {pot}</div>}
          {isMyTurn
            ? (
              <div style={{ fontSize: 10.5, color: ballInHand ? 'var(--green,#6fce9a)' : 'var(--text-muted)', fontFamily: ballInHand ? 'inherit' : 'ui-monospace, monospace' }}>
                {ballInHand ? '✋ ball in hand' : remaining != null ? `⏱ ${remaining}s` : 'your turn'}
              </div>
            )
            : opponentThinking
              ? <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: 'var(--text-muted)' }}><span className="spinner" style={{ width: 10, height: 10 }} />thinking…</div>
              : null}
        </div>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, justifyContent: 'flex-end' }}>
          <div style={{ minWidth: 0, textAlign: 'right' }}>
            <div style={{ fontSize: 12, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 92, lineHeight: 1.15 }}>{oppName}</div>
            <Group g={oppGroup} />
          </div>
          <Avatar text={initial(oppName)} active={opponentThinking} bot={oppIsBot} />
          {oppEmote && <Bubble text={oppEmote} side="right" />}
        </div>
      </div>
      {/* Row 2: captured balls, folded in to save vertical space */}
      {hasPotted && (
        <div style={{ padding: '2px 10px 3px', borderTop: '1px solid var(--border, rgba(255,255,255,0.06))' }}>
          <PocketedTray board={board} myGroup={myGroup} oppGroup={oppGroup} size={15} stretch />
        </div>
      )}
    </div>
  );
}

/**
 * Floating quick-chat button: tap 💬 to open a picker of predefined phrases; each
 * sends only its id over the socket so the opponent reads it in their own language.
 */
function QuickChat({ onSend, bottom }: { onSend: (id: string) => void; bottom: number }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: 'fixed', right: 14, bottom, zIndex: 2500 }}>
      {open && (
        <>
          {/* tap-away backdrop */}
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: -1 }} />
          <div style={{
            position: 'absolute', right: 0, bottom: 58, width: 236, maxHeight: '46vh', overflowY: 'auto',
            background: '#141a22', border: '1px solid var(--border, rgba(255,255,255,0.1))', borderRadius: 14,
            padding: 10, boxShadow: '0 18px 44px -12px rgba(0,0,0,0.85)',
          }}>
            {(['taunts', 'friendly'] as const).map((group) => (
              <div key={group} style={{ marginBottom: 6 }}>
                <div style={{ fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-muted)', margin: '4px 2px 6px' }}>{t(`pool.${group}`)}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {POOL_EMOTES[group].map((id) => (
                    <button key={id} className="btn" onClick={() => { onSend(id); setOpen(false); }}
                      style={{ justifyContent: 'flex-start', textAlign: 'left', padding: '7px 10px', fontSize: 13, width: '100%' }}>
                      {t(`pool.chat.${id}`)}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      <button onClick={() => setOpen((o) => !o)} aria-label={t('pool.quickChat')}
        style={{
          width: 48, height: 48, borderRadius: '50%', border: '1px solid var(--border, rgba(255,255,255,0.15))',
          background: open ? '#243244' : '#1b2530', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 8px 22px -6px rgba(0,0,0,0.75)', cursor: 'pointer',
        }}>
        <MessageCircle size={22} />
      </button>
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
  const [queueStartedAt, setQueueStartedAt] = useState<number | null>(null);
  const [stake, setStake] = useState(10);
  const [feed, setFeed] = useState<string[]>([]);
  const [ended, setEnded] = useState<EndState>(null);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  // Latest quick-chat emote per seat (id + timestamp), auto-cleared after a few secs.
  const [emotes, setEmotes] = useState<Partial<Record<Seat, { id: string; ts: number }>>>({});
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
    setQueueStartedAt(null);
    setEnded(null);
    setFeed([]);
    setEmotes({});
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
    onEmote: (e: PoolEmoteEvent) => {
      // Map the sender's userId to their seat; ignore emotes from non-players.
      const seat: Seat | null = e.userId === match?.seatAUserId ? 'A' : e.userId === match?.seatBUserId ? 'B' : null;
      if (!seat) return;
      setEmotes((cur) => ({ ...cur, [seat]: { id: e.id, ts: e.ts } }));
      // Auto-clear after ~3.4s, but only if a newer emote hasn't replaced it.
      window.setTimeout(() => {
        setEmotes((cur) => (cur[seat]?.ts === e.ts ? { ...cur, [seat]: undefined } : cur));
      }, 3400);
    },
  });

  const sendEmote = (id: string) => { if (match) sendPoolEmote(match.id, id); };

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
      else { setQueuedStake(res.stakeMinor); setQueueStartedAt(Date.now()); }
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
      setQueueStartedAt(null);
    }
  };

  // From the "no players found" prompt: drop out of the human queue and start an
  // AI match instead, so the player is never stuck waiting on an empty lobby.
  const playVsAiFromQueue = async () => {
    try { await poolApi.leaveQueue(); } catch { /* ignore — starting AI regardless */ }
    setQueuedStake(null);
    setQueueStartedAt(null);
    await startSingle();
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
    // Real opponent (Telegram) name for two-player; AI label for single-player.
    const oppSeatName = mySeat ? (mySeat === 'A' ? match.seatBName : match.seatAName) : (match.seatBName ?? match.seatAName);
    const opponentName = match.mode === 'single'
      ? t('pool.opponentAI')
      : (oppSeatName?.trim() || t('pool.opponent'));
    const opponentThinking = match.status === 'active' && !isMyTurn;
    const oppGroup = mySeat ? match.groups[mySeat === 'A' ? 'B' : 'A'] : null;
    // Localize each side's live quick-chat emote (in the viewer's own language).
    const meSeatKey: Seat = mySeat ?? 'A';
    const oppSeatKey: Seat = meSeatKey === 'A' ? 'B' : 'A';
    const myEmote = emotes[meSeatKey] ? t(`pool.chat.${emotes[meSeatKey]!.id}`) : undefined;
    const oppEmote = emotes[oppSeatKey] ? t(`pool.chat.${emotes[oppSeatKey]!.id}`) : undefined;
    // Quick chat is a human-vs-human feature (no point taunting the AI).
    const showQuickChat = match.mode !== 'single' && match.status === 'active';
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
        board={match.board}
        myEmote={myEmote}
        oppEmote={oppEmote}
      />
    );
    // Aim-prediction guide only vs the AI; human-vs-human is unassisted.
    const assist = match.mode === 'single';

    const didWin = !!ended && !ended.aborted && ended.winnerSeat === mySeat;
    const resultModal = ended && (
      <div style={{ position: 'fixed', inset: 0, zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(2px)' }}>
        <div style={{
          width: '100%', maxWidth: 360, textAlign: 'center', padding: '26px 22px', borderRadius: 20,
          background: 'linear-gradient(180deg,#1b2230,#12151b)',
          border: `2px solid ${ended.aborted ? '#3a4652' : didWin ? '#f6c945' : '#e0403c'}`,
          boxShadow: `0 30px 80px -20px rgba(0,0,0,0.9), 0 0 40px -8px ${didWin ? 'rgba(246,201,69,0.45)' : 'transparent'}`,
          animation: 'pool-pop 0.28s cubic-bezier(0.2,0.9,0.3,1.2)',
        }}>
          <div style={{ fontSize: 56, lineHeight: 1, marginBottom: 8 }}>
            {ended.aborted ? '↩️' : didWin ? '🏆' : '💔'}
          </div>
          <h2 style={{
            margin: '0 0 8px', fontSize: 34, fontWeight: 900, letterSpacing: '0.02em',
            color: ended.aborted ? '#cfd6df' : didWin ? '#f6c945' : '#ff6b63',
            textShadow: didWin ? '0 2px 16px rgba(246,201,69,0.5)' : 'none',
            fontFamily: 'var(--font-display, inherit)',
          }}>
            {ended.aborted ? t('pool.matchAborted') : didWin ? t('pool.youWin') : t('pool.youLost')}
          </h2>
          {didWin && match.stakeMinor > 0 && (
            <div style={{ fontSize: 16, fontWeight: 800, color: '#6fce9a', marginBottom: 8 }}>
              🪙 +{match.stakeMinor * 2}
            </div>
          )}
          <p style={{ margin: '0 0 18px', fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.4 }}>
            {ended.aborted ? t('pool.stakeRefunded') : ended.reason ?? ''}
          </p>
          <button className="btn btn-primary" onClick={backToLobby} style={{ width: '100%' }}>{t('pool.backToLobby')}</button>
        </div>
      </div>
    );

    // ── Landscape: immersive fullscreen (covers the app chrome) ────────────────
    if (landscape) {
      return (
        <div style={{ position: 'fixed', inset: 0, zIndex: 2000, background: '#0b0f14', display: 'flex', flexDirection: 'column', padding: '8px 12px 10px', gap: 8 }}>
          {header}
          <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
            <PoolTable ref={tableRef} view={match} mySeat={mySeat} canShoot={canShoot} onSubmit={submitShot} orientation="landscape" mustCall={mustCall} assist={assist} />
          </div>
          {showQuickChat && <QuickChat onSend={sendEmote} bottom={16} />}
          {resultModal}
        </div>
      );
    }

    // ── Portrait: in-page, tall vertical table ─────────────────────────────────
    return (
      <div style={{ padding: '4px 10px 10px', maxWidth: 640, margin: '0 auto' }}>
        <div style={{ marginBottom: 6 }}>{header}</div>

        <PoolTable ref={tableRef} view={match} mySeat={mySeat} canShoot={canShoot} onSubmit={submitShot} orientation="portrait" mustCall={mustCall} assist={assist} />

        {/* Shot feed — latest lines only, kept short so the table stays in view */}
        {feed.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {feed.slice(0, 2).map((line, i) => (
                <div key={i} style={{ fontSize: 12, color: i === 0 ? 'var(--text)' : 'var(--text-muted)' }}>{line}</div>
              ))}
            </div>
          </div>
        )}

        {showQuickChat && <QuickChat onSend={sendEmote} bottom={84} />}
        {resultModal}
      </div>
    );
  }

  // ── Lobby ───────────────────────────────────────────────────────────────────
  // Matchmaking countdown: search for a human for a fixed window, then offer to
  // fall back to the AI so the player is never left staring at an empty lobby.
  const searchElapsed = queueStartedAt ? Math.floor((now - queueStartedAt) / 1000) : 0;
  const searchRemaining = Math.max(0, SEARCH_WINDOW_S - searchElapsed);
  const noPlayers = queuedStake != null && searchRemaining === 0;
  const aiAvailable = config?.singlePlayerEnabled !== false;
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
            noPlayers ? (
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 3 }}>{t('pool.noPlayersTitle')}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12, lineHeight: 1.4 }}>{t('pool.noPlayersBody')}</div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  {aiAvailable && (
                    <button className="btn btn-primary" disabled={busy} onClick={playVsAiFromQueue} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Bot size={15} /> {t('pool.playVsAI')}
                    </button>
                  )}
                  <button className="btn" disabled={busy} onClick={() => setQueueStartedAt(Date.now())}>{t('pool.keepSearching')}</button>
                  <button className="btn btn-ghost" onClick={leaveQueue} style={{ marginLeft: 'auto' }}>{t('common.cancel')}</button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div className="spinner" style={{ width: 18, height: 18 }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13 }}>{t('pool.searchingStake', { amount: queuedStake })}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'ui-monospace, monospace' }}>{t('pool.searchingCountdown', { secs: searchRemaining })}</div>
                </div>
                <button className="btn" onClick={leaveQueue} style={{ marginLeft: 'auto', padding: '6px 10px' }}>{t('common.cancel')}</button>
              </div>
            )
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
