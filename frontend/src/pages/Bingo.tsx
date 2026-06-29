import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeft, Hash, Trophy, Sparkles,
  Volume2, VolumeX, Users, MessageSquare, RefreshCw,
} from 'lucide-react';
import { bingoApi, walletApi } from '../lib/api';
import type { BingoRoomState, BingoTicket } from '../lib/models';
import { createIdempotencyKey, formatCreditsFull, getErrorMessage, titleCase } from '../lib/utils';
import { formatCredits, useStore } from '../store/useStore';
import { getSocket } from '../hooks/useSocketConnection';
import { soundEngine } from '../lib/audio';
import confetti from 'canvas-confetti';

// ─── Types ────────────────────────────────────────────────────────────────────

type Phase = 'loading' | 'buy' | 'playing' | 'result';
type ChatMessage = { userId?: string; displayName: string; text: string; timestamp: string; isSystem?: boolean };
type BingoProps = { onBack: () => void };

const BINGO_COLS = ['B', 'I', 'N', 'G', 'O'];
// How long the completed-room result stays on screen before auto-advancing to
// the next room. Mirrors the backend resultDisplaySeconds default.
const RESULT_DISPLAY_MS = 10_000;
// Light fallback poll so room transitions are caught even if a socket event is missed.
const POLL_INTERVAL_MS = 5_000;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isPatternGrid(grid: Array<Array<number | null>>): boolean {
  return grid.length === 5 && (grid[0]?.length ?? 0) === 5;
}

// ─── NumberBoard ─────────────────────────────────────────────────────────────

const NumberBoard = memo(({ drawnNumbers, numberRange }: { drawnNumbers: number[]; numberRange: number }) => (
  <div className="space-y-1">
    <div className="grid grid-cols-10 gap-1">
      {Array.from({ length: numberRange }, (_, i) => i + 1).map((val) => {
        const called = drawnNumbers.includes(val);
        return (
          <motion.span
            key={val}
            animate={called ? { scale: [1, 1.3, 1.05], backgroundColor: '#dc2626' } : {}}
            transition={{ duration: 0.4, ease: 'backOut' }}
            className={`aspect-square rounded flex items-center justify-center text-[9px] font-bold font-mono ${
              called
                ? 'bg-red-600 border border-red-400/50 text-white'
                : 'bg-white/[0.03] border border-white/[0.05] text-slate-600'
            }`}
          >
            {val}
          </motion.span>
        );
      })}
    </div>
  </div>
));
NumberBoard.displayName = 'NumberBoard';

// ─── Ticket Cards ─────────────────────────────────────────────────────────────

const PatternTicketCard = memo(({ ticket, patternPrizeMap }: {
  ticket: BingoTicket; patternPrizeMap: Map<string, string>;
}) => {
  const won = ticket.payoutMinor > 0;
  const grid = ticket.grid as Array<Array<number | null>>;
  return (
    <motion.article
      layout initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }}
      className={`rounded-xl border p-3 flex flex-col gap-2 ${
        won
          ? 'bg-gradient-to-br from-amber-950/30 to-black/40 border-amber-500/30 shadow-[0_0_16px_rgba(245,158,11,0.1)]'
          : 'bg-white/[0.025] border-white/[0.06]'
      }`}
    >
      <div className="flex justify-between items-center">
        <span className="text-[10px] font-black text-slate-400">#{ticket.id.slice(-5)}</span>
        <span className={`badge ${won ? 'badge-gold' : 'badge-violet'}`}>
          {won ? `+${formatCredits(ticket.payoutMinor)} Cr` : ticket.settlementStatus}
        </span>
      </div>
      {ticket.completedPatterns?.length > 0 && (
        <p className="text-[9px] text-amber-400 font-bold -mt-1">
          {ticket.completedPatterns.map((pid) => patternPrizeMap.get(pid) ?? 'Pattern').join(' · ')}
        </p>
      )}
      <div className="grid grid-cols-5 gap-0.5">
        {BINGO_COLS.map((col) => (
          <div key={col} className="text-center text-[9px] font-black text-red-400">{col}</div>
        ))}
      </div>
      <div className="grid grid-cols-5 gap-0.5">
        {grid.map((row, ri) =>
          row.map((value, ci) => {
            const isFree = value === null;
            const isMarked = isFree || ticket.markedNumbers.includes(value!);
            return (
              <motion.span
                key={`${ticket.id}-${ri}-${ci}`}
                animate={isMarked && !isFree ? { backgroundColor: '#ef4444', color: '#ffffff' } : {}}
                transition={{ duration: 0.3, ease: 'backOut' }}
                className={`aspect-square rounded flex items-center justify-center text-[9px] font-bold font-mono ${
                  isFree ? 'bg-red-600/25 border border-red-500/30 text-red-400 text-[7px]'
                    : isMarked ? 'bg-red-600 border border-red-400/60 text-white'
                    : 'bg-white/[0.04] border border-white/[0.06] text-slate-400'
                }`}
              >
                {isFree ? 'FREE' : value}
              </motion.span>
            );
          })
        )}
      </div>
    </motion.article>
  );
});
PatternTicketCard.displayName = 'PatternTicketCard';

const BingoTicketCard = memo(({ ticket, patternPrizeMap }: {
  ticket: BingoTicket; patternPrizeMap: Map<string, string>;
}) => {
  if (isPatternGrid(ticket.grid)) {
    return <PatternTicketCard ticket={ticket} patternPrizeMap={patternPrizeMap} />;
  }
  const won = ticket.payoutMinor > 0;
  return (
    <motion.article
      layout initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }}
      className={`rounded-xl border p-3 flex flex-col gap-2 ${
        won
          ? 'bg-gradient-to-br from-amber-950/30 to-black/40 border-amber-500/30'
          : 'bg-white/[0.025] border-white/[0.06]'
      }`}
    >
      <div className="flex justify-between items-center">
        <span className="text-[10px] font-black text-slate-400">#{ticket.id.slice(-5)}</span>
        <span className={`badge ${won ? 'badge-gold' : 'badge-violet'}`}>
          {won ? `+${formatCredits(ticket.payoutMinor)} Cr` : ticket.settlementStatus}
        </span>
      </div>
      {ticket.wonTiers.length > 0 && (
        <p className="text-[9px] text-amber-400 font-bold -mt-1">{ticket.wonTiers.map(titleCase).join(' · ')}</p>
      )}
      <div className="space-y-0.5">
        {ticket.grid.map((row, ri) => {
          const isRowComplete = ticket.completedLines.includes(ri);
          return (
            <div
              key={`${ticket.id}-r${ri}`}
              className={`grid grid-cols-9 gap-0.5 rounded p-0.5 transition-colors duration-200 ${
                isRowComplete ? 'border border-amber-400/40 bg-amber-500/5' : ''
              }`}
            >
              {row.map((value, ci) =>
                value ? (
                  <motion.span
                    key={`${ticket.id}-r${ri}-c${ci}`}
                    animate={ticket.markedNumbers.includes(value) ? { backgroundColor: '#f59e0b', color: '#000' } : {}}
                    transition={{ duration: 0.3, ease: 'backOut' }}
                    className={`aspect-square rounded flex items-center justify-center text-[9px] font-bold font-mono ${
                      ticket.markedNumbers.includes(value)
                        ? 'bg-[var(--gold)] text-black'
                        : 'bg-white/[0.04] border border-white/[0.06] text-slate-400'
                    }`}
                  >
                    {value}
                  </motion.span>
                ) : (
                  <span key={`${ticket.id}-r${ri}-c${ci}`} className="aspect-square bg-black/20 rounded border border-white/[0.03]" />
                )
              )}
            </div>
          );
        })}
      </div>
      <div className="flex justify-between text-[9px] text-slate-600 pt-1 border-t border-white/[0.05]">
        <span>Stake {formatCredits(ticket.stakeMinor)} Cr</span>
        <span>{ticket.completedLines.length}/3 lines</span>
      </div>
    </motion.article>
  );
});
BingoTicketCard.displayName = 'BingoTicketCard';

// ─── Victory Overlay ──────────────────────────────────────────────────────────

function VictoryOverlay({ tickets, room, onClose }: {
  tickets: BingoTicket[]; room: BingoRoomState | null; onClose: () => void;
}) {
  const totalWin = tickets.reduce((s, t) => s + t.payoutMinor, 0);
  let topLabel = 'You Won!';
  if (room?.winMode === 'pattern') {
    const pm = new Map((room.patternPrizes ?? []).map((pp) => [pp.patternId, pp.name]));
    const names = [...new Set(tickets.flatMap((t) => t.completedPatterns ?? []))].map((pid) => pm.get(pid)).filter(Boolean);
    topLabel = names.length > 0 ? names.join(' & ') + '!' : 'Pattern Win!';
  } else {
    topLabel = tickets.some((t) => t.wonTiers.includes('full_house')) ? 'Full House!'
      : tickets.some((t) => t.wonTiers.includes('two_lines')) ? 'Two Lines!' : 'Line Win!';
  }
  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm"
    >
      <motion.div
        initial={{ scale: 0.7, rotate: -6 }}
        animate={{ scale: 1, rotate: 0 }}
        exit={{ scale: 0.8, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 280, damping: 18 }}
        className="relative max-w-sm w-full mx-4 rounded-3xl border-2 border-amber-500/50 p-8 text-center overflow-hidden"
        style={{ background: 'linear-gradient(135deg, #1a0a00 0%, #0d0505 50%, #080814 100%)' }}
      >
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: 'radial-gradient(ellipse at 50% 10%, rgba(245,158,11,0.15) 0%, transparent 60%)' }} />
        <motion.div animate={{ rotate: [0, 10, -10, 0], scale: [1, 1.1, 1] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }} className="relative z-10 mb-4 inline-block">
          <Trophy size={60} className="text-amber-400" style={{ filter: 'drop-shadow(0 0 14px rgba(245,158,11,0.7))' }} />
        </motion.div>
        <h2 className="relative z-10 text-3xl font-black text-amber-400 mb-2">{topLabel}</h2>
        <div className="relative z-10 inline-block bg-amber-500/10 border border-amber-500/30 rounded-2xl px-6 py-3 mb-6">
          <span className="block text-[9px] font-black uppercase tracking-widest text-amber-600 mb-0.5">Total Prize</span>
          <span className="text-3xl font-black text-amber-400 font-mono">+{formatCreditsFull(totalWin)}</span>
        </div>
        <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.96 }}
          onClick={onClose} className="relative z-10 btn btn-primary btn-full">
          Claim &amp; Continue
        </motion.button>
      </motion.div>
    </motion.div>
  );
}

// ─── Draw Machine (compact) ───────────────────────────────────────────────────

function DrawBall({ number, count, max, status }: {
  number: number | null; count: number; max: number; status: string;
}) {
  if (status === 'completed') {
    return (
      <div className="flex flex-col items-center gap-1">
        <Trophy size={28} className="text-amber-400" />
        <span className="text-[9px] font-black text-amber-500 uppercase tracking-wider">Complete</span>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center gap-1.5">
      <AnimatePresence mode="popLayout">
        {number !== null ? (
          <motion.div
            key={number}
            initial={{ scale: 0.3, rotate: -270, opacity: 0 }}
            animate={{ scale: 1, rotate: 0, opacity: 1 }}
            exit={{ scale: 0.6, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 240, damping: 16 }}
            className="w-14 h-14 rounded-full bg-gradient-to-br from-red-600 to-rose-700 border-2 border-red-400 flex items-center justify-center shadow-[0_0_18px_rgba(239,68,68,0.5)]"
          >
            <span className="text-xl font-black text-white font-mono">{number}</span>
          </motion.div>
        ) : (
          <motion.div key="waiting"
            animate={{ opacity: [0.4, 1, 0.4] }} transition={{ duration: 1.4, repeat: Infinity }}
            className="w-14 h-14 rounded-full border-2 border-dashed border-red-500/30 flex items-center justify-center"
          >
            <span className="text-[9px] font-black text-red-400 uppercase">{status === 'open' ? 'Open' : '...'}</span>
          </motion.div>
        )}
      </AnimatePresence>
      {count > 0 && (
        <span className="text-[9px] font-bold text-slate-400">#{count} of {max}</span>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function Bingo({ onBack }: BingoProps) {
  const addToast          = useStore((s) => s.addToast);
  const setWallet         = useStore((s) => s.setWallet);
  const liveCounts        = useStore((s) => s.liveCounts);
  const soundVolume       = useStore((s) => s.soundVolume);
  const soundMuted        = useStore((s) => s.soundMuted);
  const setSoundVolume    = useStore((s) => s.setSoundVolume);
  const setSoundMuted     = useStore((s) => s.setSoundMuted);
  const currentUser       = useStore((s) => s.user);
  const isSocketConnected = useStore((s) => s.isSocketConnected);

  // ── Core state ──────────────────────────────────────────────────────────────
  const [room, setRoom]                   = useState<BingoRoomState | null>(null);
  const [loading, setLoading]             = useState(true);
  const [holdingResult, setHoldingResult] = useState(false);

  // ── Buy state ───────────────────────────────────────────────────────────────
  const [ticketCount, setTicketCount]     = useState(1);
  const [buying, setBuying]               = useState(false);

  // ── Playing / result state ─────────────────────────────────────────────────
  const [showVictory, setShowVictory]     = useState(false);
  const [victoryTickets, setVictoryTickets] = useState<BingoTicket[]>([]);
  const [showBoard, setShowBoard]         = useState(true);

  // ── Countdown ───────────────────────────────────────────────────────────────
  const [timeRemainingSecs, setTimeRemainingSecs] = useState<number | null>(null);
  const [resultSecs, setResultSecs]       = useState<number>(0);

  // ── Refs ────────────────────────────────────────────────────────────────────
  const roomIdRef          = useRef<string | null>(null);
  const holdingResultRef   = useRef(false);
  const victoryRoomRef     = useRef<string | null>(null);
  const reconcileTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resultTimerRef     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownRef       = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Chat ────────────────────────────────────────────────────────────────────
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    { displayName: 'System', text: 'Welcome to iGames Bingo!', timestamp: new Date().toISOString(), isSystem: true },
  ]);
  const [chatInput, setChatInput] = useState('');
  const [showChat, setShowChat]   = useState(false);
  const chatEndRef                = useRef<HTMLDivElement>(null);
  const chatInputRef              = useRef<HTMLInputElement>(null);

  // ── Load the single active room ─────────────────────────────────────────────

  const loadCurrent = useCallback(async () => {
    try {
      const next = await bingoApi.getCurrentRoom();
      setRoom(next);
      roomIdRef.current = next?.id ?? null;
    } catch (err) {
      addToast('error', getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  // Initial load + light fallback poll. While the result is being held we skip
  // re-fetching so we don't jump to the next room before the 10s window ends.
  useEffect(() => {
    void loadCurrent();
    const id = setInterval(() => {
      if (!holdingResultRef.current) void loadCurrent();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [loadCurrent]);

  // ── Socket: presence (online count) ─────────────────────────────────────────
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    socket.emit('enter.game', { game: 'bingo' });
    return () => { socket.emit('leave.game', { game: 'bingo' }); };
  }, [isSocketConnected]);

  // ── Socket: live room events ────────────────────────────────────────────────
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const scheduleReconcile = () => {
      if (reconcileTimerRef.current) clearTimeout(reconcileTimerRef.current);
      // Debounce: after the burst of balls settles, do one authoritative reload
      // to sync completedLines / winners that we can't derive optimistically.
      reconcileTimerRef.current = setTimeout(() => {
        if (!holdingResultRef.current) void loadCurrent();
      }, 1200);
    };

    const onNumberDrawn = (p: { roomId?: string; number?: number }) => {
      if (p.roomId !== roomIdRef.current || p.number === undefined) return;
      soundEngine.pop();
      const drawn = p.number;
      setRoom((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          status: prev.status === 'open' ? 'running' : prev.status,
          drawnNumbers: prev.drawnNumbers.includes(drawn) ? prev.drawnNumbers : [...prev.drawnNumbers, drawn],
          tickets: prev.tickets?.map((t) => {
            if (t.markedNumbers.includes(drawn)) return t;
            const isOnCard = t.grid.some((row) => row.some((cell) => cell === drawn));
            if (!isOnCard) return t;
            return { ...t, markedNumbers: [...t.markedNumbers, drawn] };
          }),
        };
      });
      scheduleReconcile();
    };

    const onRoomUpdate = (p: { roomId?: string }) => {
      // open→running transition, new-room creation, etc. Ignore while holding result.
      if (holdingResultRef.current) return;
      if (p.roomId === roomIdRef.current || roomIdRef.current === null) void loadCurrent();
    };

    const onRoomCompleted = (p: { roomId?: string }) => {
      if (p.roomId !== roomIdRef.current) return;
      void loadCurrent(); // pull settled tickets; the status effect starts the hold
    };

    const onChatMessage = (p: { roomId: string; userId?: string; displayName: string; text: string; timestamp: string }) => {
      if (p.roomId !== roomIdRef.current) return;
      setChatMessages((prev) => [...prev.slice(-49), { ...p }]);
    };

    socket.on('bingo.number.drawn', onNumberDrawn);
    socket.on('bingo.room.updated', onRoomUpdate);
    socket.on('bingo.room.completed', onRoomCompleted);
    socket.on('bingo.chat.message', onChatMessage);

    return () => {
      socket.off('bingo.number.drawn', onNumberDrawn);
      socket.off('bingo.room.updated', onRoomUpdate);
      socket.off('bingo.room.completed', onRoomCompleted);
      socket.off('bingo.chat.message', onChatMessage);
      if (reconcileTimerRef.current) clearTimeout(reconcileTimerRef.current);
    };
  }, [isSocketConnected, loadCurrent]);

  // ── Result hold: when a room completes, freeze on it for RESULT_DISPLAY_MS ──
  useEffect(() => {
    if (!room) return;
    const done = room.status === 'completed' || room.status === 'cancelled';
    if (!done) {
      holdingResultRef.current = false;
      setHoldingResult(false);
      return;
    }
    holdingResultRef.current = true;
    setHoldingResult(true);
    setResultSecs(Math.ceil(RESULT_DISPLAY_MS / 1000));

    if (resultTimerRef.current) clearTimeout(resultTimerRef.current);
    resultTimerRef.current = setTimeout(() => {
      holdingResultRef.current = false;
      setHoldingResult(false);
      void loadCurrent();
    }, RESULT_DISPLAY_MS);

    if (countdownRef.current) clearInterval(countdownRef.current);
    countdownRef.current = setInterval(() => {
      setResultSecs((s) => Math.max(0, s - 1));
    }, 1000);

    return () => {
      if (resultTimerRef.current) clearTimeout(resultTimerRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [room?.id, room?.status, loadCurrent]);

  // ── Buy-window countdown ────────────────────────────────────────────────────
  useEffect(() => {
    setTimeRemainingSecs(null);
    if (!room || room.status !== 'open') return;
    const tick = () => {
      const ms = new Date(room.scheduledStartAt).getTime() - Date.now();
      setTimeRemainingSecs(Math.max(0, Math.floor(ms / 1000)));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [room?.id, room?.status, room?.scheduledStartAt]);

  // ── Win detection ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (room?.status !== 'completed' || !room.tickets?.length) return;
    if (victoryRoomRef.current === room.id) return; // already celebrated this room
    const winners = room.tickets.filter((t) => t.payoutMinor > 0);
    if (!winners.length) return;
    victoryRoomRef.current = room.id;
    soundEngine.win();
    confetti({ particleCount: 200, spread: 90, origin: { y: 0.55 }, colors: ['#FFD700', '#FF4444', '#00FF88', '#FFFFFF'] });
    setVictoryTickets(winners);
    setShowVictory(true);
  }, [room?.status, room?.tickets, room?.id]);

  // ── Chat auto-scroll ────────────────────────────────────────────────────────
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chatMessages]);

  // ── Derived ─────────────────────────────────────────────────────────────────
  const phase: Phase = !room ? 'loading'
    : holdingResult ? 'result'
    : room.status === 'open' ? 'buy'
    : room.status === 'running' ? 'playing'
    : 'result';

  const patternPrizeMap = useMemo(
    () => new Map((room?.patternPrizes ?? []).map((pp) => [pp.patternId, pp.name])),
    [room],
  );
  const isPatternMode    = room?.winMode === 'pattern';
  const numberRange      = room?.numberRange ?? (isPatternMode ? 75 : 90);
  const drawnNumbers     = room?.drawnNumbers ?? [];
  const lastNumber       = drawnNumbers.length > 0 ? drawnNumbers[drawnNumbers.length - 1] : null;
  const remainingTickets = room ? Math.max(0, room.maxTickets - room.soldTickets) : 0;
  const myTickets        = room?.tickets ?? [];
  const salesOpen        = room?.status === 'open';

  // ── Actions ─────────────────────────────────────────────────────────────────
  const buyTickets = async () => {
    if (!room || !salesOpen) return;
    setBuying(true);
    try {
      await bingoApi.purchaseTickets(room.id, ticketCount, createIdempotencyKey('bingo'));
      const [nextWallet] = await Promise.all([walletApi.getWallet(), loadCurrent()]);
      setWallet(nextWallet);
      soundEngine.cashout();
      addToast('success', `Bought ${ticketCount} Bingo ticket${ticketCount > 1 ? 's' : ''}!`);
    } catch (err) {
      addToast('error', getErrorMessage(err));
    } finally {
      setBuying(false);
    }
  };

  const sendChat = useCallback(() => {
    const text = chatInput.trim();
    if (!text || !room) return;
    const socket = getSocket();
    if (!socket) return;
    socket.emit('bingo.chat.send', { roomId: room.id, text });
    setChatInput('');
    chatInputRef.current?.focus();
  }, [chatInput, room]);

  // ── RENDER ──────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4 max-w-3xl mx-auto pb-20">
      {/* Victory overlay */}
      <AnimatePresence>
        {showVictory && victoryTickets.length > 0 && (
          <VictoryOverlay
            tickets={victoryTickets}
            room={room}
            onClose={() => { soundEngine.click(); setShowVictory(false); }}
          />
        )}
      </AnimatePresence>

      {/* ── Top bar ── */}
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="btn btn-ghost btn-sm flex items-center gap-2">
          <ArrowLeft size={14} /> Home
        </button>

        <div className="flex items-center gap-2">
          {liveCounts && liveCounts.bingoOnline > 0 && (
            <span className="live-badge-pulse">
              <span className="pulse-dot" />
              {liveCounts.bingoOnline}
            </span>
          )}
          <button onClick={() => setSoundMuted(!soundMuted)} className="btn btn-ghost btn-sm icon-btn">
            {soundMuted ? <VolumeX size={15} /> : <Volume2 size={15} />}
          </button>
          {!soundMuted && (
            <input type="range" min="0" max="1" step="0.05" value={soundVolume}
              onChange={(e) => setSoundVolume(parseFloat(e.target.value))}
              className="w-16 accent-amber-500 cursor-pointer h-1 rounded" />
          )}
        </div>
      </div>

      {/* ── Loading / empty ── */}
      {phase === 'loading' && (
        <div className="centered-loader py-16"><div className="spinner" /></div>
      )}

      {!loading && !room && (
        <div className="card text-center py-12 space-y-2">
          <Sparkles size={28} className="mx-auto text-slate-600" />
          <p className="text-slate-400 text-sm">No Bingo game running right now.</p>
          <button onClick={() => void loadCurrent()} className="btn btn-secondary btn-sm mt-1">
            <RefreshCw size={12} /> Refresh
          </button>
        </div>
      )}

      {room && (
        <motion.div
          key={room.id}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 28 }}
          className="space-y-4"
        >
          {/* ── Draw header ── */}
          <div className="card">
            <div className="flex items-center gap-4">
              <DrawBall number={lastNumber} count={drawnNumbers.length} max={numberRange} status={room.status} />
              <div className="flex-1 min-w-0 space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-black text-sm text-slate-100">{room.name}</span>
                  <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded ${
                    room.status === 'open' ? 'bg-emerald-500/10 text-emerald-400' :
                    room.status === 'running' ? 'bg-red-500/10 text-red-400 animate-pulse' :
                    'bg-slate-700 text-slate-400'
                  }`}>{phase === 'buy' ? 'buy in' : room.status}</span>
                  {isPatternMode && (
                    <span className="text-[8px] font-black bg-violet-500/10 text-violet-400 px-1.5 py-0.5 rounded">PATTERN</span>
                  )}
                </div>

                {/* Buy-window countdown */}
                {phase === 'buy' && timeRemainingSecs !== null && (
                  <p className="text-[10px] text-slate-500">
                    Starts in{' '}
                    <span className={`font-mono font-black ${timeRemainingSecs <= 10 ? 'text-red-400' : 'text-amber-400'}`}>
                      {String(Math.floor(timeRemainingSecs / 60)).padStart(2, '0')}:{String(timeRemainingSecs % 60).padStart(2, '0')}
                    </span>
                  </p>
                )}

                {/* Recent balls */}
                {drawnNumbers.length > 0 && (
                  <div className="flex gap-1 flex-wrap">
                    {drawnNumbers.slice(-10).map((n, i, arr) => (
                      <motion.span
                        key={`${n}-${i}`}
                        initial={{ scale: 0, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        className={`w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-black ${
                          i === arr.length - 1
                            ? 'bg-red-600 border border-red-400/60 text-white'
                            : 'bg-white/[0.06] border border-white/[0.08] text-slate-400'
                        }`}
                      >
                        {n}
                      </motion.span>
                    ))}
                  </div>
                )}

                {phase === 'result' && (
                  <p className="text-[10px] font-bold text-emerald-400">
                    {room.settledTiers.length > 0
                      ? `${room.settledTiers.length} prize tier${room.settledTiers.length > 1 ? 's' : ''} settled`
                      : 'No winners this round'}
                    {resultSecs > 0 && <span className="text-slate-500"> · next game in {resultSecs}s</span>}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* ── Stats bar ── */}
          <div className="grid grid-cols-4 gap-2">
            {[
              { label: 'Derash', value: `${formatCredits(room.prizeMinor)} Cr`, color: 'text-amber-400' },
              { label: 'Players', value: String(room.soldTickets), color: 'text-slate-200' },
              { label: 'Stake', value: `${formatCredits(room.ticketPriceMinor)} Cr`, color: 'text-slate-200' },
              { label: 'Call', value: `${drawnNumbers.length}/${numberRange}`, color: 'text-red-400' },
            ].map((stat) => (
              <div key={stat.label} className="rounded-xl bg-white/[0.025] border border-white/[0.06] p-2 text-center">
                <span className="block text-[8px] font-bold uppercase tracking-wider text-slate-600 mb-0.5">{stat.label}</span>
                <span className={`text-[11px] font-black ${stat.color}`}>{stat.value}</span>
              </div>
            ))}
          </div>

          {/* ── Buy panel (only during buy window) ── */}
          {phase === 'buy' && (
            <div className="card space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">How many cards?</p>
                <span className="text-[10px] text-slate-500">{remainingTickets} left</span>
              </div>
              <div className="flex gap-2">
                {[1, 2, 3, 5].map((n) => (
                  <motion.button
                    key={n}
                    whileTap={{ scale: 0.9 }}
                    onClick={() => setTicketCount(n)}
                    disabled={n > Math.min(24, remainingTickets)}
                    className={`flex-1 py-2 rounded-xl font-black text-sm border transition-all ${
                      ticketCount === n
                        ? 'bg-amber-500/15 border-amber-500/40 text-amber-400'
                        : n > Math.min(24, remainingTickets)
                          ? 'bg-white/[0.01] border-white/[0.04] text-slate-700 cursor-not-allowed'
                          : 'bg-white/[0.04] border-white/[0.07] text-slate-300 hover:border-amber-500/20'
                    }`}
                  >
                    {n}
                  </motion.button>
                ))}
                <input
                  type="number" min={1} max={Math.min(24, remainingTickets)} value={ticketCount}
                  onChange={(e) => setTicketCount(Math.max(1, Math.min(24, Number(e.target.value) || 1)))}
                  className="input text-center font-mono font-black w-16 py-2 text-sm"
                />
              </div>
              <motion.button
                whileHover={!buying && remainingTickets > 0 ? { scale: 1.02, y: -2 } : {}}
                whileTap={{ scale: 0.97 }}
                onClick={buyTickets}
                disabled={buying || remainingTickets <= 0}
                className="btn btn-primary btn-full py-3.5 text-base font-black"
              >
                {buying ? (
                  <span className="flex items-center gap-2 justify-center"><RefreshCw size={15} className="animate-spin" /> Processing…</span>
                ) : remainingTickets <= 0 ? (
                  'Room Full'
                ) : (
                  `Buy ${ticketCount} Card${ticketCount > 1 ? 's' : ''} — ${formatCreditsFull(room.ticketPriceMinor * ticketCount)} Cr`
                )}
              </motion.button>
            </div>
          )}

          {/* ── My cards ── */}
          {myTickets.length > 0 ? (
            <div className="space-y-3">
              <h3 className="text-[10px] font-black uppercase tracking-wider text-slate-500 px-1">My Cards</h3>
              <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
                {myTickets.map((ticket) => (
                  <BingoTicketCard key={ticket.id} ticket={ticket} patternPrizeMap={patternPrizeMap} />
                ))}
              </div>
            </div>
          ) : phase !== 'buy' && (
            <div className="card text-center py-6 space-y-1">
              <Sparkles size={20} className="mx-auto text-slate-600" />
              <p className="text-slate-500 text-xs">You didn’t buy a card for this round.</p>
              <p className="text-slate-600 text-[10px]">Hang tight — the next game opens for buy-in soon.</p>
            </div>
          )}

          {/* ── Number board (collapsible) ── */}
          <div className="card space-y-2">
            <button onClick={() => setShowBoard((v) => !v)} className="w-full flex items-center justify-between">
              <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 flex items-center gap-2">
                <Hash size={11} /> Called Numbers · {drawnNumbers.length}/{numberRange}
              </span>
              <span className="text-[9px] text-slate-600">{showBoard ? '▲' : '▼'}</span>
            </button>
            <AnimatePresence>
              {showBoard && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <NumberBoard drawnNumbers={drawnNumbers} numberRange={numberRange} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* ── Chat (collapsible) ── */}
          <div className="card space-y-2">
            <button onClick={() => setShowChat((v) => !v)} className="w-full flex items-center justify-between">
              <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 flex items-center gap-2">
                <MessageSquare size={11} /> Room Chat
              </span>
              <span className="flex items-center gap-1">
                {chatMessages.filter((m) => !m.isSystem).length > 0 && (
                  <span className="text-[9px] text-blue-400 font-bold">{chatMessages.filter((m) => !m.isSystem).length}</span>
                )}
                <Users size={9} className="text-slate-600" />
                <span className="text-[9px] text-slate-600">{showChat ? '▲' : '▼'}</span>
              </span>
            </button>

            <AnimatePresence>
              {showChat && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 220 }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden flex flex-col"
                >
                  <div className="flex-1 overflow-y-auto pr-1 space-y-1.5" style={{ maxHeight: 160 }}>
                    {chatMessages.map((msg, i) => {
                      const isOwn = !msg.isSystem && msg.userId === currentUser?.id;
                      return (
                        <div key={i} className={`flex flex-col ${isOwn ? 'items-end' : 'items-start'}`}>
                          {!msg.isSystem && (
                            <span className={`text-[9px] font-bold mb-0.5 ${isOwn ? 'text-amber-400' : 'text-blue-400'}`}>
                              {isOwn ? 'You' : msg.displayName}
                            </span>
                          )}
                          <div
                            className={`text-[11px] px-2 py-1 max-w-[85%] leading-snug ${
                              msg.isSystem
                                ? 'text-slate-500 bg-white/[0.02] rounded-md border border-white/[0.04]'
                                : isOwn
                                  ? 'bg-amber-500/12 border border-amber-500/20 rounded-[10px_10px_2px_10px] text-slate-300'
                                  : 'bg-blue-500/8 border border-blue-500/15 rounded-[10px_10px_10px_2px] text-slate-300'
                            }`}
                          >
                            {msg.text}
                          </div>
                        </div>
                      );
                    })}
                    <div ref={chatEndRef} />
                  </div>
                  <div className="flex gap-2 mt-2 pt-2 border-t border-white/[0.05]">
                    <input
                      ref={chatInputRef}
                      className="input flex-1 text-xs py-1.5"
                      placeholder="Say something…"
                      maxLength={200}
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') sendChat(); }}
                    />
                    <button onClick={sendChat} disabled={!chatInput.trim()} className="btn btn-primary btn-sm">
                      Send
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      )}
    </div>
  );
}
