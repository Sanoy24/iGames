import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeft, Trophy, Sparkles,
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

const RESULT_DISPLAY_MS = 10_000;
const POLL_INTERVAL_MS = 5_000;

// ─── Color config ─────────────────────────────────────────────────────────────

// 75-ball (pattern): B/I/N/G/O columns of 15
const BINGO_COLS_75 = [
  { letter: 'B', from: 1,  to: 15,  color: '#ef4444', glow: 'rgba(239,68,68,0.6)',  bg: 'rgba(239,68,68,0.18)'  },
  { letter: 'I', from: 16, to: 30,  color: '#3b82f6', glow: 'rgba(59,130,246,0.6)', bg: 'rgba(59,130,246,0.18)' },
  { letter: 'N', from: 31, to: 45,  color: '#22c55e', glow: 'rgba(34,197,94,0.6)',  bg: 'rgba(34,197,94,0.18)'  },
  { letter: 'G', from: 46, to: 60,  color: '#a855f7', glow: 'rgba(168,85,247,0.6)', bg: 'rgba(168,85,247,0.18)' },
  { letter: 'O', from: 61, to: 75,  color: '#06b6d4', glow: 'rgba(6,182,212,0.6)',  bg: 'rgba(6,182,212,0.18)'  },
];

// 90-ball: 9 groups of 10
const BALL_GROUPS_90 = [
  { from: 1,  to: 10, color: '#ef4444', glow: 'rgba(239,68,68,0.6)',   bg: 'rgba(239,68,68,0.18)'   },
  { from: 11, to: 20, color: '#3b82f6', glow: 'rgba(59,130,246,0.6)',  bg: 'rgba(59,130,246,0.18)'  },
  { from: 21, to: 30, color: '#22c55e', glow: 'rgba(34,197,94,0.6)',   bg: 'rgba(34,197,94,0.18)'   },
  { from: 31, to: 40, color: '#a855f7', glow: 'rgba(168,85,247,0.6)',  bg: 'rgba(168,85,247,0.18)'  },
  { from: 41, to: 50, color: '#06b6d4', glow: 'rgba(6,182,212,0.6)',   bg: 'rgba(6,182,212,0.18)'   },
  { from: 51, to: 60, color: '#f97316', glow: 'rgba(249,115,22,0.6)',  bg: 'rgba(249,115,22,0.18)'  },
  { from: 61, to: 70, color: '#ec4899', glow: 'rgba(236,72,153,0.6)',  bg: 'rgba(236,72,153,0.18)'  },
  { from: 71, to: 80, color: '#14b8a6', glow: 'rgba(20,184,166,0.6)',  bg: 'rgba(20,184,166,0.18)'  },
  { from: 81, to: 90, color: '#f59e0b', glow: 'rgba(245,158,11,0.6)',  bg: 'rgba(245,158,11,0.18)'  },
];

function getBallStyle(n: number, isPatternMode: boolean) {
  if (isPatternMode) {
    return BINGO_COLS_75.find(c => n >= c.from && n <= c.to) ?? BINGO_COLS_75[0];
  }
  return BALL_GROUPS_90.find(g => n >= g.from && n <= g.to) ?? BALL_GROUPS_90[0];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isPatternGrid(grid: Array<Array<number | null>>): boolean {
  return grid.length === 5 && (grid[0]?.length ?? 0) === 5;
}

// ─── Number Board ─────────────────────────────────────────────────────────────

const NumberBoard = memo(({ drawnNumbers, numberRange, isPatternMode, myCardNums }: {
  drawnNumbers: number[];
  numberRange: number;
  isPatternMode: boolean;
  myCardNums: Set<number>;
}) => {
  const drawnSet = useMemo(() => new Set(drawnNumbers), [drawnNumbers]);

  if (isPatternMode) {
    // 5 columns × 15 rows (B/I/N/G/O)
    return (
      <div className="grid grid-cols-5 gap-1">
        {BINGO_COLS_75.map(col => (
          <div key={col.letter} className="flex flex-col gap-0.5">
            <div
              className="text-center text-[10px] font-black py-0.5 rounded-sm mb-0.5"
              style={{ color: col.color, background: col.bg }}
            >
              {col.letter}
            </div>
            {Array.from({ length: col.to - col.from + 1 }, (_, i) => col.from + i).map(n => {
              const called = drawnSet.has(n);
              const onCard = myCardNums.has(n);
              return (
                <motion.div
                  key={n}
                  animate={called ? { scale: [1, 1.25, 1] } : {}}
                  transition={{ duration: 0.3, ease: 'backOut' }}
                  className="aspect-square rounded-full flex items-center justify-center text-[9px] font-bold font-mono"
                  style={
                    called
                      ? {
                          background: col.color,
                          color: '#fff',
                          boxShadow: onCard ? `0 0 8px ${col.glow}, 0 0 2px #fff inset` : undefined,
                          outline: onCard ? '2px solid #fff' : undefined,
                          outlineOffset: onCard ? '1px' : undefined,
                        }
                      : onCard
                      ? { background: col.bg, color: col.color, border: `1px dashed ${col.color}` }
                      : { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.25)' }
                  }
                >
                  {n}
                </motion.div>
              );
            })}
          </div>
        ))}
      </div>
    );
  }

  // 90-ball: 9 columns (groups of 10), 10 rows
  const groups = BALL_GROUPS_90.filter(g => g.from <= numberRange);
  return (
    <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${groups.length}, 1fr)` }}>
      {groups.map(group => (
        <div key={group.from} className="flex flex-col gap-0.5">
          <div
            className="text-center text-[7px] font-black py-0.5 rounded-sm mb-0.5"
            style={{ color: group.color, background: group.bg }}
          >
            {group.from}–{Math.min(group.to, numberRange)}
          </div>
          {Array.from(
            { length: Math.min(group.to, numberRange) - group.from + 1 },
            (_, i) => group.from + i,
          ).map(n => {
            const called = drawnSet.has(n);
            const onCard = myCardNums.has(n);
            return (
              <motion.div
                key={n}
                animate={called ? { scale: [1, 1.2, 1] } : {}}
                transition={{ duration: 0.3, ease: 'backOut' }}
                className="aspect-square rounded-full flex items-center justify-center text-[8px] font-bold font-mono"
                style={
                  called
                    ? {
                        background: group.color,
                        color: '#fff',
                        boxShadow: onCard ? `0 0 8px ${group.glow}` : undefined,
                        outline: onCard ? '2px solid #fff' : undefined,
                        outlineOffset: onCard ? '1px' : undefined,
                      }
                    : onCard
                    ? { background: group.bg, color: group.color, border: `1px dashed ${group.color}` }
                    : { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.22)' }
                }
              >
                {n}
              </motion.div>
            );
          })}
        </div>
      ))}
    </div>
  );
});
NumberBoard.displayName = 'NumberBoard';

// ─── Draw Section (current + recent balls) ───────────────────────────────────

function DrawSection({ drawnNumbers, isPatternMode, status, count, max }: {
  drawnNumbers: number[];
  isPatternMode: boolean;
  status: string;
  count: number;
  max: number;
}) {
  const currentBall = drawnNumbers.length > 0 ? drawnNumbers[drawnNumbers.length - 1] : null;
  const recentPrev = drawnNumbers.slice(-4, -1);

  if (status === 'completed') {
    return (
      <div className="flex flex-col items-center justify-center gap-1 py-2">
        <Trophy size={32} className="text-amber-400" />
        <span className="text-[10px] font-black text-amber-500 uppercase tracking-wider">Complete</span>
      </div>
    );
  }

  if (status === 'open' || currentBall === null) {
    return (
      <div className="flex flex-col items-center justify-center gap-1 py-2">
        <motion.div
          animate={{ opacity: [0.4, 1, 0.4] }}
          transition={{ duration: 1.4, repeat: Infinity }}
          className="w-16 h-16 rounded-full border-2 border-dashed border-white/20 flex items-center justify-center"
        >
          <span className="text-[9px] font-black text-white/40 uppercase">Waiting</span>
        </motion.div>
        <span className="text-[9px] text-slate-500">{count}/{max} called</span>
      </div>
    );
  }

  const curStyle = getBallStyle(currentBall, isPatternMode);

  return (
    <div className="flex flex-col items-center gap-2">
      {/* Previous 3 balls */}
      {recentPrev.length > 0 && (
        <div className="flex gap-1.5 justify-center">
          {recentPrev.map((n) => {
            const s = getBallStyle(n, isPatternMode);
            return (
              <div
                key={n}
                className="w-9 h-9 rounded-full flex items-center justify-center text-[10px] font-black text-white"
                style={{ background: s.color, opacity: 0.75 }}
              >
                {isPatternMode
                  ? (BINGO_COLS_75.find(c => n >= c.from && n <= c.to)?.letter ?? '') + n
                  : n}
              </div>
            );
          })}
        </div>
      )}

      {/* Current ball — large and glowing */}
      <AnimatePresence mode="popLayout">
        <motion.div
          key={currentBall}
          initial={{ scale: 0.3, rotate: -270, opacity: 0 }}
          animate={{ scale: 1, rotate: 0, opacity: 1 }}
          exit={{ scale: 0.5, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 260, damping: 18 }}
          className="w-20 h-20 rounded-full flex items-center justify-center font-black text-white"
          style={{
            background: `radial-gradient(circle at 35% 35%, ${curStyle.color}ee, ${curStyle.color}99)`,
            boxShadow: `0 0 28px ${curStyle.glow}, 0 0 8px ${curStyle.glow}`,
            fontSize: currentBall >= 10 ? 22 : 26,
          }}
        >
          {isPatternMode
            ? (BINGO_COLS_75.find(c => currentBall >= c.from && currentBall <= c.to)?.letter ?? '') + currentBall
            : currentBall}
        </motion.div>
      </AnimatePresence>

      <span className="text-[9px] text-slate-500 font-mono">#{count} of {max}</span>
    </div>
  );
}

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
          {won ? `+${formatCredits(ticket.payoutMinor)} ETB` : ticket.settlementStatus}
        </span>
      </div>
      {ticket.completedPatterns?.length > 0 && (
        <p className="text-[9px] text-amber-400 font-bold -mt-1">
          {ticket.completedPatterns.map((pid) => patternPrizeMap.get(pid) ?? 'Pattern').join(' · ')}
        </p>
      )}
      <div className="grid grid-cols-5 gap-0.5">
        {BINGO_COLS_75.map((col) => (
          <div key={col.letter} className="text-center text-[9px] font-black" style={{ color: col.color }}>{col.letter}</div>
        ))}
      </div>
      <div className="grid grid-cols-5 gap-0.5">
        {grid.map((row, ri) =>
          row.map((value, ci) => {
            const isFree = value === null;
            const isMarked = isFree || ticket.markedNumbers.includes(value!);
            const colStyle = isMarked && !isFree ? getBallStyle(value!, true) : null;
            return (
              <motion.span
                key={`${ticket.id}-${ri}-${ci}`}
                animate={isMarked && !isFree ? { backgroundColor: colStyle!.color } : {}}
                transition={{ duration: 0.3, ease: 'backOut' }}
                className={`aspect-square rounded flex items-center justify-center text-[9px] font-bold font-mono ${
                  isFree ? 'bg-red-600/25 border border-red-500/30 text-red-400 text-[7px]'
                    : isMarked ? 'text-white'
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
          {won ? `+${formatCredits(ticket.payoutMinor)} ETB` : ticket.settlementStatus}
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
        <span>Stake {formatCredits(ticket.stakeMinor)} ETB</span>
        <span>{ticket.completedLines.length}/3 lines</span>
      </div>
    </motion.article>
  );
});
BingoTicketCard.displayName = 'BingoTicketCard';

// ─── Room Result Overlay ──────────────────────────────────────────────────────

function RoomResultOverlay({ room, myTickets, resultSecs, onClose }: {
  room: BingoRoomState;
  myTickets: BingoTicket[];
  resultSecs: number;
  onClose: () => void;
}) {
  const totalWin = myTickets.reduce((s, t) => s + t.payoutMinor, 0);
  const iWon = totalWin > 0;

  const summary = room.settlementSummary ?? {};
  const fullHouse = summary.full_house as Record<string, unknown> | undefined;
  const winnerDisplayName = (fullHouse?.winnerDisplayName as string | undefined) ?? 'A lucky player';
  const prizeMinor = (fullHouse?.prizeMinor as number | undefined) ?? room.prizeMinor;
  const winnerTicket = iWon ? myTickets.find((t) => t.payoutMinor > 0) ?? null : null;

  const progressPct = Math.max(0, Math.min(100, (resultSecs / (RESULT_DISPLAY_MS / 1000)) * 100));

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.75, y: 24 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.85, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 280, damping: 20 }}
        onClick={(e) => e.stopPropagation()}
        className="relative max-w-sm w-full mx-4 rounded-3xl border-2 overflow-hidden"
        style={{
          background: 'linear-gradient(160deg, #0a1628 0%, #060d1a 50%, #0a0a14 100%)',
          borderColor: iWon ? 'rgba(245,158,11,0.5)' : 'rgba(239,68,68,0.4)',
        }}
      >
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: iWon
              ? 'radial-gradient(ellipse at 50% 0%, rgba(245,158,11,0.18) 0%, transparent 60%)'
              : 'radial-gradient(ellipse at 50% 0%, rgba(239,68,68,0.15) 0%, transparent 60%)',
          }}
        />
        <div className="relative z-10 text-center pt-7 pb-3 px-6">
          <motion.h1
            animate={{ scale: [1, 1.05, 1] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
            className="text-5xl font-black tracking-wider mb-3"
            style={{ color: '#fff', textShadow: '0 0 30px rgba(239,68,68,0.8), 0 0 60px rgba(239,68,68,0.4)' }}
          >
            BINGO!
          </motion.h1>
          <div className="flex items-center justify-center gap-2 flex-wrap">
            <span
              className="font-black text-sm px-3 py-1 rounded-full border"
              style={{ background: 'rgba(16,185,129,0.15)', borderColor: 'rgba(16,185,129,0.35)', color: '#34d399' }}
            >
              {winnerDisplayName}
            </span>
            <span className="text-white/70 text-sm font-semibold">has won the game</span>
          </div>
        </div>

        {iWon && winnerTicket && !isPatternGrid(winnerTicket.grid) && (
          <div className="relative z-10 px-5 pb-3">
            <div className="rounded-2xl border p-3" style={{ background: 'rgba(245,158,11,0.06)', borderColor: 'rgba(245,158,11,0.25)' }}>
              <div className="space-y-1">
                {winnerTicket.grid.map((row, ri) => {
                  const isRowComplete = winnerTicket.completedLines.includes(ri);
                  return (
                    <div key={ri} className={`grid grid-cols-9 gap-0.5 rounded p-0.5 ${isRowComplete ? 'bg-amber-500/10' : ''}`}>
                      {row.map((value, ci) =>
                        value ? (
                          <span
                            key={ci}
                            className={`aspect-square rounded flex items-center justify-center text-[9px] font-black font-mono ${
                              winnerTicket.markedNumbers.includes(value)
                                ? isRowComplete ? 'bg-amber-400 text-black' : 'bg-red-600 text-white border border-red-400/60'
                                : 'bg-white/[0.04] border border-white/[0.06] text-slate-500'
                            }`}
                          >
                            {value}
                          </span>
                        ) : (
                          <span key={ci} className="aspect-square bg-black/20 rounded border border-white/[0.03]" />
                        )
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="flex items-center justify-between mt-2 pt-2 border-t border-white/[0.06]">
                <span className="text-[10px] font-black text-amber-400">Prize: {formatCreditsFull(winnerTicket.payoutMinor)} ETB</span>
                <span className="text-[10px] text-slate-500 font-mono">Card #{winnerTicket.id.slice(-3)}</span>
              </div>
            </div>
          </div>
        )}

        {(!iWon || isPatternGrid(winnerTicket?.grid ?? [])) && prizeMinor > 0 && (
          <div className="relative z-10 flex justify-center pb-3 px-5">
            <div className="rounded-2xl border px-6 py-3 text-center" style={{ background: 'rgba(239,68,68,0.08)', borderColor: 'rgba(239,68,68,0.2)' }}>
              <span className="block text-[9px] font-black uppercase tracking-widest text-red-400/70 mb-0.5">Prize</span>
              <span className="text-2xl font-black text-white font-mono">{formatCreditsFull(prizeMinor)} ETB</span>
            </div>
          </div>
        )}

        <div className="relative z-10 px-5 pb-6">
          <div className="text-center mb-2">
            <span className="text-3xl font-black font-mono text-red-400">{resultSecs}s</span>
          </div>
          <div className="h-3 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.07)' }}>
            <motion.div
              className="h-full rounded-full"
              style={{ background: 'linear-gradient(90deg, #10b981, #34d399)' }}
              animate={{ width: `${progressPct}%` }}
              transition={{ duration: 0.9, ease: 'linear' }}
            />
          </div>
        </div>
      </motion.div>
    </motion.div>
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

  const [room, setRoom]                   = useState<BingoRoomState | null>(null);
  const [loading, setLoading]             = useState(true);
  const [holdingResult, setHoldingResult] = useState(false);
  const [buying, setBuying]               = useState(false);
  const [localTickets, setLocalTickets]   = useState<BingoTicket[]>([]);
  const localRoomIdRef                    = useRef<string | null>(null);
  const [showChat, setShowChat]           = useState(false);
  const [timeRemainingSecs, setTimeRemainingSecs] = useState<number | null>(null);
  const [resultSecs, setResultSecs]       = useState<number>(0);

  const roomIdRef         = useRef<string | null>(null);
  const holdingResultRef  = useRef(false);
  const victoryRoomRef    = useRef<string | null>(null);
  const reconcileTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resultTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownRef      = useRef<ReturnType<typeof setInterval> | null>(null);

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    { displayName: 'System', text: 'Welcome to iGames Bingo!', timestamp: new Date().toISOString(), isSystem: true },
  ]);
  const [chatInput, setChatInput] = useState('');
  const chatEndRef  = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLInputElement>(null);

  // ── Load ────────────────────────────────────────────────────────────────────

  const loadCurrent = useCallback(async () => {
    try {
      const next = await bingoApi.getCurrentRoom();
      setRoom(next);
      roomIdRef.current = next?.id ?? null;
      if (next?.id !== localRoomIdRef.current) {
        setLocalTickets([]);
        localRoomIdRef.current = next?.id ?? null;
      }
    } catch (err) {
      addToast('error', getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    void loadCurrent();
    const id = setInterval(() => {
      if (!holdingResultRef.current) void loadCurrent();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [loadCurrent]);

  // ── Socket: presence ─────────────────────────────────────────────────────────
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    socket.emit('enter.game', { game: 'bingo' });
    return () => { socket.emit('leave.game', { game: 'bingo' }); };
  }, [isSocketConnected]);

  // ── Socket: game events ──────────────────────────────────────────────────────
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const scheduleReconcile = () => {
      if (reconcileTimerRef.current) clearTimeout(reconcileTimerRef.current);
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
      setLocalTickets((prev) =>
        prev.map((t) => {
          if (t.markedNumbers.includes(drawn)) return t;
          const isOnCard = t.grid.some((row) => row.some((cell) => cell === drawn));
          if (!isOnCard) return t;
          return { ...t, markedNumbers: [...t.markedNumbers, drawn] };
        }),
      );
      scheduleReconcile();
    };

    const onRoomUpdate = (p: { roomId?: string }) => {
      if (holdingResultRef.current) return;
      if (p.roomId === roomIdRef.current || roomIdRef.current === null) void loadCurrent();
    };

    const onRoomCompleted = (p: { roomId?: string }) => {
      if (p.roomId !== roomIdRef.current) return;
      void loadCurrent();
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

  // ── Result hold ──────────────────────────────────────────────────────────────
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

  // ── Buy-window countdown ─────────────────────────────────────────────────────
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

  // ── Win detection ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (room?.status !== 'completed') return;
    if (victoryRoomRef.current === room.id) return;
    const allTickets = [...(room.tickets ?? []), ...localTickets];
    const winners = allTickets.filter((t) => t.payoutMinor > 0);
    if (!winners.length) return;
    victoryRoomRef.current = room.id;
    soundEngine.win();
    confetti({ particleCount: 200, spread: 90, origin: { y: 0.55 }, colors: ['#FFD700', '#FF4444', '#00FF88', '#FFFFFF'] });
  }, [room?.status, room?.tickets, room?.id, localTickets]);

  // ── Chat scroll ──────────────────────────────────────────────────────────────
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chatMessages]);

  // ── Derived ──────────────────────────────────────────────────────────────────
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
  const remainingTickets = room ? Math.max(0, room.maxTickets - room.soldTickets) : 0;
  const salesOpen        = room?.status === 'open';

  const myTickets = useMemo(() => {
    const apiTickets = room?.tickets ?? [];
    if (apiTickets.length > 0) return apiTickets;
    if (localRoomIdRef.current === room?.id) return localTickets;
    return [];
  }, [room?.tickets, room?.id, localTickets]);

  const alreadyBought = myTickets.length > 0;

  // Numbers on the player's card(s) — highlighted on the number board
  const myCardNums = useMemo(() => {
    const nums = new Set<number>();
    myTickets.forEach((t) => t.grid.forEach((row) => row.forEach((n) => { if (n !== null) nums.add(n); })));
    return nums;
  }, [myTickets]);

  // ── Buy ──────────────────────────────────────────────────────────────────────
  const buyTickets = async () => {
    if (!room || !salesOpen || alreadyBought) return;
    setBuying(true);
    try {
      const bought = await bingoApi.purchaseTickets(room.id, 1, createIdempotencyKey('bingo'));
      localRoomIdRef.current = room.id;
      setLocalTickets(bought);
      const [nextWallet] = await Promise.all([walletApi.getWallet(), loadCurrent()]);
      setWallet(nextWallet);
      soundEngine.cashout();
      addToast('success', 'Bought 1 Bingo card!');
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

  // ── RENDER ───────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-3xl mx-auto pb-20 space-y-3">
      {/* Room result overlay */}
      <AnimatePresence>
        {phase === 'result' && room && room.status === 'completed' && (
          <RoomResultOverlay
            room={room}
            myTickets={myTickets}
            resultSecs={resultSecs}
            onClose={() => {
              soundEngine.click();
              holdingResultRef.current = false;
              setHoldingResult(false);
              void loadCurrent();
            }}
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
              {liveCounts.bingoOnline} playing
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

      {/* ── Loading ── */}
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
          className="space-y-3"
        >
          {/* ── Stats bar ── */}
          <div className="grid grid-cols-4 gap-2">
            {[
              { label: 'Derash',   value: `${formatCredits(room.prizeMinor)} ETB`,    color: 'text-amber-400' },
              { label: 'Players',  value: String(room.soldTickets),                   color: 'text-slate-200' },
              { label: 'Stake',    value: `${formatCredits(room.ticketPriceMinor)} ETB`, color: 'text-slate-200' },
              { label: 'Call',     value: `${drawnNumbers.length}/${numberRange}`,    color: 'text-red-400'   },
            ].map((stat) => (
              <div key={stat.label} className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-2 text-center">
                <span className="block text-[8px] font-bold uppercase tracking-wider text-slate-600 mb-0.5">{stat.label}</span>
                <span className={`text-[10px] font-black leading-tight ${stat.color}`}>{stat.value}</span>
              </div>
            ))}
          </div>

          {/* ── Main game area: number board (left) + draw display (right) ── */}
          <div className="card p-2">
            <div className="flex gap-2">
              {/* Left: Number board */}
              <div className="flex-1 min-w-0">
                {/* Room / status label */}
                <div className="flex items-center gap-1.5 mb-2 px-0.5">
                  <span className="text-[9px] font-black text-slate-400 truncate">{room.name}</span>
                  <span className={`text-[8px] font-black uppercase px-1.5 py-0.5 rounded flex-shrink-0 ${
                    room.status === 'open'    ? 'bg-emerald-500/10 text-emerald-400' :
                    room.status === 'running' ? 'bg-red-500/10 text-red-400 animate-pulse' :
                    'bg-slate-700 text-slate-400'
                  }`}>
                    {phase === 'buy' ? 'open' : room.status}
                  </span>
                  {isPatternMode && (
                    <span className="text-[7px] font-black bg-violet-500/10 text-violet-400 px-1 py-0.5 rounded flex-shrink-0">75-BALL</span>
                  )}
                </div>
                <NumberBoard
                  drawnNumbers={drawnNumbers}
                  numberRange={numberRange}
                  isPatternMode={isPatternMode}
                  myCardNums={myCardNums}
                />
              </div>

              {/* Right: Draw display */}
              <div className="w-28 flex-shrink-0 flex flex-col items-center justify-start pt-6">
                <DrawSection
                  drawnNumbers={drawnNumbers}
                  isPatternMode={isPatternMode}
                  status={room.status}
                  count={drawnNumbers.length}
                  max={numberRange}
                />

                {/* Buy-window countdown */}
                {phase === 'buy' && timeRemainingSecs !== null && (
                  <div className="mt-3 text-center">
                    <div className="text-[8px] text-slate-500 mb-0.5">Starts in</div>
                    <span className={`font-mono font-black text-sm ${timeRemainingSecs <= 10 ? 'text-red-400' : 'text-amber-400'}`}>
                      {String(Math.floor(timeRemainingSecs / 60)).padStart(2, '0')}:{String(timeRemainingSecs % 60).padStart(2, '0')}
                    </span>
                  </div>
                )}

                {phase === 'result' && resultSecs > 0 && (
                  <div className="mt-3 text-center">
                    <div className="text-[8px] text-emerald-400 mb-0.5">Next game in</div>
                    <span className="font-mono font-black text-sm text-emerald-400">{resultSecs}s</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ── Buy panel ── */}
          {phase === 'buy' && !alreadyBought && (
            <div className="card space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Buy a card</p>
                <span className="text-[10px] text-slate-500">{remainingTickets} spots left</span>
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
                  `Buy Card — ${formatCreditsFull(room.ticketPriceMinor)} ETB`
                )}
              </motion.button>
            </div>
          )}

          {phase === 'buy' && alreadyBought && (
            <div className="card flex items-center gap-3 py-3">
              <span className="text-emerald-400 text-lg">✓</span>
              <div>
                <p className="text-[11px] font-black text-emerald-400">Card purchased</p>
                <p className="text-[10px] text-slate-500">Waiting for the draw to begin…</p>
              </div>
            </div>
          )}

          {/* ── My card(s) ── */}
          {myTickets.length > 0 ? (
            <div className="space-y-2">
              <h3 className="text-[10px] font-black uppercase tracking-wider text-slate-500 px-1">My Card</h3>
              <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
                {myTickets.map((ticket) => (
                  <BingoTicketCard key={ticket.id} ticket={ticket} patternPrizeMap={patternPrizeMap} />
                ))}
              </div>
            </div>
          ) : phase !== 'buy' && (
            <div className="card text-center py-6 space-y-1">
              <Sparkles size={20} className="mx-auto text-slate-600" />
              <p className="text-slate-500 text-xs">You didn't buy a card for this round.</p>
              <p className="text-slate-600 text-[10px]">Hang tight — the next game opens for buy-in soon.</p>
            </div>
          )}

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
                          <div className={`text-[11px] px-2 py-1 max-w-[85%] leading-snug ${
                            msg.isSystem
                              ? 'text-slate-500 bg-white/[0.02] rounded-md border border-white/[0.04]'
                              : isOwn
                                ? 'bg-amber-500/12 border border-amber-500/20 rounded-[10px_10px_2px_10px] text-slate-300'
                                : 'bg-blue-500/8 border border-blue-500/15 rounded-[10px_10px_10px_2px] text-slate-300'
                          }`}>
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
                    <button onClick={sendChat} disabled={!chatInput.trim()} className="btn btn-primary btn-sm">Send</button>
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
