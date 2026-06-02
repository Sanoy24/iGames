import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, Trophy, CircleDashed, Gamepad2, History, Ticket } from 'lucide-react';
import { GameTabs, type GameTabOption } from '../components/GameTabs';
import { kenoApi, walletApi } from '../lib/api';
import type { KenoConfig, KenoDraw, KenoTicket } from '../lib/models';
import {
  createIdempotencyKey,
  formatCreditsFull,
  formatDateTime,
  getErrorMessage,
} from '../lib/utils';
import { formatCredits, useStore } from '../store/useStore';
import { getSocket } from '../hooks/useSocketConnection';
import { soundEngine } from '../lib/audio';
import confetti from 'canvas-confetti';

function useCountdown(targetIso: string | null | undefined) {
  const [display, setDisplay] = useState('--:--');
  const [urgent, setUrgent] = useState(false);
  const [expired, setExpired] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    setExpired(false);
    if (!targetIso) { setDisplay('--:--'); setUrgent(false); return; }

    const tick = () => {
      const ms = new Date(targetIso).getTime() - Date.now();
      if (ms <= 0) {
        setDisplay('00:00');
        setUrgent(false);
        setExpired(true);
        if (timerRef.current) clearInterval(timerRef.current);
        return;
      }
      const totalSec = Math.floor(ms / 1000);
      const mins = Math.floor(totalSec / 60);
      const secs = totalSec % 60;
      setDisplay(`${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`);
      setUrgent(totalSec < 15);
      setExpired(false);
    };

    tick();
    timerRef.current = setInterval(tick, 500);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [targetIso]);

  return { display, urgent, expired };
}

const DEFAULT_ALLOWED_SPOTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const DEFAULT_KENO_INTERVAL_SECONDS = 40;
const KENO_REVEAL_DELAY_MS = 150;

function getKenoIntervalSeconds(config: KenoConfig) {
  if (config.autoScheduleIntervalSeconds !== undefined) {
    return config.autoScheduleIntervalSeconds;
  }
  if (config.autoScheduleIntervalMinutes === 0) {
    return 0;
  }
  return DEFAULT_KENO_INTERVAL_SECONDS;
}

function formatKenoInterval(config: KenoConfig) {
  const seconds = getKenoIntervalSeconds(config);
  if (seconds <= 0) return 'Manual';
  if (seconds < 60) return `${seconds}s`;
  const minutes = seconds / 60;
  return Number.isInteger(minutes) ? `${minutes}m` : `${seconds}s`;
}

type KenoDrawCompletedPayload = {
  drawId?: string;
  drawnNumbers?: number[];
};

type KenoProps = {
  onBack: () => void;
};

type KenoTab = 'active' | 'draws' | 'tickets';

const KENO_TABS: Array<GameTabOption<KenoTab>> = [
  { id: 'active', label: 'Active Game', description: 'Countdown, picks, and ticket purchase.', icon: <Gamepad2 size={20} /> },
  { id: 'draws', label: 'Recent Draws', description: 'Latest Keno rounds and their results.', icon: <History size={20} /> },
  { id: 'tickets', label: 'Your Tickets', description: 'Recent Keno bets and results.', icon: <Ticket size={20} /> },
];

const DRAW_STATUS_BADGE: Record<string, string> = {
  settled: 'badge-green',
  cancelled: 'badge-red',
  pending: 'badge-violet',
};

export function Keno({ onBack }: KenoProps) {
  const addToast = useStore((state) => state.addToast);
  const setWallet = useStore((state) => state.setWallet);
  const [config, setConfig] = useState<KenoConfig | null>(null);
  const [draws, setDraws] = useState<KenoDraw[]>([]);
  const [tickets, setTickets] = useState<KenoTicket[]>([]);
  const [activeDraw, setActiveDraw] = useState<KenoDraw | null>(null);
  const [selectedNumbers, setSelectedNumbers] = useState<number[]>([]);
  const [spotTarget, setSpotTarget] = useState(4);
  const [ticketPhase, setTicketPhase] = useState<'buy' | 'pick'>('buy');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState<KenoTab>('active');
  const [animatingDrawId, setAnimatingDrawId] = useState<string | null>(null);
  const [revealedNumbers, setRevealedNumbers] = useState<number[]>([]);
  const [drawResult, setDrawResult] = useState<{
    drawId: string;
    drawnNumbers: number[];
    userTickets: KenoTicket[];
    totalPayout: number;
  } | null>(null);
  const ticketsRef = useRef<KenoTicket[]>([]);

  const scheduledAt = activeDraw?.status === 'open' ? activeDraw.scheduledAt : null;
  const { display: countdown, urgent: countdownUrgent, expired: countdownExpired } = useCountdown(scheduledAt);

  const allowedSpots = config?.allowedSpots?.length ? config.allowedSpots : DEFAULT_ALLOWED_SPOTS;
  const numbers = useMemo(() => {
    const min = config?.numberMin ?? 1;
    const max = config?.numberMax ?? 80;
    return Array.from({ length: max - min + 1 }, (_, index) => min + index);
  }, [config]);
  const latestDraw = draws[0];
  const ticketsByDrawId = useMemo(() => {
    const map = new Map<string, KenoTicket[]>();
    for (const ticket of tickets) {
      const list = map.get(ticket.drawId) ?? [];
      list.push(ticket);
      map.set(ticket.drawId, list);
    }
    return map;
  }, [tickets]);

  useEffect(() => {
    ticketsRef.current = tickets;
  }, [tickets]);

  const loadKeno = useCallback(async () => {
    try {
      const [nextConfig, nextDraws, nextTickets, nextActiveDraw] = await Promise.all([
        kenoApi.getConfig(),
        kenoApi.listDraws(8),
        kenoApi.listTickets(12),
        kenoApi.getActiveDraw(),
      ]);
      setConfig(nextConfig);
      setDraws(nextDraws);
      setTickets(nextTickets);
      setActiveDraw(nextActiveDraw);
      setSpotTarget((current) => {
        if (nextConfig.allowedSpots.includes(current)) return current;
        return nextConfig.allowedSpots[0] ?? 1;
      });
    } catch (error) {
      addToast('error', getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    void loadKeno();

    const socket = getSocket();
    if (socket) {
      const handleDrawStarted = () => {
        setActiveDraw((prev) => prev ? { ...prev, status: 'locked' } : prev);
      };

      const handleDrawCompleted = (payload: KenoDrawCompletedPayload) => {
        const drawn: number[] = payload.drawnNumbers || [];
        const userHasTicket = ticketsRef.current.some((t) => t.drawId === payload.drawId);
        setAnimatingDrawId(payload.drawId ?? null);
        setRevealedNumbers([]);

        drawn.forEach((num: number, idx: number) => {
          setTimeout(() => {
            if (userHasTicket) soundEngine.pop();
            setRevealedNumbers((prev) => [...prev, num]);
          }, idx * KENO_REVEAL_DELAY_MS);
        });

        void loadKeno().then(() => {});
        addToast('info', `Draw ${payload.drawId?.slice(-6) || 'completed'} settled.`);
      };

      socket.on('keno.draw.started', handleDrawStarted);
      socket.on('keno.draw.completed', handleDrawCompleted);
      return () => {
        socket.off('keno.draw.started', handleDrawStarted);
        socket.off('keno.draw.completed', handleDrawCompleted);
      };
    }
  }, [loadKeno, addToast]);

  // Poll while the draw is overdue (countdown expired but scheduler hasn't fired yet)
  useEffect(() => {
    if (!countdownExpired || !activeDraw || activeDraw.status !== 'open') return;
    const id = setInterval(async () => {
      try {
        const next = await kenoApi.getActiveDraw();
        if (!next || next.id !== activeDraw.id) {
          setActiveDraw(next);
        }
      } catch { /* ignore */ }
    }, 2000);
    return () => clearInterval(id);
  }, [countdownExpired, activeDraw]);

  // Show result panel once settled tickets arrive for the animating draw
  useEffect(() => {
    if (!animatingDrawId || tickets.length === 0) return;
    const relevant = tickets.filter(
      (t) => t.drawId === animatingDrawId && t.settlementStatus === 'settled'
    );
    if (relevant.length === 0) return;
    const resultDraw = draws.find((d) => d.id === animatingDrawId);
    if (!resultDraw?.drawnNumbers.length) return;
    const totalPayout = relevant.reduce((sum, t) => sum + t.payoutMinor, 0);
    const timer = setTimeout(() => {
      if (totalPayout > 0) {
        soundEngine.win();
        confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 }, colors: ['#FFE600', '#00FF00', '#FF00FF'] });
      }
      setDrawResult({ drawId: animatingDrawId, drawnNumbers: resultDraw.drawnNumbers, userTickets: relevant, totalPayout });
      setAnimatingDrawId(null);
    }, 1500);
    return () => clearTimeout(timer);
  }, [tickets, animatingDrawId, draws]);

  useEffect(() => {
    setSelectedNumbers((current) => current.slice(0, spotTarget));
  }, [spotTarget]);

  const toggleNumber = (value: number) => {
    soundEngine.click();
    setSelectedNumbers((current) => {
      if (current.includes(value)) return current.filter((item) => item !== value);
      if (current.length >= spotTarget) return current;
      return [...current, value].sort((a, b) => a - b);
    });
  };

  const submitTicket = async () => {
    if (selectedNumbers.length !== spotTarget) {
      addToast('info', `Pick exactly ${spotTarget} numbers to place this ticket.`);
      return;
    }
    setSubmitting(true);
    try {
      await kenoApi.purchaseTicket(selectedNumbers, createIdempotencyKey('keno'));
      const [nextWallet] = await Promise.all([walletApi.getWallet(), loadKeno()]);
      setWallet(nextWallet);
      setSelectedNumbers([]);
      setTicketPhase('buy');
      addToast('success', 'Keno ticket purchased.');
    } catch (error) {
      addToast('error', getErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="stack-lg">
      <GameTabs
        tabs={KENO_TABS}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onBack={onBack}
        ariaLabel="Keno sections"
      />

      <section className="card hero-subpanel">
        <div className="section-header">
          <div>
            <div className="section-title">Keno</div>
            <p className="section-copy">
              Choose your spot count, lock your numbers, and join the next scheduled draw.
            </p>
          </div>
          <button className="btn btn-ghost btn-sm icon-btn" onClick={() => void loadKeno()}>
            <RefreshCw size={14} />
          </button>
        </div>

        {config ? (
          <div className="stats-grid">
            <div className="stat-card">
              <span className="stat-label">Ticket Price</span>
              <strong>{formatCredits(config.ticketPriceMinor)} Credits</strong>
            </div>
            <div className="stat-card">
              <span className="stat-label">Draw Size</span>
              <strong>{config.drawSize} Numbers</strong>
            </div>
            <div className="stat-card">
              <span className="stat-label">Interval</span>
              <strong>{formatKenoInterval(config)}</strong>
            </div>
          </div>
        ) : (
          <div className="card-muted">Loading Keno configuration...</div>
        )}
      </section>

      {/* ── Draw result panel ── */}
      {drawResult && (
        <section className={`card keno-result-panel ${drawResult.totalPayout > 0 ? 'keno-result-win' : 'keno-result-loss'}`}>
          <div className="keno-result-header">
            {drawResult.totalPayout > 0 ? (
              <>
                <Trophy className="keno-result-icon keno-result-icon-win" size={32} />
                <div className="keno-result-title">You Won!</div>
                <div className="keno-result-amount">+{formatCreditsFull(drawResult.totalPayout)}</div>
                <p className="keno-result-sub">Credited to your wallet instantly</p>
              </>
            ) : (
              <>
                <CircleDashed className="keno-result-icon keno-result-icon-loss" size={32} />
                <div className="keno-result-title">No Win This Draw</div>
                <p className="keno-result-sub">The numbers weren't in your favour — try again!</p>
              </>
            )}
          </div>

          {drawResult.userTickets.map((ticket) => {
            const hits = ticket.selectedNumbers.filter((n) => drawResult.drawnNumbers.includes(n));
            return (
              <div key={ticket.id} className="keno-result-ticket">
                <div className="keno-result-ticket-meta">
                  <span>{ticket.selectedNumbers.length}-Spot</span>
                  <span>{ticket.matches} match{ticket.matches !== 1 ? 'es' : ''}</span>
                  {hits.length > 0 && <span>Hit: {hits.join(', ')}</span>}
                  {ticket.payoutMinor > 0 && (
                    <span className="keno-result-payout">+{formatCredits(ticket.payoutMinor)}</span>
                  )}
                </div>
                <div className="keno-result-picks">
                  {ticket.selectedNumbers.map((n) => (
                    <span
                      key={n}
                      className={`ball ${hits.includes(n) ? 'ball-hit' : 'ball-miss'}`}
                    >
                      {n}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}

          <div className="keno-result-drawn">
            <div className="keno-result-ticket-meta">Drawn numbers</div>
            <div className="ball-row">
              {drawResult.drawnNumbers.map((number) => {
                const selectedHit = drawResult.userTickets.some((ticket) => ticket.selectedNumbers.includes(number));
                return (
                  <span key={number} className={`ball ${selectedHit ? 'ball-hit' : 'ball-drawn'}`}>
                    {number}
                  </span>
                );
              })}
            </div>
          </div>

          <button
            className="btn btn-primary btn-full"
            style={{ marginTop: 16 }}
            onClick={() => { setDrawResult(null); setTicketPhase('buy'); }}
          >
            Play Again
          </button>
        </section>
      )}

      {/* ── Countdown ── */}
      {activeTab === 'active' && (
        <div className="game-tab-panel" role="tabpanel" aria-label="Active Game">
      <section className="card keno-countdown-card">
        {activeDraw && activeDraw.status !== 'open' ? (
          <div className="keno-countdown-inner">
            <div className="keno-countdown-value keno-countdown-drawing">Drawing…</div>
            <div className="keno-countdown-label">Numbers being drawn now</div>
          </div>
        ) : countdownExpired ? (
          <div className="keno-countdown-inner">
            <div className="keno-countdown-value keno-countdown-drawing">Starting…</div>
            <div className="keno-countdown-label">Draw executing, new round coming</div>
          </div>
        ) : (
          <div className="keno-countdown-inner">
            <div className={`keno-countdown-value${countdownUrgent ? ' keno-countdown-urgent' : ''}`}>
              {countdown}
            </div>
            <div className="keno-countdown-label">
              {activeDraw ? 'until next draw' : 'No draw scheduled'}
            </div>
          </div>
        )}
      </section>

      <section className="card">
        {ticketPhase === 'buy' ? (
          <>
            <div className="section-header" style={{ marginBottom: 12 }}>
              <div>
                <div className="section-title">Buy a Keno Ticket</div>
                <p className="section-copy">Choose how many spots, then pick your lucky numbers.</p>
              </div>
            </div>

            <div className="chip-row">
              {allowedSpots.map((spots) => (
                <button
                  key={spots}
                  className={`choice-chip${spots === spotTarget ? ' active' : ''}`}
                  onClick={() => setSpotTarget(spots)}
                >
                  {spots} Spot
                </button>
              ))}
            </div>

            {config?.paytable && (() => {
              const entries = config.paytable
                .filter((e) => e.spots === spotTarget && e.payoutMultiplier > 0)
                .sort((a, b) => a.matches - b.matches);
              if (entries.length === 0) return null;
              return (
                <div className="keno-paytable">
                  <div className="keno-paytable-title">{spotTarget}-Spot Payouts</div>
                  <div className="keno-paytable-rows">
                    {entries.map((e) => (
                      <div key={`${e.spots}-${e.matches}`} className="keno-paytable-row">
                        <span>{e.matches} match{e.matches !== 1 ? 'es' : ''}</span>
                        <span className="keno-paytable-mult">{e.payoutMultiplier}×</span>
                      </div>
                    ))}
                  </div>
                  <p className="keno-paytable-hint">
                    Need at least {entries[0].matches} match{entries[0].matches !== 1 ? 'es' : ''} to win
                  </p>
                </div>
              );
            })()}

            <button
              className="btn btn-primary btn-full"
              style={{ marginTop: 16 }}
              disabled={!activeDraw || activeDraw.status !== 'open'}
              onClick={() => { setSelectedNumbers([]); setTicketPhase('pick'); }}
            >
              {!activeDraw || activeDraw.status !== 'open'
                ? 'Waiting for draw...'
                : `Buy ${spotTarget}-Spot Ticket — ${formatCredits(config?.ticketPriceMinor ?? 0)} credits`}
            </button>
          </>
        ) : (
          <>
            <div className="section-header" style={{ marginBottom: 12 }}>
              <div>
                <div className="section-title">Pick Your {spotTarget} Numbers</div>
                <p className="section-copy">
                  {selectedNumbers.length >= spotTarget
                    ? `All ${spotTarget} picked — tap a number to swap it out.`
                    : `${selectedNumbers.length} / ${spotTarget} selected. Tap a number to pick it; tap again to remove.`}
                </p>
              </div>
            </div>

            <div className="selected-strip">
              {selectedNumbers.length > 0 ? (
                selectedNumbers.map((value) => (
                  <span
                    key={value}
                    className="ball ball-selected"
                    style={{ cursor: 'pointer' }}
                    onClick={() => toggleNumber(value)}
                  >
                    {value}
                  </span>
                ))
              ) : (
                <span className="text-muted">Tap numbers below to start picking.</span>
              )}
            </div>

            <div className="number-grid">
              {numbers.map((value) => {
                const isSelected = selectedNumbers.includes(value);
                const isFull = selectedNumbers.length >= spotTarget && !isSelected;
                const isDrawn = animatingDrawId === latestDraw?.id
                  ? revealedNumbers.includes(value)
                  : latestDraw?.drawnNumbers.includes(value) ?? false;
                const tone = isSelected ? 'ball-selected' : isDrawn ? 'ball-drawn' : 'ball-idle';
                return (
                  <button
                    key={value}
                    className={`ball ${tone}${isFull ? ' ball-dimmed' : ''}`}
                    onClick={() => toggleNumber(value)}
                    title={isSelected ? 'Tap to remove' : isFull ? 'Remove a number first' : undefined}
                  >
                    {value}
                  </button>
                );
              })}
            </div>

            <div className="action-row" style={{ marginTop: 16 }}>
              <button
                className="btn btn-ghost"
                disabled={submitting}
                onClick={() => { setSelectedNumbers([]); setTicketPhase('buy'); }}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                disabled={submitting || selectedNumbers.length !== spotTarget}
                onClick={submitTicket}
              >
                {submitting
                  ? 'Confirming...'
                  : selectedNumbers.length === spotTarget
                  ? `Confirm — ${formatCredits(config?.ticketPriceMinor ?? 0)} credits`
                  : `Pick ${spotTarget - selectedNumbers.length} more`}
              </button>
            </div>
          </>
        )}
          </section>
        </div>
      )}

      {activeTab === 'draws' && (
      <section className="card" role="tabpanel" aria-label="Recent Draws">
        <div className="section-header">
          <div>
            <div className="section-title">Recent Draws</div>
            <p className="section-copy">Latest Keno rounds and their results.</p>
          </div>
        </div>
        {loading && draws.length === 0 ? (
          <div className="card-muted">Fetching draw history...</div>
        ) : draws.length === 0 ? (
          <div className="card-muted">No draws yet.</div>
        ) : (
          <div className="list-stack">
            {draws.map((draw) => {
                const drawTickets = ticketsByDrawId.get(draw.id) ?? [];
                const selectedForDraw = new Set(drawTickets.flatMap((ticket) => ticket.selectedNumbers));
                return (
                  <article key={draw.id} className="list-card">
                    <div className="list-card-header">
                      <div>
                        <h3>Draw #{draw.id.slice(-6)}</h3>
                        <p>{formatDateTime(draw.scheduledAt)}</p>
                      </div>
                      <span className={`badge ${DRAW_STATUS_BADGE[draw.status] ?? 'badge-violet'}`}>
                        {draw.status}
                      </span>
                    </div>
                    {drawTickets.length > 0 && (
                      <div className="keno-draw-picks">
                        <span className="text-muted">Your selected numbers</span>
                        <div className="keno-ticket-numbers">
                          {[...selectedForDraw].sort((left, right) => left - right).map((number) => (
                            <span
                              key={`${draw.id}-pick-${number}`}
                              className={`keno-number-pip${draw.drawnNumbers.includes(number) ? ' hit' : ''}`}
                            >
                              {number}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="ball-row">
                      {draw.drawnNumbers.length > 0 ? (
                        draw.drawnNumbers.map((value) => (
                          <span
                            key={`${draw.id}-${value}`}
                            className={`ball ${selectedForDraw.has(value) ? 'ball-hit' : 'ball-drawn'}`}
                          >
                            {value}
                          </span>
                        ))
                      ) : (
                        <span className="text-muted">Not drawn yet.</span>
                      )}
                    </div>
                  </article>
                );
            })}
          </div>
        )}
      </section>
      )}

      {activeTab === 'tickets' && (
      <section className="card" role="tabpanel" aria-label="Your Tickets">
        <div className="section-header">
          <div>
            <div className="section-title">Your Tickets</div>
            <p className="section-copy">Recent Keno bets and results.</p>
          </div>
        </div>
        {tickets.length === 0 ? (
          <div className="card-muted">No tickets yet. Use Active Game to buy your first ticket.</div>
        ) : (
          <div className="list-stack">
            {tickets.map((ticket) => {
              const settled = ticket.settlementStatus === 'settled';
              const won = ticket.payoutMinor > 0;
              const ticketDraw = draws.find((draw) => draw.id === ticket.drawId);
              const ticketDrawnNumbers = ticketDraw?.drawnNumbers ?? [];
              return (
                <article key={ticket.id} className="list-card">
                  <div className="list-card-header">
                    <div>
                      <h3>Ticket #{ticket.id.slice(-6)}</h3>
                      <div className="keno-ticket-numbers">
                        {ticket.selectedNumbers.map((n) => (
                          <span
                            key={n}
                            className={`keno-number-pip${settled && ticketDrawnNumbers.includes(n) ? ' hit' : ''}`}
                          >
                            {n}
                          </span>
                        ))}
                      </div>
                    </div>
                    <span className={`badge ${won ? 'badge-green' : settled ? 'badge-red' : 'badge-gold'}`}>
                      {won ? 'Win' : settled ? 'No win' : 'Pending'}
                    </span>
                  </div>
                  <div className="ticket-meta">
                    <span>Stake: {formatCredits(ticket.stakeMinor)}</span>
                    {settled && <span>Matches: {ticket.matches}</span>}
                    {settled && won && <span style={{ color: 'var(--green)' }}>Payout: {formatCreditsFull(ticket.payoutMinor)}</span>}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
      )}
    </div>
  );
}
