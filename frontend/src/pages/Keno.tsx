import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { kenoApi, walletApi } from '../lib/api';
import type { KenoConfig, KenoDraw, KenoTicket } from '../lib/models';
import {
  createIdempotencyKey,
  formatCreditsFull,
  formatDateTime,
  formatRelativeTime,
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

type KenoDrawCompletedPayload = {
  drawId?: string;
  drawnNumbers?: number[];
};

const DRAW_STATUS_BADGE: Record<string, string> = {
  settled: 'badge-green',
  cancelled: 'badge-red',
  pending: 'badge-violet',
};

export function Keno() {
  const addToast = useStore((state) => state.addToast);
  const setWallet = useStore((state) => state.setWallet);
  const [config, setConfig] = useState<KenoConfig | null>(null);
  const [draws, setDraws] = useState<KenoDraw[]>([]);
  const [tickets, setTickets] = useState<KenoTicket[]>([]);
  const [activeDraw, setActiveDraw] = useState<KenoDraw | null>(null);
  const [selectedNumbers, setSelectedNumbers] = useState<number[]>([]);
  const [spotTarget, setSpotTarget] = useState(4);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [animatingDrawId, setAnimatingDrawId] = useState<string | null>(null);
  const [revealedNumbers, setRevealedNumbers] = useState<number[]>([]);

  const scheduledAt = activeDraw?.status === 'open' ? activeDraw.scheduledAt : null;
  const { display: countdown, urgent: countdownUrgent, expired: countdownExpired } = useCountdown(scheduledAt);

  const allowedSpots = config?.allowedSpots?.length ? config.allowedSpots : DEFAULT_ALLOWED_SPOTS;
  const numbers = useMemo(() => {
    const min = config?.numberMin ?? 1;
    const max = config?.numberMax ?? 80;
    return Array.from({ length: max - min + 1 }, (_, index) => min + index);
  }, [config]);
  const latestDraw = draws[0];

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
        const userHasTicket = tickets.some((t) => t.drawId === payload.drawId);
        setAnimatingDrawId(payload.drawId ?? null);
        setRevealedNumbers([]);

        drawn.forEach((num: number, idx: number) => {
          setTimeout(() => {
            if (userHasTicket) soundEngine.pop();
            setRevealedNumbers((prev) => [...prev, num]);
          }, idx * 500);
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

  // Poll every 5 s while the draw is overdue (countdown expired but scheduler hasn't fired yet)
  useEffect(() => {
    if (!countdownExpired || !activeDraw || activeDraw.status !== 'open') return;
    const id = setInterval(async () => {
      try {
        const next = await kenoApi.getActiveDraw();
        if (!next || next.id !== activeDraw.id) {
          setActiveDraw(next);
        }
      } catch { /* ignore */ }
    }, 5000);
    return () => clearInterval(id);
  }, [countdownExpired, activeDraw]);

  // Check all tickets for a win after a draw completes
  useEffect(() => {
    if (!animatingDrawId || tickets.length === 0) return;
    const hasWin = tickets.some(
      (t) => t.payoutMinor > 0 && t.drawId === animatingDrawId
    );
    if (hasWin) {
      soundEngine.win();
      confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 }, colors: ['#FFE600', '#00FF00', '#FF00FF'] });
      setAnimatingDrawId(null);
    }
  }, [tickets, animatingDrawId]);

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
      addToast('success', 'Keno ticket purchased.');
    } catch (error) {
      addToast('error', getErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="stack-lg">
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
              <strong>{config.autoScheduleIntervalMinutes > 0 ? `${config.autoScheduleIntervalMinutes}m` : 'Manual'}</strong>
            </div>
          </div>
        ) : (
          <div className="card-muted">Loading Keno configuration...</div>
        )}
      </section>

      {/* ── Countdown ── */}
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
        <div className="section-header">
          <div>
            <div className="section-title">Build Your Ticket</div>
            <p className="section-copy">
              {selectedNumbers.length === spotTarget
                ? `${spotTarget} numbers selected — ready to buy!`
                : `Select ${spotTarget - selectedNumbers.length} more number${spotTarget - selectedNumbers.length === 1 ? '' : 's'}.`}
            </p>
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

        <div className="selected-strip">
          {selectedNumbers.length > 0 ? (
            selectedNumbers.map((value) => (
              <span key={value} className="ball ball-selected">{value}</span>
            ))
          ) : (
            <span className="text-muted">Tap numbers below to select them.</span>
          )}
        </div>

        <div className="number-grid">
          {numbers.map((value) => {
            const isSelected = selectedNumbers.includes(value);
            const isDrawn = animatingDrawId === latestDraw?.id
              ? revealedNumbers.includes(value)
              : latestDraw?.drawnNumbers.includes(value) ?? false;
            const tone = isSelected ? 'ball-selected' : isDrawn ? 'ball-drawn' : 'ball-idle';
            return (
              <button key={value} className={`ball ${tone}`} onClick={() => toggleNumber(value)}>
                {value}
              </button>
            );
          })}
        </div>

        <div className="action-row">
          <button className="btn btn-secondary" onClick={() => setSelectedNumbers([])}>
            Clear
          </button>
          <button className="btn btn-primary" disabled={submitting || selectedNumbers.length !== spotTarget} onClick={submitTicket}>
            {submitting ? 'Buying...' : `Buy for ${formatCredits(config?.ticketPriceMinor ?? 0)}`}
          </button>
        </div>
      </section>

      <section className="card">
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
            {draws.map((draw) => (
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
                <div className="ball-row">
                  {draw.drawnNumbers.length > 0 ? (
                    draw.drawnNumbers.map((value) => (
                      <span key={`${draw.id}-${value}`} className="ball ball-drawn">{value}</span>
                    ))
                  ) : (
                    <span className="text-muted">Not drawn yet.</span>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="card">
        <div className="section-header">
          <div>
            <div className="section-title">Your Tickets</div>
            <p className="section-copy">Recent Keno bets and results.</p>
          </div>
        </div>
        {tickets.length === 0 ? (
          <div className="card-muted">No tickets yet. Buy your first ticket above.</div>
        ) : (
          <div className="list-stack">
            {tickets.map((ticket) => {
              const settled = ticket.settlementStatus === 'settled';
              const won = ticket.payoutMinor > 0;
              return (
                <article key={ticket.id} className="list-card">
                  <div className="list-card-header">
                    <div>
                      <h3>Ticket #{ticket.id.slice(-6)}</h3>
                      <div className="keno-ticket-numbers">
                        {ticket.selectedNumbers.map((n) => (
                          <span
                            key={n}
                            className={`keno-number-pip${settled && latestDraw?.drawnNumbers.includes(n) ? ' hit' : ''}`}
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
    </div>
  );
}
