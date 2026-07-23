import { useEffect, useRef } from 'react';
import { getSocket } from './useSocketConnection';
import { useStore } from '../store/useStore';
import type { WerkRoundView, WerkSnapshot, WerkInputMsg } from '../lib/werkApi';

interface Handlers {
  onRoundState?: (v: WerkRoundView) => void;
  onSnapshot?: (s: WerkSnapshot) => void;
  onCompleted?: (v: WerkRoundView) => void;
}

/** Send the local player's per-tick input to the authoritative round (fire-and-forget). */
export function sendWerkInput(msg: WerkInputMsg): void {
  getSocket()?.emit('werk.input', msg);
}

/**
 * Subscribe to the shared Werk round: join the lobby room (+ a specific round's
 * room once known) and receive round-state transitions and the high-frequency
 * authoritative snapshots. The server owns the clock/positions/coins, so nothing
 * here needs a local timer.
 */
export function useWerkSocket(roundId: string | null, handlers: Handlers) {
  const ref = useRef(handlers);
  useEffect(() => { ref.current = handlers; });
  const connected = useStore((s) => s.isSocketConnected);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const join = () => socket.emit('werk.join', roundId ? { roundId } : {});
    const onState = (v: WerkRoundView) => ref.current.onRoundState?.(v);
    const onSnap = (s: WerkSnapshot) => ref.current.onSnapshot?.(s);
    const onDone = (v: WerkRoundView) => ref.current.onCompleted?.(v);

    join();
    socket.on('werk.round.state', onState);
    socket.on('werk.snapshot', onSnap);
    socket.on('werk.round.completed', onDone);
    // Re-join rooms after a reconnect (socket.io drops room membership).
    socket.on('connect', join);

    return () => {
      if (roundId) socket.emit('werk.leave', { roundId });
      socket.off('werk.round.state', onState);
      socket.off('werk.snapshot', onSnap);
      socket.off('werk.round.completed', onDone);
      socket.off('connect', join);
    };
  }, [roundId, connected]);
}
