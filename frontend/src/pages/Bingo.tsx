import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  RefreshCw, Gamepad2, Hash, Ticket, Volume2, VolumeX,
  MessageSquare, Users, Trophy, Sparkles,
} from 'lucide-react';
import { GameTabs, type GameTabOption } from '../components/GameTabs';
import { bingoApi, walletApi } from '../lib/api';
import type { BingoRoom, BingoRoomState, BingoTicket } from '../lib/models';
import { createIdempotencyKey, formatCreditsFull, getErrorMessage, titleCase } from '../lib/utils';
import { formatCredits, useStore } from '../store/useStore';
import { getSocket } from '../hooks/useSocketConnection';
import { soundEngine } from '../lib/audio';
import confetti from 'canvas-confetti';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatPrizeTier(key: string): string {
  return titleCase(key.replace(/minor$/i, '').trim());
}

function isPatternGrid(grid: Array<Array<number | null>>): boolean {
  return grid.length === 5 && (grid[0]?.length ?? 0) === 5;
}

// ─── Types ────────────────────────────────────────────────────────────────────

type BingoRoomEventPayload = { roomId?: string };
type BingoProps = { onBack: () => void };
type BingoTab = 'active' | 'draws' | 'tickets';
type ChatMessage = { userId?: string; displayName: string; text: string; timestamp: string; isSystem?: boolean };

const BINGO_TABS: Array<GameTabOption<BingoTab>> = [
  { id: 'active',  label: 'Bingo Rooms',  description: 'Select room and buy tickets.',      icon: <Gamepad2 size={18} /> },
  { id: 'draws',   label: 'Number Board', description: 'Called numbers and game matrix.',    icon: <Hash    size={18} /> },
  { id: 'tickets', label: 'My Tickets',   description: 'View your active cards.',            icon: <Ticket  size={18} /> },
];

const BINGO_COLS = ['B', 'I', 'N', 'G', 'O'];

// ─── Sub-components ───────────────────────────────────────────────────────────

/** Animated lottery-cage draw machine */
function DrawMachine({ roomStatus, lastNumber, drawnCount, maxNumber }: {
  roomStatus: string; lastNumber: number | null; drawnCount: number; maxNumber: number;
}) {
  const balls = useMemo(() =>
    Array.from({ length: 8 }, (_, i) => ({
      id: i,
      color: ['#f59e0b', '#8b5cf6', '#10b981', '#ef4444', '#3b82f6', '#ec4899', '#f97316', '#14b8a6'][i],
      delay: i * 0.15,
    })),
  []);

  if (roomStatus === 'open') {
    return (
      <div className="flex flex-col items-center gap-3 py-4">
        <div className="relative w-28 h-28">
          <svg className="w-full h-full absolute inset-0" viewBox="0 0 112 112">
            <circle cx="56" cy="56" r="50" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="2" strokeDasharray="6 4" />
            <motion.circle
              cx="56" cy="56" r="50" fill="none"
              stroke="rgba(245,158,11,0.2)" strokeWidth="1.5"
              strokeDasharray="12 8"
              animate={{ rotate: 360 }}
              transition={{ duration: 8, repeat: Infinity, ease: 'linear' }}
              style={{ transformOrigin: '56px 56px' }}
            />
          </svg>
          {balls.map((b) => (
            <motion.div
              key={b.id}
              className="absolute w-4 h-4 rounded-full"
              style={{ backgroundColor: b.color, left: '50%', top: '50%' }}
              animate={{
                x: [Math.cos(b.id * 45 * Math.PI / 180) * 28, Math.cos((b.id * 45 + 180) * Math.PI / 180) * 28],
                y: [Math.sin(b.id * 45 * Math.PI / 180) * 28, Math.sin((b.id * 45 + 180) * Math.PI / 180) * 28],
                scale: [1, 0.7, 1],
              }}
              transition={{ duration: 1.8 + b.delay, repeat: Infinity, ease: 'easeInOut', delay: b.delay }}
            />
          ))}
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-[9px] font-black uppercase tracking-wider text-amber-500/80">Tickets Open</span>
          </div>
        </div>
        <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Waiting for players</span>
      </div>
    );
  }

  if (roomStatus === 'running') {
    return (
      <div className="flex flex-col items-center gap-3 py-2">
        <div className="relative w-32 h-32">
          <motion.svg
            className="w-full h-full absolute inset-0"
            viewBox="0 0 128 128"
            animate={{ rotate: 360 }}
            transition={{ duration: 4, repeat: Infinity, ease: 'linear' }}
          >
            {Array.from({ length: 12 }, (_, i) => (
              <line
                key={i}
                x1="64" y1="8" x2="64" y2="30"
                stroke="rgba(239,68,68,0.35)"
                strokeWidth="1.5"
                strokeLinecap="round"
                transform={`rotate(${i * 30} 64 64)`}
              />
            ))}
            <circle cx="64" cy="64" r="56" fill="none" stroke="rgba(239,68,68,0.15)" strokeWidth="2" />
          </motion.svg>
          {balls.slice(0, 5).map((b) => (
            <motion.div
              key={b.id}
              className="absolute w-3 h-3 rounded-full"
              style={{ backgroundColor: b.color, left: '50%', top: '50%' }}
              animate={{
                x: [Math.cos(b.id * 72 * Math.PI / 180) * 32, Math.cos((b.id * 72 + 90) * Math.PI / 180) * 32],
                y: [Math.sin(b.id * 72 * Math.PI / 180) * 32, Math.sin((b.id * 72 + 90) * Math.PI / 180) * 32],
              }}
              transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut', delay: b.delay }}
            />
          ))}
          <div className="absolute inset-0 flex items-center justify-center">
            <AnimatePresence mode="popLayout">
              {lastNumber !== null ? (
                <motion.div
                  key={lastNumber}
                  initial={{ scale: 0.3, rotate: -270, opacity: 0 }}
                  animate={{ scale: 1, rotate: 0, opacity: 1 }}
                  exit={{ scale: 0.6, opacity: 0, y: 8 }}
                  transition={{ type: 'spring', stiffness: 220, damping: 16 }}
                  className="w-16 h-16 rounded-full bg-gradient-to-br from-red-600 to-rose-700 border-2 border-red-400 flex items-center justify-center shadow-[0_0_20px_rgba(239,68,68,0.5)]"
                >
                  <span className="text-2xl font-black text-white font-mono">{lastNumber}</span>
                </motion.div>
              ) : (
                <motion.span key="waiting"
                  animate={{ opacity: [0.4, 1, 0.4] }} transition={{ duration: 1.4, repeat: Infinity }}
                  className="text-[9px] font-black uppercase tracking-wider text-red-400"
                >
                  Drawing
                </motion.span>
              )}
            </AnimatePresence>
          </div>
        </div>
        <span className="text-xs font-black text-red-400 uppercase tracking-widest animate-pulse">
          Ball #{drawnCount} of {maxNumber}
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-2 py-6">
      <motion.div
        animate={{ rotate: [0, 5, -5, 0], scale: [1, 1.05, 1] }}
        transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
      >
        <Trophy size={52} className="text-amber-400" style={{ filter: 'drop-shadow(0 0 12px rgba(245,158,11,0.5))' }} />
      </motion.div>
      <span className="text-sm font-black text-slate-100">Draw Complete</span>
      <span className="text-[10px] text-slate-500">All payouts settled</span>
    </div>
  );
}

/**
 * Number board matching the Ethiopian "Esu Bingo" style.
 * Drawn numbers appear highlighted in red. 10 columns wide.
 */
const NumberBoard = memo(({ drawnNumbers, numberRange }: { drawnNumbers: number[]; numberRange: number }) => (
  <div className="space-y-2">
    {/* Column headers for pattern mode (1-75) or plain for 90/140 */}
    {numberRange <= 75 && (
      <div className="grid grid-cols-10 gap-1 sm:gap-1.5 mb-1">
        {['B','I','N','G','O','','','','',''].map((h, i) => (
          <div key={i} className="aspect-square flex items-center justify-center text-[9px] font-black text-slate-500 uppercase">
            {h}
          </div>
        ))}
      </div>
    )}
    <div className="grid grid-cols-10 gap-1 sm:gap-1.5">
      {Array.from({ length: numberRange }, (_, i) => i + 1).map((val) => {
        const called = drawnNumbers.includes(val);
        return (
          <motion.span
            key={val}
            animate={called ? {
              scale: [1, 1.3, 1.1],
              boxShadow: ['0 0 0px rgba(239,68,68,0)', '0 0 16px rgba(239,68,68,0.8)', '0 0 6px rgba(239,68,68,0.4)'],
            } : {}}
            transition={{ duration: 0.5, ease: 'backOut' }}
            className={`aspect-square rounded-md flex items-center justify-center text-[10px] font-bold font-mono transition-colors duration-300 ${
              called
                ? 'bg-red-600/90 border border-red-400/60 text-white shadow-[0_0_4px_rgba(239,68,68,0.4)]'
                : 'bg-white/[0.03] border border-white/[0.06] text-slate-600'
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

/**
 * 5×5 BINGO pattern ticket card (B-I-N-G-O headers, FREE center)
 */
const PatternTicketCard = memo(({ ticket, patternPrizeMap }: {
  ticket: BingoTicket;
  patternPrizeMap: Map<string, string>;
}) => {
  const won = ticket.payoutMinor > 0;
  const grid = ticket.grid as Array<Array<number | null>>;

  return (
    <motion.article
      layout
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      className={`rounded-2xl border p-4 flex flex-col gap-3 ${
        won
          ? 'bg-gradient-to-br from-amber-950/30 to-black/40 border-amber-500/30 shadow-[0_0_20px_rgba(245,158,11,0.1)]'
          : 'bg-white/[0.025] border-white/[0.06]'
      }`}
    >
      <div className="flex justify-between items-center">
        <div>
          <h4 className="text-xs font-black text-slate-200">#{ticket.id.slice(-6)}</h4>
          {ticket.completedPatterns && ticket.completedPatterns.length > 0 ? (
            <p className="text-[10px] text-amber-400 font-bold mt-0.5">
              Won: {ticket.completedPatterns.map((pid) => patternPrizeMap.get(pid) ?? 'Pattern').join(', ')}
            </p>
          ) : (
            <p className="text-[10px] text-slate-500 mt-0.5">Awaiting pattern</p>
          )}
        </div>
        <span className={`badge ${won ? 'badge-gold' : 'badge-violet'}`}>
          {won ? `+${formatCredits(ticket.payoutMinor)} Cr` : ticket.settlementStatus}
        </span>
      </div>

      {/* BINGO column headers */}
      <div className="grid grid-cols-5 gap-1">
        {BINGO_COLS.map((col) => (
          <div key={col} className="aspect-square flex items-center justify-center text-[11px] font-black text-red-400">
            {col}
          </div>
        ))}
      </div>

      {/* 5×5 grid */}
      <div className="grid grid-cols-5 gap-1">
        {grid.map((row, rowIdx) =>
          row.map((value, colIdx) => {
            const isFree = value === null;
            const isMarked = isFree || ticket.markedNumbers.includes(value!);
            return (
              <motion.span
                key={`${ticket.id}-${rowIdx}-${colIdx}`}
                animate={isMarked && !isFree ? {
                  scale: [1, 1.15, 1.05],
                  backgroundColor: ['rgba(255,255,255,0.04)', '#ef4444', '#ef4444'],
                  color: ['#9ca3af', '#ffffff', '#ffffff'],
                } : {}}
                transition={{ duration: 0.35, ease: 'backOut' }}
                className={`aspect-square rounded-md flex items-center justify-center text-[11px] font-bold font-mono relative ${
                  isFree
                    ? 'bg-red-600/30 border border-red-500/40 text-red-400 text-[9px] font-black'
                    : isMarked
                      ? 'bg-red-600 border border-red-400/60 text-white shadow-[0_0_4px_rgba(239,68,68,0.4)]'
                      : 'bg-white/[0.04] border border-white/[0.07] text-slate-400'
                }`}
              >
                {isFree ? 'FREE' : value}
                {isMarked && !isFree && (
                  <motion.span
                    initial={{ scale: 0.3, opacity: 1 }}
                    animate={{ scale: 2.2, opacity: 0 }}
                    transition={{ duration: 0.5 }}
                    className="absolute inset-0 rounded-md bg-red-400/50 pointer-events-none"
                  />
                )}
              </motion.span>
            );
          })
        )}
      </div>

      <div className="flex justify-between text-[10px] text-slate-500 font-bold uppercase tracking-wider pt-1 border-t border-white/[0.05]">
        <span>Stake: {formatCredits(ticket.stakeMinor)} Cr</span>
        {ticket.completedPatterns && <span>Patterns: {ticket.completedPatterns.length}</span>}
      </div>
    </motion.article>
  );
});
PatternTicketCard.displayName = 'PatternTicketCard';

/** Individual bingo ticket card with animated marking (90-ball 3×9 mode) */
const BingoTicketCard = memo(({ ticket, patternPrizeMap }: {
  ticket: BingoTicket;
  patternPrizeMap: Map<string, string>;
}) => {
  if (isPatternGrid(ticket.grid)) {
    return <PatternTicketCard ticket={ticket} patternPrizeMap={patternPrizeMap} />;
  }

  const won = ticket.payoutMinor > 0;
  return (
    <motion.article
      layout
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      className={`rounded-2xl border p-4 flex flex-col gap-3 ${
        won
          ? 'bg-gradient-to-br from-amber-950/30 to-black/40 border-amber-500/30 shadow-[0_0_20px_rgba(245,158,11,0.1)]'
          : 'bg-white/[0.025] border-white/[0.06]'
      }`}
    >
      <div className="flex justify-between items-center">
        <div>
          <h4 className="text-xs font-black text-slate-200">#{ticket.id.slice(-6)}</h4>
          <p className="text-[10px] text-slate-500 mt-0.5">
            {ticket.wonTiers.length
              ? <span className="text-amber-400 font-bold">Won: {ticket.wonTiers.map(titleCase).join(', ')}</span>
              : 'Awaiting matches'}
          </p>
        </div>
        <span className={`badge ${won ? 'badge-gold' : 'badge-violet'}`}>
          {won ? `+${formatCredits(ticket.payoutMinor)} Cr` : ticket.settlementStatus}
        </span>
      </div>

      {/* 3×9 grid */}
      <div className="space-y-1">
        {ticket.grid.map((row, rowIndex) => {
          const isRowComplete = ticket.completedLines.includes(rowIndex);
          return (
            <motion.div
              key={`${ticket.id}-r${rowIndex}`}
              animate={isRowComplete ? {
                boxShadow: ['0 0 0px rgba(245,158,11,0)', '0 0 16px rgba(245,158,11,0.4)', '0 0 8px rgba(245,158,11,0.2)'],
              } : {}}
              transition={{ duration: 0.6 }}
              className={`grid grid-cols-9 gap-0.5 rounded-lg p-1 border transition-colors duration-300 relative overflow-hidden ${
                isRowComplete
                  ? 'border-amber-400/60 bg-amber-500/8'
                  : 'border-transparent'
              }`}
            >
              {isRowComplete && (
                <motion.div
                  initial={{ x: '-100%' }}
                  animate={{ x: '200%' }}
                  transition={{ duration: 0.9, ease: 'easeInOut' }}
                  className="absolute inset-0 bg-gradient-to-r from-transparent via-amber-400/20 to-transparent pointer-events-none"
                />
              )}
              {row.map((value, colIndex) =>
                value ? (
                  <motion.span
                    key={`${ticket.id}-r${rowIndex}-c${colIndex}`}
                    animate={ticket.markedNumbers.includes(value) ? {
                      scale: [1, 1.2, 1.05],
                      backgroundColor: ['rgba(255,255,255,0.04)', '#f59e0b', '#f59e0b'],
                      color: ['#9ca3af', '#000000', '#000000'],
                    } : {}}
                    transition={{ duration: 0.35, ease: 'backOut' }}
                    className={`aspect-square rounded flex items-center justify-center text-[10px] font-bold font-mono transition-colors duration-200 relative ${
                      ticket.markedNumbers.includes(value)
                        ? 'bg-[var(--gold)] text-black shadow-[0_0_6px_rgba(245,158,11,0.35)]'
                        : 'bg-white/[0.04] border border-white/[0.07] text-slate-400'
                    }`}
                  >
                    {value}
                    {ticket.markedNumbers.includes(value) && (
                      <motion.span
                        initial={{ scale: 0.3, opacity: 1 }}
                        animate={{ scale: 2.2, opacity: 0 }}
                        transition={{ duration: 0.5 }}
                        className="absolute inset-0 rounded bg-amber-400/50 pointer-events-none"
                      />
                    )}
                  </motion.span>
                ) : (
                  <span
                    key={`${ticket.id}-r${rowIndex}-c${colIndex}`}
                    className="aspect-square bg-black/20 rounded border border-white/[0.03]"
                  />
                )
              )}
            </motion.div>
          );
        })}
      </div>

      <div className="flex justify-between text-[10px] text-slate-500 font-bold uppercase tracking-wider pt-1 border-t border-white/[0.05]">
        <span>Stake: {formatCredits(ticket.stakeMinor)} Cr</span>
        <span>Lines: {ticket.completedLines.length}/3</span>
      </div>
    </motion.article>
  );
});
BingoTicketCard.displayName = 'BingoTicketCard';

/** Full-house or pattern win celebration overlay */
function VictoryOverlay({ tickets, room, onClose }: {
  tickets: BingoTicket[];
  room: BingoRoomState | null;
  onClose: () => void;
}) {
  const totalWin = tickets.reduce((s, t) => s + t.payoutMinor, 0);

  let topLabel = 'Line Win!';
  if (room?.winMode === 'pattern') {
    const patternPrizeMap = new Map(
      (room.patternPrizes ?? []).map((pp) => [pp.patternId, pp.name]),
    );
    const allCompleted = tickets.flatMap((t) => t.completedPatterns ?? []);
    const uniqueCompleted = [...new Set(allCompleted)];
    const names = uniqueCompleted.map((pid) => patternPrizeMap.get(pid)).filter(Boolean);
    topLabel = names.length > 0 ? names.join(' & ') + '!' : 'Pattern Win!';
  } else {
    topLabel = tickets.some((t) => t.wonTiers.includes('full_house')) ? 'Full House!' :
               tickets.some((t) => t.wonTiers.includes('two_lines')) ? 'Two Lines!' : 'Line Win!';
  }

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
    >
      <motion.div
        initial={{ scale: 0.7, rotate: -6 }}
        animate={{ scale: 1, rotate: 0 }}
        exit={{ scale: 0.8, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 280, damping: 18 }}
        className="relative max-w-sm w-full mx-4 rounded-3xl border-2 border-amber-500/50 overflow-hidden"
        style={{ background: 'linear-gradient(135deg, #1a0a00 0%, #0d0505 50%, #080814 100%)' }}
      >
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: 'radial-gradient(ellipse at 50% 10%, rgba(245,158,11,0.15) 0%, transparent 60%)' }} />

        {Array.from({ length: 6 }, (_, i) => (
          <motion.div
            key={i}
            className="absolute w-1.5 h-1.5 rounded-full bg-amber-400"
            initial={{ x: '50%', y: '50%', opacity: 1 }}
            animate={{
              x: `${10 + i * 16}%`,
              y: `${5 + (i % 3) * 15}%`,
              opacity: 0,
              scale: [1, 1.5, 0],
            }}
            transition={{ duration: 1.2, delay: i * 0.15, repeat: Infinity }}
          />
        ))}

        <div className="relative z-10 p-8 text-center">
          <motion.div
            animate={{ rotate: [0, 10, -10, 0], scale: [1, 1.1, 1] }}
            transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
            className="mb-4 inline-block"
          >
            <Trophy size={64} className="text-amber-400 mx-auto" style={{ filter: 'drop-shadow(0 0 16px rgba(245,158,11,0.7))' }} />
          </motion.div>

          <motion.h2
            initial={{ y: 16, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.2 }}
            className="text-3xl font-black text-amber-400 mb-1"
          >
            {topLabel}
          </motion.h2>

          <motion.p
            initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.35 }}
            className="text-slate-400 text-sm mb-5"
          >
            Congratulations — you won!
          </motion.p>

          <motion.div
            initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 0.5, type: 'spring', stiffness: 240 }}
            className="inline-block bg-amber-500/10 border border-amber-500/30 rounded-2xl px-6 py-3 mb-6"
          >
            <span className="block text-[9px] font-black uppercase tracking-widest text-amber-600 mb-0.5">Total Prize</span>
            <span className="text-3xl font-black text-amber-400 font-mono">+{formatCreditsFull(totalWin)}</span>
          </motion.div>

          <motion.button
            whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.96 }}
            onClick={onClose}
            className="btn btn-primary btn-full"
          >
            Claim &amp; Continue
          </motion.button>
        </div>
      </motion.div>
    </motion.div>
  );
}

/** Circular countdown timer */
function CircularCountdown({ seconds, totalSeconds, status }: {
  seconds: number | null; totalSeconds: number; status: string;
}) {
  const R = 46;
  const C = 2 * Math.PI * R;
  const pct = (seconds !== null && totalSeconds > 0) ? Math.max(0, Math.min(1, seconds / totalSeconds)) : 1;
  const offset = C * (1 - pct);
  const urgent = seconds !== null && seconds <= 5;

  if (status !== 'open') return null;

  return (
    <div className="relative w-24 h-24 flex items-center justify-center">
      <svg className="w-full h-full -rotate-90 absolute inset-0" viewBox="0 0 96 96">
        <circle cx="48" cy="48" r={R} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="4" />
        <circle
          cx="48" cy="48" r={R} fill="none"
          stroke={urgent ? '#ef4444' : '#f59e0b'}
          strokeWidth="4" strokeLinecap="round"
          strokeDasharray={C} strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 0.9s linear', filter: `drop-shadow(0 0 5px ${urgent ? '#ef4444' : '#f59e0b'})` }}
        />
      </svg>
      <div className="z-10 flex flex-col items-center">
        <span className={`text-xl font-black font-mono ${urgent ? 'text-red-400 animate-pulse' : 'text-amber-400'}`}>
          {seconds !== null ? String(seconds).padStart(2, '0') : '--'}
        </span>
        <span className="text-[8px] font-bold uppercase tracking-widest text-slate-500">Starts in</span>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function Bingo({ onBack }: BingoProps) {
  const addToast     = useStore((s) => s.addToast);
  const setWallet    = useStore((s) => s.setWallet);
  const liveCounts   = useStore((s) => s.liveCounts);
  const soundVolume  = useStore((s) => s.soundVolume);
  const soundMuted   = useStore((s) => s.soundMuted);
  const setSoundVolume = useStore((s) => s.setSoundVolume);
  const setSoundMuted  = useStore((s) => s.setSoundMuted);

  const [rooms, setRooms]               = useState<BingoRoom[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [roomState, setRoomState]       = useState<BingoRoomState | null>(null);
  const [ticketCount, setTicketCount]   = useState(1);
  const [loadingRooms, setLoadingRooms] = useState(true);
  const [loadingState, setLoadingState] = useState(false);
  const [buying, setBuying]             = useState(false);
  const [activeTab, setActiveTab]       = useState<BingoTab>('active');
  const [showVictory, setShowVictory]   = useState(false);
  const [victoryTickets, setVictoryTickets] = useState<BingoTicket[]>([]);

  const [timeRemainingSecs, setTimeRemainingSecs] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevDrawnLengthRef = useRef(0);

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    { displayName: 'System', text: 'Welcome to iGames Bingo! Select a room to get started.', timestamp: new Date().toISOString(), isSystem: true },
  ]);
  const [chatInput, setChatInput] = useState('');
  const [sendingChat, setSendingChat] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLInputElement>(null);

  const currentUser = useStore((s) => s.user);

  const sendChatMessage = useCallback(() => {
    const text = chatInput.trim();
    if (!text || sendingChat || !selectedRoomId) return;
    const socket = getSocket();
    if (!socket) return;
    setSendingChat(true);
    socket.emit('bingo.chat.send', { roomId: selectedRoomId, text });
    setChatInput('');
    setSendingChat(false);
    chatInputRef.current?.focus();
  }, [chatInput, sendingChat, selectedRoomId]);

  const loadRooms = useCallback(async () => {
    setLoadingRooms(true);
    try {
      const next = await bingoApi.listRooms();
      setRooms(next);
      setSelectedRoomId((cur) => cur ?? next[0]?.id ?? null);
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

  useEffect(() => {
    if (!selectedRoomId) { setRoomState(null); return; }
    void loadRoomState(selectedRoomId);
    prevDrawnLengthRef.current = 0;

    const socket = getSocket();
    if (!socket) return;

    socket.emit('enter.game', { game: 'bingo' });

    const handleRoomUpdate = (payload: BingoRoomEventPayload) => {
      if (payload.roomId === selectedRoomId) {
        void Promise.all([loadRoomState(selectedRoomId), loadRooms()]);
      } else {
        void loadRooms();
      }
    };

    const handleNumberDrawn = (payload: BingoRoomEventPayload) => {
      if (payload.roomId !== selectedRoomId) return;
      soundEngine.pop();
      void loadRoomState(selectedRoomId);
    };

    const handleRoomCompleted = (payload: BingoRoomEventPayload) => {
      if (payload.roomId !== selectedRoomId) return;
      void loadRoomState(selectedRoomId);
      addToast('info', 'Bingo room completed — payouts settled!');
    };

    const handleChatMessage = (payload: { roomId: string; userId?: string; displayName: string; text: string; timestamp: string }) => {
      if (payload.roomId !== selectedRoomId) return;
      setChatMessages((prev) => [...prev.slice(-49), { ...payload }]);
    };

    socket.on('bingo.room.updated', handleRoomUpdate);
    socket.on('bingo.number.drawn', handleNumberDrawn);
    socket.on('bingo.room.completed', handleRoomCompleted);
    socket.on('bingo.chat.message', handleChatMessage);

    return () => {
      socket.emit('leave.game', { game: 'bingo' });
      socket.off('bingo.room.updated', handleRoomUpdate);
      socket.off('bingo.number.drawn', handleNumberDrawn);
      socket.off('bingo.room.completed', handleRoomCompleted);
      socket.off('bingo.chat.message', handleChatMessage);
    };
  }, [loadRoomState, loadRooms, selectedRoomId, addToast]);

  // Countdown timer for open rooms
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    setTimeRemainingSecs(null);

    const room = rooms.find((r) => r.id === selectedRoomId);
    if (!room || room.status !== 'open') return;

    const tick = () => {
      const ms = new Date(room.scheduledStartAt).getTime() - Date.now();
      const secs = Math.max(0, Math.floor(ms / 1000));
      setTimeRemainingSecs(secs);
      if (secs > 0 && secs <= 5) soundEngine.countdown(secs === 1);
      if (secs <= 0 && timerRef.current) clearInterval(timerRef.current);
    };

    tick();
    timerRef.current = setInterval(tick, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [rooms, selectedRoomId]);

  // Check for win on state update
  useEffect(() => {
    if (roomState?.status !== 'completed' || !roomState.tickets?.length) return;
    const winners = roomState.tickets.filter((t) => t.payoutMinor > 0);
    if (!winners.length) return;
    const prevLen = prevDrawnLengthRef.current;
    const curLen = roomState.drawnNumbers?.length ?? 0;
    if (curLen > prevLen) {
      soundEngine.win();
      confetti({ particleCount: 220, spread: 90, origin: { y: 0.55 }, colors: ['#00FFFF', '#FF0000', '#FFE600', '#FFFFFF'] });
      setVictoryTickets(winners);
      setShowVictory(true);
    }
    prevDrawnLengthRef.current = curLen;
  }, [roomState?.status, roomState?.tickets, roomState?.drawnNumbers]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const selectedRoom = useMemo(
    () => roomState ?? rooms.find((r) => r.id === selectedRoomId) ?? null,
    [roomState, rooms, selectedRoomId],
  );

  const patternPrizeMap = useMemo(
    () => new Map((selectedRoom?.patternPrizes ?? []).map((pp) => [pp.patternId, pp.name])),
    [selectedRoom],
  );

  const isPatternMode = selectedRoom?.winMode === 'pattern';
  const numberRange = selectedRoom?.numberRange ?? (isPatternMode ? 75 : 90);
  const remainingTickets = selectedRoom ? Math.max(0, selectedRoom.maxTickets - selectedRoom.soldTickets) : 0;
  const salesOpen = selectedRoom?.status === 'open';
  const buyDisabledReason = !selectedRoom ? 'Pick a room first.'
    : !salesOpen ? 'Ticket sales are closed.'
    : remainingTickets <= 0 ? 'This room is sold out.' : null;

  const buyTickets = async () => {
    if (!selectedRoomId || buyDisabledReason) { addToast('info', buyDisabledReason ?? 'Pick a room.'); return; }
    setBuying(true);
    try {
      await bingoApi.purchaseTickets(selectedRoomId, ticketCount, createIdempotencyKey('bingo'));
      const [nextWallet] = await Promise.all([walletApi.getWallet(), loadRoomState(selectedRoomId), loadRooms()]);
      setWallet(nextWallet);
      soundEngine.cashout();
      addToast('success', `Bought ${ticketCount} Bingo ticket${ticketCount > 1 ? 's' : ''}!`);
    } catch (err) {
      addToast('error', getErrorMessage(err));
    } finally {
      setBuying(false);
    }
  };

  const drawnNumbers = roomState?.drawnNumbers ?? [];
  const lastNumber = drawnNumbers.length > 0 ? drawnNumbers[drawnNumbers.length - 1] : null;

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5 max-w-6xl mx-auto pb-20">
      <AnimatePresence>
        {showVictory && victoryTickets.length > 0 && (
          <VictoryOverlay
            tickets={victoryTickets}
            room={roomState}
            onClose={() => { soundEngine.click(); setShowVictory(false); }}
          />
        )}
      </AnimatePresence>

      <GameTabs tabs={BINGO_TABS} activeTab={activeTab} onTabChange={setActiveTab} onBack={onBack} ariaLabel="Bingo sections" />

      {/* Audio bar */}
      <div className="flex justify-between items-center">
        {liveCounts && liveCounts.bingoOnline > 0 && (
          <span className="live-badge-pulse">
            <span className="pulse-dot" />
            {liveCounts.bingoOnline} online
          </span>
        )}
        <div className="flex items-center gap-2 ml-auto">
          <button onClick={() => setSoundMuted(!soundMuted)} className="btn btn-ghost btn-sm icon-btn">
            {soundMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>
          {!soundMuted && (
            <input type="range" min="0" max="1" step="0.05" value={soundVolume}
              onChange={(e) => setSoundVolume(parseFloat(e.target.value))}
              className="w-20 accent-amber-500 cursor-pointer h-1 rounded" />
          )}
        </div>
      </div>

      {/* Room selection */}
      <section className="card space-y-4">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <div>
            <h3 className="section-title">Bingo Rooms</h3>
            <p className="hero-copy text-xs">Choose a room, buy tickets, and wait for the draw.</p>
          </div>
          <button onClick={loadRooms} className="btn btn-secondary btn-sm">
            <RefreshCw size={13} className={loadingRooms ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>

        {loadingRooms && rooms.length === 0 ? (
          <div className="centered-loader"><div className="spinner" /></div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {rooms.map((room) => (
              <motion.button
                key={room.id}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.97 }}
                onClick={() => { soundEngine.click(); setSelectedRoomId(room.id); }}
                className={`p-3.5 rounded-xl border text-left transition-all duration-200 ${
                  selectedRoomId === room.id
                    ? 'bg-red-500/8 border-red-500/40 shadow-[0_0_12px_rgba(239,68,68,0.12)]'
                    : 'bg-white/[0.025] border-white/[0.06] hover:border-white/[0.12]'
                }`}
              >
                <span className="block font-black text-sm text-slate-100">{room.name}</span>
                <span className="block text-[10px] text-slate-500 mt-0.5">{formatCredits(room.ticketPriceMinor)} Cr/ticket</span>
                <div className="flex items-center justify-between mt-2">
                  <div className="flex items-center gap-1">
                    <span className={`text-[9px] font-bold uppercase ${
                      room.status === 'open' ? 'text-emerald-400' : room.status === 'running' ? 'text-red-400' : 'text-slate-500'
                    }`}>{room.status}</span>
                    {room.winMode === 'pattern' && (
                      <span className="text-[8px] font-black uppercase text-violet-400 bg-violet-500/10 px-1 rounded">PTN</span>
                    )}
                  </div>
                  <span className="text-[9px] text-slate-500">{room.soldTickets}/{room.maxTickets}</span>
                </div>
              </motion.button>
            ))}
          </div>
        )}
      </section>

      {selectedRoom ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">

          {/* LEFT COLUMN */}
          <div className="lg:col-span-4 space-y-4">

            {/* Draw machine + timer card */}
            <div className="card text-center relative overflow-hidden">
              <div className="absolute inset-0 pointer-events-none"
                style={{ background: 'radial-gradient(ellipse at 50% 0%, rgba(239,68,68,0.06) 0%, transparent 65%)' }} />
              <DrawMachine
                roomStatus={selectedRoom.status}
                lastNumber={lastNumber}
                drawnCount={drawnNumbers.length}
                maxNumber={numberRange}
              />
              {selectedRoom.status === 'open' && (
                <div className="flex justify-center mt-2">
                  <CircularCountdown
                    seconds={timeRemainingSecs}
                    totalSeconds={40}
                    status={selectedRoom.status}
                  />
                </div>
              )}
              {drawnNumbers.length > 1 && (
                <div className="mt-3 pt-3 border-t border-white/[0.05]">
                  <p className="text-[9px] font-bold uppercase tracking-wider text-slate-500 mb-2">Recent balls</p>
                  <div className="flex justify-center gap-1.5 flex-wrap">
                    {drawnNumbers.slice(-8).map((n, i) => (
                      <motion.span
                        key={`recent-${n}-${i}`}
                        initial={{ scale: 0, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ delay: i * 0.04 }}
                        className="w-7 h-7 rounded-full bg-red-900/60 border border-red-500/30 flex items-center justify-center text-[10px] font-black text-red-300"
                      >
                        {n}
                      </motion.span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Buy tickets panel */}
            <div className="card space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-black uppercase tracking-wider text-slate-300">Purchase Tickets</h3>
                {isPatternMode && (
                  <span className="text-[9px] font-black uppercase tracking-wider text-violet-400 bg-violet-500/10 border border-violet-500/20 px-2 py-0.5 rounded-full">
                    Pattern Mode · 1–{numberRange}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: 'Price', value: `${formatCredits(selectedRoom.ticketPriceMinor)} Cr`, color: 'text-amber-400' },
                  { label: 'Remaining', value: `${remainingTickets}`, color: 'text-indigo-400' },
                ].map(({ label, value, color }) => (
                  <div key={label} className="rounded-xl bg-white/[0.03] border border-white/[0.05] p-2.5 text-center">
                    <span className="block text-[9px] font-bold uppercase tracking-wider text-slate-500">{label}</span>
                    <span className={`text-sm font-black ${color}`}>{value}</span>
                  </div>
                ))}
              </div>

              <div className="flex gap-2">
                <input
                  type="number" min={1} max={Math.min(24, remainingTickets || 24)} value={ticketCount}
                  onChange={(e) => setTicketCount(Math.max(1, Number(e.target.value) || 1))}
                  className="input text-center font-mono font-black w-20 py-2"
                />
                <motion.button
                  whileHover={!buying && !buyDisabledReason ? { scale: 1.02 } : {}}
                  whileTap={{ scale: 0.97 }}
                  onClick={buyTickets}
                  disabled={buying || !!buyDisabledReason}
                  className="btn btn-primary flex-1"
                >
                  {buying ? 'Processing...' : 'Buy Tickets'}
                </motion.button>
              </div>

              {buyDisabledReason && (
                <p className="text-[10px] text-red-400 font-bold text-center">{buyDisabledReason}</p>
              )}

              {/* Prize tiers — line mode */}
              {!isPatternMode && (
                <div className="border-t border-white/[0.05] pt-3 space-y-1">
                  <p className="text-[9px] font-black uppercase tracking-wider text-slate-500 mb-2">Prize Tiers</p>
                  {Object.entries(selectedRoom.prizes).map(([tier, amount]) => (
                    <div key={tier} className="flex justify-between items-center text-xs">
                      <span className="text-slate-400">{formatPrizeTier(tier)}</span>
                      <span className="font-black text-amber-400">{formatCreditsFull(amount)} Cr</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Pattern prizes */}
              {isPatternMode && selectedRoom.patternPrizes && selectedRoom.patternPrizes.length > 0 && (
                <div className="border-t border-white/[0.05] pt-3 space-y-1.5">
                  <p className="text-[9px] font-black uppercase tracking-wider text-slate-500 mb-2">Pattern Prizes</p>
                  {selectedRoom.patternPrizes.map((pp) => (
                    <div key={pp.patternId} className="flex justify-between items-center text-xs">
                      <div className="flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-violet-400 flex-shrink-0" />
                        <span className="text-slate-300 font-bold">{pp.name}</span>
                      </div>
                      <span className="font-black text-amber-400">{formatCreditsFull(pp.prizeMinor)} Cr</span>
                    </div>
                  ))}
                  {selectedRoom.settledTiers.length > 0 && (
                    <p className="text-[9px] text-emerald-500 font-bold mt-1">
                      {selectedRoom.settledTiers.length} pattern{selectedRoom.settledTiers.length > 1 ? 's' : ''} settled
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Chat */}
            <div className="card flex flex-col overflow-hidden" style={{ height: 260 }}>
              <div className="flex items-center justify-between mb-2 pb-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                <span style={{ fontSize: 10, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 5 }}>
                  <MessageSquare size={12} /> Room Chat
                </span>
                <span style={{ fontSize: 9, color: '#475569', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Users size={10} /> Live
                </span>
              </div>
              <div className="flex-1 overflow-y-auto pr-1" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {chatMessages.map((msg, i) => {
                  const isOwn = !msg.isSystem && msg.userId === currentUser?.id;
                  return (
                    <div key={i} style={{ fontSize: 12, display: 'flex', flexDirection: 'column', alignItems: isOwn ? 'flex-end' : 'flex-start' }}>
                      {!msg.isSystem && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                          <span style={{ fontWeight: 700, color: isOwn ? 'var(--gold)' : '#60a5fa', fontSize: 11 }}>{isOwn ? 'You' : msg.displayName}</span>
                          <span style={{ fontSize: 9, color: '#475569' }}>
                            {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      )}
                      <div style={{
                        padding: '4px 8px',
                        borderRadius: msg.isSystem ? 6 : (isOwn ? '10px 10px 2px 10px' : '10px 10px 10px 2px'),
                        background: msg.isSystem
                          ? 'rgba(255,255,255,0.04)'
                          : (isOwn ? 'rgba(250,204,21,0.12)' : 'rgba(96,165,250,0.1)'),
                        border: `1px solid ${msg.isSystem ? 'rgba(255,255,255,0.05)' : (isOwn ? 'rgba(250,204,21,0.2)' : 'rgba(96,165,250,0.15)')}`,
                        color: msg.isSystem ? 'var(--text-muted)' : 'var(--text-secondary)',
                        fontSize: msg.isSystem ? 10 : 12,
                        lineHeight: 1.4,
                        maxWidth: '85%',
                      }}>
                        {msg.text}
                      </div>
                    </div>
                  );
                })}
                <div ref={chatEndRef} />
              </div>
              {/* Input row */}
              {selectedRoomId && (
                <div style={{ display: 'flex', gap: 6, marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                  <input
                    ref={chatInputRef}
                    className="input"
                    style={{ flex: 1, fontSize: 12, padding: '6px 10px', height: 32 }}
                    placeholder="Say something…"
                    maxLength={200}
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') sendChatMessage(); }}
                    disabled={sendingChat}
                  />
                  <button
                    className="btn btn-primary"
                    style={{ fontSize: 11, padding: '0 12px', height: 32, minWidth: 44 }}
                    onClick={sendChatMessage}
                    disabled={!chatInput.trim() || sendingChat}
                  >
                    Send
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* RIGHT COLUMN */}
          <div className="lg:col-span-8 space-y-4">

            {/* Number Board tab */}
            {activeTab === 'draws' && (
              <motion.section
                initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                className="card space-y-5"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="section-title">Called Numbers Board</h3>
                    <p className="hero-copy text-xs">
                      {drawnNumbers.length > 0
                        ? `${drawnNumbers.length} of ${numberRange} numbers called`
                        : 'Waiting for the game to start.'}
                    </p>
                  </div>
                  {isPatternMode && (
                    <div className="text-right">
                      <span className="text-[9px] font-black uppercase text-violet-400">Pattern Bingo</span>
                      <p className="text-[9px] text-slate-500">1 – {numberRange}</p>
                    </div>
                  )}
                </div>

                {loadingState && !roomState ? (
                  <div className="centered-loader"><div className="spinner" /></div>
                ) : (
                  <NumberBoard drawnNumbers={drawnNumbers} numberRange={numberRange} />
                )}
              </motion.section>
            )}

            {/* My Tickets */}
            {(activeTab === 'active' || activeTab === 'tickets') && (
              <motion.section
                initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                className="card space-y-4"
              >
                <div>
                  <h3 className="section-title">My Cards</h3>
                  <p className="hero-copy text-xs">
                    {isPatternMode
                      ? 'Pattern cards auto-mark as numbers are called. FREE center is always marked.'
                      : 'Cards auto-mark as numbers are called.'}
                  </p>
                </div>

                {roomState?.tickets?.length ? (
                  <div className={`grid gap-4 ${isPatternMode ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 md:grid-cols-2'}`}>
                    {roomState.tickets.map((ticket) => (
                      <BingoTicketCard
                        key={ticket.id}
                        ticket={ticket}
                        patternPrizeMap={patternPrizeMap}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="centered-loader border border-dashed border-white/[0.07] rounded-xl min-h-36">
                    <Sparkles size={24} className="text-slate-600" />
                    <span className="text-slate-500 text-xs">
                      {roomState ? "No tickets yet — buy some to play!" : "Select a room to view your tickets."}
                    </span>
                  </div>
                )}
              </motion.section>
            )}
          </div>
        </div>
      ) : (
        <section className="card text-center py-12">
          <Sparkles size={28} className="mx-auto text-slate-600 mb-3" />
          <p className="text-slate-400 text-sm">No Bingo rooms available right now.</p>
        </section>
      )}
    </div>
  );
}
