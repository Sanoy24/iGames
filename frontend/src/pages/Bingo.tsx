import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion } from 'framer-motion';
import {
    ArrowLeft,
    Trophy,
    Sparkles,
    Volume2,
    VolumeX,
    Users,
    MessageSquare,
    RefreshCw,
} from 'lucide-react';
import { bingoApi, walletApi } from '../lib/api';
import type { BingoRoomState, BingoTicket } from '../lib/models';
import {
    createIdempotencyKey,
    formatCreditsFull,
    getErrorMessage,
    titleCase,
} from '../lib/utils';
import { formatCredits, useStore } from '../store/useStore';
import { getSocket } from '../hooks/useSocketConnection';
import { soundEngine } from '../lib/audio';
import confetti from 'canvas-confetti';

// ─── Types ────────────────────────────────────────────────────────────────────

type Phase = 'loading' | 'buy' | 'playing' | 'result';
type ChatMessage = {
    userId?: string;
    displayName: string;
    text: string;
    timestamp: string;
    isSystem?: boolean;
};
type BingoProps = { onBack: () => void };

const RESULT_DISPLAY_MS = 10_000;
const POLL_INTERVAL_MS = 5_000;

// Paced reveal cadence. One ball is revealed every REVEAL_BASE_MS so each gets a
// full, unhurried moment on the caller, the board and the cards. We only shorten
// to REVEAL_MIN_MS when the client has fallen far behind (e.g. it was a
// background tab and a poll delivered a big batch), and never below the ball
// animation's own duration — so reveals always stay smooth, never a rushed burst.
const REVEAL_BASE_MS = 1_500;
const REVEAL_MIN_MS = 650;
const REVEAL_CATCHUP_BACKLOG = 10;

// Reveal cascade: a called number shows in "now calling" FIRST, then marks on the
// board a beat later, then on the tickets a beat after that. Never the reverse.
const NOW_CALLING_LEAD_MS = 500; // now calling → board
const BOARD_TO_TICKET_MS = 500; // board → ticket

// 10 cycling colors for the prefilled number grid
const CYCLE_COLORS = [
    {
        color: '#f87171',
        glow: 'rgba(248,113,113,0.5)',
        bg: 'rgba(248,113,113,0.08)',
    },
    {
        color: '#60a5fa',
        glow: 'rgba(96,165,250,0.5)',
        bg: 'rgba(96,165,250,0.08)',
    },
    {
        color: '#4ade80',
        glow: 'rgba(74,222,128,0.5)',
        bg: 'rgba(74,222,128,0.08)',
    },
    {
        color: '#c084fc',
        glow: 'rgba(192,132,252,0.5)',
        bg: 'rgba(192,132,252,0.08)',
    },
    {
        color: '#38bdf8',
        glow: 'rgba(56,189,248,0.5)',
        bg: 'rgba(56,189,248,0.08)',
    },
    {
        color: '#fb923c',
        glow: 'rgba(251,146,60,0.5)',
        bg: 'rgba(251,146,60,0.08)',
    },
    {
        color: '#f472b6',
        glow: 'rgba(244,114,182,0.5)',
        bg: 'rgba(244,114,182,0.08)',
    },
    {
        color: '#2dd4bf',
        glow: 'rgba(45,212,191,0.5)',
        bg: 'rgba(45,212,191,0.08)',
    },
    {
        color: '#fbbf24',
        glow: 'rgba(251,191,36,0.5)',
        bg: 'rgba(251,191,36,0.08)',
    },
    {
        color: '#a78bfa',
        glow: 'rgba(167,139,250,0.5)',
        bg: 'rgba(167,139,250,0.08)',
    },
];

function getPrefilledStyle(n: number, gridSize: number) {
    const groupSize = Math.max(1, Math.ceil(gridSize / CYCLE_COLORS.length));
    return CYCLE_COLORS[Math.floor((n - 1) / groupSize) % CYCLE_COLORS.length];
}

// ─── Group definitions ────────────────────────────────────────────────────────

// 75-ball: B/I/N/G/O columns — each is a distinct accent
const BINGO_COLS_75 = [
    {
        letter: 'B',
        from: 1,
        to: 15,
        color: '#f87171',
        glow: 'rgba(248,113,113,0.55)',
        bg: 'rgba(248,113,113,0.10)',
    },
    {
        letter: 'I',
        from: 16,
        to: 30,
        color: '#60a5fa',
        glow: 'rgba(96,165,250,0.55)',
        bg: 'rgba(96,165,250,0.10)',
    },
    {
        letter: 'N',
        from: 31,
        to: 45,
        color: '#4ade80',
        glow: 'rgba(74,222,128,0.55)',
        bg: 'rgba(74,222,128,0.10)',
    },
    {
        letter: 'G',
        from: 46,
        to: 60,
        color: '#c084fc',
        glow: 'rgba(192,132,252,0.55)',
        bg: 'rgba(192,132,252,0.10)',
    },
    {
        letter: 'O',
        from: 61,
        to: 75,
        color: '#38bdf8',
        glow: 'rgba(56,189,248,0.55)',
        bg: 'rgba(56,189,248,0.10)',
    },
];

// 90-ball: 9 groups of 10 — each decade gets a different accent
const BALL_GROUPS_90 = [
    {
        from: 1,
        to: 10,
        color: '#f87171',
        glow: 'rgba(248,113,113,0.5)',
        bg: 'rgba(248,113,113,0.08)',
    },
    {
        from: 11,
        to: 20,
        color: '#60a5fa',
        glow: 'rgba(96,165,250,0.5)',
        bg: 'rgba(96,165,250,0.08)',
    },
    {
        from: 21,
        to: 30,
        color: '#4ade80',
        glow: 'rgba(74,222,128,0.5)',
        bg: 'rgba(74,222,128,0.08)',
    },
    {
        from: 31,
        to: 40,
        color: '#c084fc',
        glow: 'rgba(192,132,252,0.5)',
        bg: 'rgba(192,132,252,0.08)',
    },
    {
        from: 41,
        to: 50,
        color: '#38bdf8',
        glow: 'rgba(56,189,248,0.5)',
        bg: 'rgba(56,189,248,0.08)',
    },
    {
        from: 51,
        to: 60,
        color: '#fb923c',
        glow: 'rgba(251,146,60,0.5)',
        bg: 'rgba(251,146,60,0.08)',
    },
    {
        from: 61,
        to: 70,
        color: '#f472b6',
        glow: 'rgba(244,114,182,0.5)',
        bg: 'rgba(244,114,182,0.08)',
    },
    {
        from: 71,
        to: 80,
        color: '#2dd4bf',
        glow: 'rgba(45,212,191,0.5)',
        bg: 'rgba(45,212,191,0.08)',
    },
    {
        from: 81,
        to: 90,
        color: '#fbbf24',
        glow: 'rgba(251,191,36,0.5)',
        bg: 'rgba(251,191,36,0.08)',
    },
];

function getGroupStyle(n: number, isPatternMode: boolean) {
    if (isPatternMode) {
        return (
            BINGO_COLS_75.find((c) => n >= c.from && n <= c.to) ??
            BINGO_COLS_75[0]
        );
    }
    return (
        BALL_GROUPS_90.find((g) => n >= g.from && n <= g.to) ??
        BALL_GROUPS_90[0]
    );
}

function isPatternGrid(grid: Array<Array<number | null>>): boolean {
    return grid.length === 5 && (grid[0]?.length ?? 0) === 5;
}

// ─── Number Board ─────────────────────────────────────────────────────────────
// Flat grid of rounded-square cells. Called numbers glow with their group color.
// Player card numbers are shown separately in the "My Card" section below.

const NumberBoard = memo(
    ({
        drawnNumbers,
        numberRange,
        isPatternMode,
    }: {
        drawnNumbers: number[];
        numberRange: number;
        isPatternMode: boolean;
    }) => {
        const drawnSet = useMemo(() => new Set(drawnNumbers), [drawnNumbers]);
        // The most-recently revealed ball — highlighted distinctly on the board so it's
        // obvious where the "now calling" number landed.
        const current =
            drawnNumbers.length > 0
                ? drawnNumbers[drawnNumbers.length - 1]
                : null;

        if (isPatternMode) {
            return (
                <div className='space-y-[2px]'>
                    {/* Column headers */}
                    <div className='grid grid-cols-5 gap-[2px]'>
                        {BINGO_COLS_75.map((col) => (
                            <div
                                key={col.letter}
                                className='text-center text-[10px] font-black rounded leading-tight'
                                style={{
                                    color: col.color,
                                    background: col.bg,
                                    letterSpacing: 1,
                                }}
                            >
                                {col.letter}
                            </div>
                        ))}
                    </div>
                    {/* Number grid: 15 rows × 5 cols (dense = short rows) */}
                    {Array.from({ length: 15 }, (_, row) => (
                        <div key={row} className='grid grid-cols-5 gap-[2px]'>
                            {BINGO_COLS_75.map((col) => {
                                const n = col.from + row;
                                const called = drawnSet.has(n);
                                return (
                                    <NumberCell
                                        key={n}
                                        n={n}
                                        called={called}
                                        isCurrent={n === current}
                                        style={col}
                                        dense
                                    />
                                );
                            })}
                        </div>
                    ))}
                </div>
            );
        }

        // 90-ball: 10 rows × 9 columns (one per decade group)
        const groups = BALL_GROUPS_90.filter((g) => g.from <= numberRange);
        return (
            <div className='space-y-1'>
                {/* Decade headers */}
                <div
                    className='grid gap-1'
                    style={{
                        gridTemplateColumns: `repeat(${groups.length}, 1fr)`,
                    }}
                >
                    {groups.map((g) => (
                        <div
                            key={g.from}
                            className='text-center text-[8px] font-black py-0.5 rounded-md leading-tight'
                            style={{ color: g.color, background: g.bg }}
                        >
                            {g.from}–{Math.min(g.to, numberRange)}
                        </div>
                    ))}
                </div>
                {/* 10 rows */}
                {Array.from({ length: 10 }, (_, row) => (
                    <div
                        key={row}
                        className='grid gap-1'
                        style={{
                            gridTemplateColumns: `repeat(${groups.length}, 1fr)`,
                        }}
                    >
                        {groups.map((g) => {
                            const n = g.from + row;
                            if (n > Math.min(g.to, numberRange))
                                return <span key={g.from} />;
                            const called = drawnSet.has(n);
                            return (
                                <NumberCell
                                    key={n}
                                    n={n}
                                    called={called}
                                    isCurrent={n === current}
                                    style={g}
                                />
                            );
                        })}
                    </div>
                ))}
            </div>
        );
    },
);
NumberBoard.displayName = 'NumberBoard';

const NumberCell = memo(
    ({
        n,
        called,
        isCurrent,
        style,
        dense = false,
    }: {
        n: number;
        called: boolean;
        isCurrent: boolean;
        style: { color: string; glow: string; bg: string };
        // `dense` cells are short rectangles (used by the 75-ball board so its 15
        // rows don't run tall); non-dense cells stay square.
        dense?: boolean;
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
            className={`${dense ? 'h-5 rounded text-[10px]' : 'aspect-square rounded-md text-[9px]'} flex items-center justify-center font-bold font-mono select-none`}
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
                          color: '#f5f5f5',
                      }
            }
        >
            {n}
        </motion.div>
    ),
);
NumberCell.displayName = 'NumberCell';

// ─── Cartela Grid ───────────────────────────────────────────────────────────
// Derash cartela picker. Each number maps to a hidden 5×5 card (no preview).
// Tap to select/deselect one or more cartelas, then pay once. Taken cartelas
// (owned by anyone in this room) are locked.

const CartelaGrid = memo(
    ({
        gridSize,
        takenSet,
        mySet,
        pendingSet,
        salesOpen,
        onTap,
    }: {
        gridSize: number;
        takenSet: Set<number>;
        mySet: Set<number>;
        pendingSet: Set<number>;
        salesOpen: boolean;
        onTap: (n: number) => void;
    }) => {
        const cols = 10;
        const nums = useMemo(
            () => Array.from({ length: gridSize }, (_, i) => i + 1),
            [gridSize],
        );

        return (
            <div
                className='grid gap-0.5'
                style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}
            >
                {nums.map((n) => {
                    const mine = mySet.has(n);
                    const takenByOther = takenSet.has(n) && !mine;
                    const pending = pendingSet.has(n);
                    const s = getPrefilledStyle(n, gridSize);

                    let cellStyle: React.CSSProperties;
                    let textStyle: React.CSSProperties = {};

                    if (mine) {
                        // Cartelas I own → green. Tapping again (while sales are open) refunds it.
                        cellStyle = {
                            background: 'rgba(52,211,153,0.20)',
                            border: '1.5px solid rgba(52,211,153,0.85)',
                        };
                        textStyle = { color: '#34d399', fontWeight: 900 };
                    } else if (takenByOther) {
                        // Taken by someone else → red (locked).
                        cellStyle = {
                            background: 'rgba(248,113,113,0.16)',
                            border: '1px solid rgba(248,113,113,0.5)',
                        };
                        textStyle = { color: '#f87171', fontWeight: 900 };
                    } else {
                        // Available → black tile, off-white number, group colour kept as a
                        // thin accent border so the design language survives on big 200/300 grids.
                        cellStyle = {
                            background: '#000',
                            border: `1px solid ${s.color}55`,
                        };
                        textStyle = { color: '#f5f5f5', fontWeight: 900 };
                    }

                    const canTap = salesOpen && !takenByOther && !pending;

                    return (
                        <motion.button
                            key={n}
                            whileTap={canTap ? { scale: 0.86 } : {}}
                            disabled={!canTap}
                            onClick={() => canTap && onTap(n)}
                            className='aspect-square rounded-[3px] flex items-center justify-center text-[13px] sm:text-[14px] leading-none tracking-tight font-black font-mono select-none transition-all duration-75'
                            style={{
                                ...cellStyle,
                                ...textStyle,
                                cursor: canTap ? 'pointer' : 'default',
                                minWidth: 0,
                                opacity: pending ? 0.45 : 1,
                            }}
                        >
                            {n}
                        </motion.button>
                    );
                })}
            </div>
        );
    },
);
CartelaGrid.displayName = 'CartelaGrid';

// ─── Recent-calls strip ───────────────────────────────────────────────────────
// Horizontal scrolling pill strip showing the last N drawn numbers.
// Most recent on the right, fading older ones to the left.

function RecentCallsStrip({
    drawnNumbers,
    isPatternMode,
}: {
    drawnNumbers: number[];
    isPatternMode: boolean;
}) {
    const { t } = useTranslation();
    const last = drawnNumbers.slice(-12);
    const stripRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        stripRef.current?.scrollTo({ left: 9999, behavior: 'smooth' });
    }, [drawnNumbers.length]);

    if (last.length === 0) return null;

    return (
        <div className='relative overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2'>
            <div className='text-[8px] font-black uppercase tracking-widest text-slate-600 mb-1.5'>
                {t('bingo.recentCalls')}
            </div>
            {/* Keyed by number (unique per room) — NOT array index — so the sliding
          window doesn't remount every pill on each draw. Only the genuinely new
          pill animates in; the rest stay put and simply glide as the row grows. */}
            <div
                ref={stripRef}
                className='flex gap-1.5 overflow-x-auto scrollbar-hide'
            >
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
                                transition={{
                                    type: 'spring',
                                    stiffness: 300,
                                    damping: 26,
                                }}
                                className='flex-shrink-0 rounded-lg flex items-center justify-center font-black font-mono'
                                style={{
                                    width: isNewest ? 38 : 30,
                                    height: isNewest ? 38 : 30,
                                    fontSize: isNewest ? 13 : 10,
                                    background: isNewest
                                        ? `linear-gradient(135deg, ${s.color}dd, ${s.color}99)`
                                        : `${s.color}${Math.round(opacity * 40)
                                              .toString(16)
                                              .padStart(2, '0')}`,
                                    color: isNewest ? '#fff' : s.color,
                                    border: isNewest
                                        ? `2px solid ${s.color}`
                                        : `1px solid ${s.color}44`,
                                    boxShadow: isNewest
                                        ? `0 0 14px ${s.glow}`
                                        : undefined,
                                }}
                            >
                                {isPatternMode
                                    ? (BINGO_COLS_75.find(
                                          (c) => n >= c.from && n <= c.to,
                                      )?.letter ?? '') + n
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

function CurrentBallDisplay({
    drawnNumbers,
    isPatternMode,
    status,
    count,
    max,
}: {
    drawnNumbers: number[];
    isPatternMode: boolean;
    status: string;
    count: number;
    max: number;
}) {
    const { t } = useTranslation();
    // `drawnNumbers` is the parent's already-paced "revealed" list, so the last
    // entry here is exactly the ball currently lit on the board and cards — they
    // all advance together.
    const n =
        drawnNumbers.length > 0 ? drawnNumbers[drawnNumbers.length - 1] : null;
    const s = n !== null ? getGroupStyle(n, isPatternMode) : null;
    const prefix =
        n !== null && isPatternMode
            ? (BINGO_COLS_75.find((c) => n >= c.from && n <= c.to)?.letter ??
              '')
            : '';

    if (status === 'completed') {
        return (
            <div className='flex flex-col items-center gap-2 py-4'>
                <Trophy size={28} className='text-amber-400' />
                <span className='text-[10px] font-black text-amber-500 uppercase tracking-widest'>
                    {t('bingo.drawComplete')}
                </span>
                <span className='text-[9px] font-mono text-slate-500'>
                    {t('bingo.numbersCalled', { count, max })}
                </span>
            </div>
        );
    }

    if (n === null || status === 'open') {
        return (
            <div className='flex flex-col items-center gap-3 py-4'>
                <div className='w-20 h-20 rounded-2xl border-2 border-dashed border-white/10 flex items-center justify-center'>
                    <span className='text-[9px] font-black text-white/30 uppercase tracking-wider'>
                        {t('bingo.waiting')}
                    </span>
                </div>
                <span className='text-[9px] text-slate-600 font-mono'>
                    0/{max}
                </span>
            </div>
        );
    }

    return (
        <div className='flex flex-col items-center gap-2 py-2'>
            <span className='text-[8px] font-black uppercase tracking-widest text-slate-500'>
                {t('bingo.nowCalling')}
            </span>
            {/* `mode="wait"` guarantees the previous ball fully exits before the next
          enters — one unhurried ball at a time, never two mid-flight overlapping
          into a jittery blur even if reveals land close together. */}
            <AnimatePresence mode='wait'>
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
                        default: {
                            type: 'spring',
                            stiffness: 280,
                            damping: 23,
                            mass: 0.9,
                        },
                        boxShadow: {
                            duration: 1.6,
                            repeat: Infinity,
                            ease: 'easeInOut',
                        },
                    }}
                    className='rounded-2xl flex flex-col items-center justify-center font-black text-white select-none'
                    style={{
                        width: 80,
                        height: 80,
                        background: `linear-gradient(145deg, ${s!.color}22, ${s!.color}08)`,
                        border: `2px solid ${s!.color}66`,
                    }}
                >
                    {prefix && (
                        <span
                            className='text-[9px] font-black leading-none'
                            style={{ color: s!.color }}
                        >
                            {prefix}
                        </span>
                    )}
                    <span
                        className='leading-none'
                        style={{ fontSize: n >= 10 ? 28 : 34, color: s!.color }}
                    >
                        {n}
                    </span>
                </motion.div>
            </AnimatePresence>
            <span className='text-[9px] text-slate-600 font-mono'>
                {t('bingo.ofCount', { count, max })}
            </span>
        </div>
    );
}

// ─── Ticket Cards ─────────────────────────────────────────────────────────────

const PatternTicketCard = memo(
    ({
        ticket,
        patternPrizeMap,
        revealedSet,
    }: {
        ticket: BingoTicket;
        patternPrizeMap: Map<string, string>;
        revealedSet?: Set<number>;
    }) => {
        const { t } = useTranslation();
        const won = ticket.payoutMinor > 0;
        const grid = ticket.grid as Array<Array<number | null>>;
        // Mark cells from the paced "revealed" set when provided, so a number lights on
        // the card at the same instant it is announced in "now calling" and the board.
        // Falls back to the ticket's own marks (e.g. history views with no live pacing).
        const isCellMarked = (value: number) =>
            revealedSet
                ? revealedSet.has(value)
                : ticket.markedNumbers.includes(value);
        return (
            <motion.article
                layout
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                className={`rounded-xl border p-3 flex flex-col gap-2 ${
                    won
                        ? 'bg-gradient-to-br from-amber-950/30 to-black/40 border-amber-500/30 shadow-[0_0_16px_rgba(245,158,11,0.1)]'
                        : 'bg-white/[0.025] border-white/[0.06]'
                }`}
            >
                <div className='flex justify-between items-center'>
                    <span className='text-[10px] font-black text-slate-400'>
                        {ticket.cartelaNumber != null
                            ? `Cartela #${ticket.cartelaNumber}`
                            : `#${ticket.id.slice(-5)}`}
                    </span>
                    <span
                        className={`badge ${won ? 'badge-gold' : 'badge-violet'}`}
                    >
                        {won
                            ? `+${formatCredits(ticket.payoutMinor)} ETB`
                            : ticket.settlementStatus}
                    </span>
                </div>
                {ticket.completedPatterns?.length > 0 && (
                    <p className='text-[9px] text-amber-400 font-bold -mt-1'>
                        {ticket.completedPatterns
                            .map((pid) => patternPrizeMap.get(pid) ?? t('bingo.pattern'))
                            .join(' · ')}
                    </p>
                )}
                {/* Column headers */}
                <div className='grid grid-cols-5 gap-0.5'>
                    {BINGO_COLS_75.map((col) => (
                        <div
                            key={col.letter}
                            className='text-center text-[9px] font-black'
                            style={{ color: col.color }}
                        >
                            {col.letter}
                        </div>
                    ))}
                </div>
                <div className='grid grid-cols-5 gap-0.5'>
                    {grid.map((row, ri) =>
                        row.map((value, ci) => {
                            const isFree = value === null;
                            const isMarked = isFree || isCellMarked(value!);
                            const colStyle =
                                isMarked && !isFree
                                    ? getGroupStyle(value!, true)
                                    : null;
                            return (
                                <motion.span
                                    key={`${ticket.id}-${ri}-${ci}`}
                                    animate={
                                        isMarked && !isFree
                                            ? {
                                                  backgroundColor:
                                                      colStyle!.color,
                                              }
                                            : {}
                                    }
                                    transition={{ duration: 0.3 }}
                                    className={`aspect-square rounded-md flex items-center justify-center text-[9px] font-bold font-mono ${
                                        isFree
                                            ? 'bg-red-600/20 border border-red-500/30 text-red-400 text-[7px]'
                                            : isMarked
                                              ? 'text-white'
                                              : 'bg-white/[0.04] border border-white/[0.06] text-slate-400'
                                    }`}
                                >
                                    {isFree ? t('bingo.free') : value}
                                </motion.span>
                            );
                        }),
                    )}
                </div>
            </motion.article>
        );
    },
);
PatternTicketCard.displayName = 'PatternTicketCard';

const BingoTicketCard = memo(
    ({
        ticket,
        patternPrizeMap,
    }: {
        ticket: BingoTicket;
        patternPrizeMap: Map<string, string>;
    }) => {
        const { t } = useTranslation();
        if (isPatternGrid(ticket.grid)) {
            return (
                <PatternTicketCard
                    ticket={ticket}
                    patternPrizeMap={patternPrizeMap}
                />
            );
        }
        const won = ticket.payoutMinor > 0;
        return (
            <motion.article
                layout
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                className={`rounded-xl border p-3 flex flex-col gap-2 ${
                    won
                        ? 'bg-gradient-to-br from-amber-950/30 to-black/40 border-amber-500/30'
                        : 'bg-white/[0.025] border-white/[0.06]'
                }`}
            >
                <div className='flex justify-between items-center'>
                    <span className='text-[10px] font-black text-slate-400'>
                        #{ticket.id.slice(-5)}
                    </span>
                    <span
                        className={`badge ${won ? 'badge-gold' : 'badge-violet'}`}
                    >
                        {won
                            ? `+${formatCredits(ticket.payoutMinor)} ETB`
                            : ticket.settlementStatus}
                    </span>
                </div>
                {ticket.wonTiers.length > 0 && (
                    <p className='text-[9px] text-amber-400 font-bold -mt-1'>
                        {ticket.wonTiers.map(titleCase).join(' · ')}
                    </p>
                )}
                <div className='space-y-0.5'>
                    {ticket.grid.map((row, ri) => {
                        const isRowComplete =
                            ticket.completedLines.includes(ri);
                        return (
                            <div
                                key={`${ticket.id}-r${ri}`}
                                className={`grid grid-cols-9 gap-0.5 rounded-md p-0.5 transition-colors duration-200 ${
                                    isRowComplete
                                        ? 'bg-amber-500/8 border border-amber-400/25'
                                        : ''
                                }`}
                            >
                                {row.map((value, ci) =>
                                    value ? (
                                        <motion.span
                                            key={`${ticket.id}-r${ri}-c${ci}`}
                                            animate={
                                                ticket.markedNumbers.includes(
                                                    value,
                                                )
                                                    ? {
                                                          backgroundColor:
                                                              '#f59e0b',
                                                          color: '#000',
                                                      }
                                                    : {}
                                            }
                                            transition={{ duration: 0.3 }}
                                            className={`aspect-square rounded-md flex items-center justify-center text-[9px] font-bold font-mono ${
                                                ticket.markedNumbers.includes(
                                                    value,
                                                )
                                                    ? 'bg-amber-400 text-black'
                                                    : 'bg-white/[0.04] border border-white/[0.06] text-slate-400'
                                            }`}
                                        >
                                            {value}
                                        </motion.span>
                                    ) : (
                                        <span
                                            key={`${ticket.id}-r${ri}-c${ci}`}
                                            className='aspect-square bg-black/20 rounded-md border border-white/[0.03]'
                                        />
                                    ),
                                )}
                            </div>
                        );
                    })}
                </div>
                <div className='flex justify-between text-[9px] text-slate-600 pt-1 border-t border-white/[0.05]'>
                    <span>{t('bingo.stakeEtb', { amount: formatCredits(ticket.stakeMinor) })}</span>
                    <span>{t('bingo.linesOf3', { count: ticket.completedLines.length })}</span>
                </div>
            </motion.article>
        );
    },
);
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

function WinnerBingoCard({
    grid,
    drawnNumbers,
    markedNumbers,
    lastCalled,
}: {
    grid: Array<Array<number | null>>;
    drawnNumbers: number[];
    markedNumbers?: number[];
    lastCalled: number | null;
}) {
    // Prefer the server's authoritative marked set (the exact cells the win was
    // settled on); fall back to the room's called numbers when it isn't provided.
    const hitSet = new Set(
        markedNumbers && markedNumbers.length > 0
            ? markedNumbers
            : drawnNumbers,
    );
    const rows = grid.length;
    const cols = grid[0]?.length ?? 0;
    const marked = grid.map((row) =>
        row.map((cell) => cell === null || hitSet.has(cell)),
    );
    const win = grid.map((row) => row.map(() => false));
    for (let r = 0; r < rows; r++)
        if (marked[r].every(Boolean))
            for (let c = 0; c < cols; c++) win[r][c] = true;
    for (let c = 0; c < cols; c++)
        if (marked.every((row) => row[c]))
            for (let r = 0; r < rows; r++) win[r][c] = true;
    if (rows === 5 && cols === 5) {
        if ([0, 1, 2, 3, 4].every((i) => marked[i][i]))
            [0, 1, 2, 3, 4].forEach((i) => {
                win[i][i] = true;
            });
        if ([0, 1, 2, 3, 4].every((i) => marked[i][4 - i]))
            [0, 1, 2, 3, 4].forEach((i) => {
                win[i][4 - i] = true;
            });
    }

    return (
        <div
            className='rounded-lg p-2'
            style={{
                background:
                    'linear-gradient(150deg,#cdd2d8 0%,#d6cbbe 60%,#e6c9a8 100%)',
            }}
        >
            <div className='grid grid-cols-5 gap-1 mb-1'>
                {WIN_HEADER.map((h) => (
                    <div
                        key={h.letter}
                        className='h-7 rounded-full flex items-center justify-center text-white font-black text-base'
                        style={{ background: h.color }}
                    >
                        {h.letter}
                    </div>
                ))}
            </div>
            <div className='grid grid-cols-5 gap-1'>
                {grid.map((row, r) =>
                    row.map((cell, c) => {
                        const isFree = cell === null;
                        const isWin = win[r][c];
                        const isHit = !isFree && marked[r][c] && !isWin;
                        const isLast = !isFree && cell === lastCalled;
                        let bg = '#ffffff';
                        let color = '#1f2937';
                        if (isFree || isWin) {
                            bg = '#1b7a2f';
                            color = '#fff';
                        } else if (isHit) {
                            bg = '#d92d2d';
                            color = '#fff';
                        }
                        return (
                            <div
                                key={`${r}-${c}`}
                                className='aspect-square rounded-md flex items-center justify-center font-black font-mono'
                                style={{
                                    background: bg,
                                    color,
                                    fontSize: isLast ? 17 : 13,
                                    boxShadow: isLast
                                        ? '0 0 0 2px #f59e0b'
                                        : '0 1px 2px rgba(0,0,0,0.15)',
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

type PrefilledPlaceKey = '1st' | '2nd' | '3rd' | '4th' | '5th';
const PREFILLED_PLACE_ORDER: PrefilledPlaceKey[] = [
    '1st',
    '2nd',
    '3rd',
    '4th',
    '5th',
];
const PLACE_MEDAL: Record<PrefilledPlaceKey, string> = {
    '1st': '🥇',
    '2nd': '🥈',
    '3rd': '🥉',
    '4th': '🏅',
    '5th': '🎖️',
};
const PLACE_LABEL: Record<PrefilledPlaceKey, string> = {
    '1st': '1st',
    '2nd': '2nd',
    '3rd': '3rd',
    '4th': '4th',
    '5th': '5th',
};

// How long each live per-place win window stays on screen before the next in the
// queue (or the underlying game) is shown again.
const LIVE_PLACE_WIN_MS = 3_400;
// Beat where the winning ball sits in the "now calling" display BEFORE the 5×5
// winner card pops — so the call is seen first, then the card, then the summary.
const NOW_CALLING_HOLD_MS = 1_400;

export type LivePlaceWin = {
    place: PrefilledPlaceKey;
    entry: Record<string, unknown>;
};

// ─── Live per-place win window ────────────────────────────────────────────────
// Pops the MOMENT a place is won during the draw (not at the end): the winner's
// 5×5 card + name + last-4 phone + place + prize. Auto-dismisses so the draw
// keeps flowing underneath; the end-of-game overlay then shows the summary only.
function LivePlaceWinPopup({
    win,
    drawnNumbers,
    onDone,
}: {
    win: LivePlaceWin;
    drawnNumbers: number[];
    onDone: () => void;
}) {
    const { t } = useTranslation();
    useEffect(() => {
        const id = setTimeout(onDone, LIVE_PLACE_WIN_MS);
        return () => clearTimeout(id);
    }, [win, onDone]);

    const { place, entry } = win;
    const grid =
        (entry.winnerGrid as Array<Array<number | null>> | undefined) ?? null;
    const marked =
        (entry.winnerMarkedNumbers as number[] | undefined) ?? undefined;
    const name = (entry.winnerDisplayName as string | undefined) ?? t('bingo.player');
    const last4 = (entry.winnerPhoneLast4 as string | undefined) ?? '';
    const prize = (entry.prizeMinor as number | undefined) ?? 0;
    const cartela = entry.winnerCartelaNumber as number | undefined;
    const lastCalled =
        drawnNumbers.length > 0 ? drawnNumbers[drawnNumbers.length - 1] : null;

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className='fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm pointer-events-none'
        >
            <motion.div
                initial={{ scale: 0.82, y: 20 }}
                animate={{ scale: 1, y: 0 }}
                exit={{ scale: 0.9, opacity: 0 }}
                transition={{ type: 'spring', stiffness: 300, damping: 21 }}
                className='relative max-w-[300px] w-full mx-4 rounded-2xl p-2.5 space-y-2.5'
                style={{
                    background: 'linear-gradient(160deg,#2b4f57,#1c333a)',
                    border: '2px solid rgba(167,139,250,0.7)',
                    boxShadow: '0 0 34px rgba(167,139,250,0.45)',
                }}
            >
                <div
                    className='rounded-xl py-2.5 px-4 text-center'
                    style={{ background: 'rgba(20,60,60,0.55)' }}
                >
                    <div
                        className='text-2xl font-black tracking-[0.12em] mb-1'
                        style={{
                            color: '#fff',
                            textShadow: '0 0 22px rgba(52,211,153,0.7)',
                        }}
                    >
                        {t('bingo.bingoExclaim')}
                    </div>
                    <div className='text-[11px] font-black uppercase tracking-widest text-amber-300 mb-1'>
                        {PLACE_MEDAL[place]} {t('bingo.placeOrdinal', { place: PLACE_LABEL[place] })}
                    </div>
                    <p className='text-slate-100 text-sm font-bold flex items-center justify-center gap-2 flex-wrap'>
                        <span
                            className='rounded-lg px-3 py-1 font-black text-white'
                            style={{ background: '#2f8f4f' }}
                        >
                            {name}
                            {last4 ? ` ( *${last4} )` : ''}
                        </span>
                        <span>{t('bingo.winsThisPlace')}</span>
                    </p>
                </div>

                {grid && (
                    <div
                        className='rounded-xl p-1.5'
                        style={{
                            background: 'rgba(20,60,60,0.4)',
                            border: '2px solid rgba(167,139,250,0.6)',
                        }}
                    >
                        <div
                            className='rounded-lg p-1.5'
                            style={{
                                border: '2px solid rgba(245,158,11,0.85)',
                            }}
                        >
                            <WinnerBingoCard
                                grid={grid}
                                drawnNumbers={drawnNumbers}
                                markedNumbers={marked}
                                lastCalled={lastCalled}
                            />
                            <div className='flex items-center justify-between px-1 pt-1.5'>
                                <span
                                    className='text-[13px] font-black'
                                    style={{ color: '#34d399' }}
                                >
                                    {t('bingo.prizeEtb', { amount: formatCreditsFull(prize) })}
                                </span>
                                {cartela != null && (
                                    <span className='text-[13px] font-black text-slate-100'>
                                        {t('bingo.cardHash', { n: cartela })}
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </motion.div>
        </motion.div>
    );
}

function RoomResultOverlay({
    room,
    myTickets,
    resultSecs,
    totalDisplaySecs,
    onClose,
}: {
    room: BingoRoomState;
    myTickets: BingoTicket[];
    resultSecs: number;
    totalDisplaySecs: number;
    onClose: () => void;
}) {
    const { t: tr } = useTranslation();
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
        (v): v is Record<string, unknown> =>
            !!v && typeof v === 'object' && !Array.isArray(v),
    );

    // Ordered per-place winners (derash). When more than one place is enabled the
    // dialog reveals them one at a time (1st → 2nd → …) and shows a final standings
    // list; `placeEntries` drives both. Each entry carries name + last-4 phone.
    const placeEntries = PREFILLED_PLACE_ORDER.map((place) => ({
        place,
        entry: summary[place] as Record<string, unknown> | undefined,
    })).filter(
        (
            x,
        ): x is { place: PrefilledPlaceKey; entry: Record<string, unknown> } =>
            !!x.entry && (!!x.entry.winnerDisplayName || !!x.entry.winnerGrid),
    );

    const primaryKey = isPrefilledMode ? '1st' : 'full_house';
    const winEntry =
        (summary[primaryKey] as Record<string, unknown> | undefined) ??
        summaryEntries.find((e) => e.winnerGrid || e.winnerDisplayName);
    const winnerDisplayName =
        (winEntry?.winnerDisplayName as string | undefined) ?? tr('bingo.luckyPlayer');
    const prizeMinor =
        (winEntry?.prizeMinor as number | undefined) ?? room.prizeMinor;
    const winnerTicket = iWon
        ? (myTickets.find((t) => t.payoutMinor > 0) ?? null)
        : null;

    // Did anyone actually win, and were there any players at all? A round can end
    // with no winner (nobody completed the pattern) or with no players (empty room).
    // In those cases we must NOT render a fabricated winner.
    const hasPlayers = room.soldTickets > 0;
    const hasWinner =
        !!winEntry ||
        Object.values(room.winnersByTier ?? {}).some(
            (ids) => Array.isArray(ids) && ids.length > 0,
        );
    const noWinReason = !hasPlayers
        ? tr('bingo.noPlayersNoWin')
        : tr('bingo.noWinnerThisRound');

    const progressPct = Math.max(
        0,
        Math.min(100, (resultSecs / totalDisplaySecs) * 100),
    );

    // ── Derash / prefilled: END-OF-GAME SUMMARY ONLY ──
    // Each winner's 5×5 card is shown LIVE (LivePlaceWinPopup) the MOMENT their
    // place is won during the draw. Here, once the draw has finished, we show only
    // the standings: who placed 1st/2nd/3rd… with name + last-4 phone + card# +
    // amount won (matches the requested summary card).
    if (isPrefilledMode) {
        const topName =
            (winEntry?.winnerDisplayName as string | undefined) ??
            tr('bingo.luckyPlayer');
        return (
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className='fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm'
                onClick={onClose}
            >
                <motion.div
                    initial={{ scale: 0.8, y: 24 }}
                    animate={{ scale: 1, y: 0 }}
                    exit={{ scale: 0.88, opacity: 0 }}
                    transition={{ type: 'spring', stiffness: 280, damping: 20 }}
                    onClick={(e) => e.stopPropagation()}
                    className='relative max-w-[300px] w-full mx-4 rounded-2xl p-2.5 space-y-2.5'
                    style={{
                        background: 'linear-gradient(160deg,#2b4f57,#1c333a)',
                        border: '2px solid rgba(167,139,250,0.7)',
                        boxShadow: '0 0 34px rgba(167,139,250,0.45)',
                    }}
                >
                    {/* Header */}
                    <div
                        className='rounded-xl py-2.5 px-4 text-center'
                        style={{ background: 'rgba(20,60,60,0.55)' }}
                    >
                        {hasWinner ? (
                            <>
                                <div
                                    className='text-2xl font-black tracking-[0.12em] mb-1'
                                    style={{
                                        color: '#fff',
                                        textShadow:
                                            '0 0 22px rgba(52,211,153,0.7)',
                                    }}
                                >
                                    {tr('bingo.bingoExclaim')}
                                </div>
                                <p className='text-slate-100 text-sm font-bold'>
                                    {iWon ? (
                                        <>
                                            {tr('bingo.youWon')}{' '}
                                            <span style={{ color: '#34d399' }}>
                                                {formatCreditsFull(totalWin)}{' '}
                                                ETB
                                            </span>
                                        </>
                                    ) : placeEntries.length > 1 ? (
                                        tr('bingo.finalStandings')
                                    ) : (
                                        <>
                                            <span className='font-black text-white'>
                                                {topName}
                                            </span>{' '}
                                            {tr('bingo.wonTheGame')}
                                        </>
                                    )}
                                </p>
                            </>
                        ) : (
                            <>
                                <div
                                    className='text-3xl font-black tracking-[0.1em] mb-2'
                                    style={{
                                        color: '#fbbf24',
                                        textShadow:
                                            '0 0 22px rgba(251,191,36,0.5)',
                                    }}
                                >
                                    {tr('bingo.noWin')}
                                </div>
                                <p className='text-slate-200 text-sm font-bold'>
                                    {noWinReason}
                                </p>
                            </>
                        )}
                    </div>

                    {/* Final standings — every place that was won: medal + name + last-4
              phone + card# + amount won. No 5×5 replay (that showed live). */}
                    {hasWinner && placeEntries.length > 0 && (
                        <div
                            className='rounded-xl p-2'
                            style={{
                                background: 'rgba(20,60,60,0.4)',
                                border: '1px solid rgba(167,139,250,0.4)',
                            }}
                        >
                            <div className='text-[9px] font-black uppercase tracking-widest text-slate-300/70 mb-1.5 text-center'>
                                {tr('bingo.finalStandings')}
                            </div>
                            <div className='space-y-1'>
                                {placeEntries.map(({ place, entry }) => (
                                    <div
                                        key={place}
                                        className='flex items-center justify-between rounded-lg px-2 py-1 bg-black/20'
                                    >
                                        <span className='flex items-center gap-1.5 min-w-0'>
                                            <span className='text-sm leading-none'>
                                                {PLACE_MEDAL[place]}
                                            </span>
                                            <span className='text-[11px] font-black text-white truncate'>
                                                {(entry.winnerDisplayName as
                                                    | string
                                                    | undefined) ?? tr('bingo.player')}
                                                {entry.winnerPhoneLast4 ? (
                                                    <span className='text-slate-400'>
                                                        {' '}
                                                        *
                                                        {
                                                            entry.winnerPhoneLast4 as string
                                                        }
                                                    </span>
                                                ) : null}
                                            </span>
                                        </span>
                                        <span className='flex items-center gap-2 flex-shrink-0'>
                                            {entry.winnerCartelaNumber !=
                                                null && (
                                                <span className='text-[10px] font-black text-slate-400'>
                                                    #
                                                    {
                                                        entry.winnerCartelaNumber as number
                                                    }
                                                </span>
                                            )}
                                            <span
                                                className='text-[11px] font-black'
                                                style={{ color: '#34d399' }}
                                            >
                                                {formatCreditsFull(
                                                    (entry.prizeMinor as
                                                        | number
                                                        | undefined) ?? 0,
                                                )}
                                            </span>
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Countdown bar */}
                    <div
                        className='rounded-xl py-2 px-4'
                        style={{ background: 'rgba(20,60,60,0.55)' }}
                    >
                        <div className='flex justify-center items-center mb-1'>
                            <span className='font-mono font-black text-xl text-red-500'>
                                {resultSecs}s
                            </span>
                        </div>
                        <div
                            className='h-1.5 rounded-full overflow-hidden'
                            style={{ background: 'rgba(255,255,255,0.12)' }}
                        >
                            <motion.div
                                className='h-full rounded-full'
                                style={{
                                    background:
                                        'linear-gradient(90deg,#34d399,#10b981)',
                                }}
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
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className='fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm'
            onClick={onClose}
        >
            <motion.div
                initial={{ scale: 0.78, y: 28 }}
                animate={{ scale: 1, y: 0 }}
                exit={{ scale: 0.88, opacity: 0 }}
                transition={{ type: 'spring', stiffness: 280, damping: 20 }}
                onClick={(e) => e.stopPropagation()}
                className='relative max-w-sm w-full mx-4 rounded-3xl border overflow-hidden'
                style={{
                    background:
                        'linear-gradient(160deg, #0a1628 0%, #060d1a 50%, #0a0a14 100%)',
                    borderColor: iWon
                        ? 'rgba(251,191,36,0.45)'
                        : 'rgba(248,113,113,0.35)',
                }}
            >
                <div
                    className='absolute inset-0 pointer-events-none'
                    style={{
                        background: iWon
                            ? 'radial-gradient(ellipse at 50% -10%, rgba(251,191,36,0.15) 0%, transparent 55%)'
                            : 'radial-gradient(ellipse at 50% -10%, rgba(248,113,113,0.12) 0%, transparent 55%)',
                    }}
                />

                {/* Header */}
                <div className='relative z-10 text-center pt-8 pb-4 px-6'>
                    <div
                        className='inline-block text-4xl font-black tracking-[0.15em] mb-2'
                        style={{
                            color: iWon ? '#fbbf24' : '#f87171',
                            textShadow: iWon
                                ? '0 0 20px rgba(251,191,36,0.7), 0 2px 0 rgba(0,0,0,0.6)'
                                : '0 0 20px rgba(248,113,113,0.7), 0 2px 0 rgba(0,0,0,0.6)',
                        }}
                    >
                        {iWon ? tr('bingo.youWonExclaim') : hasWinner ? tr('bingo.bingoExclaim') : tr('bingo.noWin')}
                    </div>
                    <p className='text-slate-300 text-sm'>
                        {iWon ? (
                            <>
                                <span className='font-bold text-white'>
                                    {winnerDisplayName}
                                </span>{' '}
                                {tr('bingo.thatsYou')}
                            </>
                        ) : hasWinner ? (
                            <>
                                <span className='font-bold text-white'>
                                    {winnerDisplayName}
                                </span>{' '}
                                {tr('bingo.winsFullHouse')}
                            </>
                        ) : (
                            noWinReason
                        )}
                    </p>
                </div>

                {/* Winner ticket (if I won, 90-ball) */}
                {iWon && winnerTicket && !isPatternGrid(winnerTicket.grid) && (
                    <div className='relative z-10 px-5 pb-3'>
                        <div
                            className='rounded-2xl border p-3'
                            style={{
                                background: 'rgba(251,191,36,0.05)',
                                borderColor: 'rgba(251,191,36,0.2)',
                            }}
                        >
                            <div className='space-y-1'>
                                {winnerTicket.grid.map((row, ri) => {
                                    const complete =
                                        winnerTicket.completedLines.includes(
                                            ri,
                                        );
                                    return (
                                        <div
                                            key={ri}
                                            className={`grid grid-cols-9 gap-0.5 rounded-md p-0.5 ${complete ? 'bg-amber-500/10' : ''}`}
                                        >
                                            {row.map((val, ci) =>
                                                val ? (
                                                    <span
                                                        key={ci}
                                                        className={`aspect-square rounded-md flex items-center justify-center text-[9px] font-black font-mono ${
                                                            winnerTicket.markedNumbers.includes(
                                                                val,
                                                            )
                                                                ? complete
                                                                    ? 'bg-amber-400 text-black'
                                                                    : 'bg-red-500/80 text-white'
                                                                : 'bg-white/[0.04] border border-white/[0.06] text-slate-500'
                                                        }`}
                                                    >
                                                        {val}
                                                    </span>
                                                ) : (
                                                    <span
                                                        key={ci}
                                                        className='aspect-square bg-black/20 rounded-md border border-white/[0.03]'
                                                    />
                                                ),
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                            <div className='flex items-center justify-between mt-2 pt-2 border-t border-white/[0.06]'>
                                <span className='text-[10px] font-black text-amber-400'>
                                    +
                                    {formatCreditsFull(
                                        winnerTicket.payoutMinor,
                                    )}{' '}
                                    ETB
                                </span>
                                <span className='text-[10px] text-slate-500 font-mono'>
                                    Card #{winnerTicket.id.slice(-3)}
                                </span>
                            </div>
                        </div>
                    </div>
                )}

                {/* Prize pill when I didn't win (only when someone actually won) */}
                {!iWon && hasWinner && prizeMinor > 0 && (
                    <div className='relative z-10 flex justify-center pb-4 px-5'>
                        <div
                            className='rounded-2xl border px-6 py-3 text-center'
                            style={{
                                background: 'rgba(248,113,113,0.07)',
                                borderColor: 'rgba(248,113,113,0.18)',
                            }}
                        >
                            <span className='block text-[9px] font-black uppercase tracking-widest text-red-400/60 mb-0.5'>
                                Prize paid
                            </span>
                            <span className='text-2xl font-black text-white font-mono'>
                                {formatCreditsFull(prizeMinor)} ETB
                            </span>
                        </div>
                    </div>
                )}

                {/* Countdown bar */}
                <div className='relative z-10 px-5 pb-6'>
                    <div className='flex justify-between items-center mb-1.5'>
                        <span className='text-[9px] text-slate-500'>
                            Next game starting soon
                        </span>
                        <span
                            className='font-mono font-black text-sm'
                            style={{ color: iWon ? '#fbbf24' : '#f87171' }}
                        >
                            {resultSecs}s
                        </span>
                    </div>
                    <div
                        className='h-2 rounded-full overflow-hidden'
                        style={{ background: 'rgba(255,255,255,0.06)' }}
                    >
                        <motion.div
                            className='h-full rounded-full'
                            style={{
                                background: iWon
                                    ? 'linear-gradient(90deg,#f59e0b,#fbbf24)'
                                    : 'linear-gradient(90deg,#dc2626,#f87171)',
                            }}
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
    const { t } = useTranslation();
    const addToast = useStore((s) => s.addToast);
    const setWallet = useStore((s) => s.setWallet);
    const liveCounts = useStore((s) => s.liveCounts);
    const soundVolume = useStore((s) => s.soundVolume);
    const soundMuted = useStore((s) => s.soundMuted);
    const setSoundVolume = useStore((s) => s.setSoundVolume);
    const setSoundMuted = useStore((s) => s.setSoundMuted);
    const currentUser = useStore((s) => s.user);
    const isSocketConnected = useStore((s) => s.isSocketConnected);

    const [room, setRoom] = useState<BingoRoomState | null>(null);
    const [loading, setLoading] = useState(true);
    const [holdingResult, setHoldingResult] = useState(false);
    const [buying, setBuying] = useState(false);
    const [pendingCartelas, setPendingCartelas] = useState<Set<number>>(
        new Set(),
    );
    const [localTickets, setLocalTickets] = useState<BingoTicket[]>([]);
    const [autoMode, setAutoMode] = useState(true);
    const [claimingId, setClaimingId] = useState<string | null>(null);
    const localRoomIdRef = useRef<string | null>(null);
    const [showChat, setShowChat] = useState(false);
    const [timeRemainingSecs, setTimeRemainingSecs] = useState<number | null>(
        null,
    );
    const [resultSecs, setResultSecs] = useState<number>(0);

    // Live per-place win windows (derash): each place's 5×5 pops the instant it is
    // won during the draw. `shownPlacesRef` tracks which places we've already shown
    // for the current room so we never replay one (or pop a place that was already
    // settled when the player joined mid-game). Driven by the effect below.
    const [livePlaceQueue, setLivePlaceQueue] = useState<LivePlaceWin[]>([]);
    const shownPlacesRef = useRef<{
        roomId: string | null;
        shown: Set<string>;
        seeded: boolean;
    }>({ roomId: null, shown: new Set(), seeded: false });

    const roomIdRef = useRef<string | null>(null);
    const holdingResultRef = useRef(false);
    const victoryRoomRef = useRef<string | null>(null);
    const reconcileTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
        null,
    );
    const resultTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
        {
            displayName: t('bingo.systemName'),
            text: t('bingo.welcomeMessage'),
            timestamp: new Date().toISOString(),
            isSystem: true,
        },
    ]);
    const [chatInput, setChatInput] = useState('');
    const chatEndRef = useRef<HTMLDivElement>(null);
    const chatInputRef = useRef<HTMLInputElement>(null);

    // ── Live per-place win detection ──────────────────────────────────────────────

    const advanceLiveQueue = useCallback(
        () => setLivePlaceQueue((q) => q.slice(1)),
        [],
    );

    // Stage each live win: when a new place reaches the front of the queue, hold for
    // a beat so the winning ball is seen in "now calling" first, THEN arm the 5×5
    // card popup. Disarming on head change re-plays the beat for every place.
    const [popupArmed, setPopupArmed] = useState(false);
    const headPlace = livePlaceQueue[0]?.place ?? null;
    useEffect(() => {
        if (!headPlace) {
            setPopupArmed(false);
            return;
        }
        setPopupArmed(false);
        const id = setTimeout(() => setPopupArmed(true), NOW_CALLING_HOLD_MS);
        return () => clearTimeout(id);
    }, [headPlace]);

    // Single source of truth for live win windows: watch the room's settlement
    // summary and queue a 5×5 window for each newly-won place. Whatever path
    // updated the room (socket draw event, room-completed event, or a poll) drives
    // this, so a window can never be missed. Windows are ordered HIGHEST rank number
    // first (e.g. 3rd → 2nd → 1st) to mirror the easy→hard pattern ladder and build
    // up to the 1st-place win. The FIRST pass for a room only seeds (suppresses)
    // whatever was already settled, so joining mid-game never replays a decided
    // place; a fresh room (or the buying phase) starts clean and shows every rank.
    useEffect(() => {
        const roomId = room?.id ?? null;
        const ref = shownPlacesRef.current;
        if (ref.roomId !== roomId) {
            ref.roomId = roomId;
            ref.shown = new Set();
            ref.seeded = false;
            setLivePlaceQueue([]);
        }
        const summary = room?.settlementSummary;
        if (!roomId || !summary) return;
        const newly: LivePlaceWin[] = [];
        for (const place of PREFILLED_PLACE_ORDER) {
            const entry = summary[place] as Record<string, unknown> | undefined;
            if (
                entry &&
                (entry.winnerDisplayName || entry.winnerGrid) &&
                !ref.shown.has(place)
            ) {
                ref.shown.add(place);
                if (ref.seeded) newly.push({ place, entry });
            }
        }
        ref.seeded = true;
        if (newly.length > 0) {
            // Highest rank number first (…→ 3rd → 2nd → 1st) so the reveal climbs to 1st.
            newly.sort(
                (a, b) =>
                    PREFILLED_PLACE_ORDER.indexOf(b.place) -
                    PREFILLED_PLACE_ORDER.indexOf(a.place),
            );
            setLivePlaceQueue((q) => [...q, ...newly]);
        }
    }, [room]);

    // ── Load ────────────────────────────────────────────────────────────────────

    const loadCurrent = useCallback(async () => {
        try {
            const next = await bingoApi.getCurrentRoom();
            setRoom((prev) => {
                // During result hold, don't switch to a different (newer) room —
                // only allow updating the same room (e.g. to pick up settlement data).
                if (holdingResultRef.current && next?.id !== prev?.id)
                    return prev;
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
        return () => {
            socket.emit('leave.game', { game: 'bingo' });
        };
    }, [isSocketConnected]);

    // ── Socket: game events ──────────────────────────────────────────────────────
    useEffect(() => {
        const socket = getSocket();
        if (!socket) return;

        const scheduleReconcile = () => {
            if (reconcileTimerRef.current)
                clearTimeout(reconcileTimerRef.current);
            reconcileTimerRef.current = setTimeout(() => {
                if (!holdingResultRef.current) void loadCurrent();
            }, 1200);
        };

        const onNumberDrawn = (p: {
            roomId?: string;
            number?: number;
            winnersByTier?: Record<string, string[]>;
            settlementSummary?: Record<string, unknown>;
        }) => {
            if (p.roomId !== roomIdRef.current || p.number === undefined)
                return;
            // The reveal sound is played by CurrentBallDisplay in sync with the queued
            // ball animation, so we don't pop here (that fired in a fast burst).
            const drawn = p.number;
            setRoom((prev) => {
                if (!prev) return prev;
                return {
                    ...prev,
                    status: prev.status === 'open' ? 'running' : prev.status,
                    drawnNumbers: prev.drawnNumbers.includes(drawn)
                        ? prev.drawnNumbers
                        : [...prev.drawnNumbers, drawn],
                    // Keep the settlement summary fresh so the end-of-game overlay has every
                    // place even before the room.completed event / getRoomState resolves.
                    winnersByTier: p.winnersByTier ?? prev.winnersByTier,
                    settlementSummary:
                        p.settlementSummary ?? prev.settlementSummary,
                    tickets: prev.tickets?.map((t) => {
                        if (t.markedNumbers.includes(drawn)) return t;
                        const isOnCard = t.grid.some((row) =>
                            row.some((cell) => cell === drawn),
                        );
                        if (!isOnCard) return t;
                        return {
                            ...t,
                            markedNumbers: [...t.markedNumbers, drawn],
                        };
                    }),
                };
            });
            setLocalTickets((prev) =>
                prev.map((t) => {
                    if (t.markedNumbers.includes(drawn)) return t;
                    const isOnCard = t.grid.some((row) =>
                        row.some((cell) => cell === drawn),
                    );
                    if (!isOnCard) return t;
                    return { ...t, markedNumbers: [...t.markedNumbers, drawn] };
                }),
            );
            scheduleReconcile();
        };

        const onRoomUpdate = (p: { roomId?: string }) => {
            if (holdingResultRef.current) return;
            if (p.roomId === roomIdRef.current || roomIdRef.current === null)
                void loadCurrent();
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
                    settlementSummary:
                        p.settlementSummary ?? prev.settlementSummary,
                };
            });
            // Fetch the completed room BY ID (not getCurrentRoom, which now returns the
            // next room) to pick up settled ticket payouts for the winner-card display.
            void bingoApi
                .getRoomState(completedId)
                .then((full) => {
                    if (full.id !== completedId) return;
                    setRoom((prev) =>
                        prev && prev.id === completedId ? full : prev,
                    );
                })
                .catch(() => undefined);
        };

        const onChatMessage = (p: {
            roomId: string;
            userId?: string;
            displayName: string;
            text: string;
            timestamp: string;
        }) => {
            // Bingo chat is a single global lobby — the server broadcasts to every
            // player in `game_bingo`, not per-room. Rooms rotate each round with a
            // fresh id, so filtering on the current room id silently dropped every
            // message whose sender was on a (transiently) different room id — which
            // is why "text from others" never showed. Accept all lobby messages.
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
            if (reconcileTimerRef.current)
                clearTimeout(reconcileTimerRef.current);
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

        // Hold the room open (no room switch) while the live per-place 5×5 windows are
        // still playing — the summary "win window" only shows once the queue drains, so
        // don't start its display countdown until then. Otherwise a multi-place
        // leaderboard round could burn the whole result window on the live popups and
        // never show the summary. The effect re-runs when the queue length changes.
        if (livePlaceQueue.length > 0) return;

        // Use resultDisplaySeconds from the room config if available, else fall back to constant.
        const displayMs =
            (room.resultDisplaySeconds ?? RESULT_DISPLAY_MS / 1000) * 1000;
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
    }, [room?.id, room?.status, livePlaceQueue.length, loadCurrent]);

    // ── Buy-window countdown ─────────────────────────────────────────────────────
    useEffect(() => {
        setTimeRemainingSecs(null);
        // No scheduledStartAt means the room is IDLE — waiting for the first buyer.
        // Leave the countdown null so the UI shows the idle state, not a 00:00 timer.
        if (!room || room.status !== 'open' || !room.scheduledStartAt) return;
        const tick = () => {
            const ms = new Date(room.scheduledStartAt as string).getTime() - Date.now();
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
        confetti({
            particleCount: 200,
            spread: 90,
            origin: { y: 0.55 },
            colors: ['#FFD700', '#FF4444', '#00FF88', '#FFFFFF'],
        });
        // The bell notification is created + pushed by the server at settlement (so it
        // lands even if the player left the screen) — no client-side entry here to
        // avoid a duplicate.
        // The win credit landed server-side — pull the fresh balance into the header.
        walletApi
            .getWallet()
            .then(setWallet)
            .catch(() => undefined);
    }, [room?.status, room?.tickets, room?.id, localTickets, setWallet]);

    // ── Chat scroll ──────────────────────────────────────────────────────────────
    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [chatMessages]);

    // ── Derived ──────────────────────────────────────────────────────────────────
    const phase: Phase = !room
        ? 'loading'
        : holdingResult
          ? 'result'
          : room.status === 'open'
            ? 'buy'
            : room.status === 'running'
              ? 'playing'
              : 'result';

    const patternPrizeMap = useMemo(
        () =>
            new Map(
                (room?.patternPrizes ?? []).map((pp) => [
                    pp.patternId,
                    pp.name,
                ]),
            ),
        [room],
    );
    // winMode is the source of truth for which board to show.
    const isPatternMode = room?.winMode === 'pattern';
    const isPrefilledMode = room?.winMode === 'prefilled';
    // Ball pool for the board: derash is ALWAYS 75-ball (standard B/I/N/G/O); a
    // stale/misconfigured room's numberRange is ignored so the client can never
    // render a >75 ball (no more 137/187/200 in derash).
    const ballCount = isPatternMode
        ? (room?.numberRange ?? 75)
        : isPrefilledMode
          ? 75
          : 90;
    // Prefilled cards are 75-ball 5×5, so the board uses the B/I/N/G/O layout.
    const boardBingoStyle = isPatternMode || isPrefilledMode;
    const gridSize = room?.gridSize ?? 75;
    // Server draws, clamped to the valid pool — drops any out-of-range ball a
    // legacy room may have produced so it never reaches the UI.
    const drawnNumbers = useMemo(
        () =>
            (room?.drawnNumbers ?? []).filter((n) => n >= 1 && n <= ballCount),
        [room?.drawnNumbers, ballCount],
    );
    const takenSet = useMemo(
        () => new Set(room?.takenSpots ?? []),
        [room?.takenSpots],
    );
    const remainingTickets = room
        ? Math.max(0, room.maxTickets - room.soldTickets)
        : 0;
    const salesOpen = room?.status === 'open';

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
        if (room?.status === 'completed' || room?.status === 'cancelled') {
            setRevealedCount(total);
            return;
        }
        if (revealedCount > total) {
            setRevealedCount(total);
            return;
        }
        if (revealedCount >= total) return;
        // One steady, calm cadence for every ball. Only shorten (still gently) when
        // the client is far behind — never a fast 250ms burst that outruns the
        // animation and reads as "rushed".
        const backlog = total - revealedCount;
        const delay =
            backlog > REVEAL_CATCHUP_BACKLOG ? REVEAL_MIN_MS : REVEAL_BASE_MS;
        const id = setTimeout(() => {
            setRevealedCount((c) => Math.min(c + 1, total));
            soundEngine.pop();
        }, delay);
        return () => clearTimeout(id);
    }, [revealedCount, drawnNumbers.length, room?.status]);
    const revealedNumbers = useMemo(
        () => drawnNumbers.slice(0, revealedCount),
        [drawnNumbers, revealedCount],
    );

    // Two trailing cursors so the reveal cascades: now calling (revealedCount) →
    // board (boardCount, a beat behind) → tickets (ticketCount, a beat behind that).
    // Each snaps backwards instantly (room switch/reset) but lags going forward.
    const [boardCount, setBoardCount] = useState(0);
    const [ticketCount, setTicketCount] = useState(0);
    useEffect(() => {
        if (boardCount === revealedCount) return;
        if (boardCount > revealedCount) {
            setBoardCount(revealedCount);
            return;
        }
        const id = setTimeout(
            () => setBoardCount(revealedCount),
            NOW_CALLING_LEAD_MS,
        );
        return () => clearTimeout(id);
    }, [revealedCount, boardCount]);
    useEffect(() => {
        if (ticketCount === boardCount) return;
        if (ticketCount > boardCount) {
            setTicketCount(boardCount);
            return;
        }
        const id = setTimeout(
            () => setTicketCount(boardCount),
            BOARD_TO_TICKET_MS,
        );
        return () => clearTimeout(id);
    }, [boardCount, ticketCount]);

    const boardNumbers = useMemo(
        () => drawnNumbers.slice(0, boardCount),
        [drawnNumbers, boardCount],
    );
    const ticketSet = useMemo(
        () => new Set(drawnNumbers.slice(0, ticketCount)),
        [drawnNumbers, ticketCount],
    );

    // When a place is won, a card completed its pattern on numbers the server has
    // already drawn. Snap the paced reveal up to the full drawn set so the winner
    // card's marked cells all read as genuinely CALLED — otherwise the board's slow
    // reveal lags behind and the win card looks like it marked uncalled numbers.
    useEffect(() => {
        if (livePlaceQueue.length > 0)
            setRevealedCount(room?.drawnNumbers?.length ?? 0);
    }, [livePlaceQueue.length, room?.drawnNumbers?.length]);

    const myTickets = useMemo(() => {
        const apiTickets = room?.tickets ?? [];
        if (apiTickets.length > 0) return apiTickets;
        if (localRoomIdRef.current === room?.id) return localTickets;
        return [];
    }, [room?.tickets, room?.id, localTickets]);

    const alreadyBought = myTickets.length > 0;

    // Keep the Auto switch in sync with the server (source of truth). A card in
    // manual mode reports autoClaim === false, so if any of my cards is manual the
    // switch shows OFF. Re-derives on every poll so a refresh never desyncs it —
    // except while a toggle is in flight, so an older poll can't flip it back
    // (which would hide the BINGO buttons for a beat).
    const autoBusyRef = useRef(false);
    useEffect(() => {
        if (autoBusyRef.current) return;
        const tix = room?.tickets ?? [];
        if (tix.length > 0)
            setAutoMode(tix.every((t) => t.autoClaim !== false));
    }, [room?.tickets]);

    const toggleAuto = async () => {
        if (!room) return;
        const next = !autoMode;
        autoBusyRef.current = true;
        setAutoMode(next); // optimistic
        try {
            await bingoApi.setAuto(room.id, next);
            await loadCurrent();
        } catch (e) {
            setAutoMode(!next); // revert on failure
            addToast('error', getErrorMessage(e));
        } finally {
            autoBusyRef.current = false;
        }
    };

    const callBingo = async (ticketId: string) => {
        if (!room || claimingId) return;
        setClaimingId(ticketId);
        try {
            const res = await bingoApi.claimBingo(room.id, ticketId);
            if (res.result === 'won') {
                soundEngine.cashout();
                addToast('success', t('bingo.toastYouWon'));
            } else if (res.result === 'disqualified') {
                soundEngine.pop();
                addToast(
                    'error',
                    t('bingo.toastWrongCall'),
                );
            } else {
                addToast('info', t('bingo.toastNoBingoYet'));
            }
            const [nextWallet] = await Promise.all([
                walletApi.getWallet(),
                loadCurrent(),
            ]);
            setWallet(nextWallet);
        } catch (e) {
            addToast('error', getErrorMessage(e));
        } finally {
            setClaimingId(null);
        }
    };

    // Cartela numbers the player already owns in this room.
    const myCartelaSet = useMemo(() => {
        const nums = new Set<number>();
        myTickets.forEach((t) => {
            if (t.cartelaNumber != null) nums.add(t.cartelaNumber);
        });
        return nums;
    }, [myTickets]);

    // ── Buy ──────────────────────────────────────────────────────────────────────
    const buyTickets = async () => {
        if (!room || !salesOpen || alreadyBought) return;
        setBuying(true);
        try {
            const bought = await bingoApi.purchaseTickets(
                room.id,
                1,
                createIdempotencyKey('bingo'),
            );
            localRoomIdRef.current = room.id;
            setLocalTickets(bought);
            const [nextWallet] = await Promise.all([
                walletApi.getWallet(),
                loadCurrent(),
            ]);
            setWallet(nextWallet);
            soundEngine.cashout();
            addToast('success', t('bingo.toastBoughtCard'));
        } catch (err) {
            addToast('error', getErrorMessage(err));
        } finally {
            setBuying(false);
        }
    };

    // Instant buy-or-refund on a single tap. Tapping an available cartela buys it
    // immediately; tapping one you already own (while sales are open) refunds it.
    // A per-cartela pending guard prevents a double-tap from firing twice.
    const handleCartelaTap = useCallback(
        async (n: number) => {
            if (!room || room.status !== 'open') return;
            if (!currentUser) {
                addToast('error', t('bingo.toastLoginToBuy'));
                return;
            }
            if (pendingCartelas.has(n)) return;

            const owned = myCartelaSet.has(n);
            if (!owned && takenSet.has(n)) return; // taken by someone else — locked

            setPendingCartelas((prev) => new Set(prev).add(n));
            try {
                if (owned) {
                    await bingoApi.releaseCartela(room.id, n);
                    setLocalTickets((prev) =>
                        prev.filter((t) => t.cartelaNumber !== n),
                    );
                    addToast('info', t('bingo.toastCartelaRefunded', { n }));
                } else {
                    const bought = await bingoApi.purchaseCartelas(
                        room.id,
                        [n],
                        createIdempotencyKey('bingo-cartela'),
                    );
                    localRoomIdRef.current = room.id;
                    setLocalTickets((prev) => [...prev, ...bought]);
                    soundEngine.cashout();
                    addToast('success', t('bingo.toastCartelaPurchased', { n }));
                }
                const [nextWallet] = await Promise.all([
                    walletApi.getWallet(),
                    loadCurrent(),
                ]);
                setWallet(nextWallet);
            } catch (err) {
                const msg = getErrorMessage(err);
                if (msg.toLowerCase().includes('taken'))
                    addToast('error', t('bingo.toastCartelaTaken'));
                else if (
                    msg.toLowerCase().includes('balance') ||
                    msg.toLowerCase().includes('insufficient') ||
                    msg.toLowerCase().includes('enough')
                )
                    addToast('error', t('bingo.toastInsufficientBalance'));
                else if (msg.toLowerCase().includes('closed'))
                    addToast('error', t('bingo.toastSalesClosed'));
                else if (msg.toLowerCase().includes('limit'))
                    addToast('error', t('bingo.cartelaLimit', { count: parseInt(msg.match(/\d+/)?.[0] ?? '0', 10) }));
                else addToast('error', msg);
                void loadCurrent();
            } finally {
                setPendingCartelas((prev) => {
                    const next = new Set(prev);
                    next.delete(n);
                    return next;
                });
            }
        },
        [
            room,
            currentUser,
            pendingCartelas,
            myCartelaSet,
            takenSet,
            addToast,
            loadCurrent,
            setWallet,
            t,
        ],
    );

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
        <div className='max-w-2xl mx-auto pb-20 space-y-3'>
            {/* Room result overlay — gated on the timed `holdingResult` flag, not the
          derived phase. A completed room's phase stays 'result' until the next
          room loads, so gating on phase left the dialog stuck open after the
          countdown hit 0. holdingResult flips false exactly when the timer ends. */}
            <AnimatePresence>
                {holdingResult &&
                    room &&
                    room.status === 'completed' &&
                    livePlaceQueue.length === 0 && (
                        <RoomResultOverlay
                            room={room}
                            myTickets={myTickets}
                            resultSecs={resultSecs}
                            totalDisplaySecs={
                                room.resultDisplaySeconds ??
                                RESULT_DISPLAY_MS / 1000
                            }
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

            {/* Live per-place win window — pops the instant a place is won DURING the
          draw (derash), one place at a time (oldest first). It also plays out the
          game-ending place after completion; the summary overlay above waits for
          this queue to drain, so every winner gets its live 5×5 moment. */}
            <AnimatePresence>
                {popupArmed && livePlaceQueue.length > 0 && room && (
                    <LivePlaceWinPopup
                        key={livePlaceQueue[0].place}
                        win={livePlaceQueue[0]}
                        drawnNumbers={room.drawnNumbers}
                        onDone={advanceLiveQueue}
                    />
                )}
            </AnimatePresence>

            {/* ── Top bar ── */}
            <div className='flex items-center justify-between'>
                <button
                    onClick={onBack}
                    className='btn btn-ghost btn-sm flex items-center gap-2'
                >
                    <ArrowLeft size={14} /> {t('nav.home')}
                </button>
                <div className='flex items-center gap-2'>
                    {liveCounts && liveCounts.bingoOnline > 0 && (
                        <span className='live-badge-pulse'>
                            <span className='pulse-dot' />
                            {t('home.playing', { count: liveCounts.bingoOnline })}
                        </span>
                    )}
                    <button
                        onClick={() => setSoundMuted(!soundMuted)}
                        className='btn btn-ghost btn-sm icon-btn'
                    >
                        {soundMuted ? (
                            <VolumeX size={15} />
                        ) : (
                            <Volume2 size={15} />
                        )}
                    </button>
                    {!soundMuted && (
                        <input
                            type='range'
                            min='0'
                            max='1'
                            step='0.05'
                            value={soundVolume}
                            onChange={(e) =>
                                setSoundVolume(parseFloat(e.target.value))
                            }
                            className='w-16 accent-amber-500 cursor-pointer h-1 rounded'
                        />
                    )}
                </div>
            </div>

            {/* ── Loading ── */}
            {phase === 'loading' && (
                <div className='centered-loader py-16'>
                    <div className='spinner' />
                </div>
            )}

            {!loading && !room && (
                <div className='card text-center py-12 space-y-2'>
                    <Sparkles size={28} className='mx-auto text-slate-600' />
                    <p className='text-slate-400 text-sm'>
                        {t('bingo.noGameRunning')}
                    </p>
                    <button
                        onClick={() => void loadCurrent()}
                        className='btn btn-secondary btn-sm mt-1'
                    >
                        <RefreshCw size={12} /> {t('common.refresh')}
                    </button>
                </div>
            )}

            {room && (
                <motion.div
                    key={room.id}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ type: 'spring', stiffness: 300, damping: 28 }}
                    className='space-y-3'
                >
                    {/* ── Stats bar ── */}
                    <div className='grid grid-cols-4 gap-2'>
                        {[
                            {
                                key: 'derash',
                                label: t('bingo.statDerash'),
                                value: `${formatCredits(room.prizeMinor)} ETB`,
                                color: 'text-amber-400',
                            },
                            {
                                key: 'players',
                                label: t('bingo.statPlayers'),
                                value: String(room.soldTickets),
                                color: 'text-slate-200',
                            },
                            {
                                key: 'stake',
                                label: t('bingo.statStake'),
                                value: `${formatCredits(room.ticketPriceMinor)} ETB`,
                                color: 'text-slate-200',
                            },
                            {
                                key: 'called',
                                label: t('bingo.statCalled'),
                                value: `${drawnNumbers.length}/${ballCount}`,
                                color: 'text-red-400',
                            },
                        ].map((stat) => (
                            <div
                                key={stat.key}
                                className='rounded-xl bg-white/[0.03] border border-white/[0.06] p-2 text-center'
                            >
                                <span className='block text-[8px] font-bold uppercase tracking-wider text-slate-300 mb-0.5'>
                                    {stat.label}
                                </span>
                                <span
                                    className={`text-[10px] font-black leading-tight ${stat.color}`}
                                >
                                    {stat.value}
                                </span>
                            </div>
                        ))}
                    </div>

                    {/* ── Recent calls strip ── */}
                    {revealedNumbers.length > 0 && (
                        <RecentCallsStrip
                            drawnNumbers={revealedNumbers}
                            isPatternMode={boardBingoStyle}
                        />
                    )}

                    {/* ── Cartela picker (derash buy phase) / Number board ── */}
                    <div className='card p-3'>
                        {isPrefilledMode && phase === 'buy' ? (
                            <div className='space-y-2'>
                                <div className='flex items-center justify-between'>
                                    <span className='text-[9px] font-black text-slate-400 truncate'>
                                        {room.name}
                                    </span>
                                    <div className='flex items-center gap-1.5'>
                                        <span className='text-[7px] font-black bg-amber-500/10 text-amber-400 px-1.5 py-0.5 rounded'>
                                            DERASH
                                        </span>
                                        {timeRemainingSecs !== null ? (
                                            <span
                                                className={`font-mono font-black text-sm ${timeRemainingSecs <= 10 ? 'text-red-400' : 'text-amber-400'}`}
                                            >
                                                {String(
                                                    Math.floor(
                                                        timeRemainingSecs / 60,
                                                    ),
                                                ).padStart(2, '0')}
                                                :
                                                {String(
                                                    timeRemainingSecs % 60,
                                                ).padStart(2, '0')}
                                            </span>
                                        ) : (
                                            <span className='text-[8px] font-black uppercase tracking-wide text-emerald-400 animate-pulse'>
                                                {t('bingo.idleWaiting')}
                                            </span>
                                        )}
                                    </div>
                                </div>
                                <p className='text-[9px] text-slate-500'>
                                    {t('bingo.cartelaInstructions')}
                                </p>
                                {/* Bought cartelas — live chips. Tap a chip to remove (refund). */}
                                {myCartelaSet.size > 0 && (
                                    <div className='flex items-center gap-1.5 flex-wrap rounded-lg bg-emerald-500/5 border border-emerald-500/15 px-2 py-1.5'>
                                        <span className='text-[8px] font-black uppercase tracking-wider text-emerald-400/80 mr-0.5'>
                                            {t('bingo.yourCartelas', {
                                                count: myCartelaSet.size,
                                            })}
                                        </span>
                                        {[...myCartelaSet]
                                            .sort((a, b) => a - b)
                                            .map((n) => {
                                                const busy =
                                                    pendingCartelas.has(n);
                                                return (
                                                    <button
                                                        key={n}
                                                        type='button'
                                                        onClick={() =>
                                                            handleCartelaTap(n)
                                                        }
                                                        disabled={busy}
                                                        title={t(
                                                            'bingo.tapToRefund',
                                                        )}
                                                        className={`group flex items-center gap-0.5 rounded-md bg-emerald-500/20 text-emerald-300 font-mono font-black text-[11px] pl-2 pr-1.5 py-0.5 border border-emerald-400/30 transition ${
                                                            busy
                                                                ? 'opacity-50'
                                                                : 'hover:bg-red-500/20 hover:text-red-300 hover:border-red-400/40'
                                                        }`}
                                                    >
                                                        {n}
                                                        <span className='text-[10px] leading-none opacity-60 group-hover:opacity-100'>
                                                            ×
                                                        </span>
                                                    </button>
                                                );
                                            })}
                                    </div>
                                )}
                                <CartelaGrid
                                    gridSize={gridSize}
                                    takenSet={takenSet}
                                    mySet={myCartelaSet}
                                    pendingSet={pendingCartelas}
                                    salesOpen={salesOpen}
                                    onTap={handleCartelaTap}
                                />
                            </div>
                        ) : (
                            <div className='flex items-start gap-3'>
                                {/* Room name + status */}
                                <div className='flex-1 min-w-0'>
                                    <div className='flex items-center gap-2 mb-2'>
                                        <span className='text-[9px] font-black text-slate-400 truncate'>
                                            {room.name}
                                        </span>
                                        <span
                                            className={`text-[8px] font-black uppercase px-1.5 py-0.5 rounded flex-shrink-0 ${
                                                room.status === 'open'
                                                    ? 'bg-emerald-500/10 text-emerald-400'
                                                    : room.status === 'running'
                                                      ? 'bg-red-500/10 text-red-400'
                                                      : 'bg-slate-700/50 text-slate-400'
                                            }`}
                                        >
                                            {room.status === 'open'
                                                ? t('bingo.buyOpen')
                                                : room.status}
                                        </span>
                                        {isPrefilledMode ? (
                                            <span className='text-[7px] font-black bg-amber-500/10 text-amber-400 px-1 py-0.5 rounded flex-shrink-0'>
                                                DERASH
                                            </span>
                                        ) : (
                                            isPatternMode && (
                                                <span className='text-[7px] font-black bg-violet-500/10 text-violet-400 px-1 py-0.5 rounded flex-shrink-0'>
                                                    75-BALL
                                                </span>
                                            )
                                        )}
                                    </div>
                                    <NumberBoard
                                        drawnNumbers={boardNumbers}
                                        numberRange={ballCount}
                                        isPatternMode={boardBingoStyle}
                                    />
                                </div>
                                {/* Now calling + (derash) my mapped cards stacked below */}
                                <div
                                    className={`flex-shrink-0 flex flex-col items-center gap-2 ${isPrefilledMode && myTickets.length > 0 ? 'w-32 sm:w-40' : 'w-24'}`}
                                >
                                    <CurrentBallDisplay
                                        drawnNumbers={revealedNumbers}
                                        isPatternMode={boardBingoStyle}
                                        status={room.status}
                                        count={revealedNumbers.length}
                                        max={ballCount}
                                    />
                                    {phase === 'buy' &&
                                        (timeRemainingSecs !== null ? (
                                            <div className='mt-1 text-center'>
                                                <div className='text-[8px] text-slate-500 mb-0.5'>
                                                    {t('bingo.startsIn')}
                                                </div>
                                                <span
                                                    className={`font-mono font-black text-sm ${timeRemainingSecs <= 10 ? 'text-red-400' : 'text-amber-400'}`}
                                                >
                                                    {String(
                                                        Math.floor(
                                                            timeRemainingSecs /
                                                                60,
                                                        ),
                                                    ).padStart(2, '0')}
                                                    :
                                                    {String(
                                                        timeRemainingSecs % 60,
                                                    ).padStart(2, '0')}
                                                </span>
                                            </div>
                                        ) : (
                                            <div className='mt-1 text-center'>
                                                <div className='text-[8px] font-black uppercase tracking-wide text-emerald-400 animate-pulse'>
                                                    {t('bingo.idleWaiting')}
                                                </div>
                                                <div className='text-[7px] text-slate-500 mt-0.5'>
                                                    {t('bingo.idleHint')}
                                                </div>
                                            </div>
                                        ))}
                                    {/* Derash: mapped 5×5 card(s), vertically stacked under the caller,
                     with the owned-count label. The stack scrolls so many cartelas
                     never blow out the layout. */}
                                    {isPrefilledMode &&
                                        myTickets.length > 0 && (
                                            <>
                                                <div className='w-full flex items-center justify-between gap-2'>
                                                    <span className='text-[9px] font-black uppercase tracking-wider text-slate-500'>
                                                        {myTickets.length}{' '}
                                                        {myTickets.length === 1
                                                            ? 'card'
                                                            : 'cards'}
                                                    </span>
                                                    {phase === 'playing' && (
                                                        <button
                                                            type='button'
                                                            role='switch'
                                                            aria-checked={
                                                                autoMode
                                                            }
                                                            onClick={() =>
                                                                void toggleAuto()
                                                            }
                                                            title={
                                                                autoMode
                                                                    ? t('bingo.autoTitle')
                                                                    : t('bingo.manualTitle')
                                                            }
                                                            className='flex items-center gap-1.5'
                                                        >
                                                            <span
                                                                className={`text-[9px] font-black uppercase tracking-wider ${autoMode ? 'text-emerald-400' : 'text-amber-400'}`}
                                                            >
                                                                {autoMode
                                                                    ? t('bingo.auto')
                                                                    : t('bingo.manual')}
                                                            </span>
                                                            <span
                                                                className={`relative w-8 h-[18px] rounded-full transition-colors duration-200 ${autoMode ? 'bg-emerald-500/80' : 'bg-slate-600'}`}
                                                            >
                                                                <span
                                                                    className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white transition-transform duration-200 ${autoMode ? 'translate-x-[16px]' : 'translate-x-[2px]'}`}
                                                                />
                                                            </span>
                                                        </button>
                                                    )}
                                                </div>
                                                {phase === 'playing' &&
                                                    !autoMode && (
                                                        <p className='w-full text-[8px] leading-tight text-amber-400/80 text-center'>
                                                            Manual mode — only
                                                            tap <b>BINGO</b>{' '}
                                                            when your card
                                                            actually wins. A
                                                            wrong call{' '}
                                                            <b>disqualifies</b>{' '}
                                                            the card!
                                                        </p>
                                                    )}
                                                <div
                                                    className='w-full flex flex-col gap-2 overflow-y-auto pr-1 scrollbar-hide'
                                                    style={{ maxHeight: 340 }}
                                                >
                                                    {myTickets.map((ticket) => (
                                                        <div
                                                            key={ticket.id}
                                                            className='w-full flex flex-col gap-1'
                                                        >
                                                            <PatternTicketCard
                                                                ticket={ticket}
                                                                patternPrizeMap={
                                                                    patternPrizeMap
                                                                }
                                                                revealedSet={
                                                                    ticketSet
                                                                }
                                                            />
                                                            {phase ===
                                                                'playing' &&
                                                                !autoMode &&
                                                                ticket.status ===
                                                                    'active' && (
                                                                    <button
                                                                        type='button'
                                                                        onClick={() =>
                                                                            void callBingo(
                                                                                ticket.id,
                                                                            )
                                                                        }
                                                                        disabled={
                                                                            claimingId ===
                                                                            ticket.id
                                                                        }
                                                                        className='w-full py-1.5 rounded-lg bg-gradient-to-r from-amber-500 to-red-500 text-black text-[11px] font-black uppercase tracking-wide disabled:opacity-50 active:scale-95 transition-transform'
                                                                    >
                                                                        {claimingId ===
                                                                        ticket.id
                                                                            ? '…'
                                                                            : t('bingo.bingoExclaim')}
                                                                    </button>
                                                                )}
                                                            {ticket.status ===
                                                                'disqualified' && (
                                                                <span className='w-full text-center text-[9px] font-black text-red-400 uppercase tracking-wide'>
                                                                    {t('bingo.disqualified')}
                                                                </span>
                                                            )}
                                                        </div>
                                                    ))}
                                                </div>
                                            </>
                                        )}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* ── Owned summary (derash) — buying happens instantly on tap ── */}
                    {isPrefilledMode && phase === 'buy' && (
                        <div className='card'>
                            <div className='flex items-center justify-between text-[10px]'>
                                <span className='font-black uppercase tracking-wider text-slate-400'>
                                    Owned:{' '}
                                    <span className='text-emerald-400'>
                                        {myCartelaSet.size}
                                    </span>
                                    {room && myCartelaSet.size > 0 && (
                                        <span className='text-slate-500'>
                                            {' '}
                                            ·{' '}
                                            {formatCreditsFull(
                                                myCartelaSet.size *
                                                    room.ticketPriceMinor,
                                            )}{' '}
                                            ETB staked
                                        </span>
                                    )}
                                </span>
                                <span className='text-slate-500'>
                                    {remainingTickets} cartelas left
                                </span>
                            </div>
                        </div>
                    )}

                    {/* ── Buy panel (line/pattern mode only — prefilled buys via grid) ── */}
                    {!isPrefilledMode && phase === 'buy' && !alreadyBought && (
                        <div className='card space-y-2'>
                            <div className='flex items-center justify-between'>
                                <p className='text-[10px] font-black uppercase tracking-wider text-slate-400'>
                                    {t('bingo.buyACard')}
                                </p>
                                <span className='text-[10px] text-slate-500'>
                                    {t('bingo.spotsLeft', { count: remainingTickets })}
                                </span>
                            </div>
                            <motion.button
                                whileHover={
                                    !buying && remainingTickets > 0
                                        ? { scale: 1.02, y: -2 }
                                        : {}
                                }
                                whileTap={{ scale: 0.97 }}
                                onClick={buyTickets}
                                disabled={buying || remainingTickets <= 0}
                                className='btn btn-primary btn-full py-3.5 text-base font-black'
                            >
                                {buying ? (
                                    <span className='flex items-center gap-2 justify-center'>
                                        <RefreshCw
                                            size={15}
                                            className='animate-spin'
                                        />{' '}
                                        {t('bingo.processing')}
                                    </span>
                                ) : remainingTickets <= 0 ? (
                                    t('bingo.roomFull')
                                ) : (
                                    t('bingo.buyCardEtb', { amount: formatCreditsFull(room.ticketPriceMinor) })
                                )}
                            </motion.button>
                        </div>
                    )}

                    {!isPrefilledMode && phase === 'buy' && alreadyBought && (
                        <div className='card flex items-center gap-3 py-3'>
                            <span className='text-emerald-400 text-lg'>✓</span>
                            <div>
                                <p className='text-[11px] font-black text-emerald-400'>
                                    {t('bingo.cardPurchased')}
                                </p>
                                <p className='text-[10px] text-slate-500'>
                                    {t('bingo.waitingForDraw')}
                                </p>
                            </div>
                        </div>
                    )}

                    {/* ── My card(s) ──
             Derash shows purchased cartelas here during buy-in; once the draw
             starts they move up beside the caller, so we skip the bottom list. */}
                    {myTickets.length > 0 &&
                    !(isPrefilledMode && phase !== 'buy') ? (
                        <div className='space-y-2'>
                            <h3 className='text-[10px] font-black uppercase tracking-wider text-slate-500 px-1'>
                                {isPrefilledMode
                                    ? t('bingo.myCartelas', { count: myTickets.length })
                                    : t('bingo.myCard')}
                            </h3>
                            <div className='grid gap-3 grid-cols-1 sm:grid-cols-2'>
                                {myTickets.map((ticket) => (
                                    <BingoTicketCard
                                        key={ticket.id}
                                        ticket={ticket}
                                        patternPrizeMap={patternPrizeMap}
                                    />
                                ))}
                            </div>
                        </div>
                    ) : (
                        myTickets.length === 0 &&
                        phase !== 'buy' && (
                            <div className='card text-center py-6 space-y-1'>
                                <Sparkles
                                    size={20}
                                    className='mx-auto text-slate-600'
                                />
                                <p className='text-slate-500 text-xs'>
                                    {isPrefilledMode
                                        ? t('bingo.noCartelasThisRound')
                                        : t('bingo.noCardThisRound')}
                                </p>
                                <p className='text-slate-600 text-[10px]'>
                                    {t('bingo.nextGameOpensSoon')}
                                </p>
                            </div>
                        )
                    )}

                    {/* ── Chat (collapsible) ── */}
                    <div className='card space-y-2'>
                        <button
                            onClick={() => setShowChat((v) => !v)}
                            className='w-full flex items-center justify-between'
                        >
                            <span className='text-[10px] font-black uppercase tracking-wider text-slate-400 flex items-center gap-2'>
                                <MessageSquare size={11} /> {t('bingo.roomChat')}
                            </span>
                            <span className='flex items-center gap-1'>
                                {chatMessages.filter((m) => !m.isSystem)
                                    .length > 0 && (
                                    <span className='text-[9px] text-blue-400 font-bold'>
                                        {
                                            chatMessages.filter(
                                                (m) => !m.isSystem,
                                            ).length
                                        }
                                    </span>
                                )}
                                <Users size={9} className='text-slate-600' />
                                <span className='text-[9px] text-slate-600'>
                                    {showChat ? '▲' : '▼'}
                                </span>
                            </span>
                        </button>
                        <AnimatePresence>
                            {showChat && (
                                <motion.div
                                    initial={{ opacity: 0, height: 0 }}
                                    animate={{ opacity: 1, height: 220 }}
                                    exit={{ opacity: 0, height: 0 }}
                                    transition={{ duration: 0.2 }}
                                    className='overflow-hidden flex flex-col'
                                >
                                    <div
                                        className='flex-1 overflow-y-auto pr-1 space-y-1.5'
                                        style={{ maxHeight: 160 }}
                                    >
                                        {chatMessages.map((msg, i) => {
                                            const isOwn =
                                                !msg.isSystem &&
                                                msg.userId === currentUser?.id;
                                            return (
                                                <div
                                                    key={i}
                                                    className={`flex flex-col ${isOwn ? 'items-end' : 'items-start'}`}
                                                >
                                                    {!msg.isSystem && (
                                                        <span
                                                            className={`text-[9px] font-bold mb-0.5 ${isOwn ? 'text-amber-400' : 'text-blue-400'}`}
                                                        >
                                                            {isOwn
                                                                ? t('bingo.you')
                                                                : msg.displayName}
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
                                    <div className='flex gap-2 mt-2 pt-2 border-t border-white/[0.05]'>
                                        <input
                                            ref={chatInputRef}
                                            className='input flex-1 text-xs py-1.5'
                                            placeholder={t('bingo.saySomething')}
                                            maxLength={200}
                                            value={chatInput}
                                            onChange={(e) =>
                                                setChatInput(e.target.value)
                                            }
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter')
                                                    sendChat();
                                            }}
                                        />
                                        <button
                                            onClick={sendChat}
                                            disabled={!chatInput.trim()}
                                            className='btn btn-primary btn-sm'
                                        >
                                            {t('common.send')}
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
