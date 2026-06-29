import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeft, RefreshCw, Hash, Trophy, Sparkles,
  Volume2, VolumeX, Users, MessageSquare, Shuffle, Hand, Wand2,
} from 'lucide-react';
import { bingoApi, walletApi } from '../lib/api';
import type { BingoRoom, BingoRoomState, BingoTicket } from '../lib/models';
import { createIdempotencyKey, formatCreditsFull, getErrorMessage, titleCase } from '../lib/utils';
import { formatCredits, useStore } from '../store/useStore';
import { getSocket } from '../hooks/useSocketConnection';
import { soundEngine } from '../lib/audio';
import confetti from 'canvas-confetti';

// ─── Types ────────────────────────────────────────────────────────────────────

type Screen = 'lobby' | 'configure' | 'playing';
type FillMode = 'auto' | 'manual' | 'hybrid';
type ChatMessage = { userId?: string; displayName: string; text: string; timestamp: string; isSystem?: boolean };
type BingoProps = { onBack: () => void };

const BINGO_COLS = ['B', 'I', 'N', 'G', 'O'];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isPatternGrid(grid: Array<Array<number | null>>): boolean {
  return grid.length === 5 && (grid[0]?.length ?? 0) === 5;
}

function formatPrizeTier(key: string): string {
  return titleCase(key.replace(/minor$/i, '').trim());
}

function colRangeForPattern(col: number, numberRange: number): [number, number] {
  const colWidth = Math.floor(numberRange / 5);
  const min = col * colWidth + 1;
  const max = col === 4 ? numberRange : (col + 1) * colWidth;
  return [min, max];
}

// ─── NumberPicker ─────────────────────────────────────────────────────────────

function NumberPicker({
  fillMode, numberRange, isPattern, selected, onChange,
}: {
  fillMode: FillMode;
  numberRange: number;
  isPattern: boolean;
  selected: number[];
  onChange: (nums: number[]) => void;
}) {
  if (fillMode === 'auto') return null;

  const maxPicks = isPattern ? 20 : 15; // pattern: 4 per col×5=20; 90-ball: 15
  const remaining = maxPicks - selected.length;
  const isHybrid = fillMode === 'hybrid';

  const toggle = (n: number) => {
    if (selected.includes(n)) {
      onChange(selected.filter((x) => x !== n));
    } else if (selected.length < maxPicks) {
      onChange([...selected, n]);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 28 }}
      className="overflow-hidden"
    >
      <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3 space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">
            {isHybrid ? 'Pick some numbers (rest auto-filled)' : 'Pick your numbers'}
          </span>
          <div className="flex items-center gap-2">
            <span className={`text-[10px] font-black ${remaining === 0 ? 'text-emerald-400' : 'text-amber-400'}`}>
              {selected.length}/{maxPicks}
            </span>
            {selected.length > 0 && (
              <button
                onClick={() => onChange([])}
                className="text-[9px] text-slate-500 hover:text-slate-300 underline transition-colors"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Pattern picker: 5 column layout (B-I-N-G-O) */}
        {isPattern ? (
          <div className="grid grid-cols-5 gap-1">
            {BINGO_COLS.map((col, ci) => {
              const [min, max] = colRangeForPattern(ci, numberRange);
              const needed = ci === 2 ? 4 : 5; // center column has FREE
              const colSelected = selected.filter((n) => n >= min && n <= max);
              return (
                <div key={col} className="space-y-0.5">
                  <div
                    className="text-center text-[10px] font-black py-1 rounded-t"
                    style={{ background: ['#ef4444','#f97316','#22c55e','#3b82f6','#a855f7'][ci] + '22', color: ['#ef4444','#f97316','#22c55e','#3b82f6','#a855f7'][ci] }}
                  >
                    {col}
                    <span className="block text-[7px] opacity-60">{colSelected.length}/{needed}</span>
                  </div>
                  <div className="space-y-0.5">
                    {Array.from({ length: max - min + 1 }, (_, i) => min + i).map((n) => {
                      const picked = selected.includes(n);
                      const colFull = colSelected.length >= needed && !picked;
                      return (
                        <button
                          key={n}
                          onClick={() => !colFull && toggle(n)}
                          disabled={colFull && !picked}
                          className={`w-full rounded text-[10px] font-bold py-0.5 transition-all duration-150 ${
                            picked
                              ? 'bg-amber-500 text-black font-black shadow-[0_0_6px_rgba(245,158,11,0.4)]'
                              : colFull
                                ? 'bg-white/[0.02] text-slate-700 cursor-not-allowed'
                                : 'bg-white/[0.04] text-slate-400 hover:bg-white/[0.08] hover:text-slate-200'
                          }`}
                        >
                          {n}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* 90-ball picker: flat 1-90 grid */
          <div className="grid grid-cols-10 gap-1">
            {Array.from({ length: 90 }, (_, i) => i + 1).map((n) => {
              const picked = selected.includes(n);
              const full = selected.length >= 15 && !picked;
              return (
                <button
                  key={n}
                  onClick={() => !full && toggle(n)}
                  disabled={full}
                  className={`aspect-square rounded text-[10px] font-bold transition-all duration-150 ${
                    picked
                      ? 'bg-amber-500 text-black font-black shadow-[0_0_5px_rgba(245,158,11,0.35)]'
                      : full
                        ? 'bg-white/[0.02] text-slate-700 cursor-not-allowed'
                        : 'bg-white/[0.04] text-slate-400 hover:bg-amber-500/20 hover:text-amber-300'
                  }`}
                >
                  {n}
                </button>
              );
            })}
          </div>
        )}

        {/* Progress bar */}
        <div className="h-1 bg-white/[0.05] rounded-full overflow-hidden">
          <motion.div
            className="h-full rounded-full bg-amber-500"
            animate={{ width: `${(selected.length / maxPicks) * 100}%` }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          />
        </div>

        {isHybrid && remaining > 0 && (
          <p className="text-[9px] text-center text-slate-500">
            {remaining} number{remaining !== 1 ? 's' : ''} will be auto-filled
          </p>
        )}
        {fillMode === 'manual' && remaining > 0 && (
          <p className="text-[9px] text-center text-amber-500/80">
            Pick {remaining} more to fill your card
          </p>
        )}
      </div>
    </motion.div>
  );
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
  const addToast      = useStore((s) => s.addToast);
  const setWallet     = useStore((s) => s.setWallet);
  const liveCounts    = useStore((s) => s.liveCounts);
  const soundVolume   = useStore((s) => s.soundVolume);
  const soundMuted    = useStore((s) => s.soundMuted);
  const setSoundVolume = useStore((s) => s.setSoundVolume);
  const setSoundMuted  = useStore((s) => s.setSoundMuted);
  const currentUser   = useStore((s) => s.user);

  // ── Screen state machine ───────────────────────────────────────────────────
  const [screen, setScreen]               = useState<Screen>('lobby');
  const [rooms, setRooms]                 = useState<BingoRoom[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [roomState, setRoomState]         = useState<BingoRoomState | null>(null);
  const [loadingRooms, setLoadingRooms]   = useState(true);
  const [loadingState, setLoadingState]   = useState(false);

  // ── Configure state ────────────────────────────────────────────────────────
  const [fillMode, setFillMode]           = useState<FillMode>('auto');
  const [selectedNumbers, setSelectedNumbers] = useState<number[]>([]);
  const [ticketCount, setTicketCount]     = useState(1);
  const [buying, setBuying]               = useState(false);

  // ── Playing state ─────────────────────────────────────────────────────────
  const [showVictory, setShowVictory]     = useState(false);
  const [victoryTickets, setVictoryTickets] = useState<BingoTicket[]>([]);
  const prevDrawnLengthRef                = useRef(0);
  const [showBoard, setShowBoard]         = useState(true);

  // ── Countdown ─────────────────────────────────────────────────────────────
  const [timeRemainingSecs, setTimeRemainingSecs] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Chat ──────────────────────────────────────────────────────────────────
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    { displayName: 'System', text: 'Welcome to iGames Bingo!', timestamp: new Date().toISOString(), isSystem: true },
  ]);
  const [chatInput, setChatInput]   = useState('');
  const [showChat, setShowChat]     = useState(false);
  const chatEndRef                  = useRef<HTMLDivElement>(null);
  const chatInputRef                = useRef<HTMLInputElement>(null);

  // ── Data loading ──────────────────────────────────────────────────────────

  const loadRooms = useCallback(async () => {
    setLoadingRooms(true);
    try {
      const next = await bingoApi.listRooms();
      setRooms(next);
    } catch (err) {
      addToast('error', getErrorMessage(err));
    } finally {
      setLoadingRooms(false);
    }
  }, [addToast]);

  const loadRoomState = useCallback(async (roomId: string) => {
    setLoadingState(true);
    try {
      const next = await bingoApi.getRoomState(roomId);
      setRoomState(next);
    } catch (err) {
      addToast('error', getErrorMessage(err));
    } finally {
      setLoadingState(false);
    }
  }, [addToast]);

  useEffect(() => { void loadRooms(); }, [loadRooms]);

  // ── Socket ────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!selectedRoomId) { setRoomState(null); return; }
    void loadRoomState(selectedRoomId);
    prevDrawnLengthRef.current = 0;

    const socket = getSocket();
    if (!socket) return;
    socket.emit('enter.game', { game: 'bingo' });

    const onRoomUpdate = (p: { roomId?: string }) => {
      if (p.roomId === selectedRoomId) void loadRoomState(selectedRoomId);
      void loadRooms();
    };
    const onNumberDrawn = (p: { roomId?: string }) => {
      if (p.roomId !== selectedRoomId) return;
      soundEngine.pop();
      void loadRoomState(selectedRoomId);
    };
    const onRoomCompleted = (p: { roomId?: string }) => {
      if (p.roomId !== selectedRoomId) return;
      void loadRoomState(selectedRoomId);
      addToast('info', 'Bingo room completed — payouts settled!');
    };
    const onChatMessage = (p: { roomId: string; userId?: string; displayName: string; text: string; timestamp: string }) => {
      if (p.roomId !== selectedRoomId) return;
      setChatMessages((prev) => [...prev.slice(-49), { ...p }]);
    };

    socket.on('bingo.room.updated', onRoomUpdate);
    socket.on('bingo.number.drawn', onNumberDrawn);
    socket.on('bingo.room.completed', onRoomCompleted);
    socket.on('bingo.chat.message', onChatMessage);

    return () => {
      socket.emit('leave.game', { game: 'bingo' });
      socket.off('bingo.room.updated', onRoomUpdate);
      socket.off('bingo.number.drawn', onNumberDrawn);
      socket.off('bingo.room.completed', onRoomCompleted);
      socket.off('bingo.chat.message', onChatMessage);
    };
  }, [selectedRoomId, loadRoomState, loadRooms, addToast]);

  // ── Countdown ─────────────────────────────────────────────────────────────

  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    setTimeRemainingSecs(null);
    const room = rooms.find((r) => r.id === selectedRoomId);
    if (!room || room.status !== 'open') return;
    const tick = () => {
      const ms = new Date(room.scheduledStartAt).getTime() - Date.now();
      const secs = Math.max(0, Math.floor(ms / 1000));
      setTimeRemainingSecs(secs);
      if (secs <= 0 && timerRef.current) clearInterval(timerRef.current);
    };
    tick();
    timerRef.current = setInterval(tick, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [rooms, selectedRoomId]);

  // ── Win detection ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (roomState?.status !== 'completed' || !roomState.tickets?.length) return;
    const winners = roomState.tickets.filter((t) => t.payoutMinor > 0);
    if (!winners.length) return;
    const curLen = roomState.drawnNumbers?.length ?? 0;
    if (curLen > prevDrawnLengthRef.current) {
      soundEngine.win();
      confetti({ particleCount: 200, spread: 90, origin: { y: 0.55 }, colors: ['#FFD700', '#FF4444', '#00FF88', '#FFFFFF'] });
      setVictoryTickets(winners);
      setShowVictory(true);
    }
    prevDrawnLengthRef.current = curLen;
  }, [roomState?.status, roomState?.tickets, roomState?.drawnNumbers]);

  // ── Chat scroll ───────────────────────────────────────────────────────────

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chatMessages]);

  // ── Derived ───────────────────────────────────────────────────────────────

  const selectedRoom = useMemo(
    () => roomState ?? rooms.find((r) => r.id === selectedRoomId) ?? null,
    [roomState, rooms, selectedRoomId],
  );
  const patternPrizeMap = useMemo(
    () => new Map((selectedRoom?.patternPrizes ?? []).map((pp) => [pp.patternId, pp.name])),
    [selectedRoom],
  );
  const isPatternMode  = selectedRoom?.winMode === 'pattern';
  const numberRange    = selectedRoom?.numberRange ?? (isPatternMode ? 75 : 90);
  const drawnNumbers   = roomState?.drawnNumbers ?? [];
  const lastNumber     = drawnNumbers.length > 0 ? drawnNumbers[drawnNumbers.length - 1] : null;
  const remainingTickets = selectedRoom ? Math.max(0, selectedRoom.maxTickets - selectedRoom.soldTickets) : 0;
  const salesOpen      = selectedRoom?.status === 'open';

  // ── Actions ───────────────────────────────────────────────────────────────

  const selectRoom = (room: BingoRoom) => {
    soundEngine.click();
    setSelectedRoomId(room.id);
    setSelectedNumbers([]);
    setFillMode('auto');
    setTicketCount(1);
    if (room.status === 'running' || room.status === 'completed') {
      setScreen('playing');
    } else {
      setScreen('configure');
    }
  };

  const buyTickets = async () => {
    if (!selectedRoomId || !salesOpen) return;
    setBuying(true);
    try {
      const nums = fillMode !== 'auto' ? selectedNumbers : undefined;
      await bingoApi.purchaseTickets(selectedRoomId, ticketCount, createIdempotencyKey('bingo'), nums);
      const [nextWallet] = await Promise.all([walletApi.getWallet(), loadRoomState(selectedRoomId), loadRooms()]);
      setWallet(nextWallet);
      soundEngine.cashout();
      addToast('success', `Bought ${ticketCount} Bingo ticket${ticketCount > 1 ? 's' : ''}!`);
      setScreen('playing');
    } catch (err) {
      addToast('error', getErrorMessage(err));
    } finally {
      setBuying(false);
    }
  };

  const sendChat = useCallback(() => {
    const text = chatInput.trim();
    if (!text || !selectedRoomId) return;
    const socket = getSocket();
    if (!socket) return;
    socket.emit('bingo.chat.send', { roomId: selectedRoomId, text });
    setChatInput('');
    chatInputRef.current?.focus();
  }, [chatInput, selectedRoomId]);

  // ── RENDER ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4 max-w-3xl mx-auto pb-20">
      {/* Victory overlay */}
      <AnimatePresence>
        {showVictory && victoryTickets.length > 0 && (
          <VictoryOverlay
            tickets={victoryTickets}
            room={roomState}
            onClose={() => { soundEngine.click(); setShowVictory(false); }}
          />
        )}
      </AnimatePresence>

      {/* ── Top bar ── */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => {
            if (screen === 'lobby') { onBack(); }
            else if (screen === 'playing') { setScreen('lobby'); }
            else { setScreen('lobby'); }
          }}
          className="btn btn-ghost btn-sm flex items-center gap-2"
        >
          <ArrowLeft size={14} />
          {screen === 'lobby' ? 'Home' : 'Rooms'}
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

      {/* ════════════════════════════════════════════════════════════════
          LOBBY
      ═══════════════════════════════════════════════════════════════════ */}
      <AnimatePresence mode="wait">
        {screen === 'lobby' && (
          <motion.div key="lobby"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ type: 'spring', stiffness: 300, damping: 28 }}
            className="space-y-4"
          >
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-black text-slate-100">Bingo Rooms</h2>
                <p className="text-[11px] text-slate-500">Choose a room to play</p>
              </div>
              <button onClick={loadRooms} className="btn btn-secondary btn-sm">
                <RefreshCw size={12} className={loadingRooms ? 'animate-spin' : ''} />
              </button>
            </div>

            {loadingRooms && rooms.length === 0 ? (
              <div className="centered-loader py-12"><div className="spinner" /></div>
            ) : rooms.length === 0 ? (
              <div className="card text-center py-12 space-y-2">
                <Sparkles size={28} className="mx-auto text-slate-600" />
                <p className="text-slate-400 text-sm">No rooms available right now.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {rooms.map((room) => (
                  <motion.button
                    key={room.id}
                    whileHover={{ scale: 1.01, y: -1 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => selectRoom(room)}
                    className="w-full card text-left flex items-center gap-4 hover:border-amber-500/20 transition-all"
                  >
                    {/* Status dot */}
                    <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                      room.status === 'open' ? 'bg-emerald-400 animate-pulse' :
                      room.status === 'running' ? 'bg-red-400 animate-pulse' : 'bg-slate-600'
                    }`} />

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-black text-sm text-slate-100">{room.name}</span>
                        <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded ${
                          room.status === 'open' ? 'bg-emerald-500/10 text-emerald-400' :
                          room.status === 'running' ? 'bg-red-500/10 text-red-400' :
                          'bg-slate-700 text-slate-500'
                        }`}>{room.status}</span>
                        {room.winMode === 'pattern' && (
                          <span className="text-[8px] font-black bg-violet-500/10 text-violet-400 px-1.5 py-0.5 rounded">PATTERN</span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-[10px] text-slate-500">
                        <span>{formatCredits(room.ticketPriceMinor)} Cr/ticket</span>
                        <span>{room.soldTickets}/{room.maxTickets} sold</span>
                        <span>1–{room.numberRange ?? 90}</span>
                      </div>
                    </div>

                    <div className="text-right flex-shrink-0">
                      <span className="text-[10px] font-black text-amber-400 block">
                        {room.status === 'running' ? 'Join' : room.status === 'open' ? 'Buy In' : 'Watch'}
                      </span>
                      <span className="text-[9px] text-slate-600">{room.maxTickets - room.soldTickets} left</span>
                    </div>
                  </motion.button>
                ))}
              </div>
            )}
          </motion.div>
        )}

        {/* ════════════════════════════════════════════════════════════════
            CONFIGURE
        ═══════════════════════════════════════════════════════════════════ */}
        {screen === 'configure' && selectedRoom && (
          <motion.div key="configure"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ type: 'spring', stiffness: 300, damping: 28 }}
            className="space-y-4"
          >
            {/* Room header */}
            <div className="card">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h2 className="font-black text-base text-slate-100">{selectedRoom.name}</h2>
                  <p className="text-[10px] text-slate-500 mt-0.5">
                    {formatCredits(selectedRoom.ticketPriceMinor)} Cr · {remainingTickets} tickets left
                    {isPatternMode ? ' · Pattern mode' : ' · 90-ball'}
                  </p>
                </div>
                {timeRemainingSecs !== null && (
                  <div className="text-right">
                    <span className={`text-xl font-black font-mono ${timeRemainingSecs <= 10 ? 'text-red-400 animate-pulse' : 'text-amber-400'}`}>
                      {String(Math.floor(timeRemainingSecs / 60)).padStart(2, '0')}:{String(timeRemainingSecs % 60).padStart(2, '0')}
                    </span>
                    <span className="block text-[9px] text-slate-500">starts in</span>
                  </div>
                )}
              </div>

              {/* Prize tiers */}
              {!isPatternMode && selectedRoom.prizes && (
                <div className="grid grid-cols-3 gap-2 mt-1">
                  {Object.entries(selectedRoom.prizes).map(([tier, amt]) => (
                    <div key={tier} className="rounded-lg bg-white/[0.03] border border-white/[0.05] p-2 text-center">
                      <span className="block text-[8px] font-bold uppercase text-slate-600 mb-0.5">{formatPrizeTier(tier)}</span>
                      <span className="text-[11px] font-black text-amber-400">{formatCredits(amt)} Cr</span>
                    </div>
                  ))}
                </div>
              )}
              {isPatternMode && selectedRoom.patternPrizes?.length > 0 && (
                <div className="space-y-1 mt-1">
                  {selectedRoom.patternPrizes.map((pp) => (
                    <div key={pp.patternId} className="flex justify-between text-[10px]">
                      <span className="text-slate-400">{pp.name}</span>
                      <span className="font-black text-amber-400">{formatCredits(pp.prizeMinor)} Cr</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Step 1: Tickets */}
            <div className="card space-y-3">
              <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Step 1 — How many tickets?</p>
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
            </div>

            {/* Step 2: Fill mode */}
            <div className="card space-y-3">
              <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Step 2 — How to fill your card?</p>
              <div className="grid grid-cols-3 gap-2">
                {([
                  { id: 'auto',   icon: <Shuffle size={14} />,  label: 'Auto',   desc: 'Fully random' },
                  { id: 'hybrid', icon: <Wand2 size={14} />,    label: 'Hybrid', desc: 'Pick some, auto-fill rest' },
                  { id: 'manual', icon: <Hand size={14} />,     label: 'Manual', desc: 'Pick all numbers' },
                ] as { id: FillMode; icon: React.ReactNode; label: string; desc: string }[]).map((opt) => (
                  <motion.button
                    key={opt.id}
                    whileTap={{ scale: 0.93 }}
                    onClick={() => { setFillMode(opt.id); setSelectedNumbers([]); }}
                    className={`flex flex-col items-center gap-1.5 py-3 px-2 rounded-xl border transition-all ${
                      fillMode === opt.id
                        ? 'bg-amber-500/12 border-amber-500/40 text-amber-400'
                        : 'bg-white/[0.03] border-white/[0.07] text-slate-400 hover:border-white/[0.14]'
                    }`}
                  >
                    {opt.icon}
                    <span className="text-[11px] font-black">{opt.label}</span>
                    <span className="text-[8px] text-slate-600 text-center leading-tight">{opt.desc}</span>
                  </motion.button>
                ))}
              </div>

              {/* Number picker */}
              <AnimatePresence>
                {fillMode !== 'auto' && (
                  <NumberPicker
                    fillMode={fillMode}
                    numberRange={numberRange}
                    isPattern={isPatternMode}
                    selected={selectedNumbers}
                    onChange={setSelectedNumbers}
                  />
                )}
              </AnimatePresence>
            </div>

            {/* Buy button */}
            <motion.button
              whileHover={!buying && salesOpen ? { scale: 1.02, y: -2 } : {}}
              whileTap={{ scale: 0.97 }}
              onClick={buyTickets}
              disabled={buying || !salesOpen || remainingTickets <= 0}
              className="btn btn-primary btn-full py-4 text-base font-black"
            >
              {buying ? (
                <span className="flex items-center gap-2 justify-center"><RefreshCw size={15} className="animate-spin" /> Processing…</span>
              ) : !salesOpen ? (
                'Sales Closed'
              ) : remainingTickets <= 0 ? (
                'Room Full'
              ) : (
                `Buy ${ticketCount} Ticket${ticketCount > 1 ? 's' : ''} — ${formatCreditsFull(selectedRoom.ticketPriceMinor * ticketCount)} Cr`
              )}
            </motion.button>

            {salesOpen && (
              <button
                onClick={() => { setScreen('playing'); }}
                className="btn btn-ghost btn-full text-xs text-slate-500"
              >
                Watch without buying
              </button>
            )}
          </motion.div>
        )}

        {/* ════════════════════════════════════════════════════════════════
            PLAYING
        ═══════════════════════════════════════════════════════════════════ */}
        {screen === 'playing' && selectedRoom && (
          <motion.div key="playing"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ type: 'spring', stiffness: 300, damping: 28 }}
            className="space-y-4"
          >
            {/* ── Draw header ── */}
            <div className="card">
              <div className="flex items-center gap-4">
                <DrawBall
                  number={lastNumber}
                  count={drawnNumbers.length}
                  max={numberRange}
                  status={selectedRoom.status}
                />
                <div className="flex-1 min-w-0 space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-black text-sm text-slate-100">{selectedRoom.name}</span>
                    <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded ${
                      selectedRoom.status === 'open' ? 'bg-emerald-500/10 text-emerald-400' :
                      selectedRoom.status === 'running' ? 'bg-red-500/10 text-red-400 animate-pulse' :
                      'bg-slate-700 text-slate-400'
                    }`}>{selectedRoom.status}</span>
                  </div>
                  {/* Recent balls */}
                  {drawnNumbers.length > 0 && (
                    <div className="flex gap-1 flex-wrap">
                      {drawnNumbers.slice(-10).map((n, i) => (
                        <motion.span
                          key={`${n}-${i}`}
                          initial={{ scale: 0, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          className={`w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-black ${
                            i === drawnNumbers.slice(-10).length - 1
                              ? 'bg-red-600 border border-red-400/60 text-white'
                              : 'bg-white/[0.06] border border-white/[0.08] text-slate-400'
                          }`}
                        >
                          {n}
                        </motion.span>
                      ))}
                    </div>
                  )}
                  {selectedRoom.status === 'completed' && (
                    <p className="text-[9px] text-emerald-400 font-bold">
                      {selectedRoom.settledTiers.length > 0
                        ? `${selectedRoom.settledTiers.length} prize tier${selectedRoom.settledTiers.length > 1 ? 's' : ''} settled`
                        : 'No winners this round'}
                    </p>
                  )}
                </div>
                {/* Buy more (if sales still open) */}
                {salesOpen && (
                  <button onClick={() => setScreen('configure')} className="btn btn-secondary btn-sm flex-shrink-0">
                    + Buy
                  </button>
                )}
              </div>
            </div>

            {/* ── My Tickets ── */}
            {roomState?.tickets && roomState.tickets.length > 0 ? (
              <div className="space-y-3">
                <h3 className="text-[10px] font-black uppercase tracking-wider text-slate-500 px-1">My Cards</h3>
                <div className={`grid gap-3 ${isPatternMode ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 sm:grid-cols-2'}`}>
                  {roomState.tickets.map((ticket) => (
                    <BingoTicketCard key={ticket.id} ticket={ticket} patternPrizeMap={patternPrizeMap} />
                  ))}
                </div>
              </div>
            ) : (
              <div className="card text-center py-6 space-y-2">
                <Sparkles size={20} className="mx-auto text-slate-600" />
                <p className="text-slate-500 text-xs">You have no tickets for this room.</p>
                {salesOpen && (
                  <button onClick={() => setScreen('configure')} className="btn btn-primary btn-sm mt-1">
                    Buy Tickets
                  </button>
                )}
              </div>
            )}

            {/* ── Number Board (collapsible) ── */}
            <div className="card space-y-2">
              <button
                onClick={() => setShowBoard((v) => !v)}
                className="w-full flex items-center justify-between"
              >
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
                    {loadingState && !roomState ? (
                      <div className="centered-loader py-4"><div className="spinner" /></div>
                    ) : (
                      <NumberBoard drawnNumbers={drawnNumbers} numberRange={numberRange} />
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* ── Chat (collapsible) ── */}
            <div className="card space-y-2">
              <button
                onClick={() => setShowChat((v) => !v)}
                className="w-full flex items-center justify-between"
              >
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
                      <button
                        onClick={sendChat}
                        disabled={!chatInput.trim()}
                        className="btn btn-primary btn-sm"
                      >
                        Send
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
