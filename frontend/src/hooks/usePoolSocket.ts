import { useEffect, useRef } from 'react';
import { getSocket } from './useSocketConnection';
import { useStore } from '../store/useStore';
import type { PoolMatchView, Seat } from '../lib/poolApi';
import type { ShotInput } from '@pool-engine';

export interface PoolShotResolvedEvent {
  matchId: string;
  seat: Seat;
  input: ShotInput;
  pocketed: number[];
  fouls: string[];
  reason: string;
  turnPassed: boolean;
  gameOver: boolean;
  winnerSeat: Seat | null;
  board: unknown;
  turn: Seat;
}

export interface PoolMatchEndedEvent {
  matchId: string;
  winnerSeat?: Seat | null;
  reason?: string;
  aborted?: boolean;
}

interface Handlers {
  onMatchUpdated?: (view: PoolMatchView) => void;
  onShotResolved?: (e: PoolShotResolvedEvent) => void;
  onMatchEnded?: (e: PoolMatchEndedEvent) => void;
}

/**
 * Subscribe to a single match's live events and join its broadcast room. The
 * shots stream in over the socket while the board state stays authoritative via
 * `pool.match.updated`.
 */
export function usePoolMatchSocket(matchId: string | null, handlers: Handlers) {
  const ref = useRef(handlers);
  useEffect(() => {
    ref.current = handlers;
  });
  const connected = useStore((s) => s.isSocketConnected);

  useEffect(() => {
    if (!matchId) return;
    const socket = getSocket();
    if (!socket) return;

    const onUpdated = (view: PoolMatchView) => {
      if (view.id === matchId) ref.current.onMatchUpdated?.(view);
    };
    const onShot = (e: PoolShotResolvedEvent) => {
      if (e.matchId === matchId) ref.current.onShotResolved?.(e);
    };
    const onEnded = (e: PoolMatchEndedEvent) => {
      if (e.matchId === matchId) ref.current.onMatchEnded?.(e);
    };

    socket.emit('pool.join', { matchId });
    socket.on('pool.match.updated', onUpdated);
    socket.on('pool.shot.resolved', onShot);
    socket.on('pool.match.ended', onEnded);
    // Re-join the room after a reconnect (socket drops room membership).
    const onConnect = () => socket.emit('pool.join', { matchId });
    socket.on('connect', onConnect);

    return () => {
      socket.emit('pool.leave', { matchId });
      socket.off('pool.match.updated', onUpdated);
      socket.off('pool.shot.resolved', onShot);
      socket.off('pool.match.ended', onEnded);
      socket.off('connect', onConnect);
    };
  }, [matchId, connected]);
}

/** Fires when matchmaking pairs you into a match (from anywhere in the app). */
export function usePoolMatchFound(onFound: (view: PoolMatchView) => void) {
  const ref = useRef(onFound);
  useEffect(() => {
    ref.current = onFound;
  });
  const connected = useStore((s) => s.isSocketConnected);
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const handler = (view: PoolMatchView) => ref.current(view);
    socket.on('pool.match.found', handler);
    return () => {
      socket.off('pool.match.found', handler);
    };
  }, [connected]);
}
