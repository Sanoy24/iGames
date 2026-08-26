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
import { bingoApi, walletApi, type BingoLobbyRoom } from '../lib/api';
import { getBingoCardPalette } from '../lib/bingoCardPalette';
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
import { fireConfetti } from '../lib/confetti';

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
// full, unhurried moment on the caller, the board and the cards.
// REVEAL_BASE_MS is only the fallback used before the first `bingo.number.drawn`
// event of a session arrives  once a draw event lands, its `intervalMs` (the
// server's actual configured cadence) takes over as the steady-state delay. This
// was previously a hardcoded 1500ms, faster than the server's own 2000ms default,
// so the client routinely caught up and stalled waiting on the socket  visible
// as uneven/laggy calling ("it seems the bot is calculating").
const REVEAL_BASE_MS = 1_500;

// If the client falls more than this many balls behind (backgrounded tab,
// dropped socket, a big poll catch-up  see the visibility/focus resync
// effect below), we do NOT animate through the backlog at a sped-up pace
// that reads as suspicious ("is this rigged?") rather than as a resync. We
// jump straight to CATCHUP_TAIL balls short of live and resume the normal
// calm cadence from there, showing a brief "Catching up…" badge so the jump
// is legible instead of either a suspicious speed-run or a silent teleport.
const REVEAL_CATCHUP_BACKLOG = 10;
const CATCHUP_TAIL = 3;
const CATCHUP_BADGE_MS = 2_500;

// The pacer intentionally runs ONE ball behind the server. That buffer is what
// absorbs the draw scheduler's 0-250ms of tick jitter (SCHEDULER_TICK_MS in
// bingo.scheduler.ts) and keeps the calling cadence even instead of lurching.
// Anything beyond it is debt, and the pacer below works it off.
const REVEAL_TARGET_BACKLOG = 1;
// How that debt is worked off. Smoothness is the constraint here, not speed: the
// rhythm the player hears/sees must not lurch. So we shave a SMALL slice off the
// interval per ball of debt rather than dividing by it - dividing (3.0s -> 1.0s
// at three balls behind) is a 3x rhythm change and reads as the game suddenly
// sprinting. At 0.15 per ball capped at 0.45, the delay relaxes back toward the
// steady cadence in ~15% steps (0.55x -> 0.70x -> 0.85x -> 1x) as the debt
// clears: monotonic, each step under the threshold of being noticed, and never
// faster than a little over half the normal pace even at the cap.
const REVEAL_DRAIN_PER_BALL = 0.15;
const REVEAL_DRAIN_MAX = 0.45;
// Absolute floor, for rooms configured with a very short draw interval.
const REVEAL_MIN_DRAIN_MS = 550;

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

// 75-ball: B/I/N/G/O columns  each is a distinct accent
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

// 90-ball: 9 groups of 10  each decade gets a different accent
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
        // The most-recently revealed ball  highlighted distinctly on the board so it's
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
        returnLocked,
        onTap,
    }: {
        gridSize: number;
        takenSet: Set<number>;
        mySet: Set<number>;
        pendingSet: Set<number>;
        salesOpen: boolean;
        returnLocked: boolean;
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

                    const canBuy =
                        salesOpen && !takenByOther && !pending && !returnLocked;
                    const canRefund =
                        mine && salesOpen && !pending && !returnLocked;
                    const canTap = canBuy || canRefund;

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
                                cursor: canTap
                                    ? 'pointer'
                                    : mine && returnLocked
                                      ? 'not-allowed'
                                      : 'default',
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
    activePatternNames,
}: {
    drawnNumbers: number[];
    isPatternMode: boolean;
    /** Names of the pattern(s) this round is actually playing for (a pattern-mode
     * round can have several active at once, each with its own prize)  shown
     * next to the strip header so it stays in view while calling is live,
     * instead of only surfacing once a pattern is already won. */
    activePatternNames?: string[];
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
            <div className='flex items-center justify-between gap-2 mb-1.5'>
                <div className='text-[8px] font-black uppercase tracking-widest text-slate-600'>
                    {t('bingo.recentCalls')}
                </div>
                {activePatternNames && activePatternNames.length > 0 && (
                    <div className='flex items-center gap-1 min-w-0'>
                        <span className='w-1 h-1 rounded-full bg-violet-400 flex-shrink-0' />
                        <span className='text-[8px] font-black uppercase tracking-wide text-white truncate'>
                            {activePatternNames.join(' · ')}
                        </span>
                    </div>
                )}
            </div>
            {/* Keyed by number (unique per room)  NOT array index  so the sliding
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
    catchingUp,
    catchupKind,
}: {
    drawnNumbers: number[];
    isPatternMode: boolean;
    status: string;
    count: number;
    max: number;
    catchingUp?: boolean;
    catchupKind?: 'live' | 'completed';
}) {
    const { t } = useTranslation();
    // `drawnNumbers` is the parent's already-paced "revealed" list, so the last
    // entry here is exactly the ball currently lit on the board and cards  they
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
        // `status` here is the PRESENTED status (see presentedStatus in
        // BingoRoomView), so reaching this branch already means the reveal has
        // called every ball - this can no longer replace the "now calling" tile
        // with a trophy while the deciding ball is still queued up behind it.
        // The catch-up wording below still applies to the far-behind branch,
        // where the card is visibly filling in faster than it was called.
        const replaying = catchingUp && catchupKind === 'completed';
        return (
            <div className='flex flex-col items-center gap-1.5 py-2'>
                <Trophy size={24} className='text-amber-400' />
                <span
                    className={`text-[10px] font-black uppercase tracking-widest ${replaying ? 'text-amber-400' : 'text-amber-500'}`}
                >
                    {replaying
                        ? t('bingo.replayingResult')
                        : t('bingo.drawComplete')}
                </span>
                <span className='text-[9px] font-mono text-slate-500'>
                    {t('bingo.numbersCalled', { count, max })}
                </span>
            </div>
        );
    }

    if (n === null || status === 'open') {
        return (
            <div className='flex flex-col items-center gap-2 py-2'>
                <div className='w-14 h-14 rounded-xl border-2 border-dashed border-white/10 flex items-center justify-center'>
                    <span className='text-[8px] font-black text-white/30 uppercase tracking-wider'>
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
        <div className='flex flex-col items-center gap-1 py-1'>
            <span
                className={`text-[8px] font-black uppercase tracking-widest ${catchingUp ? 'text-amber-400' : 'text-slate-500'}`}
            >
                {catchingUp ? t('bingo.catchingUp') : t('bingo.nowCalling')}
            </span>
            {/* `mode="wait"` guarantees the previous ball fully exits before the next
          enters  one unhurried ball at a time, never two mid-flight overlapping
          into a jittery blur even if reveals land close together. */}
            <AnimatePresence mode='wait'>
                {/* iGames' own rounded-tile caller. The smoothness  not the shape  is
            what we borrowed from the reference: it pops in on a calm spring, the
            glow breathes gently, and `mode="wait"` keeps exactly one tile in
            flight so it never smears into the next. */}
                <motion.div
                    key={n}
                    // Only handles the mount/unmount transition  a plain spring on
                    // `y`/`opacity`, exactly the shape that was proven stable before
                    // any glow work. No keyframe arrays here on purpose: `exit` and
                    // `animate` share this single transition, so there's no risk of
                    // `exit` silently inheriting an infinite-repeat config from a
                    // property it doesn't even animate.
                    initial={{ y: -18, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: 12, opacity: 0 }}
                    transition={{
                        type: 'spring',
                        stiffness: 280,
                        damping: 23,
                        mass: 0.9,
                    }}
                >
                    {/* The perpetual glow/scale pulse lives entirely outside Framer
                    Motion  a plain CSS `@keyframes` animation (`.bingo-ball-pulse`
                    in index.css) driven by `--ball-glow`/`--ball-inset` custom
                    properties. Framer Motion never touches `boxShadow` or `scale`
                    here, so there's no keyframe-array interpolation for it to choke
                    on and nothing for `exit` to accidentally inherit. */}
                    <div
                        className='bingo-ball-pulse rounded-xl flex flex-col items-center justify-center font-black text-white select-none'
                        style={
                            {
                                width: 54,
                                height: 54,
                                background: `linear-gradient(145deg, ${s!.color}22, ${s!.color}08)`,
                                border: `2px solid ${s!.color}66`,
                                outline: '2px solid #fff',
                                outlineOffset: 2,
                                '--ball-glow': s!.glow,
                                '--ball-inset': `${s!.color}33`,
                            } as React.CSSProperties
                        }
                    >
                        {prefix && (
                            <span
                                className='text-[13px] font-black leading-none'
                                style={{ color: s!.color }}
                            >
                                {prefix}
                            </span>
                        )}
                        <span
                            className='leading-none'
                            style={{
                                fontSize: n >= 10 ? 22 : 26,
                                color: s!.color,
                            }}
                        >
                            {n}
                        </span>
                    </div>
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
                className={`rounded-xl border p-2 flex flex-col gap-1.5 ${
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
                        style={
                            won
                                ? undefined
                                : {
                                      fontSize: 7,
                                      padding: '1px 5px',
                                      letterSpacing: 0,
                                  }
                        }
                    >
                        {won
                            ? `+${formatCredits(ticket.payoutMinor)} ETB`
                            : ticket.settlementStatus}
                    </span>
                </div>
                {ticket.completedPatterns?.length > 0 && (
                    <p className='text-[9px] text-amber-400 font-bold -mt-1'>
                        {ticket.completedPatterns
                            .map(
                                (pid) =>
                                    patternPrizeMap.get(pid) ??
                                    t('bingo.pattern'),
                            )
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
                className={`rounded-xl border p-2 flex flex-col gap-1.5 ${
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
                        style={
                            won
                                ? undefined
                                : {
                                      fontSize: 7,
                                      padding: '1px 5px',
                                      letterSpacing: 0,
                                  }
                        }
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
                    <span>
                        {t('bingo.stakeEtb', {
                            amount: formatCredits(ticket.stakeMinor),
                        })}
                    </span>
                    <span>
                        {t('bingo.linesOf3', {
                            count: ticket.completedLines.length,
                        })}
                    </span>
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
    winCells,
    lastCalled,
}: {
    grid: Array<Array<number | null>>;
    drawnNumbers: number[];
    markedNumbers?: number[];
    /** The exact cells that satisfied the awarded pattern (server-computed).
     * When present, ONLY these render as the win  a card can legitimately
     * have extra lines complete by chance, and those must not be shown as if
     * they were required to win. Falls back to auto-detecting any complete
     * line when absent (older rooms settled before this field existed). */
    winCells?: Array<{ row: number; col: number }>;
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
    if (winCells && winCells.length > 0) {
        for (const { row, col } of winCells) {
            if (win[row]) win[row][col] = true;
        }
    } else {
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
// A split place stacks one full 5x5 winner card PER winner, so the window needs
// longer to be readable (and scrollable) than a single-winner one. Each extra
// winner past the first adds this much. Mirrored server-side in
// bingo.service.ts (LIVE_PLACE_WIN_SPLIT_EXTRA_MS) - the bot buy-in hold budgets
// against these exact numbers, so keep the two in sync.
const LIVE_PLACE_WIN_SPLIT_EXTRA_MS = 1_800;
export function placeWinDisplayMs(winnerCount: number): number {
    return (
        LIVE_PLACE_WIN_MS +
        Math.max(0, winnerCount - 1) * LIVE_PLACE_WIN_SPLIT_EXTRA_MS
    );
}
// Quiet beat AFTER the deciding ball has been fully called and marked on the
// card, before the 5x5 winner card covers it. This is a pause on a finished
// board now, not a race against the reveal: see the live win staging block in
// BingoRoomView, which is what guarantees the ball has actually landed first.
const NOW_CALLING_HOLD_MS = 1_800;

export type LivePlaceWin = {
    place: PrefilledPlaceKey;
    entry: Record<string, unknown>;
};

type WinnerRecord = {
    winnerGrid?: Array<Array<number | null>>;
    winnerMarkedNumbers?: number[];
    winPatternCells?: Array<{ row: number; col: number }>;
    winnerDisplayName?: string;
    winnerPhoneLast4?: string;
    winnerCartelaNumber?: number;
    shareMinor?: number;
};

/**
 * Normalizes a settlement entry into its individual winners, whether it uses
 * the current `winners: [...]` array (several cards can jointly complete a
 * place in the same draw and split its prize) or the older shape from before
 * that existed, where the winner fields sat directly on the entry itself.
 */
function getEntryWinners(entry: Record<string, unknown>): WinnerRecord[] {
    if (Array.isArray(entry.winners)) {
        return entry.winners as WinnerRecord[];
    }
    if (entry.winnerDisplayName || entry.winnerGrid) {
        return [
            {
                ...entry,
                shareMinor: entry.prizeMinor as number | undefined,
            } as WinnerRecord,
        ];
    }
    return [];
}

function BingoLiveWinCard({
    place,
    entry,
    drawnNumbers,
}: {
    place: PrefilledPlaceKey;
    entry: Record<string, unknown>;
    drawnNumbers: number[];
}) {
    const { t } = useTranslation();
    const winners = getEntryWinners(entry);
    const disqualified = !!entry.disqualified;
    const lastCalled =
        drawnNumbers.length > 0 ? drawnNumbers[drawnNumbers.length - 1] : null;
    const splitWays = winners.length > 1;

    // pointer-events-auto below is load-bearing: the backdrop that renders this
    // card is deliberately click-through (pointer-events-none), and without
    // re-enabling events here the overflow-y scroll never receives a touch or
    // wheel gesture - a split place's second winner card was simply cut off
    // with no way to reach it.
    return (
        <motion.div
            initial={{ scale: 0.82, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 21 }}
            className='relative max-w-[300px] w-full mx-4 rounded-2xl p-2.5 space-y-2.5 max-h-[85vh] overflow-y-auto overscroll-contain pointer-events-auto'
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
                    {PLACE_MEDAL[place]}{' '}
                    {t('bingo.placeOrdinal', { place: PLACE_LABEL[place] })}
                    {splitWays
                        ? ` · ${t('bingo.splitWays', { count: winners.length })}`
                        : ''}
                </div>
                <p className='text-slate-100 text-sm font-bold flex items-center justify-center gap-2 flex-wrap'>
                    {winners.map((w, i) => (
                        <span
                            key={i}
                            className='rounded-lg px-3 py-1 font-black text-white'
                            style={{
                                background: disqualified
                                    ? '#b91c1c'
                                    : '#2f8f4f',
                            }}
                        >
                            {w.winnerDisplayName ?? t('bingo.player')}
                            {w.winnerPhoneLast4
                                ? ` ( *${w.winnerPhoneLast4} )`
                                : ''}
                        </span>
                    ))}
                    <span>
                        {disqualified
                            ? t('bingo.disqualifiedHouseWins')
                            : t('bingo.winsThisPlace')}
                    </span>
                </p>
                {disqualified && (
                    <div className='mt-1.5 inline-block rounded-md bg-red-500/20 border border-red-400/40 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-red-300'>
                        {t('bingo.disqualified')}
                    </div>
                )}
            </div>

            {winners.map((w, i) => {
                const grid = w.winnerGrid;
                if (!grid) return null;
                const prize = w.shareMinor ?? 0;
                return (
                    <div
                        key={i}
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
                                markedNumbers={w.winnerMarkedNumbers}
                                winCells={w.winPatternCells}
                                lastCalled={lastCalled}
                            />
                            <div className='flex items-center justify-between px-1 pt-1.5'>
                                {disqualified ? (
                                    <span className='text-[13px] font-black flex items-center gap-1'>
                                        <span className='line-through text-slate-400'>
                                            {formatCreditsFull(prize)}
                                        </span>
                                        <span className='text-red-300 text-[10px] uppercase tracking-wide'>
                                            {t('bingo.toHouse')}
                                        </span>
                                    </span>
                                ) : (
                                    <span
                                        className='text-[13px] font-black'
                                        style={{ color: '#34d399' }}
                                    >
                                        {t('bingo.prizeEtb', {
                                            amount: formatCreditsFull(prize),
                                        })}
                                    </span>
                                )}
                                {w.winnerCartelaNumber != null && (
                                    <span className='text-[13px] font-black text-slate-100'>
                                        {t('bingo.cardHash', {
                                            n: w.winnerCartelaNumber,
                                        })}
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>
                );
            })}
        </motion.div>
    );
}

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
    // Hold a split place on screen longer - it stacks one card per winner.
    const holdMs = placeWinDisplayMs(getEntryWinners(win.entry).length);
    useEffect(() => {
        const id = setTimeout(onDone, holdMs);
        return () => clearTimeout(id);
    }, [win, onDone, holdMs]);

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className='fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm pointer-events-none'
        >
            <BingoLiveWinCard
                place={win.place}
                entry={win.entry}
                drawnNumbers={drawnNumbers}
            />
        </motion.div>
    );

    const { place, entry } = win;
    const grid = entry.winnerGrid as Array<Array<number | null>>;
    const marked =
        (entry.winnerMarkedNumbers as number[] | undefined) ?? undefined;
    const name =
        (entry.winnerDisplayName as string | undefined) ?? t('bingo.player');
    const last4 = (entry.winnerPhoneLast4 as string | undefined) ?? '';
    const prize = (entry.prizeMinor as number | undefined) ?? 0;
    const cartela = entry.winnerCartelaNumber as number | undefined;
    // This card was the winner but got disqualified for a premature BINGO call
    // the prize goes to the house, not the player. We still reveal the card.
    const disqualified = !!entry.disqualified;
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
                        {PLACE_MEDAL[place]}{' '}
                        {t('bingo.placeOrdinal', { place: PLACE_LABEL[place] })}
                    </div>
                    <p className='text-slate-100 text-sm font-bold flex items-center justify-center gap-2 flex-wrap'>
                        <span
                            className='rounded-lg px-3 py-1 font-black text-white'
                            style={{
                                background: disqualified
                                    ? '#b91c1c'
                                    : '#2f8f4f',
                            }}
                        >
                            {name}
                            {last4 ? ` ( *${last4} )` : ''}
                        </span>
                        <span>
                            {disqualified
                                ? t('bingo.disqualifiedHouseWins')
                                : t('bingo.winsThisPlace')}
                        </span>
                    </p>
                    {disqualified && (
                        <div className='mt-1.5 inline-block rounded-md bg-red-500/20 border border-red-400/40 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-red-300'>
                            {t('bingo.disqualified')}
                        </div>
                    )}
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
                                {disqualified ? (
                                    <span className='text-[13px] font-black flex items-center gap-1'>
                                        <span className='line-through text-slate-400'>
                                            {formatCreditsFull(prize)}
                                        </span>
                                        <span className='text-red-300 text-[10px] uppercase tracking-wide'>
                                            {t('bingo.toHouse')}
                                        </span>
                                    </span>
                                ) : (
                                    <span
                                        className='text-[13px] font-black'
                                        style={{ color: '#34d399' }}
                                    >
                                        {t('bingo.prizeEtb', {
                                            amount: formatCreditsFull(prize),
                                        })}
                                    </span>
                                )}
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

// ─── Bonus Win: live banner + live win popup ─────────────────────────────────
// Independent of the Derash placements above: an admin-scheduled campaign that
// pays an extra prize to whoever completes its own pattern while the campaign's
// window is open (see BingoService.evaluateAndSettleBonus on the backend).

function BingoBonusBanner({
    campaign,
}: {
    campaign: NonNullable<BingoRoomState['activeBonusCampaign']>;
}) {
    const { t } = useTranslation();
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(id);
    }, []);
    const untilMs = campaign.activeUntil
        ? new Date(campaign.activeUntil).getTime() - now
        : null;
    const countdown =
        untilMs != null && untilMs > 0
            ? (() => {
                  const totalSec = Math.floor(untilMs / 1000);
                  const h = Math.floor(totalSec / 3600);
                  const m = Math.floor((totalSec % 3600) / 60);
                  const s = totalSec % 60;
                  return h > 0
                      ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
                      : `${m}:${String(s).padStart(2, '0')}`;
              })()
            : null;

    return (
        <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{
                opacity: 1,
                y: 0,
                boxShadow: [
                    '0 0 14px rgba(245,158,11,0.45)',
                    '0 0 26px rgba(245,158,11,0.75)',
                    '0 0 14px rgba(245,158,11,0.45)',
                ],
            }}
            transition={{
                boxShadow: { duration: 1.8, repeat: Infinity },
            }}
            className='flex items-center justify-between gap-2 rounded-xl px-3 py-2 mb-2'
            style={{
                background: 'linear-gradient(90deg,#7c2d12,#92400e,#7c2d12)',
                border: '1.5px solid rgba(245,158,11,0.85)',
            }}
        >
            <div className='flex items-center gap-2 min-w-0'>
                <span className='text-lg'>🎁</span>
                <div className='min-w-0'>
                    <div className='text-[11px] font-black uppercase tracking-wider text-amber-300 truncate'>
                        {t('bingo.bonusActive')}
                    </div>
                    <div className='text-[12px] font-bold text-white truncate'>
                        {t('bingo.bonusActiveDesc', {
                            pattern: campaign.patternName,
                            amount: formatCreditsFull(campaign.prizeMinor),
                        })}
                    </div>
                </div>
            </div>
            {countdown && (
                <div className='shrink-0 rounded-lg bg-black/30 px-2 py-1 text-[12px] font-black text-amber-200 tabular-nums'>
                    {countdown}
                </div>
            )}
        </motion.div>
    );
}

function BingoBonusWinCard({
    entry,
    drawnNumbers,
    secondsLeft,
    totalSeconds,
}: {
    entry: Record<string, unknown>;
    drawnNumbers: number[];
    secondsLeft: number;
    totalSeconds: number;
}) {
    const { t } = useTranslation();
    const winners = getEntryWinners(entry);
    const campaignName = (entry.campaignName as string | undefined) ?? '';
    const lastCalled =
        drawnNumbers.length > 0 ? drawnNumbers[drawnNumbers.length - 1] : null;
    const splitWays = winners.length > 1;
    const progressPct = Math.max(
        0,
        Math.min(100, (secondsLeft / totalSeconds) * 100),
    );

    return (
        <motion.div
            initial={{ scale: 0.82, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 21 }}
            className='relative max-w-[300px] w-full mx-4 rounded-2xl p-2.5 space-y-2.5 max-h-[85vh] overflow-y-auto'
            style={{
                background: 'linear-gradient(160deg,#7c2d12,#3b1a05)',
                border: '2px solid rgba(245,158,11,0.85)',
                boxShadow: '0 0 34px rgba(245,158,11,0.55)',
            }}
        >
            <div
                className='rounded-xl py-2.5 px-4 text-center'
                style={{ background: 'rgba(60,30,10,0.55)' }}
            >
                <div
                    className='text-2xl font-black tracking-[0.12em] mb-1'
                    style={{
                        color: '#fff',
                        textShadow: '0 0 22px rgba(245,158,11,0.8)',
                    }}
                >
                    🎁 {t('bingo.bonusWinExclaim')}
                </div>
                <div className='text-[11px] font-black uppercase tracking-widest text-amber-300 mb-1'>
                    {campaignName}
                    {splitWays
                        ? ` · ${t('bingo.splitWays', { count: winners.length })}`
                        : ''}
                </div>
                <p className='text-slate-100 text-sm font-bold flex items-center justify-center gap-2 flex-wrap'>
                    {winners.map((w, i) => (
                        <span
                            key={i}
                            className='rounded-lg px-3 py-1 font-black text-white'
                            style={{ background: '#b45309' }}
                        >
                            {w.winnerDisplayName ?? t('bingo.player')}
                            {w.winnerPhoneLast4
                                ? ` ( *${w.winnerPhoneLast4} )`
                                : ''}
                        </span>
                    ))}
                    <span>{t('bingo.winsBonus')}</span>
                </p>
            </div>

            {winners.map((w, i) => {
                const grid = w.winnerGrid;
                if (!grid) return null;
                const prize = w.shareMinor ?? 0;
                return (
                    <div
                        key={i}
                        className='rounded-xl p-1.5'
                        style={{
                            background: 'rgba(60,30,10,0.4)',
                            border: '2px solid rgba(245,158,11,0.6)',
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
                                markedNumbers={w.winnerMarkedNumbers}
                                winCells={w.winPatternCells}
                                lastCalled={lastCalled}
                            />
                            <div className='flex items-center justify-between px-1 pt-1.5'>
                                <span
                                    className='text-[13px] font-black'
                                    style={{ color: '#fbbf24' }}
                                >
                                    {t('bingo.prizeEtb', {
                                        amount: formatCreditsFull(prize),
                                    })}
                                </span>
                                {w.winnerCartelaNumber != null && (
                                    <span className='text-[13px] font-black text-slate-100'>
                                        {t('bingo.cardHash', {
                                            n: w.winnerCartelaNumber,
                                        })}
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>
                );
            })}

            {/* Countdown bar  same style as RoomResultOverlay's, so the bonus
          popup gives the same "closing soon" feedback the result window does. */}
            <div
                className='rounded-xl py-2 px-4'
                style={{ background: 'rgba(60,30,10,0.55)' }}
            >
                <div className='flex justify-center items-center mb-1'>
                    <span className='font-mono font-black text-xl text-amber-400'>
                        {secondsLeft}s
                    </span>
                </div>
                <div
                    className='h-1.5 rounded-full overflow-hidden'
                    style={{ background: 'rgba(255,255,255,0.12)' }}
                >
                    <motion.div
                        className='h-full rounded-full'
                        style={{
                            background: 'linear-gradient(90deg,#fbbf24,#f59e0b)',
                        }}
                        animate={{ width: `${progressPct}%` }}
                        transition={{ duration: 0.9, ease: 'linear' }}
                    />
                </div>
            </div>
        </motion.div>
    );
}

function BingoBonusWinPopup({
    entry,
    drawnNumbers,
    totalSeconds,
    onDone,
}: {
    entry: Record<string, unknown>;
    drawnNumbers: number[];
    totalSeconds: number;
    onDone: () => void;
}) {
    const [secondsLeft, setSecondsLeft] = useState(totalSeconds);
    useEffect(() => {
        setSecondsLeft(totalSeconds);
        const timeoutId = setTimeout(onDone, totalSeconds * 1000);
        const intervalId = setInterval(() => {
            setSecondsLeft((s) => Math.max(0, s - 1));
        }, 1000);
        return () => {
            clearTimeout(timeoutId);
            clearInterval(intervalId);
        };
    }, [entry, totalSeconds, onDone]);

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className='fixed inset-0 z-[61] flex items-center justify-center bg-black/70 backdrop-blur-sm pointer-events-none'
        >
            <BingoBonusWinCard
                entry={entry}
                drawnNumbers={drawnNumbers}
                secondsLeft={secondsLeft}
                totalSeconds={totalSeconds}
            />
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
    // settlement entry that carries winner data  so the card still renders if only
    // 2nd/3rd settled, or the key naming differs  instead of degrading to a
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
            !!x.entry && getEntryWinners(x.entry).length > 0,
    );

    const primaryKey = isPrefilledMode ? '1st' : 'full_house';
    const winEntry =
        (summary[primaryKey] as Record<string, unknown> | undefined) ??
        summaryEntries.find((e) => getEntryWinners(e).length > 0);
    const winnerDisplayName =
        (winEntry?.winnerDisplayName as string | undefined) ??
        tr('bingo.luckyPlayer');
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
        const topWinners = winEntry ? getEntryWinners(winEntry) : [];
        const topName =
            topWinners
                .map((w) => w.winnerDisplayName)
                .filter((n): n is string => !!n)
                .join(', ') || tr('bingo.luckyPlayer');
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
                                    ) : winEntry?.disqualified ? (
                                        <>
                                            <span className='font-black text-white'>
                                                {topName}
                                            </span>{' '}
                                            {tr('bingo.disqualifiedHouseWins')}
                                        </>
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

                    {/* Final standings  every place that was won: medal + name + last-4
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
                                {placeEntries.flatMap(({ place, entry }) => {
                                    const dq = !!entry.disqualified;
                                    const winners = getEntryWinners(entry);
                                    return winners.map((w, i) => (
                                        <div
                                            key={`${place}-${i}`}
                                            className='flex items-center justify-between rounded-lg px-2 py-1 bg-black/20'
                                        >
                                            <span className='flex items-center gap-1.5 min-w-0'>
                                                <span className='text-sm leading-none w-4 text-center'>
                                                    {i === 0
                                                        ? PLACE_MEDAL[place]
                                                        : ''}
                                                </span>
                                                <span className='text-[11px] font-black truncate text-white'>
                                                    {w.winnerDisplayName ??
                                                        tr('bingo.player')}
                                                    {w.winnerPhoneLast4 ? (
                                                        <span className='text-slate-400'>
                                                            {' '}
                                                            *{w.winnerPhoneLast4}
                                                        </span>
                                                    ) : null}
                                                    {dq && (
                                                        <span className='ml-1 rounded bg-red-500/20 border border-red-400/40 px-1 py-px text-[7px] font-black uppercase tracking-wider text-red-300 align-middle'>
                                                            {tr(
                                                                'bingo.disqualified',
                                                            )}
                                                        </span>
                                                    )}
                                                </span>
                                            </span>
                                            <span className='flex items-center gap-2 flex-shrink-0'>
                                                {w.winnerCartelaNumber !=
                                                    null && (
                                                    <span className='text-[10px] font-black text-slate-400'>
                                                        #{w.winnerCartelaNumber}
                                                    </span>
                                                )}
                                                {dq ? (
                                                    <span className='text-[11px] font-black flex items-center gap-1'>
                                                        <span className='line-through text-slate-500'>
                                                            {formatCreditsFull(
                                                                w.shareMinor ??
                                                                    0,
                                                            )}
                                                        </span>
                                                        <span className='text-red-300 text-[8px] uppercase tracking-wide'>
                                                            {tr(
                                                                'bingo.toHouse',
                                                            )}
                                                        </span>
                                                    </span>
                                                ) : (
                                                    <span
                                                        className='text-[11px] font-black'
                                                        style={{
                                                            color: '#34d399',
                                                        }}
                                                    >
                                                        {formatCreditsFull(
                                                            w.shareMinor ?? 0,
                                                        )}
                                                    </span>
                                                )}
                                            </span>
                                        </div>
                                    ));
                                })}
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
                        {iWon
                            ? tr('bingo.youWonExclaim')
                            : hasWinner
                              ? tr('bingo.bingoExclaim')
                              : tr('bingo.noWin')}
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

// ─── Per-agent room lobby ─────────────────────────────────────────────────────
function BingoLobbyCard({
    room,
    onPick,
}: {
    room: BingoLobbyRoom;
    onPick: (roomId: string) => void;
}) {
    const { t } = useTranslation();
    const palette = getBingoCardPalette(room.cardPaletteId);
    const ballNumber = room.cardBallNumber ?? 1;
    return (
        <button
            type='button'
            onClick={() => onPick(room.id)}
            className='relative w-full rounded-2xl p-3.5 text-left overflow-hidden active:scale-[0.98] transition-transform shadow-lg'
            style={{ background: palette.gradient, minHeight: 132 }}
        >
            {/* Decorative bingo ball  half-cut off in the corner, purely visual */}
            <div
                className='absolute -right-3 -bottom-3 w-16 h-16 rounded-full flex items-center justify-center border-4 border-white/25 shadow-lg'
                style={{ background: palette.ballGradient }}
            >
                <span className='text-lg font-black text-black/70 drop-shadow-sm'>
                    {ballNumber}
                </span>
            </div>

            <span
                className={`absolute top-2.5 right-2.5 text-[7px] font-black uppercase px-1.5 py-0.5 rounded ${
                    room.status === 'running'
                        ? 'bg-black/30 text-red-100'
                        : 'bg-black/20 text-white/90'
                }`}
            >
                {room.status === 'running'
                    ? t('bingo.live', { defaultValue: 'LIVE' })
                    : t('bingo.open', { defaultValue: 'OPEN' })}
            </span>

            <div className='relative z-[1] flex flex-col gap-1'>
                <span className='text-sm font-black text-white truncate max-w-[85%] drop-shadow-sm'>
                    {room.name}
                </span>
                <span className='text-xl font-black text-white drop-shadow-sm'>
                    {formatCredits(room.ticketPriceMinor)}{' '}
                    <span className='text-[11px] font-bold opacity-80'>
                        ETB
                    </span>
                </span>
                <span className='text-[9px] font-bold text-white/75 mt-0.5'>
                    {t('bingo.playersCount', {
                        count: room.players,
                        defaultValue: `${room.players} players`,
                    })}
                    {' · '}
                    {t('bingo.statDerash', { defaultValue: 'Pot' })}{' '}
                    {formatCredits(room.potMinor)}
                </span>
            </div>

            <span className='relative z-[1] inline-block mt-3 text-[11px] font-black text-white bg-black/25 rounded-lg px-3 py-1.5'>
                {t('bingo.playNow', { defaultValue: 'Play now' })}
            </span>
        </button>
    );
}

function BingoLobby({
    rooms,
    onPick,
    onBack,
}: {
    rooms: BingoLobbyRoom[];
    onPick: (roomId: string) => void;
    onBack: () => void;
}) {
    const { t } = useTranslation();
    return (
        <div className='max-w-2xl mx-auto pb-20 space-y-2'>
            <div className='flex items-center justify-between'>
                <h2 className='text-lg font-black'>
                    {t('bingo.chooseRoom', { defaultValue: 'Choose a room' })}
                </h2>
                <button
                    type='button'
                    onClick={onBack}
                    className='text-[11px] font-black text-slate-400'
                >
                    ← {t('common.back', { defaultValue: 'Back' })}
                </button>
            </div>
            <p className='text-[11px] text-slate-500'>
                {t('bingo.chooseRoomHint', {
                    defaultValue: 'Pick a room and stake to play.',
                })}
            </p>
            <div className='grid grid-cols-2 gap-3'>
                {rooms.map((r) => (
                    <BingoLobbyCard key={r.id} room={r} onPick={onPick} />
                ))}
                {rooms.length === 0 && (
                    <div className='col-span-2 card p-6 text-center text-slate-500 text-sm'>
                        {t('bingo.noRooms', {
                            defaultValue: 'No rooms available right now.',
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}

export function Bingo({ onBack }: BingoProps) {
    const { t } = useTranslation();
    const addToast = useStore((s) => s.addToast);
    const setWallet = useStore((s) => s.setWallet);
    const soundVolume = useStore((s) => s.soundVolume);
    const soundMuted = useStore((s) => s.soundMuted);
    const setSoundVolume = useStore((s) => s.setSoundVolume);
    const setSoundMuted = useStore((s) => s.setSoundMuted);
    const currentUser = useStore((s) => s.user);
    const isSocketConnected = useStore((s) => s.isSocketConnected);

    const [room, setRoom] = useState<BingoRoomState | null>(null);
    const [loading, setLoading] = useState(true);
    // Per-agent room mode (Approach B): the lobby of joinable rooms, and the room
    // the customer picked. When the lobby is enabled + has >1 room and none is
    // picked, we show the lobby instead of a game.
    const [lobby, setLobby] = useState<{
        enabled: boolean;
        rooms: BingoLobbyRoom[];
    } | null>(null);
    const [pinnedRoomId, setPinnedRoomId] = useState<string | null>(null);
    const [holdingResult, setHoldingResult] = useState(false);
    const [buying, setBuying] = useState(false);
    const [pendingCartelas, setPendingCartelas] = useState<Set<number>>(
        new Set(),
    );
    const [localTickets, setLocalTickets] = useState<BingoTicket[]>([]);
    const [autoMode, setAutoMode] = useState(true);
    const autoPreferenceRoomRef = useRef<string | null>(null);
    const autoPreferenceInitializedRef = useRef(false);
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

    // ── Live Bonus Win detection (mirrors the per-place mechanism above, but a
    // room can only ever settle ONE bonus, so this is a single slot, not a queue) ──
    const [liveBonusWin, setLiveBonusWin] =
        useState<Record<string, unknown> | null>(null);
    const shownBonusRef = useRef<{
        roomId: string | null;
        shown: boolean;
        seeded: boolean;
    }>({ roomId: null, shown: false, seeded: false });

    const roomIdRef = useRef<string | null>(null);
    const holdingResultRef = useRef(false);
    const victoryRoomRef = useRef<string | null>(null);
    const completedRoomRef = useRef<string | null>(null);
    const cancelledRoomRef = useRef<string | null>(null);
    const cancelHoldTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
        null,
    );
    const reconcileTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
        null,
    );
    const resultTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
    // The calling card (75-window board + caller). On entering the playing phase we
    // scroll it into view ONCE per room so the player lands on the grid, not the
    // ticker/stats above it  then leave scrolling to the user (no re-snapping).
    const callingCardRef = useRef<HTMLDivElement>(null);
    const focusedRoomRef = useRef<string | null>(null);

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
        if (!roomId) return;
        // `summary` is null/undefined for the room's entire lifetime until the
        // FIRST place is actually won  so gating the `return` above on it being
        // truthy meant `ref.seeded` never got armed before that first win, and
        // the first genuine win (the only one, for a single-place room) was
        // always swallowed as if it had been decided before we joined. Seed on
        // ANY render of this room, summary present or not; the loop below still
        // only fires for entries a truly-first pass hadn't seen yet.
        const summary = room?.settlementSummary;
        const newly: LivePlaceWin[] = [];
        if (summary) {
            for (const place of PREFILLED_PLACE_ORDER) {
                const entry = summary[place] as
                    | Record<string, unknown>
                    | undefined;
                if (
                    entry &&
                    getEntryWinners(entry).length > 0 &&
                    !ref.shown.has(place)
                ) {
                    ref.shown.add(place);
                    if (ref.seeded) newly.push({ place, entry });
                }
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

    // Same "seed on first pass, only pop up for a genuinely NEW event" logic as
    // the per-place watcher above, applied to the room's single Bonus Win slot.
    useEffect(() => {
        const roomId = room?.id ?? null;
        const ref = shownBonusRef.current;
        if (ref.roomId !== roomId) {
            ref.roomId = roomId;
            ref.shown = false;
            ref.seeded = false;
        }
        if (!roomId) return;
        // Same fix as the per-place watcher above: `bonusSettlement` is
        // null/undefined for the whole room lifetime until the bonus is
        // actually won, so seeding only on a truthy pass meant the one real
        // bonus win a room ever has was always swallowed. Seed on any render.
        const bonus = room?.bonusSettlement;
        if (bonus && !ref.shown) {
            ref.shown = true;
            if (ref.seeded) setLiveBonusWin(bonus);
        }
        ref.seeded = true;
    }, [room]);

    // ── Load ────────────────────────────────────────────────────────────────────

    const loadCurrent = useCallback(async () => {
        try {
            // In per-agent mode, once the customer picks a room from the lobby we
            // stay in that specific room; otherwise use the single current room.
            let next = pinnedRoomId
                ? await bingoApi.getRoomState(pinnedRoomId)
                : await bingoApi.getCurrentRoom();

            const loadReplacementForSameSlot = async (
                current: BingoRoomState,
            ): Promise<BingoRoomState | null> => {
                const ownerAgentId = current.ownerAgentId ?? null;
                const freshLobby = await bingoApi.getLobby().catch(() => null);
                if (freshLobby) setLobby(freshLobby);
                const replacement = freshLobby?.rooms.find(
                    (candidate) =>
                        candidate.ownerAgentId === ownerAgentId &&
                        (candidate.status === 'open' ||
                            candidate.status === 'running') &&
                        candidate.id !== current.id,
                );
                if (replacement) {
                    setPinnedRoomId(replacement.id);
                    return bingoApi.getRoomState(replacement.id);
                }

                const fallback = await bingoApi
                    .getCurrentRoom()
                    .catch(() => null);
                if (
                    fallback &&
                    fallback.id !== current.id &&
                    fallback.status !== 'completed' &&
                    fallback.status !== 'cancelled' &&
                    (ownerAgentId == null ||
                        fallback.ownerAgentId === ownerAgentId)
                ) {
                    if (pinnedRoomId) setPinnedRoomId(fallback.id);
                    return fallback;
                }

                return null;
            };

            if (pinnedRoomId && next?.status === 'cancelled') {
                const replacement = await loadReplacementForSameSlot(next);
                if (replacement) {
                    next = replacement;
                } else {
                    setLoading(false);
                    return;
                }
            }
            if (
                next?.status === 'completed' &&
                completedRoomRef.current === next.id &&
                !holdingResultRef.current
            ) {
                const replacement = await loadReplacementForSameSlot(next);
                if (replacement) {
                    next = replacement;
                } else {
                    setRoom((prev) => (prev?.id === next?.id ? null : prev));
                    roomIdRef.current = null;
                    setLoading(false);
                    return;
                }
            }
            const nextIsLive =
                !!next && (next.status === 'open' || next.status === 'running');
            if (
                room?.status === 'cancelled' &&
                cancelledRoomRef.current === room.id &&
                next?.id !== room.id
            ) {
                if (nextIsLive) {
                    cancelledRoomRef.current = null;
                    if (cancelHoldTimerRef.current) {
                        clearTimeout(cancelHoldTimerRef.current);
                        cancelHoldTimerRef.current = null;
                    }
                } else {
                    setLoading(false);
                    return;
                }
            }
            setRoom((prev) => {
                // During result hold, don't switch to a different (newer) room
                // only allow updating the same room (e.g. to pick up settlement data).
                if (holdingResultRef.current && next?.id !== prev?.id)
                    return prev;
                if (
                    prev?.status === 'cancelled' &&
                    cancelledRoomRef.current === prev.id &&
                    next?.id !== prev?.id
                ) {
                    if (nextIsLive) {
                        cancelledRoomRef.current = null;
                        if (cancelHoldTimerRef.current) {
                            clearTimeout(cancelHoldTimerRef.current);
                            cancelHoldTimerRef.current = null;
                        }
                    } else {
                        return prev;
                    }
                }
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
    }, [addToast, pinnedRoomId, room?.id, room?.status]);

    // Lobby (per-agent mode): keep the room list fresh so players/pots update.
    useEffect(() => {
        const fetchLobby = () =>
            bingoApi
                .getLobby()
                .then(setLobby)
                .catch(() => undefined);
        void fetchLobby();
        const id = setInterval(fetchLobby, 5000);
        return () => clearInterval(id);
    }, []);

    // Show the lobby when per-agent mode is on, there is more than one room, and the
    // customer hasn't picked one yet.
    const showLobby =
        !!lobby?.enabled && lobby.rooms.length > 1 && !pinnedRoomId;

    useEffect(() => {
        // Don't load a game while the lobby is showing  the player is choosing.
        if (showLobby) {
            setLoading(false);
            return;
        }
        void loadCurrent();
        const id = setInterval(() => {
            if (!holdingResultRef.current) void loadCurrent();
        }, POLL_INTERVAL_MS);
        return () => clearInterval(id);
    }, [loadCurrent, showLobby]);

    // Resync the instant the tab/app comes back to the foreground, rather than
    // waiting up to POLL_INTERVAL_MS (or for the next live draw event) to notice
    // a backgrounded tab fell behind. This is what lets the reveal-pacing effect
    // above catch a large backlog immediately and snap forward instead of the
    // player watching a stale board for a few seconds first.
    useEffect(() => {
        const resync = () => {
            if (holdingResultRef.current) return;
            void loadCurrent();
        };
        const onVisible = () => {
            if (document.visibilityState === 'visible') resync();
        };
        window.addEventListener('focus', resync);
        document.addEventListener('visibilitychange', onVisible);
        return () => {
            window.removeEventListener('focus', resync);
            document.removeEventListener('visibilitychange', onVisible);
        };
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
            intervalMs?: number;
        }) => {
            if (p.roomId !== roomIdRef.current || p.number === undefined)
                return;
            // Track the server's real cadence so the reveal pacer below can match it
            // instead of racing ahead on a hardcoded guess.
            if (typeof p.intervalMs === 'number' && p.intervalMs > 0) {
                serverIntervalMsRef.current = p.intervalMs;
            }
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
            completedRoomRef.current = completedId;
            // Apply the completion payload immediately  it carries the winner name
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
            // Bingo chat is a single global lobby  the server broadcasts to every
            // player in `game_bingo`, not per-room. Rooms rotate each round with a
            // fresh id, so filtering on the current room id silently dropped every
            // message whose sender was on a (transiently) different room id  which
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
        if (room.status === 'cancelled') {
            holdingResultRef.current = false;
            setHoldingResult(false);
            if (completedRoomRef.current === room.id) {
                completedRoomRef.current = null;
            }
            cancelledRoomRef.current = room.id;
            if (cancelHoldTimerRef.current) {
                clearTimeout(cancelHoldTimerRef.current);
            }
            cancelHoldTimerRef.current = setTimeout(() => {
                if (cancelledRoomRef.current === room.id) {
                    cancelledRoomRef.current = null;
                    cancelHoldTimerRef.current = null;
                    void loadCurrent();
                }
            }, 1800);
            return;
        }
        if (cancelHoldTimerRef.current) {
            clearTimeout(cancelHoldTimerRef.current);
            cancelHoldTimerRef.current = null;
        }
        cancelledRoomRef.current = null;
        if (room.status !== 'completed') {
            completedRoomRef.current = null;
        }
        const done = room.status === 'completed';
        if (!done) {
            holdingResultRef.current = false;
            setHoldingResult(false);
            return;
        }
        if (completedRoomRef.current === room.id && !holdingResultRef.current) {
            return;
        }
        completedRoomRef.current = room.id;
        // Empty round  nobody bought a ticket (a stray/legacy room that finished with
        // no players). There is no result to celebrate, so DON'T show the "No players
        // no win this round" overlay; quietly advance to the next (idle) room.
        if ((room.soldTickets ?? 0) === 0) {
            holdingResultRef.current = false;
            setHoldingResult(false);
            roomIdRef.current = null;
            void loadCurrent();
            return;
        }
        holdingResultRef.current = true;
        setHoldingResult(true);

        // Hold the room open (no room switch) while the live per-place 5×5 windows  or
        // the Bonus Win window, which always plays LAST, after every place  are still
        // playing; the summary "win window" only shows once both drain, so don't start
        // its display countdown until then. Otherwise a multi-place leaderboard round
        // (or a bonus that resolves on the same draw the room completes) could burn the
        // whole result window on the live popups and never show the summary, or race the
        // summary in front of the bonus popup. The effect re-runs as either drains.
        if (livePlaceQueue.length > 0 || liveBonusWin) return;

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
    }, [
        room?.id,
        room?.status,
        room?.soldTickets,
        livePlaceQueue.length,
        liveBonusWin,
        loadCurrent,
    ]);

    // ── Buy-window countdown ─────────────────────────────────────────────────────
    useEffect(() => {
        setTimeRemainingSecs(null);
        // A room with zero sold tickets is IDLE  waiting for the first buyer. Show
        // the idle state, never a countdown, no matter what scheduledStartAt holds
        // (a legacy DB default could set it to "now" before anyone has played).
        if (
            !room ||
            room.status !== 'open' ||
            room.soldTickets === 0 ||
            !room.scheduledStartAt
        )
            return;
        const tick = () => {
            const ms =
                new Date(room.scheduledStartAt as string).getTime() -
                Date.now();
            setTimeRemainingSecs(Math.max(0, Math.floor(ms / 1000)));
        };
        tick();
        const id = setInterval(tick, 1000);
        return () => clearInterval(id);
    }, [room?.id, room?.status, room?.soldTickets, room?.scheduledStartAt]);

    // ── Focus the 75-window board when calling opens ─────────────────────────────
    // On entering the playing (drawing) phase, scroll the calling card into view
    // ONCE per room so the player lands on the grid + caller rather than the ticker
    // and stats above it. Guarded by focusedRoomRef so it fires a single time
    // never on later draw ticks  leaving the user's own scrolling free and smooth.
    useEffect(() => {
        if (!room || room.status !== 'running') return;
        if (focusedRoomRef.current === room.id) return;
        focusedRoomRef.current = room.id;
        // Defer a frame so the board has painted before we scroll to it.
        const id = requestAnimationFrame(() => {
            callingCardRef.current?.scrollIntoView({
                block: 'start',
                behavior: 'smooth',
            });
        });
        return () => cancelAnimationFrame(id);
    }, [room?.id, room?.status]);

    // ── Chat scroll ──────────────────────────────────────────────────────────────
    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [chatMessages]);

    // ── Derived ──────────────────────────────────────────────────────────────────
    const phase: Phase = !room
        ? 'loading'
        : holdingResult
          ? 'result'
          : room.status === 'cancelled' && room.winMode === 'prefilled'
            ? 'buy'
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
    // Server draws, clamped to the valid pool  drops any out-of-range ball a
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
    const cartelaChangeLockSeconds = Math.max(
        0,
        room?.cartelaChangeLockSeconds ?? 3,
    );
    const cartelaChangesLocked =
        phase === 'buy' &&
        room?.status === 'open' &&
        cartelaChangeLockSeconds > 0 &&
        room.scheduledStartAt !== undefined &&
        room.scheduledStartAt !== null &&
        timeRemainingSecs !== null &&
        timeRemainingSecs <= cartelaChangeLockSeconds;
    const cartelaReturnsLocked = cartelaChangesLocked;

    // ── Paced reveal ─────────────────────────────────────────────────────────────
    // One shared cursor drives "now calling", the board and every card so they all
    // advance TOGETHER, one ball at a time at a readable pace  even when a poll
    // delivers several numbers at once. Snap instantly to full only on room switch
    // (no history replay) or cancellation. On completion, reveal keeps pacing
    // through (see the effect below) so the card never jumps to "done" ahead of
    // the round actually resolving.
    const [revealedCount, setRevealedCount] = useState(0);
    const revealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // Server's actual draw cadence, learned from the most recent draw event.
    // Falls back to REVEAL_BASE_MS until the first event of the session arrives.
    const serverIntervalMsRef = useRef<number>(REVEAL_BASE_MS);
    // True briefly right after a large-backlog snap, so the UI can show "Catching
    // up…" instead of letting the jump look like an unexplained teleport.
    const [isCatchingUp, setIsCatchingUp] = useState(false);
    // Distinguishes "you fell behind a still-live game" from "you're seeing the
    // recap of a round that already ended"  same jump-forward mechanics, but the
    // second one must never read as if it just happened live.
    const [catchupKind, setCatchupKind] = useState<'live' | 'completed'>(
        'live',
    );
    const catchupBadgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
        null,
    );
    // Mirrors isCatchingUp/catchupKind for processNextReveal (a stable useCallback)
    // to read without needing them in its dependency list.
    const replayingCompletedRef = useRef(false);
    useEffect(() => {
        replayingCompletedRef.current =
            isCatchingUp && catchupKind === 'completed';
    }, [isCatchingUp, catchupKind]);

    const processNextReveal = useCallback(() => {
        revealTimerRef.current = null;
        setRevealedCount((c) => c + 1);
        // A tick playing out during a "replaying an already-decided round" catch-up
        // is narrating balls drawn seconds/minutes ago  keep the visual marking
        // (honest, unchanged) but skip the "live call" sound cue for it.
        if (!replayingCompletedRef.current) soundEngine.pop();
    }, []);

    useEffect(() => {
        setRevealedCount(room?.drawnNumbers?.length ?? 0);
    }, [room?.id]);

    useEffect(() => {
        const total = drawnNumbers.length;
        // Cancelled rooms have no result to narrate  snap immediately, nothing lost.
        if (room?.status === 'cancelled') {
            if (revealTimerRef.current) {
                clearTimeout(revealTimerRef.current);
                revealTimerRef.current = null;
            }
            setRevealedCount(total);
            return;
        }
        if (revealedCount > total) {
            setRevealedCount(total);
            return;
        }
        if (revealedCount >= total) return;

        // If a timer is already running, let it finish. It will increment the count
        // and this effect will re-run to schedule the next one, completely decoupled
        // from the fast socket arrivals.
        if (revealTimerRef.current) return;

        // A completed room falls through to the SAME backlog/steady-cadence logic
        // below as a still-running one  no special instant snap. A card that was
        // already keeping up finishes marking at the same pace it ran all round
        // (landing "fully marked" around when the first win popup arms, never
        // before); a card that had fallen behind (backgrounded tab, dropped
        // socket) correctly falls into the catch-up branch instead of silently
        // jumping to the final state with no explanation.
        const backlog = total - revealedCount;
        if (backlog > REVEAL_CATCHUP_BACKLOG) {
            // Fell far behind  jump straight to near-live instead of animating
            // through the gap at a sped-up pace (see CATCHUP_TAIL/BADGE comment
            // above). The effect re-runs on the new revealedCount and falls
            // through to the normal branch below for the remaining tail.
            const target = Math.max(0, total - CATCHUP_TAIL);
            setRevealedCount(target);
            setIsCatchingUp(true);
            setCatchupKind(room?.status === 'completed' ? 'completed' : 'live');
            if (catchupBadgeTimerRef.current)
                clearTimeout(catchupBadgeTimerRef.current);
            catchupBadgeTimerRef.current = setTimeout(
                () => setIsCatchingUp(false),
                CATCHUP_BADGE_MS,
            );
            return;
        }

        // One steady, calm cadence for every ball, matched to the server's actual
        // draw interval - but only while we are inside the intended one-ball
        // buffer. Past that we are in DEBT, and this used to carry that debt for
        // the rest of the round: it advanced exactly one ball per full interval,
        // the same rate the server draws at, so a gap opened by a single hiccup
        // (webview timer throttling, a batched socket delivery, render jank)
        // never closed again. The client only clawed back the scheduler's
        // 0-250ms of jitter per ball, so shedding ONE ball of debt took roughly
        // 24 calls - longer than most rounds - while REVEAL_CATCHUP_BACKLOG does
        // not engage until 10. Backlogs of 1-10 were therefore effectively
        // permanent, which is why players saw the called count sitting 1-3 ahead
        // of the board for a whole round and asked whether the game was straight.
        // Shorten the delay in proportion to the debt so it drains over the next
        // call or two, floored so it never turns into a visible speed-run.
        const steadyMs = serverIntervalMsRef.current;
        const debt = backlog - REVEAL_TARGET_BACKLOG;
        const drain =
            debt > 0
                ? Math.min(REVEAL_DRAIN_PER_BALL * debt, REVEAL_DRAIN_MAX)
                : 0;
        const delayMs =
            drain > 0
                ? Math.max(
                      REVEAL_MIN_DRAIN_MS,
                      Math.round(steadyMs * (1 - drain)),
                  )
                : steadyMs;
        revealTimerRef.current = setTimeout(processNextReveal, delayMs);
    }, [revealedCount, drawnNumbers.length, room?.status, processNextReveal]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (revealTimerRef.current) clearTimeout(revealTimerRef.current);
            if (catchupBadgeTimerRef.current)
                clearTimeout(catchupBadgeTimerRef.current);
        };
    }, []);
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

    // Live win staging.
    //
    // A place is decided by one specific ball, but the two clocks that matter here
    // run independently: settlement arrives from the server the instant that ball
    // is DRAWN, while the reveal narrates it on its own paced timeline
    // (revealedCount -> boardCount -> ticketCount, a full second end to end).
    // Arming the popup off settlement therefore dropped the winner card on top of
    // a "now calling" display that was still mid-sequence - the player never saw
    // the ball that decided the round being called, let alone landing on the card.
    //
    // So gate on the REVEAL, not on settlement: wait until the paced reveal has
    // marked every ball the room had when this place reached the head of the
    // queue, and only then hold the beat and arm. At the end of a round that
    // reduces to "every number fully called and marked, pause, then the window";
    // mid-round it still lets 3rd/2nd pop as soon as their own deciding ball has
    // landed. The draw cadence itself is untouched - nothing snaps or speeds up,
    // which is the property the commented-out snap below was protecting.
    const [popupArmed, setPopupArmed] = useState(false);
    const headPlace = livePlaceQueue[0]?.place ?? null;

    // Ball count the room had when the current head took the front of the queue.
    // Snapshotted per place so balls drawn AFTERWARDS - mid-round, while the game
    // is still running and the list keeps growing - can't push the target out of
    // reach and starve an early place's popup forever.
    const drawnTotalRef = useRef(0);
    useEffect(() => {
        drawnTotalRef.current = drawnNumbers.length;
    }, [drawnNumbers.length]);
    const [decidedAtCount, setDecidedAtCount] = useState<number | null>(null);
    useEffect(() => {
        setDecidedAtCount(headPlace ? drawnTotalRef.current : null);
    }, [headPlace]);

    // Flips false -> true once and then stays put for the life of a head
    // (ticketCount only grows, decidedAtCount is fixed per place), so the timer
    // below is scheduled exactly once per place rather than being torn down and
    // restarted - and the popup re-hidden - on every subsequent ball.
    const revealReachedDecider =
        decidedAtCount !== null && ticketCount >= decidedAtCount;

    useEffect(() => {
        if (!headPlace || !revealReachedDecider) {
            setPopupArmed(false);
            return;
        }
        setPopupArmed(false);
        const id = setTimeout(() => setPopupArmed(true), NOW_CALLING_HOLD_MS);
        return () => clearTimeout(id);
    }, [headPlace, revealReachedDecider]);

    // True for the whole stretch between a round ending and its last place's win
    // popup closing  including the silent gaps before a popup arms and between
    // successive popups, which neither LivePlaceWinPopup nor RoomResultOverlay
    // covers on their own. Keyed off the same signal RoomResultOverlay already
    // gates on (livePlaceQueue.length === 0) so the two stay in sync without a
    // second independent timer. Always-mounted while true  never itself a source
    // of a gap  so the player never sees a fully-marked card with nothing
    // acknowledging the round is being resolved.
    // True once the paced reveal has narrated every ball the server has given us.
    // Until then the round is, as far as the player can see, still being called.
    const revealFinished = revealedCount >= drawnNumbers.length;

    // revealFinished flips the INSTANT the last ball's own reveal step fires -
    // same render, zero pause - which used to hand the last ball none of the
    // NOW_CALLING_HOLD_MS beat every other ball's transition gets elsewhere
    // (see popupArmed above). The board would swap straight from "now calling"
    // to the completed/trophy state on the very same tick the final number
    // appeared, so the ball that actually decided the round was never visible
    // as "now calling" for any length of time at all - it was called and
    // immediately buried under "round finished" copy. This holds the CURRENT
    // ball on screen for that same beat before anything downstream (the status
    // pill, the trophy, "revealing results…") is allowed to react to the round
    // being over.
    const [lastBallSettled, setLastBallSettled] = useState(false);
    useEffect(() => {
        // Gate on the room ACTUALLY being completed, not just "the reveal has
        // caught up to every ball we know about" - that same condition is also
        // true during every ordinary mid-round pause (the pacer settles at zero
        // backlog while waiting for the server's next draw), and real draw
        // intervals routinely run longer than NOW_CALLING_HOLD_MS. Starting the
        // hold there let it finish - and go stale - well before the round
        // actually ended, so if the deciding ball arrived bundled straight into
        // the `bingo.room.completed` payload (status and the final draw in one
        // update), revealFinished and this already-elapsed hold both went true
        // on the very same render: zero grace period for the ball that actually
        // decided the round, right back to the bug this hold exists to prevent.
        if (room?.status !== 'completed' || !revealFinished) {
            setLastBallSettled(false);
            return;
        }
        const id = setTimeout(
            () => setLastBallSettled(true),
            NOW_CALLING_HOLD_MS,
        );
        return () => clearTimeout(id);
    }, [revealFinished, room?.status, room?.id]);
    const revealSettled = revealFinished && lastBallSettled;

    // The status the ROUND PRESENTS AS, which is not the same thing as the status
    // the server has already reached. The server flips a room to 'completed' on the
    // draw that decides it, but the reveal is deliberately paced and is typically a
    // ball or two behind. Handing the raw status straight to CurrentBallDisplay
    // swapped the whole "now calling" tile for a "round finished" trophy while the
    // deciding ball had not been called yet - so the ball that actually won the
    // round was never seen being called at all; it only slid past in the small
    // recent-calls strip, under a banner announcing the round was already over.
    // Hold the round at 'running' until the narration catches up AND the settle
    // beat above has elapsed.
    const presentedStatus =
        room?.status === 'completed' && !revealSettled
            ? 'running'
            : (room?.status ?? 'open');

    // ── Win detection ────────────────────────────────────────────────────────────
    // Gated on presentedStatus, not room.status: the server flips a room to
    // 'completed' the instant the deciding ball is drawn, well before the paced
    // reveal has narrated it. Firing confetti/the win sound off the raw status
    // let both go off while the board was still visibly mid-round - sometimes
    // a couple of calls before the winning number itself ever appeared on
    // screen. Wait for the same "the player has actually seen it end" signal
    // everything else downstream of the round (trophy, results-revealing badge)
    // already waits for.
    useEffect(() => {
        if (presentedStatus !== 'completed' || !room) return;
        if (victoryRoomRef.current === room.id) return;
        const allTickets = [...(room.tickets ?? []), ...localTickets];
        const winners = allTickets.filter((t) => t.payoutMinor > 0);
        if (!winners.length) return;
        victoryRoomRef.current = room.id;
        soundEngine.win();
        void fireConfetti({
            particleCount: 200,
            spread: 90,
            origin: { y: 0.55 },
            colors: ['#FFD700', '#FF4444', '#00FF88', '#FFFFFF'],
        });
        // The bell notification is created + pushed by the server at settlement (so it
        // lands even if the player left the screen)  no client-side entry here to
        // avoid a duplicate.
        // The win credit landed server-side  pull the fresh balance into the header.
        walletApi
            .getWallet()
            .then(setWallet)
            .catch(() => undefined);
    }, [presentedStatus, room?.id, room?.tickets, localTickets, setWallet]);

    const resultsRevealing =
        room?.status === 'completed' &&
        revealSettled &&
        (livePlaceQueue.length > 0 || !!liveBonusWin);

    // When a place is won, the server already knows the winner.
    // We intentionally do NOT snap the paced reveal here to keep the drawing uniform.
    // The UI will show the winner popups while the board catches up.
    /* 
    useEffect(() => {
        if (livePlaceQueue.length > 0)
            setRevealedCount(room?.drawnNumbers?.length ?? 0);
    }, [livePlaceQueue.length, room?.drawnNumbers?.length]);
    */

    const myTickets = useMemo(() => {
        const apiTickets = room?.tickets ?? [];
        if (apiTickets.length > 0) return apiTickets;
        if (localRoomIdRef.current === room?.id) return localTickets;
        return [];
    }, [room?.tickets, room?.id, localTickets]);

    const alreadyBought = myTickets.length > 0;

    // Initialize the player's Auto/Manual preference once when a room's cards first
    // arrive. Do not re-derive it on every draw/status update: a winning or
    // disqualified card changing state must never move the player's toggle while
    // they are watching the Now Calling board.
    const autoBusyRef = useRef(false);
    useEffect(() => {
        if (autoPreferenceRoomRef.current !== room?.id) {
            autoPreferenceRoomRef.current = room?.id ?? null;
            autoPreferenceInitializedRef.current = false;
        }
        if (autoBusyRef.current || autoPreferenceInitializedRef.current) return;
        const activeTickets = (room?.tickets ?? []).filter(
            (t) => t.status === 'active',
        );
        if (activeTickets.length > 0) {
            setAutoMode(activeTickets.every((t) => t.autoClaim !== false));
            autoPreferenceInitializedRef.current = true;
        }
    }, [room?.id, room?.tickets]);

    const toggleAuto = async () => {
        if (!room) return;
        const next = !autoMode;
        autoBusyRef.current = true;
        autoPreferenceInitializedRef.current = true;
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
                addToast('error', t('bingo.toastWrongCall'));
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
        if (!room || !salesOpen || alreadyBought || cartelaChangesLocked)
            return;
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

    // Shared toast classification for a purchase/refund failure  pulled out so
    // both the immediate refund path and the batched buy path (see
    // flushPendingBuys below) show the same specific messages.
    const toastCartelaError = useCallback(
        (err: unknown) => {
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
                addToast(
                    'error',
                    t('bingo.cartelaLimit', {
                        count: parseInt(msg.match(/\d+/)?.[0] ?? '0', 10),
                    }),
                );
            else addToast('error', msg);
        },
        [addToast, t],
    );

    // Rapid taps queue their cartela number here instead of firing one HTTP
    // request each  each request takes a pessimistic write lock on the room,
    // so many concurrent single-cartela buys were serializing on that lock and
    // occasionally surfacing as a generic "service error" under load. A short
    // trailing debounce coalesces everything tapped in the same burst into one
    // purchaseCartelas([...]) call.
    const pendingBuyQueueRef = useRef<number[]>([]);
    const pendingBuyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
        null,
    );
    const pendingBuyRoomIdRef = useRef<string | null>(null);
    const pendingBuyIdempotencyKeyRef = useRef<string | null>(null);

    const flushPendingBuys = useCallback(async () => {
        pendingBuyTimerRef.current = null;
        const numbers = pendingBuyQueueRef.current;
        pendingBuyQueueRef.current = [];
        const roomId = pendingBuyRoomIdRef.current;
        const idempotencyKey = pendingBuyIdempotencyKeyRef.current;
        pendingBuyRoomIdRef.current = null;
        pendingBuyIdempotencyKeyRef.current = null;
        if (numbers.length === 0 || !roomId || !idempotencyKey) return;

        try {
            const bought = await bingoApi.purchaseCartelas(
                roomId,
                numbers,
                idempotencyKey,
            );
            localRoomIdRef.current = roomId;
            setLocalTickets((prev) => [...prev, ...bought]);
            soundEngine.cashout();
            if (numbers.length === 1) {
                addToast(
                    'success',
                    t('bingo.toastCartelaPurchased', { n: numbers[0] }),
                );
            } else {
                addToast(
                    'success',
                    t('bingo.toastCartelasPurchased', {
                        count: numbers.length,
                        defaultValue: `${numbers.length} cartelas purchased`,
                    }),
                );
            }
            const [nextWallet] = await Promise.all([
                walletApi.getWallet(),
                loadCurrent(),
            ]);
            setWallet(nextWallet);
        } catch (err) {
            toastCartelaError(err);
            void loadCurrent();
        } finally {
            setPendingCartelas((prev) => {
                const next = new Set(prev);
                for (const n of numbers) next.delete(n);
                return next;
            });
        }
    }, [addToast, loadCurrent, setWallet, t, toastCartelaError]);

    // Instant buy-or-refund on a single tap. Tapping an available cartela queues
    // it for purchase (batched with any other cartelas tapped in the same short
    // window  see flushPendingBuys); tapping one you already own (while sales
    // are open) refunds it immediately. The final freeze window blocks both
    // directions, and a per-cartela pending guard prevents a double-tap from
    // firing twice.
    const handleCartelaTap = useCallback(
        (n: number) => {
            if (!room || room.status !== 'open') return;
            if (!currentUser) {
                addToast('error', t('bingo.toastLoginToBuy'));
                return;
            }
            if (pendingCartelas.has(n)) return;

            const owned = myCartelaSet.has(n);
            if (owned && cartelaReturnsLocked) return;
            if (!owned && cartelaChangesLocked) return;
            if (!owned && takenSet.has(n)) return; // taken by someone else  locked

            setPendingCartelas((prev) => new Set(prev).add(n));

            if (owned) {
                void (async () => {
                    try {
                        const refund = await bingoApi.releaseCartela(
                            room.id,
                            n,
                        );
                        setLocalTickets((prev) =>
                            prev.filter((t) => t.cartelaNumber !== n),
                        );
                        addToast(
                            'info',
                            t('bingo.toastCartelaRefunded', { n }),
                        );
                        if (refund.roomCancelled) {
                            cancelledRoomRef.current = room.id;
                            const cancelledRoom = await bingoApi.getRoomState(
                                room.id,
                            );
                            setRoom(cancelledRoom);
                            roomIdRef.current = cancelledRoom.id;
                            localRoomIdRef.current = cancelledRoom.id;
                            setWallet(await walletApi.getWallet());
                            return;
                        }
                        const [nextWallet] = await Promise.all([
                            walletApi.getWallet(),
                            loadCurrent(),
                        ]);
                        setWallet(nextWallet);
                    } catch (err) {
                        toastCartelaError(err);
                        void loadCurrent();
                    } finally {
                        setPendingCartelas((prev) => {
                            const next = new Set(prev);
                            next.delete(n);
                            return next;
                        });
                    }
                })();
                return;
            }

            // Buy path: enqueue and (re)start the short debounce window so several
            // rapid taps land as a single batched purchase request.
            pendingBuyQueueRef.current.push(n);
            pendingBuyRoomIdRef.current = room.id;
            if (!pendingBuyIdempotencyKeyRef.current) {
                pendingBuyIdempotencyKeyRef.current =
                    createIdempotencyKey('bingo-cartela');
            }
            if (pendingBuyTimerRef.current)
                clearTimeout(pendingBuyTimerRef.current);
            pendingBuyTimerRef.current = setTimeout(() => {
                void flushPendingBuys();
            }, 250);
        },
        [
            room,
            currentUser,
            pendingCartelas,
            myCartelaSet,
            takenSet,
            cartelaReturnsLocked,
            addToast,
            loadCurrent,
            setWallet,
            t,
            toastCartelaError,
            flushPendingBuys,
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

    // ── Per-agent lobby: choose a room before entering a game ────────────────────
    if (showLobby && lobby) {
        return (
            <BingoLobby
                rooms={lobby.rooms}
                onPick={(id) => {
                    setPinnedRoomId(id);
                    setRoom(null);
                    setLoading(true);
                }}
                onBack={onBack}
            />
        );
    }

    // ── RENDER ───────────────────────────────────────────────────────────────────
    return (
        <div className='max-w-2xl mx-auto pb-20 space-y-2'>
            {pinnedRoomId && (
                <button
                    type='button'
                    onClick={() => {
                        setPinnedRoomId(null);
                        setRoom(null);
                    }}
                    className='text-[11px] font-black text-emerald-400 flex items-center gap-1'
                >
                    ← {t('bingo.backToRooms', { defaultValue: 'Rooms' })}
                </button>
            )}
            {/* Room result overlay  gated on the timed `holdingResult` flag, not the
          derived phase. A completed room's phase stays 'result' until the next
          room loads, so gating on phase left the dialog stuck open after the
          countdown hit 0. holdingResult flips false exactly when the timer ends.
          Also waits for the Bonus Win window (liveBonusWin) to drain, same as the
          per-place queue, so the summary never races in front of it. */}
            <AnimatePresence>
                {holdingResult &&
                    room &&
                    room.status === 'completed' &&
                    livePlaceQueue.length === 0 &&
                    !liveBonusWin && (
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
                                completedRoomRef.current = room.id;
                                void loadCurrent();
                            }}
                        />
                    )}
            </AnimatePresence>

            {/* Live per-place win window  pops the instant a place is won DURING the
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

            {/* Live Bonus Win window  pays out on its own (deliberately harder)
          pattern, separate from any Derash placement, but always shown LAST:
          it waits for the per-place queue above to fully drain first, so the
          reveal order is always easiest place -> ... -> 1st -> bonus. */}
            <AnimatePresence>
                {liveBonusWin && room && livePlaceQueue.length === 0 && (
                    <BingoBonusWinPopup
                        key='bonus'
                        entry={liveBonusWin}
                        drawnNumbers={room.drawnNumbers}
                        totalSeconds={room.bonusWinDisplaySeconds ?? 5}
                        onDone={() => setLiveBonusWin(null)}
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
                    className='space-y-2'
                >
                    {room.activeBonusCampaign && (
                        <BingoBonusBanner campaign={room.activeBonusCampaign} />
                    )}
                    {/* ── Stats bar ── */}
                    <div className='grid grid-cols-4 gap-1.5'>
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
                                value: `${revealedNumbers.length}/${ballCount}`,
                                color: 'text-red-400',
                            },
                        ].map((stat) => (
                            <div
                                key={stat.key}
                                className='rounded-lg bg-white/[0.03] border border-white/[0.06] px-1.5 py-1 text-center'
                            >
                                <span className='block text-[8px] font-bold uppercase tracking-wider text-slate-300'>
                                    {stat.label}
                                </span>
                                <span
                                    className={`text-[11px] font-black leading-tight ${stat.color}`}
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
                            activePatternNames={
                                isPatternMode
                                    ? Array.from(patternPrizeMap.values())
                                    : undefined
                            }
                        />
                    )}

                    {/* ── Cartela picker (derash buy phase) / Number board ── */}
                    <div
                        className='card p-2.5 scroll-mt-2'
                        ref={callingCardRef}
                    >
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
                                {/* Bought cartelas  live chips. Tap a chip to remove (refund). */}
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
                                                        disabled={
                                                            busy ||
                                                            cartelaChangesLocked
                                                        }
                                                        title={t(
                                                            'bingo.tapToRefund',
                                                        )}
                                                        className={`group flex items-center gap-0.5 rounded-md bg-emerald-500/20 text-emerald-300 font-mono font-black text-[11px] pl-2 pr-1.5 py-0.5 border border-emerald-400/30 transition ${
                                                            busy ||
                                                            cartelaChangesLocked
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
                                    returnLocked={cartelaReturnsLocked}
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
                                                presentedStatus === 'open'
                                                    ? 'bg-emerald-500/10 text-emerald-400'
                                                    : presentedStatus ===
                                                        'running'
                                                      ? 'bg-red-500/10 text-red-400'
                                                      : 'bg-slate-700/50 text-slate-400'
                                            }`}
                                        >
                                            {/* presentedStatus, not room.status: the pill must not
                                          announce COMPLETED over a board that is still calling
                                          the balls which completed it. */}
                                            {presentedStatus === 'open'
                                                ? t('bingo.buyOpen')
                                                : presentedStatus}
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
                                        status={presentedStatus}
                                        count={revealedNumbers.length}
                                        max={ballCount}
                                        catchingUp={isCatchingUp}
                                        catchupKind={catchupKind}
                                    />
                                    {/* Always-mounted (no arm/disarm timer of its own) so it
                                  bridges the real gaps before/between win popups  the round
                                  ending must never look like nothing is happening. */}
                                    {resultsRevealing && (
                                        <div className='flex items-center gap-1.5 text-[8px] font-black uppercase tracking-wide text-emerald-400'>
                                            <span className='w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse' />
                                            {t('bingo.resultsRevealing')}
                                        </div>
                                    )}
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
                                                {cartelaReturnsLocked && (
                                                    <div className='mt-0.5 text-[7px] font-black uppercase tracking-[0.18em] text-red-400'>
                                                        Cartela changes locked
                                                    </div>
                                                )}
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
                                                                    ? t(
                                                                          'bingo.autoTitle',
                                                                      )
                                                                    : t(
                                                                          'bingo.manualTitle',
                                                                      )
                                                            }
                                                            className='flex items-center gap-1.5'
                                                        >
                                                            <span
                                                                className={`text-[9px] font-black uppercase tracking-wider ${autoMode ? 'text-emerald-400' : 'text-amber-400'}`}
                                                            >
                                                                {autoMode
                                                                    ? t(
                                                                          'bingo.auto',
                                                                      )
                                                                    : t(
                                                                          'bingo.manual',
                                                                      )}
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
                                                            Manual mode only tap{' '}
                                                            <b>BINGO</b> when
                                                            your card actually
                                                            wins. A wrong call{' '}
                                                            <b>disqualifies</b>{' '}
                                                            the card!
                                                        </p>
                                                    )}
                                                <div
                                                    className='w-full flex flex-col gap-1.5 overflow-y-auto pr-1 scrollbar-hide'
                                                    style={{
                                                        maxHeight:
                                                            'min(470px, 70vh)',
                                                    }}
                                                >
                                                    {myTickets.map((ticket) => (
                                                        <div
                                                            key={ticket.id}
                                                            className='w-full flex flex-col gap-0.5'
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
                                                                        className='w-full py-1 rounded-lg bg-gradient-to-r from-amber-500 to-red-500 text-black text-[10px] font-black uppercase tracking-wide disabled:opacity-50 active:scale-95 transition-transform'
                                                                    >
                                                                        {claimingId ===
                                                                        ticket.id
                                                                            ? '…'
                                                                            : t(
                                                                                  'bingo.bingoExclaim',
                                                                              )}
                                                                    </button>
                                                                )}
                                                            {ticket.status ===
                                                                'disqualified' && (
                                                                <span className='w-full text-center text-[9px] font-black text-red-400 uppercase tracking-wide'>
                                                                    {t(
                                                                        'bingo.disqualified',
                                                                    )}
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

                    {/* ── Owned summary (derash)  buying happens instantly on tap ── */}
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

                    {/* ── Buy panel (line/pattern mode only  prefilled buys via grid) ── */}
                    {!isPrefilledMode && phase === 'buy' && !alreadyBought && (
                        <div className='card space-y-2'>
                            <div className='flex items-center justify-between'>
                                <p className='text-[10px] font-black uppercase tracking-wider text-slate-400'>
                                    {t('bingo.buyACard')}
                                </p>
                                <span className='text-[10px] text-slate-500'>
                                    {t('bingo.spotsLeft', {
                                        count: remainingTickets,
                                    })}
                                </span>
                            </div>
                            <motion.button
                                whileHover={
                                    !buying &&
                                    remainingTickets > 0 &&
                                    !cartelaChangesLocked
                                        ? { scale: 1.02, y: -2 }
                                        : {}
                                }
                                whileTap={{ scale: 0.97 }}
                                onClick={buyTickets}
                                disabled={
                                    buying ||
                                    remainingTickets <= 0 ||
                                    cartelaChangesLocked
                                }
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
                                    t('bingo.buyCardEtb', {
                                        amount: formatCreditsFull(
                                            room.ticketPriceMinor,
                                        ),
                                    })
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
                                    ? t('bingo.myCartelas', {
                                          count: myTickets.length,
                                      })
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
                                <MessageSquare size={11} />{' '}
                                {t('bingo.roomChat')}
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
                                            placeholder={t(
                                                'bingo.saySomething',
                                            )}
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
