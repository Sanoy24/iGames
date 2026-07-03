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

// Paced reveal cadence. One ball is revealed every REVEAL_BASE_MS so each gets a
// full, unhurried moment on the caller, the board and the cards. We only shorten
// to REVEAL_MIN_MS when the client has fallen far behind (e.g. it was a
// background tab and a poll delivered a big batch), and never below the ball
// animation's own duration — so reveals always stay smooth, never a rushed burst.
const REVEAL_BASE_MS = 1_500;
const REVEAL_MIN_MS  = 650;
const REVEAL_CATCHUP_BACKLOG = 10;

// 10 cycling colors for the prefilled number grid
const CYCLE_COLORS = [
  { color: '#f87171', glow: 'rgba(248,113,113,0.5)', bg: 'rgba(248,113,113,0.08)' },
  { color: '#60a5fa', glow: 'rgba(96,165,250,0.5)',  bg: 'rgba(96,165,250,0.08)'  },
  { color: '#4ade80', glow: 'rgba(74,222,128,0.5)',  bg: 'rgba(74,222,128,0.08)'  },
  { color: '#c084fc', glow: 'rgba(192,132,252,0.5)', bg: 'rgba(192,132,252,0.08)' },
  { color: '#38bdf8', glow: 'rgba(56,189,248,0.5)',  bg: 'rgba(56,189,248,0.08)'  },
  { color: '#fb923c', glow: 'rgba(251,146,60,0.5)',  bg: 'rgba(251,146,60,0.08)'  },
  { color: '#f472b6', glow: 'rgba(244,114,182,0.5)', bg: 'rgba(244,114,182,0.08)' },
  { color: '#2dd4bf', glow: 'rgba(45,212,191,0.5)',  bg: 'rgba(45,212,191,0.08)'  },
  { color: '#fbbf24', glow: 'rgba(251,191,36,0.5)',  bg: 'rgba(251,191,36,0.08)'  },
  { color: '#a78bfa', glow: 'rgba(167,139,250,0.5)', bg: 'rgba(167,139,250,0.08)' },
];

function getPrefilledStyle(n: number, gridSize: number) {
  const groupSize = Math.max(1, Math.ceil(gridSize / CYCLE_COLORS.length));
  return CYCLE_COLORS[Math.floor((n - 1) / groupSize) % CYCLE_COLORS.length];
}

// ─── Group definitions ────────────────────────────────────────────────────────

// 75-ball: B/I/N/G/O columns — each is a distinct accent
const BINGO_COLS_75 = [
  { letter: 'B', from: 1,  to: 15,  color: '#f87171', glow: 'rgba(248,113,113,0.55)', bg: 'rgba(248,113,113,0.10)' },
  { letter: 'I', from: 16, to: 30,  color: '#60a5fa', glow: 'rgba(96,165,250,0.55)',  bg: 'rgba(96,165,250,0.10)'  },
  { letter: 'N', from: 31, to: 45,  color: '#4ade80', glow: 'rgba(74,222,128,0.55)',  bg: 'rgba(74,222,128,0.10)'  },
  { letter: 'G', from: 46, to: 60,  color: '#c084fc', glow: 'rgba(192,132,252,0.55)', bg: 'rgba(192,132,252,0.10)' },
  { letter: 'O', from: 61, to: 75,  color: '#38bdf8', glow: 'rgba(56,189,248,0.55)',  bg: 'rgba(56,189,248,0.10)'  },
];

// 90-ball: 9 groups of 10 — each decade gets a different accent
const BALL_GROUPS_90 = [
  { from: 1,  to: 10, color: '#f87171', glow: 'rgba(248,113,113,0.5)', bg: 'rgba(248,113,113,0.08)' },
  { from: 11, to: 20, color: '#60a5fa', glow: 'rgba(96,165,250,0.5)',  bg: 'rgba(96,165,250,0.08)'  },
  { from: 21, to: 30, color: '#4ade80', glow: 'rgba(74,222,128,0.5)',  bg: 'rgba(74,222,128,0.08)'  },
  { from: 31, to: 40, color: '#c084fc', glow: 'rgba(192,132,252,0.5)', bg: 'rgba(192,132,252,0.08)' },
  { from: 41, to: 50, color: '#38bdf8', glow: 'rgba(56,189,248,0.5)',  bg: 'rgba(56,189,248,0.08)'  },
  { from: 51, to: 60, color: '#fb923c', glow: 'rgba(251,146,60,0.5)',  bg: 'rgba(251,146,60,0.08)'  },
  { from: 61, to: 70, color: '#f472b6', glow: 'rgba(244,114,182,0.5)', bg: 'rgba(244,114,182,0.08)' },
  { from: 71, to: 80, color: '#2dd4bf', glow: 'rgba(45,212,191,0.5)',  bg: 'rgba(45,212,191,0.08)'  },
  { from: 81, to: 90, color: '#fbbf24', glow: 'rgba(251,191,36,0.5)',  bg: 'rgba(251,191,36,0.08)'  },
];

function getGroupStyle(n: number, isPatternMode: boolean) {
  if (isPatternMode) {
    return BINGO_COLS_75.find(c => n >= c.from && n <= c.to) ?? BINGO_COLS_75[0];
  }
  return BALL_GROUPS_90.find(g => n >= g.from && n <= g.to) ?? BALL_GROUPS_90[0];
}

function isPatternGrid(grid: Array<Array<number | null>>): boolean {
  return grid.length === 5 && (grid[0]?.length ?? 0) === 5;
}

// ─── Number Board ─────────────────────────────────────────────────────────────
// Flat grid of rounded-square cells. Called numbers glow with their group color.
// Player card numbers are shown separately in the "My Card" section below.

const NumberBoard = memo(({ drawnNumbers, numberRange, isPatternMode }: {
  drawnNumbers: number[];
  numberRange: number;
  isPatternMode: boolean;
}) => {
  const drawnSet = useMemo(() => new Set(drawnNumbers), [drawnNumbers]);
  // The most-recently revealed ball — highlighted distinctly on the board so it's
  // obvious where the "now calling" number landed.
  const current = drawnNumbers.length > 0 ? drawnNumbers[drawnNumbers.length - 1] : null;

  if (isPatternMode) {
    return (
      <div className="space-y-1">
        {/* Column headers */}
        <div className="grid grid-cols-5 gap-1">
          {BINGO_COLS_75.map(col => (
            <div
              key={col.letter}
              className="text-center text-[11px] font-black py-0.5 rounded-md"
              style={{ color: col.color, background: col.bg, letterSpacing: 1 }}
            >
              {col.letter}
            </div>
          ))}
        </div>
        {/* Number grid: 15 rows × 5 cols */}
        {Array.from({ length: 15 }, (_, row) => (
          <div key={row} className="grid grid-cols-5 gap-1">
            {BINGO_COLS_75.map(col => {
              const n = col.from + row;
              const called = drawnSet.has(n);
              return <NumberCell key={n} n={n} called={called} isCurrent={n === current} style={col} />;
            })}
          </div>
        ))}
      </div>
    );
  }

  // 90-ball: 10 rows × 9 columns (one per decade group)
  const groups = BALL_GROUPS_90.filter(g => g.from <= numberRange);
  return (
    <div className="space-y-1">
      {/* Decade headers */}
      <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${groups.length}, 1fr)` }}>
        {groups.map(g => (
          <div
            key={g.from}
            className="text-center text-[8px] font-black py-0.5 rounded-md leading-tight"
            style={{ color: g.color, background: g.bg }}
          >
            {g.from}–{Math.min(g.to, numberRange)}
          </div>
        ))}
      </div>
      {/* 10 rows */}
      {Array.from({ length: 10 }, (_, row) => (
        <div key={row} className="grid gap-1" style={{ gridTemplateColumns: `repeat(${groups.length}, 1fr)` }}>
          {groups.map(g => {
            const n = g.from + row;
            if (n > Math.min(g.to, numberRange)) return <span key={g.from} />;
            const called = drawnSet.has(n);
            return <NumberCell key={n} n={n} called={called} isCurrent={n === current} style={g} />;
          })}
        </div>
      ))}
    </div>
  );
});
NumberBoard.displayName = 'NumberBoard';

const NumberCell = memo(({ n, called, isCurrent, style }: {
  n: number;
  called: boolean;
  isCurrent: boolean;
  style: { color: string; glow: string; bg: string };
}) => (
  <motion.div
    // The just-called number keeps pulsing so the eye can find where on the board
    // it landed; older called numbers just did a one-shot pop when they lit up.
    animate={
      isCurrent
        ? { scale: [1, 1.22, 1] }
        : called
          ? { scale: [1, 1.18, 1] }
          : {}
    }
    transition={
      isCurrent
        ? { duration: 0.9, ease: 'easeInOut', repeat: Infinity }
        : { duration: 0.28, ease: 'backOut' }
    }
    className="aspect-square rounded-md flex items-center justify-center text-[9px] font-bold font-mono select-none"
    style={
      called
        ? {
            background: `linear-gradient(135deg, ${style.color}cc, ${style.color}88)`,
            color: '#fff',
            boxShadow: isCurrent
              ? `0 0 0 2px #fff, 0 0 12px ${style.glow}`
              : `0 1px 4px rgba(0,0,0,0.4)`,
            zIndex: isCurrent ? 1 : undefined,
          }
        : {
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.05)',
            color: 'rgba(255,255,255,0.2)',
          }
    }
  >
    {n}
  </motion.div>
));
NumberCell.displayName = 'NumberCell';

// ─── Cartela Grid ───────────────────────────────────────────────────────────
// Derash cartela picker. Each number maps to a hidden 5×5 card (no preview).
// Tap to select/deselect one or more cartelas, then pay once. Taken cartelas
// (owned by anyone in this room) are locked.

const CartelaGrid = memo(({
  gridSize, takenSet, mySet, selectedSet, salesOpen, onToggle,
}: {
  gridSize: number;
  takenSet: Set<number>;
  mySet: Set<number>;
  selectedSet: Set<number>;
  salesOpen: boolean;
  onToggle: (n: number) => void;
}) => {
  const cols = 10;
  const nums = useMemo(() => Array.from({ length: gridSize }, (_, i) => i + 1), [gridSize]);

  return (
    <div className="grid gap-px" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
      {nums.map((n) => {
        const mine     = mySet.has(n);
        const taken    = takenSet.has(n);
        const selected = selectedSet.has(n);
        const s = getPrefilledStyle(n, gridSize);

        let cellStyle: React.CSSProperties;
        let textStyle: React.CSSProperties = {};

        if (mine) {
          // Cartelas I own → green.
          cellStyle = { background: 'rgba(52,211,153,0.18)', border: '1.5px solid rgba(52,211,153,0.7)' };
          textStyle = { color: '#34d399', fontWeight: 900 };
        } else if (selected) {
          cellStyle = { background: 'rgba(251,191,36,0.20)', border: '1.5px solid rgba(251,191,36,0.85)', boxShadow: '0 0 6px rgba(251,191,36,0.4)' };
          textStyle = { color: '#fbbf24', fontWeight: 900 };
        } else if (taken) {
          // Taken by someone else → red (locked).
          cellStyle = { background: 'rgba(248,113,113,0.16)', border: '1px solid rgba(248,113,113,0.5)' };
          textStyle = { color: '#f87171', fontWeight: 800 };
        } else {
          cellStyle = { background: s.bg, border: `1px solid ${s.color}22` };
          textStyle = { color: s.color };
        }

        const canToggle = !taken && !mine && salesOpen;

        return (
          <motion.button
            key={n}
            whileTap={canToggle ? { scale: 0.86 } : {}}
            disabled={!canToggle}
            onClick={() => canToggle && onToggle(n)}
            className="aspect-square rounded-[2px] flex items-center justify-center text-[7px] font-bold font-mono select-none transition-all duration-75"
            style={{
              ...cellStyle,
              ...textStyle,
              cursor: canToggle ? 'pointer' : 'default',
              minWidth: 0,
            }}
          >
            {n}
          </motion.button>
        );
      })}
    </div>
  );
});
CartelaGrid.displayName = 'CartelaGrid';

// ─── Recent-calls strip ───────────────────────────────────────────────────────
// Horizontal scrolling pill strip showing the last N drawn numbers.
// Most recent on the right, fading older ones to the left.

function RecentCallsStrip({ drawnNumbers, isPatternMode }: {
  drawnNumbers: number[];
  isPatternMode: boolean;
}) {
  const last = drawnNumbers.slice(-12);
  const stripRef = useRef<HTMLDivElement>(null);
  useEffect(() => { stripRef.current?.scrollTo({ left: 9999, behavior: 'smooth' }); }, [drawnNumbers.length]);

  if (last.length === 0) return null;

  return (
    <div className="relative overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2">
      <div className="text-[8px] font-black uppercase tracking-widest text-slate-600 mb-1.5">Recent calls</div>
      {/* Keyed by number (unique per room) — NOT array index — so the sliding
          window doesn't remount every pill on each draw. Only the genuinely new
          pill animates in; the rest stay put and simply glide as the row grows. */}
      <div ref={stripRef} className="flex gap-1.5 overflow-x-auto scrollbar-hide">
        <AnimatePresence initial={false}>
          {last.map((n, i) => {
            const s = getGroupStyle(n, isPatternMode);
            const opacity = 0.35 + (i / last.length) * 0.65;
            const isNewest = i === last.length - 1;
            return (
              <motion.div
                key={n}
                layout
                initial={{ opacity: 0, scale: 0.4, x: 8 }}
                animate={{ opacity, scale: 1, x: 0 }}
                exit={{ opacity: 0, scale: 0.4 }}
                transition={{ type: 'spring', stiffness: 300, damping: 26 }}
                className="flex-shrink-0 rounded-lg flex items-center justify-center font-black font-mono"
                style={{
                  width: isNewest ? 38 : 30,
                  height: isNewest ? 38 : 30,
                  fontSize: isNewest ? 13 : 10,
                  background: isNewest
                    ? `linear-gradient(135deg, ${s.color}dd, ${s.color}99)`
                    : `${s.color}${Math.round(opacity * 40).toString(16).padStart(2, '0')}`,
                  color: isNewest ? '#fff' : s.color,
                  border: isNewest ? `2px solid ${s.color}` : `1px solid ${s.color}44`,
                  boxShadow: isNewest ? `0 0 14px ${s.glow}` : undefined,
                }}
              >
                {isPatternMode
                  ? (BINGO_COLS_75.find(c => n >= c.from && n <= c.to)?.letter ?? '') + n
                  : n}
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ─── Current Ball Display ─────────────────────────────────────────────────────
// "Card" style: large centered display with the drawn number.
// Distinct from the pill/circle style of reference apps.

function CurrentBallDisplay({ drawnNumbers, isPatternMode, status, count, max }: {
  drawnNumbers: number[];
  isPatternMode: boolean;
  status: string;
  count: number;
  max: number;
}) {
  // `drawnNumbers` is the parent's already-paced "revealed" list, so the last
  // entry here is exactly the ball currently lit on the board and cards — they
  // all advance together.
  const n = drawnNumbers.length > 0 ? drawnNumbers[drawnNumbers.length - 1] : null;
  const s = n !== null ? getGroupStyle(n, isPatternMode) : null;
  const prefix = n !== null && isPatternMode
    ? (BINGO_COLS_75.find(c => n >= c.from && n <= c.to)?.letter ?? '')
    : '';

  if (status === 'completed') {
    return (
      <div className="flex flex-col items-center gap-2 py-4">
        <Trophy size={28} className="text-amber-400" />
        <span className="text-[10px] font-black text-amber-500 uppercase tracking-widest">Draw complete</span>
        <span className="text-[9px] font-mono text-slate-500">{count}/{max} numbers called</span>
      </div>
    );
  }

  if (n === null || status === 'open') {
    return (
      <div className="flex flex-col items-center gap-3 py-4">
        <div className="w-20 h-20 rounded-2xl border-2 border-dashed border-white/10 flex items-center justify-center">
          <span className="text-[9px] font-black text-white/30 uppercase tracking-wider">Waiting</span>
        </div>
        <span className="text-[9px] text-slate-600 font-mono">0/{max}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-2 py-2">
      <span className="text-[8px] font-black uppercase tracking-widest text-slate-500">Now calling</span>
      {/* `mode="wait"` guarantees the previous ball fully exits before the next
          enters — one unhurried ball at a time, never two mid-flight overlapping
          into a jittery blur even if reveals land close together. */}
      <AnimatePresence mode="wait">
        {/* iGames' own rounded-tile caller. The smoothness — not the shape — is
            what we borrowed from the reference: it pops in on a calm spring, the
            glow breathes gently, and `mode="wait"` keeps exactly one tile in
            flight so it never smears into the next. */}
        <motion.div
          key={n}
          initial={{ y: -18, opacity: 0, scale: 0.7 }}
          animate={{
            y: 0,
            opacity: 1,
            scale: 1,
            boxShadow: [
              `0 0 18px ${s!.glow}, inset 0 1px 0 ${s!.color}33`,
              `0 0 30px ${s!.glow}, inset 0 1px 0 ${s!.color}33`,
              `0 0 18px ${s!.glow}, inset 0 1px 0 ${s!.color}33`,
            ],
          }}
          exit={{ y: 12, opacity: 0, scale: 0.82 }}
          transition={{
            default: { type: 'spring', stiffness: 280, damping: 23, mass: 0.9 },
            boxShadow: { duration: 1.6, repeat: Infinity, ease: 'easeInOut' },
          }}
          className="rounded-2xl flex flex-col items-center justify-center font-black text-white select-none"
          style={{
            width: 80, height: 80,
            background: `linear-gradient(145deg, ${s!.color}22, ${s!.color}08)`,
            border: `2px solid ${s!.color}66`,
          }}
        >
          {prefix && (
            <span className="text-[9px] font-black leading-none" style={{ color: s!.color }}>{prefix}</span>
          )}
          <span className="leading-none" style={{ fontSize: n >= 10 ? 28 : 34, color: s!.color }}>{n}</span>
        </motion.div>
      </AnimatePresence>
      <span className="text-[9px] text-slate-600 font-mono">#{count} of {max}</span>
    </div>
  );
}

// ─── Ticket Cards ─────────────────────────────────────────────────────────────

const PatternTicketCard = memo(({ ticket, patternPrizeMap, revealedSet }: {
  ticket: BingoTicket; patternPrizeMap: Map<string, string>; revealedSet?: Set<number>;
}) => {
  const won = ticket.payoutMinor > 0;
  const grid = ticket.grid as Array<Array<number | null>>;
  // Mark cells from the paced "revealed" set when provided, so a number lights on
  // the card at the same instant it is announced in "now calling" and the board.
  // Falls back to the ticket's own marks (e.g. history views with no live pacing).
  const isCellMarked = (value: number) =>
    revealedSet ? revealedSet.has(value) : ticket.markedNumbers.includes(value);
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
        <span className="text-[10px] font-black text-slate-400">
          {ticket.cartelaNumber != null ? `Cartela #${ticket.cartelaNumber}` : `#${ticket.id.slice(-5)}`}
        </span>
        <span className={`badge ${won ? 'badge-gold' : 'badge-violet'}`}>
          {won ? `+${formatCredits(ticket.payoutMinor)} ETB` : ticket.settlementStatus}
        </span>
      </div>
      {ticket.completedPatterns?.length > 0 && (
        <p className="text-[9px] text-amber-400 font-bold -mt-1">
          {ticket.completedPatterns.map((pid) => patternPrizeMap.get(pid) ?? 'Pattern').join(' · ')}
        </p>
      )}
      {/* Column headers */}
      <div className="grid grid-cols-5 gap-0.5">
        {BINGO_COLS_75.map((col) => (
          <div key={col.letter} className="text-center text-[9px] font-black" style={{ color: col.color }}>{col.letter}</div>
        ))}
      </div>
      <div className="grid grid-cols-5 gap-0.5">
        {grid.map((row, ri) =>
          row.map((value, ci) => {
            const isFree = value === null;
            const isMarked = isFree || isCellMarked(value!);
            const colStyle = isMarked && !isFree ? getGroupStyle(value!, true) : null;
            return (
              <motion.span
                key={`${ticket.id}-${ri}-${ci}`}
                animate={isMarked && !isFree ? { backgroundColor: colStyle!.color } : {}}
                transition={{ duration: 0.3 }}
                className={`aspect-square rounded-md flex items-center justify-center text-[9px] font-bold font-mono ${
                  isFree ? 'bg-red-600/20 border border-red-500/30 text-red-400 text-[7px]'
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
              className={`grid grid-cols-9 gap-0.5 rounded-md p-0.5 transition-colors duration-200 ${
                isRowComplete ? 'bg-amber-500/8 border border-amber-400/25' : ''
              }`}
            >
              {row.map((value, ci) =>
                value ? (
                  <motion.span
                    key={`${ticket.id}-r${ri}-c${ci}`}
                    animate={ticket.markedNumbers.includes(value) ? { backgroundColor: '#f59e0b', color: '#000' } : {}}
                    transition={{ duration: 0.3 }}
                    className={`aspect-square rounded-md flex items-center justify-center text-[9px] font-bold font-mono ${
                      ticket.markedNumbers.includes(value)
                        ? 'bg-amber-400 text-black'
                        : 'bg-white/[0.04] border border-white/[0.06] text-slate-400'
                    }`}
                  >
                    {value}
                  </motion.span>
                ) : (
                  <span key={`${ticket.id}-r${ri}-c${ci}`} className="aspect-square bg-black/20 rounded-md border border-white/[0.03]" />
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

// ─── Winner Bingo Card (derash result) ────────────────────────────────────────
// Renders the winner's mapped 5×5 card the way the reference result screen does:
// coloured B/I/N/G/O header discs, green cells on the completed winning line(s),
// red for other called hits, white for un-called numbers, FREE centre, and the
// final called number highlighted.

const WIN_HEADER = [
  { letter: 'B', color: '#f59e0b' },
  { letter: 'I', color: '#22c55e' },
  { letter: 'N', color: '#3b82f6' },
  { letter: 'G', color: '#ef4444' },
  { letter: 'O', color: '#a855f7' },
];

function WinnerBingoCard({ grid, drawnNumbers, markedNumbers, lastCalled }: {
  grid: Array<Array<number | null>>;
  drawnNumbers: number[];
  markedNumbers?: number[];
  lastCalled: number | null;
}) {
  // Prefer the server's authoritative marked set (the exact cells the win was
  // settled on); fall back to the room's called numbers when it isn't provided.
  const hitSet = new Set(markedNumbers && markedNumbers.length > 0 ? markedNumbers : drawnNumbers);
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  const marked = grid.map((row) => row.map((cell) => cell === null || hitSet.has(cell)));
  const win = grid.map((row) => row.map(() => false));
  for (let r = 0; r < rows; r++) if (marked[r].every(Boolean)) for (let c = 0; c < cols; c++) win[r][c] = true;
  for (let c = 0; c < cols; c++) if (marked.every((row) => row[c])) for (let r = 0; r < rows; r++) win[r][c] = true;
  if (rows === 5 && cols === 5) {
    if ([0, 1, 2, 3, 4].every((i) => marked[i][i])) [0, 1, 2, 3, 4].forEach((i) => { win[i][i] = true; });
    if ([0, 1, 2, 3, 4].every((i) => marked[i][4 - i])) [0, 1, 2, 3, 4].forEach((i) => { win[i][4 - i] = true; });
  }

  return (
    <div className="rounded-lg p-2" style={{ background: 'linear-gradient(150deg,#cdd2d8 0%,#d6cbbe 60%,#e6c9a8 100%)' }}>
      <div className="grid grid-cols-5 gap-1 mb-1">
        {WIN_HEADER.map((h) => (
          <div key={h.letter} className="h-7 rounded-full flex items-center justify-center text-white font-black text-base" style={{ background: h.color }}>
            {h.letter}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-5 gap-1">
        {grid.map((row, r) =>
          row.map((cell, c) => {
            const isFree = cell === null;
            const isWin = win[r][c];
            const isHit = !isFree && marked[r][c] && !isWin;
            const isLast = !isFree && cell === lastCalled;
            let bg = '#ffffff';
            let color = '#1f2937';
            if (isFree || isWin) { bg = '#1b7a2f'; color = '#fff'; }
            else if (isHit) { bg = '#d92d2d'; color = '#fff'; }
            return (
              <div
                key={`${r}-${c}`}
                className="aspect-square rounded-md flex items-center justify-center font-black font-mono"
                style={{
                  background: bg,
                  color,
                  fontSize: isLast ? 17 : 13,
                  boxShadow: isLast ? '0 0 0 2px #f59e0b' : '0 1px 2px rgba(0,0,0,0.15)',
                }}
              >
                {isFree ? 'F' : cell}
              </div>
            );
          }),
        )}
      </div>
    </div>
  );
}

// ─── Room Result Overlay ──────────────────────────────────────────────────────

function RoomResultOverlay({ room, myTickets, resultSecs, totalDisplaySecs, onClose }: {
  room: BingoRoomState;
  myTickets: BingoTicket[];
  resultSecs: number;
  totalDisplaySecs: number;
  onClose: () => void;
}) {
  const totalWin = myTickets.reduce((s, t) => s + t.payoutMinor, 0);
  const iWon = totalWin > 0;
  const isPrefilledMode = room.winMode === 'prefilled';

  const summary = room.settlementSummary ?? {};
  // A non-winner has no access to the winner's ticket (getRoomState only returns
  // the caller's own tickets), so the settlement entry is the ONLY source of the
  // winning 5×5 card for them. Prefer the primary place, but fall back to ANY
  // settlement entry that carries winner data — so the card still renders if only
  // 2nd/3rd settled, or the key naming differs — instead of degrading to a
  // name-only dialog.
  const summaryEntries = Object.values(summary).filter(
    (v): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v),
  );
  const primaryKey = isPrefilledMode ? '1st' : 'full_house';
  const winEntry =
    (summary[primaryKey] as Record<string, unknown> | undefined) ??
    summaryEntries.find((e) => e.winnerGrid || e.winnerDisplayName);
  const winnerDisplayName = (winEntry?.winnerDisplayName as string | undefined) ?? 'A lucky player';
  const prizeMinor = (winEntry?.prizeMinor as number | undefined) ?? room.prizeMinor;
  const winnerTicket = iWon ? myTickets.find((t) => t.payoutMinor > 0) ?? null : null;

  // Did anyone actually win, and were there any players at all? A round can end
  // with no winner (nobody completed the pattern) or with no players (empty room).
  // In those cases we must NOT render a fabricated winner.
  const hasPlayers = room.soldTickets > 0;
  const hasWinner =
    !!winEntry ||
    Object.values(room.winnersByTier ?? {}).some((ids) => Array.isArray(ids) && ids.length > 0);
  const noWinReason = !hasPlayers ? 'No players — no win this round' : 'No winner this round';

  const progressPct = Math.max(0, Math.min(100, (resultSecs / totalDisplaySecs) * 100));

  // ── Derash / prefilled: image-style result shown to everyone in the room ──
  if (isPrefilledMode) {
    const winnerGrid =
      (winEntry?.winnerGrid as Array<Array<number | null>> | undefined) ??
      winnerTicket?.grid ??
      (summaryEntries.find((e) => e.winnerGrid)?.winnerGrid as Array<Array<number | null>> | undefined) ??
      null;
    // The exact cells the server settled the win on — authoritative, so the
    // winning line is drawn correctly even if the board's drawn list has since
    // moved on. Falls back to the room's called numbers when absent.
    const winnerMarked =
      (winEntry?.winnerMarkedNumbers as number[] | undefined) ??
      winnerTicket?.markedNumbers ??
      undefined;
    const winnerCartela = (winEntry?.winnerCartelaNumber as number | undefined) ?? winnerTicket?.cartelaNumber ?? null;
    const winnerPhoneLast4 = (winEntry?.winnerPhoneLast4 as string | undefined) ?? '';
    const lastCalled = room.drawnNumbers.length > 0 ? room.drawnNumbers[room.drawnNumbers.length - 1] : null;

    return (
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.8, y: 24 }}
          animate={{ scale: 1, y: 0 }}
          exit={{ scale: 0.88, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 280, damping: 20 }}
          onClick={(e) => e.stopPropagation()}
          className="relative max-w-[300px] w-full mx-4 rounded-2xl p-2.5 space-y-2.5"
          style={{
            background: 'linear-gradient(160deg,#2b4f57,#1c333a)',
            border: '2px solid rgba(167,139,250,0.7)',
            boxShadow: '0 0 34px rgba(167,139,250,0.45)',
          }}
        >
          {/* Header panel */}
          <div className="rounded-xl py-2.5 px-4 text-center" style={{ background: 'rgba(20,60,60,0.55)' }}>
            {hasWinner ? (
              <>
                <div className="text-2xl font-black tracking-[0.12em] mb-1" style={{ color: '#fff', textShadow: '0 0 22px rgba(52,211,153,0.7)' }}>
                  BINGO!
                </div>
                <p className="text-slate-100 text-sm font-bold flex items-center justify-center gap-2 flex-wrap">
                  <span className="rounded-lg px-3 py-1 font-black text-white" style={{ background: '#2f8f4f' }}>
                    {winnerDisplayName}{winnerPhoneLast4 ? ` ( *${winnerPhoneLast4} )` : ''}
                  </span>
                  <span>{iWon ? 'you won the game' : 'has won the game'}</span>
                </p>
              </>
            ) : (
              <>
                <div className="text-3xl font-black tracking-[0.1em] mb-2" style={{ color: '#fbbf24', textShadow: '0 0 22px rgba(251,191,36,0.5)' }}>
                  NO WIN
                </div>
                <p className="text-slate-200 text-sm font-bold">{noWinReason}</p>
              </>
            )}
          </div>

          {/* Winner card — purple outer frame + amber inner frame. Only when a
              cartela actually won; a no-win round shows no prize/card. */}
          {hasWinner && (winnerGrid ? (
            <div className="rounded-xl p-1.5" style={{ background: 'rgba(20,60,60,0.4)', border: '2px solid rgba(167,139,250,0.6)' }}>
              <div className="rounded-lg p-1.5" style={{ border: '2px solid rgba(245,158,11,0.85)' }}>
                <WinnerBingoCard grid={winnerGrid} drawnNumbers={room.drawnNumbers} markedNumbers={winnerMarked} lastCalled={lastCalled} />
                <div className="flex items-center justify-between px-1 pt-1.5">
                  <span className="text-[13px] font-black" style={{ color: '#34d399' }}>Prize: {formatCreditsFull(prizeMinor)} ETB</span>
                  {winnerCartela != null && <span className="text-[13px] font-black text-slate-100">Card# {winnerCartela}</span>}
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-xl py-3 px-4 text-center" style={{ background: 'rgba(20,60,60,0.4)', border: '2px solid rgba(245,158,11,0.55)' }}>
              <span className="block text-[10px] font-black uppercase tracking-widest text-emerald-300/70 mb-1">Prize won</span>
              <span className="text-2xl font-black" style={{ color: '#34d399' }}>{formatCreditsFull(prizeMinor)} ETB</span>
              {winnerCartela != null && <span className="block text-[13px] font-black text-slate-200 mt-1">Card# {winnerCartela}</span>}
            </div>
          ))}

          {/* Countdown bar */}
          <div className="rounded-xl py-2 px-4" style={{ background: 'rgba(20,60,60,0.55)' }}>
            <div className="flex justify-center items-center mb-1">
              <span className="font-mono font-black text-xl text-red-500">{resultSecs}s</span>
            </div>
            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.12)' }}>
              <motion.div
                className="h-full rounded-full"
                style={{ background: 'linear-gradient(90deg,#34d399,#10b981)' }}
                animate={{ width: `${progressPct}%` }}
                transition={{ duration: 0.9, ease: 'linear' }}
              />
            </div>
          </div>
        </motion.div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.78, y: 28 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.88, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 280, damping: 20 }}
        onClick={(e) => e.stopPropagation()}
        className="relative max-w-sm w-full mx-4 rounded-3xl border overflow-hidden"
        style={{
          background: 'linear-gradient(160deg, #0a1628 0%, #060d1a 50%, #0a0a14 100%)',
          borderColor: iWon ? 'rgba(251,191,36,0.45)' : 'rgba(248,113,113,0.35)',
        }}
      >
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: iWon
              ? 'radial-gradient(ellipse at 50% -10%, rgba(251,191,36,0.15) 0%, transparent 55%)'
              : 'radial-gradient(ellipse at 50% -10%, rgba(248,113,113,0.12) 0%, transparent 55%)',
          }}
        />

        {/* Header */}
        <div className="relative z-10 text-center pt-8 pb-4 px-6">
          <div
            className="inline-block text-4xl font-black tracking-[0.15em] mb-2"
            style={{
              color: iWon ? '#fbbf24' : '#f87171',
              textShadow: iWon
                ? '0 0 20px rgba(251,191,36,0.7), 0 2px 0 rgba(0,0,0,0.6)'
                : '0 0 20px rgba(248,113,113,0.7), 0 2px 0 rgba(0,0,0,0.6)',
            }}
          >
            {iWon ? '🏆 You Won!' : hasWinner ? 'BINGO!' : 'NO WIN'}
          </div>
          <p className="text-slate-300 text-sm">
            {iWon ? (
              <><span className="font-bold text-white">{winnerDisplayName}</span> — that&apos;s you!</>
            ) : hasWinner ? (
              <><span className="font-bold text-white">{winnerDisplayName}</span> wins the full house</>
            ) : (
              noWinReason
            )}
          </p>
        </div>

        {/* Winner ticket (if I won, 90-ball) */}
        {iWon && winnerTicket && !isPatternGrid(winnerTicket.grid) && (
          <div className="relative z-10 px-5 pb-3">
            <div
              className="rounded-2xl border p-3"
              style={{ background: 'rgba(251,191,36,0.05)', borderColor: 'rgba(251,191,36,0.2)' }}
            >
              <div className="space-y-1">
                {winnerTicket.grid.map((row, ri) => {
                  const complete = winnerTicket.completedLines.includes(ri);
                  return (
                    <div key={ri} className={`grid grid-cols-9 gap-0.5 rounded-md p-0.5 ${complete ? 'bg-amber-500/10' : ''}`}>
                      {row.map((val, ci) =>
                        val ? (
                          <span
                            key={ci}
                            className={`aspect-square rounded-md flex items-center justify-center text-[9px] font-black font-mono ${
                              winnerTicket.markedNumbers.includes(val)
                                ? complete ? 'bg-amber-400 text-black' : 'bg-red-500/80 text-white'
                                : 'bg-white/[0.04] border border-white/[0.06] text-slate-500'
                            }`}
                          >
                            {val}
                          </span>
                        ) : (
                          <span key={ci} className="aspect-square bg-black/20 rounded-md border border-white/[0.03]" />
                        )
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="flex items-center justify-between mt-2 pt-2 border-t border-white/[0.06]">
                <span className="text-[10px] font-black text-amber-400">+{formatCreditsFull(winnerTicket.payoutMinor)} ETB</span>
                <span className="text-[10px] text-slate-500 font-mono">Card #{winnerTicket.id.slice(-3)}</span>
              </div>
            </div>
          </div>
        )}

        {/* Prize pill when I didn't win (only when someone actually won) */}
        {!iWon && hasWinner && prizeMinor > 0 && (
          <div className="relative z-10 flex justify-center pb-4 px-5">
            <div
              className="rounded-2xl border px-6 py-3 text-center"
              style={{ background: 'rgba(248,113,113,0.07)', borderColor: 'rgba(248,113,113,0.18)' }}
            >
              <span className="block text-[9px] font-black uppercase tracking-widest text-red-400/60 mb-0.5">Prize paid</span>
              <span className="text-2xl font-black text-white font-mono">{formatCreditsFull(prizeMinor)} ETB</span>
            </div>
          </div>
        )}

        {/* Countdown bar */}
        <div className="relative z-10 px-5 pb-6">
          <div className="flex justify-between items-center mb-1.5">
            <span className="text-[9px] text-slate-500">Next game starting soon</span>
            <span className="font-mono font-black text-sm" style={{ color: iWon ? '#fbbf24' : '#f87171' }}>{resultSecs}s</span>
          </div>
          <div className="h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
            <motion.div
              className="h-full rounded-full"
              style={{ background: iWon ? 'linear-gradient(90deg,#f59e0b,#fbbf24)' : 'linear-gradient(90deg,#dc2626,#f87171)' }}
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
  const [selectedCartelas, setSelectedCartelas] = useState<Set<number>>(new Set());
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
  const chatEndRef   = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLInputElement>(null);

  // ── Load ────────────────────────────────────────────────────────────────────

  const loadCurrent = useCallback(async () => {
    try {
      const next = await bingoApi.getCurrentRoom();
      setRoom((prev) => {
        // During result hold, don't switch to a different (newer) room —
        // only allow updating the same room (e.g. to pick up settlement data).
        if (holdingResultRef.current && next?.id !== prev?.id) return prev;
        return next;
      });
      if (!holdingResultRef.current) {
        roomIdRef.current = next?.id ?? null;
        if (next?.id !== localRoomIdRef.current) {
          setLocalTickets([]);
          localRoomIdRef.current = next?.id ?? null;
        }
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
      // The reveal sound is played by CurrentBallDisplay in sync with the queued
      // ball animation, so we don't pop here (that fired in a fast burst).
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

    const onRoomCompleted = (p: {
      roomId?: string;
      drawnNumbers?: number[];
      winnersByTier?: Record<string, string[]>;
      settlementSummary?: Record<string, unknown>;
    }) => {
      if (p.roomId !== roomIdRef.current) return;
      const completedId = p.roomId;
      // Lock onto the result view SYNCHRONOUSLY so no poll/loadCurrent can swap
      // us to the next (already-opened) room before the overlay renders.
      holdingResultRef.current = true;
      // Apply the completion payload immediately — it carries the winner name
      // (settlementSummary) so the overlay can render right away.
      setRoom((prev) => {
        if (!prev || prev.id !== completedId) return prev;
        return {
          ...prev,
          status: 'completed' as const,
          drawnNumbers: p.drawnNumbers ?? prev.drawnNumbers,
          winnersByTier: p.winnersByTier ?? prev.winnersByTier,
          settlementSummary: p.settlementSummary ?? prev.settlementSummary,
        };
      });
      // Fetch the completed room BY ID (not getCurrentRoom, which now returns the
      // next room) to pick up settled ticket payouts for the winner-card display.
      void bingoApi.getRoomState(completedId)
        .then((full) => {
          if (full.id !== completedId) return;
          setRoom((prev) => (prev && prev.id === completedId ? full : prev));
        })
        .catch(() => undefined);
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
    // Use resultDisplaySeconds from the room config if available, else fall back to constant.
    const displayMs = ((room.resultDisplaySeconds ?? (RESULT_DISPLAY_MS / 1000)) * 1000);
    holdingResultRef.current = true;
    setHoldingResult(true);
    setResultSecs(Math.ceil(displayMs / 1000));

    if (resultTimerRef.current) clearTimeout(resultTimerRef.current);
    resultTimerRef.current = setTimeout(() => {
      // Clear hold first so loadCurrent() is free to switch to the next room.
      holdingResultRef.current = false;
      setHoldingResult(false);
      roomIdRef.current = null; // force roomIdRef to reset so next room is accepted
      void loadCurrent();
    }, displayMs);

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
    // The win credit landed server-side — pull the fresh balance into the header.
    walletApi.getWallet().then(setWallet).catch(() => undefined);
  }, [room?.status, room?.tickets, room?.id, localTickets, setWallet]);

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
  // winMode is the source of truth for which board to show.
  const isPatternMode    = room?.winMode === 'pattern';
  const isPrefilledMode  = room?.winMode === 'prefilled';
  // Ball pool for the board: derash is ALWAYS 75-ball (standard B/I/N/G/O); a
  // stale/misconfigured room's numberRange is ignored so the client can never
  // render a >75 ball (no more 137/187/200 in derash).
  const ballCount        = isPatternMode ? (room?.numberRange ?? 75) : isPrefilledMode ? 75 : 90;
  // Prefilled cards are 75-ball 5×5, so the board uses the B/I/N/G/O layout.
  const boardBingoStyle  = isPatternMode || isPrefilledMode;
  const gridSize         = room?.gridSize ?? 75;
  // Server draws, clamped to the valid pool — drops any out-of-range ball a
  // legacy room may have produced so it never reaches the UI.
  const drawnNumbers     = useMemo(
    () => (room?.drawnNumbers ?? []).filter((n) => n >= 1 && n <= ballCount),
    [room?.drawnNumbers, ballCount],
  );
  const takenSet         = useMemo(() => new Set(room?.takenSpots ?? []), [room?.takenSpots]);
  const remainingTickets = room ? Math.max(0, room.maxTickets - room.soldTickets) : 0;
  const salesOpen        = room?.status === 'open';

  // ── Paced reveal ─────────────────────────────────────────────────────────────
  // One shared cursor drives "now calling", the board and every card so they all
  // advance TOGETHER, one ball at a time at a readable pace — even when a poll
  // delivers several numbers at once. Snap to full on room switch (no history
  // replay) and on completion (show the final state immediately).
  const [revealedCount, setRevealedCount] = useState(0);
  useEffect(() => {
    setRevealedCount(room?.drawnNumbers?.length ?? 0);
  }, [room?.id]);
  useEffect(() => {
    const total = drawnNumbers.length;
    // Snap to the final state on completion/cancel (no replay) and clamp any overshoot.
    if (room?.status === 'completed' || room?.status === 'cancelled') { setRevealedCount(total); return; }
    if (revealedCount > total) { setRevealedCount(total); return; }
    if (revealedCount >= total) return;
    // One steady, calm cadence for every ball. Only shorten (still gently) when
    // the client is far behind — never a fast 250ms burst that outruns the
    // animation and reads as "rushed".
    const backlog = total - revealedCount;
    const delay = backlog > REVEAL_CATCHUP_BACKLOG ? REVEAL_MIN_MS : REVEAL_BASE_MS;
    const id = setTimeout(() => {
      setRevealedCount((c) => Math.min(c + 1, total));
      soundEngine.pop();
    }, delay);
    return () => clearTimeout(id);
  }, [revealedCount, drawnNumbers.length, room?.status]);
  const revealedNumbers = useMemo(() => drawnNumbers.slice(0, revealedCount), [drawnNumbers, revealedCount]);
  const revealedSet     = useMemo(() => new Set(revealedNumbers), [revealedNumbers]);

  const myTickets = useMemo(() => {
    const apiTickets = room?.tickets ?? [];
    if (apiTickets.length > 0) return apiTickets;
    if (localRoomIdRef.current === room?.id) return localTickets;
    return [];
  }, [room?.tickets, room?.id, localTickets]);

  const alreadyBought = myTickets.length > 0;

  // Cartela numbers the player already owns in this room.
  const myCartelaSet = useMemo(() => {
    const nums = new Set<number>();
    myTickets.forEach((t) => { if (t.cartelaNumber != null) nums.add(t.cartelaNumber); });
    return nums;
  }, [myTickets]);

  const selectedTotalMinor = room ? selectedCartelas.size * room.ticketPriceMinor : 0;

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

  const toggleCartela = useCallback((n: number) => {
    setSelectedCartelas((prev) => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });
  }, []);

  const buyCartelas = useCallback(async () => {
    if (!room || room.status !== 'open' || selectedCartelas.size === 0 || buying) return;
    if (!currentUser) { addToast('error', 'Log in to buy cartelas'); return; }
    const numbers = Array.from(selectedCartelas);
    setBuying(true);
    try {
      const bought = await bingoApi.purchaseCartelas(room.id, numbers, createIdempotencyKey('bingo-cartelas'));
      localRoomIdRef.current = room.id;
      setLocalTickets((prev) => [...prev, ...bought]);
      setSelectedCartelas(new Set());
      const [nextWallet] = await Promise.all([walletApi.getWallet(), loadCurrent()]);
      setWallet(nextWallet);
      soundEngine.cashout();
      addToast('success', numbers.length === 1 ? `Cartela #${numbers[0]} purchased!` : `${numbers.length} cartelas purchased!`);
    } catch (err) {
      const msg = getErrorMessage(err);
      if (msg.toLowerCase().includes('taken')) addToast('error', 'A cartela was just taken — adjust your picks');
      else if (msg.toLowerCase().includes('balance') || msg.toLowerCase().includes('insufficient') || msg.toLowerCase().includes('enough')) addToast('error', 'Insufficient balance');
      else addToast('error', msg);
      void loadCurrent();
    } finally {
      setBuying(false);
    }
  }, [room, currentUser, selectedCartelas, buying, addToast, loadCurrent, setWallet]);

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
    <div className="max-w-2xl mx-auto pb-20 space-y-3">
      {/* Room result overlay — gated on the timed `holdingResult` flag, not the
          derived phase. A completed room's phase stays 'result' until the next
          room loads, so gating on phase left the dialog stuck open after the
          countdown hit 0. holdingResult flips false exactly when the timer ends. */}
      <AnimatePresence>
        {holdingResult && room && room.status === 'completed' && (
          <RoomResultOverlay
            room={room}
            myTickets={myTickets}
            resultSecs={resultSecs}
            totalDisplaySecs={room.resultDisplaySeconds ?? (RESULT_DISPLAY_MS / 1000)}
            onClose={() => {
              soundEngine.click();
              holdingResultRef.current = false;
              setHoldingResult(false);
              roomIdRef.current = null;
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
              { label: 'Derash',   value: `${formatCredits(room.prizeMinor)} ETB`, color: 'text-amber-400' },
              { label: 'Players',  value: String(room.soldTickets),                color: 'text-slate-200' },
              { label: 'Stake',    value: `${formatCredits(room.ticketPriceMinor)} ETB`, color: 'text-slate-200' },
              { label: 'Called',   value: `${drawnNumbers.length}/${ballCount}`, color: 'text-red-400'   },
            ].map((stat) => (
              <div key={stat.label} className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-2 text-center">
                <span className="block text-[8px] font-bold uppercase tracking-wider text-slate-600 mb-0.5">{stat.label}</span>
                <span className={`text-[10px] font-black leading-tight ${stat.color}`}>{stat.value}</span>
              </div>
            ))}
          </div>

          {/* ── Recent calls strip ── */}
          {revealedNumbers.length > 0 && (
            <RecentCallsStrip drawnNumbers={revealedNumbers} isPatternMode={boardBingoStyle} />
          )}

          {/* ── Cartela picker (derash buy phase) / Number board ── */}
          <div className="card p-3">
            {isPrefilledMode && phase === 'buy' ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[9px] font-black text-slate-400 truncate">{room.name}</span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[7px] font-black bg-amber-500/10 text-amber-400 px-1.5 py-0.5 rounded">DERASH</span>
                    {timeRemainingSecs !== null && (
                      <span className={`font-mono font-black text-sm ${timeRemainingSecs <= 10 ? 'text-red-400' : 'text-amber-400'}`}>
                        {String(Math.floor(timeRemainingSecs / 60)).padStart(2, '0')}:{String(timeRemainingSecs % 60).padStart(2, '0')}
                      </span>
                    )}
                  </div>
                </div>
                <p className="text-[9px] text-slate-500">Pick one or more cartelas, then pay. Each cartela is a hidden bingo card.</p>
                <CartelaGrid
                  gridSize={gridSize}
                  takenSet={takenSet}
                  mySet={myCartelaSet}
                  selectedSet={selectedCartelas}
                  salesOpen={salesOpen}
                  onToggle={toggleCartela}
                />
              </div>
            ) : (
              <div className="flex items-start gap-3">
                {/* Room name + status */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[9px] font-black text-slate-400 truncate">{room.name}</span>
                    <span className={`text-[8px] font-black uppercase px-1.5 py-0.5 rounded flex-shrink-0 ${
                      room.status === 'open'    ? 'bg-emerald-500/10 text-emerald-400' :
                      room.status === 'running' ? 'bg-red-500/10 text-red-400' :
                      'bg-slate-700/50 text-slate-400'
                    }`}>
                      {room.status === 'open' ? 'Buy open' : room.status}
                    </span>
                    {isPrefilledMode ? (
                      <span className="text-[7px] font-black bg-amber-500/10 text-amber-400 px-1 py-0.5 rounded flex-shrink-0">DERASH</span>
                    ) : isPatternMode && (
                      <span className="text-[7px] font-black bg-violet-500/10 text-violet-400 px-1 py-0.5 rounded flex-shrink-0">75-BALL</span>
                    )}
                  </div>
                  <NumberBoard
                    drawnNumbers={revealedNumbers}
                    numberRange={ballCount}
                    isPatternMode={boardBingoStyle}
                  />
                </div>
                {/* Now calling + (derash) my mapped cards stacked below */}
                <div className={`flex-shrink-0 flex flex-col items-center gap-2 ${isPrefilledMode && myTickets.length > 0 ? 'w-32 sm:w-40' : 'w-24'}`}>
                  <CurrentBallDisplay
                    drawnNumbers={revealedNumbers}
                    isPatternMode={boardBingoStyle}
                    status={room.status}
                    count={revealedNumbers.length}
                    max={ballCount}
                  />
                  {phase === 'buy' && timeRemainingSecs !== null && (
                    <div className="mt-1 text-center">
                      <div className="text-[8px] text-slate-500 mb-0.5">Starts in</div>
                      <span className={`font-mono font-black text-sm ${timeRemainingSecs <= 10 ? 'text-red-400' : 'text-amber-400'}`}>
                        {String(Math.floor(timeRemainingSecs / 60)).padStart(2, '0')}:{String(timeRemainingSecs % 60).padStart(2, '0')}
                      </span>
                    </div>
                  )}
                  {/* Derash: mapped 5×5 card(s), vertically stacked under the caller,
                     with the owned-count label. The stack scrolls so many cartelas
                     never blow out the layout. */}
                  {isPrefilledMode && myTickets.length > 0 && (
                    <>
                      <div className="w-full text-center text-[9px] font-black uppercase tracking-wider text-slate-500">
                        {myTickets.length} {myTickets.length === 1 ? 'card' : 'cards'}
                      </div>
                      <div className="w-full flex flex-col gap-2 overflow-y-auto pr-1 scrollbar-hide" style={{ maxHeight: 340 }}>
                        {myTickets.map((ticket) => (
                          <PatternTicketCard key={ticket.id} ticket={ticket} patternPrizeMap={patternPrizeMap} revealedSet={revealedSet} />
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* ── Pay-once bar (derash) ── */}
          {isPrefilledMode && phase === 'buy' && (
            <div className="card space-y-2">
              <div className="flex items-center justify-between text-[10px]">
                <span className="font-black uppercase tracking-wider text-slate-400">
                  Selected: <span className="text-amber-400">{selectedCartelas.size}</span>
                  {myCartelaSet.size > 0 && <span className="text-emerald-400"> · Owned: {myCartelaSet.size}</span>}
                </span>
                <span className="text-slate-500">{remainingTickets} cartelas left</span>
              </div>
              <motion.button
                whileHover={!buying && selectedCartelas.size > 0 ? { scale: 1.02, y: -2 } : {}}
                whileTap={{ scale: 0.97 }}
                onClick={buyCartelas}
                disabled={buying || selectedCartelas.size === 0}
                className="btn btn-primary btn-full py-3.5 text-base font-black"
              >
                {buying ? (
                  <span className="flex items-center gap-2 justify-center">
                    <RefreshCw size={15} className="animate-spin" /> Processing…
                  </span>
                ) : selectedCartelas.size === 0 ? (
                  'Select cartelas to buy'
                ) : (
                  `Buy ${selectedCartelas.size} cartela${selectedCartelas.size > 1 ? 's' : ''} — ${formatCreditsFull(selectedTotalMinor)} ETB`
                )}
              </motion.button>
            </div>
          )}

          {/* ── Buy panel (line/pattern mode only — prefilled buys via grid) ── */}
          {!isPrefilledMode && phase === 'buy' && !alreadyBought && (
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
                  <span className="flex items-center gap-2 justify-center">
                    <RefreshCw size={15} className="animate-spin" /> Processing…
                  </span>
                ) : remainingTickets <= 0 ? (
                  'Room Full'
                ) : (
                  `Buy Card — ${formatCreditsFull(room.ticketPriceMinor)} ETB`
                )}
              </motion.button>
            </div>
          )}

          {!isPrefilledMode && phase === 'buy' && alreadyBought && (
            <div className="card flex items-center gap-3 py-3">
              <span className="text-emerald-400 text-lg">✓</span>
              <div>
                <p className="text-[11px] font-black text-emerald-400">Card purchased</p>
                <p className="text-[10px] text-slate-500">Waiting for the draw to begin…</p>
              </div>
            </div>
          )}

          {/* ── My card(s) ──
             Derash shows purchased cartelas here during buy-in; once the draw
             starts they move up beside the caller, so we skip the bottom list. */}
          {myTickets.length > 0 && !(isPrefilledMode && phase !== 'buy') ? (
            <div className="space-y-2">
              <h3 className="text-[10px] font-black uppercase tracking-wider text-slate-500 px-1">
                {isPrefilledMode ? `My Cartelas (${myTickets.length})` : 'My Card'}
              </h3>
              <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
                {myTickets.map((ticket) => (
                  <BingoTicketCard key={ticket.id} ticket={ticket} patternPrizeMap={patternPrizeMap} />
                ))}
              </div>
            </div>
          ) : myTickets.length === 0 && phase !== 'buy' && (
            <div className="card text-center py-6 space-y-1">
              <Sparkles size={20} className="mx-auto text-slate-600" />
              <p className="text-slate-500 text-xs">
                {isPrefilledMode ? "You didn't buy any cartelas for this round." : "You didn't buy a card for this round."}
              </p>
              <p className="text-slate-600 text-[10px]">The next game opens for buy-in soon.</p>
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
