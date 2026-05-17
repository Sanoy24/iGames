import { useCallback, useEffect, useMemo, useState } from 'react';
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

const DEFAULT_ALLOWED_SPOTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

export function Keno() {
  const addToast = useStore((state) => state.addToast);
  const setWallet = useStore((state) => state.setWallet);
  const [config, setConfig] = useState<KenoConfig | null>(null);
  const [draws, setDraws] = useState<KenoDraw[]>([]);
  const [tickets, setTickets] = useState<KenoTicket[]>([]);
  const [selectedNumbers, setSelectedNumbers] = useState<number[]>([]);
  const [spotTarget, setSpotTarget] = useState(4);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [animatingDrawId, setAnimatingDrawId] = useState<string | null>(null);
  const [revealedNumbers, setRevealedNumbers] = useState<number[]>([]);

  const allowedSpots = config?.allowedSpots?.length ? config.allowedSpots : DEFAULT_ALLOWED_SPOTS;
  const numbers = useMemo(() => {
    const min = config?.numberMin ?? 1;
    const max = config?.numberMax ?? 80;
    return Array.from({ length: max - min + 1 }, (_, index) => min + index);
  }, [config]);
  const latestDraw = draws[0];

  const loadKeno = useCallback(async () => {
    try {
      const [nextConfig, nextDraws, nextTickets] = await Promise.all([
        kenoApi.getConfig(),
        kenoApi.listDraws(8),
        kenoApi.listTickets(12),
      ]);
      setConfig(nextConfig);
      setDraws(nextDraws);
      setTickets(nextTickets);
      setSpotTarget((current) => {
        if (nextConfig.allowedSpots.includes(current)) {
          return current;
        }
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
      const handleDrawCompleted = (payload: any) => {
        const drawn: number[] = payload.drawnNumbers || [];
        setAnimatingDrawId(payload.drawId);
        setRevealedNumbers([]);
        
        // Staggered reveal animation
        drawn.forEach((num: number, idx: number) => {
          setTimeout(() => {
            soundEngine.pop();
            setRevealedNumbers((prev) => [...prev, num]);
          }, idx * 500); // Reveal one ball every 500ms
        });

        // Trigger confetti if they won in this draw
        // We will check the tickets after loadKeno resolves, or we can just rely on the updated state.
        void loadKeno().then(() => {
          // It's a bit tricky to see if they won from just the payload, but loadKeno will update tickets.
          // We'll check the tickets effect below for confetti.
        });
        
        addToast('info', `Draw ${payload.drawId?.slice(-6) || 'completed'} settled.`);
      };
      
      socket.on('keno.draw.completed', handleDrawCompleted);
      
      return () => {
        socket.off('keno.draw.completed', handleDrawCompleted);
      };
    }
  }, [loadKeno, addToast]);

  // Check for wins to trigger confetti
  useEffect(() => {
    if (tickets.length > 0) {
      const latestTicket = tickets[0];
      // Only trigger confetti if the ticket belongs to the draw that just finished, and it won
      if (
        latestTicket.payoutMinor > 0 &&
        animatingDrawId &&
        latestTicket.drawId === animatingDrawId
      ) {
        soundEngine.win();
        confetti({
          particleCount: 150,
          spread: 70,
          origin: { y: 0.6 },
          colors: ['#FFE600', '#00FF00', '#FF00FF']
        });
        // Clear animating draw ID to prevent re-firing
        setAnimatingDrawId(null);
      }
    }
  }, [tickets, animatingDrawId]);

  useEffect(() => {
    setSelectedNumbers((current) => current.slice(0, spotTarget));
  }, [spotTarget]);

  const toggleNumber = (value: number) => {
    soundEngine.click();
    setSelectedNumbers((current) => {
      if (current.includes(value)) {
        return current.filter((item) => item !== value);
      }
      if (current.length >= spotTarget) {
        return current;
      }
      return [...current, value].sort((left, right) => left - right);
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
          <button className="btn btn-ghost btn-sm" onClick={() => void loadKeno()}>
            Refresh
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
              <span className="stat-label">Latest Draw</span>
              <strong>{latestDraw ? formatRelativeTime(latestDraw.scheduledAt) : 'Waiting'}</strong>
            </div>
          </div>
        ) : (
          <div className="card-muted">Loading Keno configuration...</div>
        )}
      </section>

      <section className="card">
        <div className="section-header">
          <div>
            <div className="section-title">Build Your Ticket</div>
            <p className="section-copy">Selected {selectedNumbers.length} of {spotTarget} spots.</p>
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
              <span key={value} className="ball ball-selected">
                {value}
              </span>
            ))
          ) : (
            <span className="text-muted">No numbers selected yet.</span>
          )}
        </div>

        <div className="number-grid">
          {numbers.map((value) => {
            const isSelected = selectedNumbers.includes(value);
            let isDrawn = false;
            
            if (animatingDrawId === latestDraw?.id) {
              isDrawn = revealedNumbers.includes(value);
            } else {
              isDrawn = latestDraw?.drawnNumbers.includes(value) ?? false;
            }
            
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
          <button className="btn btn-primary" disabled={submitting} onClick={submitTicket}>
            {submitting ? 'Buying...' : `Buy for ${formatCredits(config?.ticketPriceMinor ?? 0)}`}
          </button>
        </div>
      </section>

      <section className="card">
        <div className="section-header">
          <div>
            <div className="section-title">Latest Draws</div>
            <p className="section-copy">Recent Keno rounds and their settled numbers.</p>
          </div>
        </div>
        {loading && draws.length === 0 ? (
          <div className="card-muted">Fetching draw history...</div>
        ) : (
          <div className="list-stack">
            {draws.slice(0, 4).map((draw) => (
              <article key={draw.id} className="list-card">
                <div className="list-card-header">
                  <div>
                    <h3>Draw {draw.id.slice(-6)}</h3>
                    <p>{formatDateTime(draw.scheduledAt)}</p>
                  </div>
                  <span className="badge badge-violet">{draw.status}</span>
                </div>
                <div className="ball-row">
                  {draw.drawnNumbers.length > 0 ? (
                    draw.drawnNumbers.map((value) => (
                      <span key={`${draw.id}-${value}`} className="ball ball-drawn">
                        {value}
                      </span>
                    ))
                  ) : (
                    <span className="text-muted">Draw not settled yet.</span>
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
            <p className="section-copy">Recent Keno bets and settlement results.</p>
          </div>
        </div>
        {tickets.length === 0 ? (
          <div className="card-muted">No tickets yet. Your first ticket will show up here.</div>
        ) : (
          <div className="list-stack">
            {tickets.map((ticket) => (
              <article key={ticket.id} className="list-card">
                <div className="list-card-header">
                  <div>
                    <h3>Ticket {ticket.id.slice(-6)}</h3>
                    <p>{ticket.selectedNumbers.join(', ')}</p>
                  </div>
                  <span className={`badge ${ticket.payoutMinor > 0 ? 'badge-green' : 'badge-gold'}`}>
                    {ticket.payoutMinor > 0 ? 'Winner' : ticket.settlementStatus}
                  </span>
                </div>
                <div className="ticket-meta">
                  <span>Stake: {formatCredits(ticket.stakeMinor)}</span>
                  <span>Matches: {ticket.matches}</span>
                  <span>Payout: {formatCreditsFull(ticket.payoutMinor)}</span>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
