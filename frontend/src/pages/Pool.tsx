import { useEffect, useMemo, useRef, useState } from 'react';
import confetti from 'canvas-confetti';
import { ArrowLeft, Bot, Swords, Trophy } from 'lucide-react';
import { useStore } from '../store/useStore';
import { poolApi } from '../lib/poolApi';
import type { PoolConfig, PoolMatchView, PoolTournament, Seat } from '../lib/poolApi';
import { usePoolMatchFound, usePoolMatchSocket, type PoolShotResolvedEvent } from '../hooks/usePoolSocket';
import { PoolTable, type PoolTableHandle } from '../components/PoolTable';
import type { ShotInput } from '@pool-engine';

type EndState = { winnerSeat?: Seat | null; reason?: string; aborted?: boolean } | null;

const seatLabel = (seat: Seat) => (seat === 'A' ? 'Player 1' : 'Player 2');

export function Pool({ onBack }: { onBack: () => void }) {
  const user = useStore((s) => s.user);
  const addToast = useStore((s) => s.addToast);

  const [config, setConfig] = useState<PoolConfig | null>(null);
  const [match, setMatch] = useState<PoolMatchView | null>(null);
  const [queuedStake, setQueuedStake] = useState<number | null>(null);
  const [stake, setStake] = useState(10);
  const [feed, setFeed] = useState<string[]>([]);
  const [ended, setEnded] = useState<EndState>(null);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const tableRef = useRef<PoolTableHandle>(null);

  useEffect(() => {
    poolApi.getConfig().then(setConfig).catch(() => {});
  }, []);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
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
    addToast('success', 'Match found!');
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

  useEffect(() => {
    if (ended && mySeat && ended.winnerSeat === mySeat) {
      confetti({ particleCount: 120, spread: 75, origin: { y: 0.6 } });
    }
  }, [ended, mySeat]);

  const err = (e: unknown, fallback: string) => {
    const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? fallback;
    addToast('error', Array.isArray(msg) ? msg[0] : msg);
  };

  const startSingle = async () => {
    setBusy(true);
    try {
      enterMatch(await poolApi.startSingle());
    } catch (e) {
      err(e, 'Could not start a single-player game');
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
      err(e, 'Could not join the queue');
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
      err(e, 'Shot rejected');
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
    const deadlineMs = match.turnDeadline ? new Date(match.turnDeadline).getTime() : null;
    const remaining = deadlineMs ? Math.max(0, Math.ceil((deadlineMs - now) / 1000)) : null;
    const opponentName = match.mode === 'single' ? 'AI' : 'Opponent';

    return (
      <div style={{ padding: '12px 14px 28px', maxWidth: 640, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <button className="btn" onClick={backToLobby} style={{ padding: '6px 10px', display: 'flex', alignItems: 'center', gap: 6 }}>
            <ArrowLeft size={16} /> Lobby
          </button>
          <div style={{ marginLeft: 'auto', fontSize: 12.5, color: 'var(--text-muted)' }}>
            {match.mode === 'single' ? 'Practice vs AI' : match.mode === 'tournament' ? 'Tournament' : 'Ranked'} · stake {match.stakeMinor}
          </div>
        </div>

        {/* Turn banner */}
        <div
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 14px', borderRadius: 12, marginBottom: 12,
            background: isMyTurn ? 'rgba(111,206,154,0.14)' : 'rgba(255,255,255,0.05)',
            border: `1px solid ${isMyTurn ? 'rgba(111,206,154,0.4)' : 'var(--border, rgba(255,255,255,0.1))'}`,
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 15 }}>
            {match.status !== 'active'
              ? 'Game over'
              : isMyTurn
                ? (match.ballInHand ? 'Your turn — ball in hand' : 'Your turn')
                : `${opponentName} is shooting…`}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 12.5, color: 'var(--text-muted)' }}>
            <span>You: <strong style={{ color: 'var(--text)' }}>{myGroup ?? (match.tableOpen ? 'open' : '—')}</strong></span>
            {isMyTurn && remaining != null && (
              <span style={{ fontFamily: 'ui-monospace, monospace', color: remaining <= 5 ? 'var(--danger,#e0653c)' : 'inherit' }}>⏱ {remaining}s</span>
            )}
          </div>
        </div>

        <PoolTable ref={tableRef} view={match} mySeat={mySeat} canShoot={canShoot} onSubmit={submitShot} />

        {/* Shot feed */}
        {feed.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 10.5, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6 }}>Shot log</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {feed.map((line, i) => (
                <div key={i} style={{ fontSize: 12.5, color: i === 0 ? 'var(--text)' : 'var(--text-muted)' }}>{line}</div>
              ))}
            </div>
          </div>
        )}

        {/* Result overlay */}
        {ended && (
          <div style={{ marginTop: 16, padding: 16, borderRadius: 14, textAlign: 'center', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border, rgba(255,255,255,0.1))' }}>
            <div style={{ fontSize: 40, marginBottom: 6 }}>
              {ended.aborted ? '↩️' : ended.winnerSeat === mySeat ? '🏆' : '💔'}
            </div>
            <h3 style={{ margin: '0 0 6px', fontSize: 19, fontWeight: 800 }}>
              {ended.aborted ? 'Match aborted' : ended.winnerSeat === mySeat ? 'You win!' : 'You lost'}
            </h3>
            <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--text-muted)' }}>
              {ended.aborted ? 'Your stake was refunded.' : ended.reason ?? ''}
            </p>
            <button className="btn btn-primary" onClick={backToLobby} style={{ width: '100%' }}>Back to lobby</button>
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
          <ArrowLeft size={16} /> Games
        </button>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>🎱 8-Ball Pool</h2>
      </div>

      {/* Single player */}
      {config?.singlePlayerEnabled !== false && (
        <LobbyCard
          icon={<Bot size={22} />}
          title="Play vs AI"
          subtitle={config && config.singlePlayerStakeMinor > 0 ? `Stake ${config.singlePlayerStakeMinor}` : 'Free practice'}
        >
          <button className="btn btn-primary" disabled={busy} onClick={startSingle} style={{ width: '100%' }}>
            Start game
          </button>
        </LobbyCard>
      )}

      {/* Two player */}
      {config?.twoPlayerEnabled !== false && (
        <LobbyCard icon={<Swords size={22} />} title="Ranked (2 players)" subtitle="Winner takes the pot, minus rake">
          {queuedStake != null ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div className="spinner" style={{ width: 18, height: 18 }} />
              <span style={{ fontSize: 13 }}>Searching for an opponent at stake {queuedStake}…</span>
              <button className="btn" onClick={leaveQueue} style={{ marginLeft: 'auto', padding: '6px 10px' }}>Cancel</button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <label style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Stake</label>
              <input
                type="number"
                value={stake}
                min={config?.minStakeMinor ?? 1}
                max={config?.maxStakeMinor ?? 1000}
                onChange={(e) => setStake(parseInt(e.target.value, 10) || 0)}
                style={{ width: 90, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border, rgba(255,255,255,0.15))', background: 'var(--surface,#0c0a08)', color: 'inherit', fontFamily: 'ui-monospace, monospace' }}
              />
              <button className="btn btn-primary" disabled={busy} onClick={joinQueue} style={{ marginLeft: 'auto' }}>Find match</button>
            </div>
          )}
          {config && (
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 8 }}>
              Stakes {config.minStakeMinor}–{config.maxStakeMinor} · {config.rakePct}% rake
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
  const [id, setId] = useState('');
  const [tournament, setTournament] = useState<PoolTournament | null>(null);
  const [matches, setMatches] = useState<PoolMatchView[]>([]);

  const load = async (tid: string) => {
    try {
      setTournament(await poolApi.getTournament(tid));
      setMatches(await poolApi.getTournamentMatches(tid));
    } catch (e) {
      onError(e, 'Tournament not found');
    }
  };

  const register = async () => {
    try {
      const t = await poolApi.registerTournament(id.trim());
      setTournament(t);
      setMatches(await poolApi.getTournamentMatches(t.id));
    } catch (e) {
      onError(e, 'Could not register');
    }
  };

  const myActive = matches.find(
    (m) => m.status === 'active' && (m.seatAUserId === myUserId || m.seatBUserId === myUserId),
  );

  return (
    <LobbyCard icon={<Trophy size={22} />} title="Tournaments" subtitle="Single-elimination brackets">
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          placeholder="Tournament ID"
          value={id}
          onChange={(e) => setId(e.target.value)}
          style={{ flex: 1, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border, rgba(255,255,255,0.15))', background: 'var(--surface,#0c0a08)', color: 'inherit', fontSize: 12.5 }}
        />
        <button className="btn" onClick={() => load(id.trim())} disabled={!id.trim()}>View</button>
        <button className="btn btn-primary" onClick={register} disabled={!id.trim()}>Join</button>
      </div>
      {tournament && (
        <div style={{ marginTop: 12, fontSize: 12.5 }}>
          <div style={{ fontWeight: 700 }}>{tournament.name}</div>
          <div style={{ color: 'var(--text-muted)' }}>
            {tournament.status} · {tournament.size} players · prize {tournament.prizePoolMinor}
          </div>
          {myActive && (
            <button className="btn btn-primary" onClick={() => onPlay(myActive)} style={{ width: '100%', marginTop: 10 }}>
              Play your match
            </button>
          )}
        </div>
      )}
    </LobbyCard>
  );
}
