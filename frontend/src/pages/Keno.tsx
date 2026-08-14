import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { AnimatePresence, motion } from 'framer-motion';
import {
    ArrowLeft,
    Play,
    Pause,
    Trash2,
    ChevronDown,
    ChevronUp,
    Volume2,
    VolumeX,
    Trophy,
    Award,
    Zap,
    X,
    RotateCcw,
} from 'lucide-react';
import { kenoApi, walletApi } from '../lib/api';
import type { KenoConfig, KenoDraw, KenoTicket } from '../lib/models';
import {
    createIdempotencyKey,
    formatCreditsFull,
    formatDateTime,
    getErrorMessage,
} from '../lib/utils';
import { formatCredits, useStore } from '../store/useStore';
import { getSocket } from '../hooks/useSocketConnection';
import { soundEngine } from '../lib/audio';
import { fireConfetti } from '../lib/confetti';

// ─── Countdown ────────────────────────────────────────────────────────────────

function useCountdown(targetIso: string | null | undefined) {
    const [display, setDisplay] = useState('--:--');
    const [urgent, setUrgent] = useState(false);
    const [expired, setExpired] = useState(false);
    const [seconds, setSeconds] = useState<number | null>(null);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    useEffect(() => {
        if (timerRef.current) clearInterval(timerRef.current);
        setExpired(false);
        if (!targetIso) {
            setDisplay('--:--');
            setUrgent(false);
            setSeconds(null);
            return;
        }

        const tick = () => {
            const ms = new Date(targetIso).getTime() - Date.now();
            if (ms <= 0) {
                setDisplay('00:00');
                setUrgent(false);
                setExpired(true);
                setSeconds(0);
                if (timerRef.current) clearInterval(timerRef.current);
                return;
            }
            const total = Math.floor(ms / 1000);
            const m = Math.floor(total / 60);
            const s = total % 60;
            setDisplay(
                `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`,
            );
            setUrgent(total < 15);
            setSeconds(total);
            setExpired(false);
        };

        tick();
        timerRef.current = setInterval(tick, 500);
        return () => {
            if (timerRef.current) clearInterval(timerRef.current);
        };
    }, [targetIso]);

    return { display, urgent, expired, seconds };
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_ALLOWED_SPOTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const DEFAULT_KENO_INTERVAL_SECONDS = 40;
const KENO_REVEAL_DELAY_MS = 120;
const MAX_TICKETS_PER_DRAW = 5;

function getKenoIntervalSeconds(cfg: KenoConfig) {
    if (cfg.autoScheduleIntervalSeconds !== undefined)
        return cfg.autoScheduleIntervalSeconds;
    if (cfg.autoScheduleIntervalMinutes === 0) return 0;
    return DEFAULT_KENO_INTERVAL_SECONDS;
}

function formatKenoInterval(cfg: KenoConfig, t: TFunction) {
    const secs = getKenoIntervalSeconds(cfg);
    if (secs <= 0) return t('bingo.manual');
    if (secs < 60) return `${secs}s`;
    const mins = secs / 60;
    return Number.isInteger(mins) ? `${mins}m` : `${secs}s`;
}

// ─── Types ────────────────────────────────────────────────────────────────────

type KenoDrawCompletedPayload = { drawId?: string; drawnNumbers?: number[] };
type KenoProps = { onBack: () => void };

/** A locally-built ticket not yet purchased  lives in the cart until START. */
type DraftTicket = {
    localId: string;
    selectedNumbers: number[];
    stakeMinor: number;
};

/** Normalized shape shared by cart drafts and purchased tickets, for rendering. */
type TicketRow = {
    key: string;
    selectedNumbers: number[];
    stakeMinor: number;
    removable: boolean;
    localId?: string;
};

// ─── Sub-components ───────────────────────────────────────────────────────────

type TileState = 'idle' | 'selected' | 'drawn' | 'drawnMiss' | 'hit' | 'miss';

function getTileState(
    value: number,
    selected: number[],
    revealed: number[],
    drawComplete: boolean,
): TileState {
    const isSel = selected.includes(value);
    const isRev = revealed.includes(value);
    if (isSel && isRev) return 'hit';
    if (isRev && drawComplete) return 'drawnMiss';
    if (isRev) return 'drawn';
    if (isSel && drawComplete) return 'miss';
    if (isSel) return 'selected';
    return 'idle';
}

const TILE_BASE =
    'relative aspect-square rounded-lg border text-xs font-bold font-mono select-none flex items-center justify-center transition-colors duration-150';

const TILE_CLS: Record<TileState, string> = {
    idle: 'bg-[var(--bg-2)] border-white/[0.08] text-[var(--text-secondary)]',
    selected: 'bg-[var(--gold)] border-[var(--gold)] text-black',
    drawn: 'bg-violet-950/70 border-violet-500/50 text-violet-300',
    hit: 'bg-emerald-500 border-emerald-400 text-black',
    miss: 'bg-[var(--gold)]/10 border-[var(--gold)]/40 text-amber-300',
    drawnMiss: 'bg-red-950/30 border-red-500/20 text-red-400/50',
};

const KenoTile = memo(
    ({
        value,
        state,
        onClick,
        disabled,
    }: {
        value: number;
        state: TileState;
        onClick: () => void;
        disabled: boolean;
    }) => (
        <motion.button
            whileHover={
                !disabled && state === 'idle'
                    ? {
                          scale: 1.12,
                          borderColor: 'rgba(245,158,11,0.55)',
                          color: '#f59e0b',
                          backgroundColor: 'rgba(245,158,11,0.08)',
                      }
                    : undefined
            }
            whileTap={!disabled ? { scale: 0.86 } : undefined}
            animate={
                state === 'hit'
                    ? {
                          scale: [1, 1.28, 1.08],
                          boxShadow: [
                              '0 0 0px #10b981',
                              '0 0 24px rgba(16,185,129,0.7)',
                              '0 0 10px rgba(16,185,129,0.4)',
                          ],
                      }
                    : state === 'selected'
                      ? { boxShadow: '0 0 14px rgba(245,158,11,0.45)' }
                      : state === 'drawn'
                        ? { boxShadow: '0 0 8px rgba(139,92,246,0.4)' }
                        : {}
            }
            transition={{ type: 'spring', stiffness: 420, damping: 22 }}
            onClick={onClick}
            disabled={disabled}
            aria-pressed={
                state === 'selected' || state === 'hit' || state === 'miss'
            }
            className={`${TILE_BASE} ${TILE_CLS[state]}`}
        >
            {state === 'drawnMiss' ? (
                <>
                    <span className='opacity-30'>{value}</span>
                    <X
                        size={14}
                        strokeWidth={3}
                        className='absolute inset-0 m-auto text-red-400/80 pointer-events-none'
                    />
                </>
            ) : (
                value
            )}
            {state === 'hit' && (
                <motion.span
                    initial={{ scale: 0, opacity: 0.8 }}
                    animate={{ scale: 3, opacity: 0 }}
                    transition={{ duration: 0.5 }}
                    className='absolute inset-0 rounded-lg bg-emerald-400/40 pointer-events-none'
                />
            )}
        </motion.button>
    ),
);
KenoTile.displayName = 'KenoTile';

function CircularTimer({
    seconds,
    totalSeconds,
    urgent,
    expired,
    display,
}: {
    seconds: number | null;
    totalSeconds: number;
    urgent: boolean;
    expired: boolean;
    display: string;
}) {
    const { t } = useTranslation();
    const R = 46;
    const C = 2 * Math.PI * R;
    const pct =
        seconds !== null && totalSeconds > 0
            ? Math.max(0, Math.min(1, seconds / totalSeconds))
            : 1;
    const offset = C * (1 - pct);
    const color = urgent ? '#ef4444' : '#f59e0b';

    return (
        <div className='relative w-28 h-28 flex items-center justify-center mx-auto'>
            <svg
                className='w-full h-full -rotate-90 absolute inset-0'
                viewBox='0 0 112 112'
            >
                <circle
                    cx='56'
                    cy='56'
                    r={R}
                    fill='none'
                    stroke='rgba(255,255,255,0.05)'
                    strokeWidth='5'
                />
                <circle
                    cx='56'
                    cy='56'
                    r={R}
                    fill='none'
                    stroke={color}
                    strokeWidth='5'
                    strokeLinecap='round'
                    strokeDasharray={C}
                    strokeDashoffset={offset}
                    style={{
                        transition:
                            'stroke-dashoffset 0.5s linear, stroke 0.3s ease',
                        filter: `drop-shadow(0 0 6px ${color}99)`,
                    }}
                />
            </svg>
            <div className='flex flex-col items-center z-10'>
                <span
                    className={`text-xl font-black font-mono tracking-widest ${urgent ? 'text-red-400 animate-pulse' : 'text-amber-400'}`}
                >
                    {expired ? t('keno.lock') : display}
                </span>
                <span className='text-[9px] font-bold text-slate-500 uppercase tracking-widest mt-0.5'>
                    {expired ? t('keno.processingLabel') : t('keno.nextDraw')}
                </span>
            </div>
        </div>
    );
}

function CollapsibleSection({
    title,
    children,
    defaultOpen = false,
}: {
    title: string;
    children: React.ReactNode;
    defaultOpen?: boolean;
}) {
    const [open, setOpen] = useState(defaultOpen);
    return (
        <div className='card'>
            <button
                type='button'
                onClick={() => setOpen((o) => !o)}
                className='w-full flex items-center justify-between text-left'
                style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    padding: 0,
                }}
            >
                <span className='text-sm font-bold text-slate-200'>
                    {title}
                </span>
                {open ? (
                    <ChevronUp size={16} className='text-slate-400' />
                ) : (
                    <ChevronDown size={16} className='text-slate-400' />
                )}
            </button>
            <AnimatePresence initial={false}>
                {open && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        style={{ overflow: 'hidden' }}
                    >
                        <div className='pt-4'>{children}</div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function Keno({ onBack }: KenoProps) {
    const { t } = useTranslation();
    const addToast = useStore((s) => s.addToast);
    const wallet = useStore((s) => s.wallet);
    const setWallet = useStore((s) => s.setWallet);
    const liveCounts = useStore((s) => s.liveCounts);
    const soundVolume = useStore((s) => s.soundVolume);
    const soundMuted = useStore((s) => s.soundMuted);
    const setSoundVolume = useStore((s) => s.setSoundVolume);
    const setSoundMuted = useStore((s) => s.setSoundMuted);

    const [config, setConfig] = useState<KenoConfig | null>(null);
    const [draws, setDraws] = useState<KenoDraw[]>([]);
    const [tickets, setTickets] = useState<KenoTicket[]>([]);
    const [activeDraw, setActiveDraw] = useState<KenoDraw | null>(null);
    const [selectedNumbers, setSelectedNumbers] = useState<number[]>([]);
    const [cart, setCart] = useState<DraftTicket[]>([]);
    const [betAmount, setBetAmount] = useState(0);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);

    const [gameState, setGameState] = useState<
        'idle' | 'waiting' | 'drawing' | 'celebrating' | 'finished'
    >('idle');
    const [animatingDrawId, setAnimatingDrawId] = useState<string | null>(null);
    const [revealedNumbers, setRevealedNumbers] = useState<number[]>([]);
    const [drawResult, setDrawResult] = useState<{
        drawId: string;
        drawnNumbers: number[];
        userTickets: KenoTicket[];
        totalPayout: number;
    } | null>(null);

    const [autoPlayEnabled, setAutoPlayEnabled] = useState(false);
    const [autoPlayRounds, setAutoPlayRounds] = useState(10);
    const [autoPlayRoundsRemaining, setAutoPlayRoundsRemaining] = useState(0);
    const [autoPlayStartBalance, setAutoPlayStartBalance] = useState<
        number | null
    >(null);
    const [autoPlayStopProfit, setAutoPlayStopProfit] = useState('');
    const [autoPlayStopLoss, setAutoPlayStopLoss] = useState('');
    const [autoPlayStats, setAutoPlayStats] = useState({
        roundsPlayed: 0,
        netProfit: 0,
    });

    const [bottomTab, setBottomTab] = useState<'draws' | 'tickets'>('draws');

    const ticketsRef = useRef<KenoTicket[]>([]);
    const betAmountInitialized = useRef(false);

    const scheduledAt =
        activeDraw?.status === 'open' ? activeDraw.scheduledAt : null;
    const {
        display: countdown,
        urgent: countdownUrgent,
        expired: countdownExpired,
        seconds: countdownSeconds,
    } = useCountdown(scheduledAt);

    const allowedSpots = config?.allowedSpots?.length
        ? config.allowedSpots
        : DEFAULT_ALLOWED_SPOTS;
    const maxSpot = useMemo(
        () => Math.max(1, ...allowedSpots),
        [allowedSpots],
    );
    const numbers = useMemo(() => {
        const min = config?.numberMin ?? 1;
        const max = config?.numberMax ?? 80;
        return Array.from({ length: max - min + 1 }, (_, i) => min + i);
    }, [config]);

    const minStake = config?.minStakeMinor ?? 1;
    const maxStakeConfig = config?.maxStakeMinor ?? 100_000;
    const defaultStake = config?.ticketPriceMinor ?? 10;
    const betStep = Math.max(1, defaultStake);

    const ticketsByDrawId = useMemo(() => {
        const map = new Map<string, KenoTicket[]>();
        for (const tk of tickets) {
            const list = map.get(tk.drawId) ?? [];
            list.push(tk);
            map.set(tk.drawId, list);
        }
        return map;
    }, [tickets]);

    useEffect(() => {
        ticketsRef.current = tickets;
    }, [tickets]);

    const drawComplete =
        revealedNumbers.length >= (config?.drawSize ?? 20) &&
        revealedNumbers.length > 0;

    const currentDrawTickets = useMemo(
        () =>
            activeDraw
                ? tickets.filter((tk) => tk.drawId === activeDraw.id)
                : [],
        [tickets, activeDraw],
    );
    const hasSubmittedForDraw = currentDrawTickets.length > 0;

    const highlightNumbers = useMemo(() => {
        if (!hasSubmittedForDraw) return selectedNumbers;
        return [
            ...new Set(currentDrawTickets.flatMap((tk) => tk.selectedNumbers)),
        ];
    }, [hasSubmittedForDraw, currentDrawTickets, selectedNumbers]);

    const loadKeno = useCallback(async () => {
        try {
            const [nextConfig, nextDraws, nextTickets, nextActiveDraw] =
                await Promise.all([
                    kenoApi.getConfig(),
                    kenoApi.listDraws(10),
                    kenoApi.listTickets(15),
                    kenoApi.getActiveDraw(),
                ]);
            setConfig(nextConfig);
            setDraws(nextDraws);
            setTickets(nextTickets);
            setActiveDraw(nextActiveDraw);
            if (!betAmountInitialized.current) {
                betAmountInitialized.current = true;
                setBetAmount(nextConfig.ticketPriceMinor);
            }
        } catch (err) {
            addToast('error', getErrorMessage(err));
        } finally {
            setLoading(false);
        }
    }, [addToast]);

    const quickPickNumbers = useCallback(
        (count: number) => {
            const pool = [...numbers];
            const picked: number[] = [];
            for (let i = 0; i < count && pool.length > 0; i++) {
                const idx = Math.floor(Math.random() * pool.length);
                picked.push(pool.splice(idx, 1)[0]);
            }
            return picked.sort((a, b) => a - b);
        },
        [numbers],
    );

    const attemptAutoPlayPurchase = useCallback(
        async (drawId: string) => {
            if (!config || !wallet) return;
            if (wallet.availableMinor < betAmount) {
                addToast('error', t('keno.autoStoppedBalance'));
                setAutoPlayEnabled(false);
                return;
            }
            if (autoPlayStartBalance !== null) {
                const net = wallet.availableMinor - autoPlayStartBalance;
                if (
                    autoPlayStopProfit &&
                    net >= parseFloat(autoPlayStopProfit)
                ) {
                    addToast('success', t('keno.autoStoppedProfit'));
                    setAutoPlayEnabled(false);
                    return;
                }
                if (autoPlayStopLoss && net <= -parseFloat(autoPlayStopLoss)) {
                    addToast('info', t('keno.autoStoppedLoss'));
                    setAutoPlayEnabled(false);
                    return;
                }
            }

            setSubmitting(true);
            try {
                let picks = [...selectedNumbers];
                if (picks.length === 0) {
                    const count =
                        allowedSpots[
                            Math.floor(Math.random() * allowedSpots.length)
                        ] ?? 4;
                    picks = quickPickNumbers(count);
                    setSelectedNumbers(picks);
                }
                await kenoApi.purchaseTicket(
                    picks,
                    createIdempotencyKey('keno'),
                    betAmount,
                );
                const [nextWallet] = await Promise.all([
                    walletApi.getWallet(),
                    loadKeno(),
                ]);
                setWallet(nextWallet);
                setGameState('waiting');
                addToast(
                    'success',
                    t('keno.autoBetPlaced', { drawId: drawId.slice(-6) }),
                );
                setAutoPlayRoundsRemaining((prev) => {
                    const next = prev - 1;
                    if (next <= 0) {
                        setAutoPlayEnabled(false);
                        addToast('info', t('keno.autoCompleted'));
                    }
                    return next;
                });
            } catch (err) {
                addToast(
                    'error',
                    t('keno.autoBetFailed', { error: getErrorMessage(err) }),
                );
                setAutoPlayEnabled(false);
            } finally {
                setSubmitting(false);
            }
        },
        [
            config,
            wallet,
            selectedNumbers,
            betAmount,
            allowedSpots,
            quickPickNumbers,
            addToast,
            loadKeno,
            setWallet,
            autoPlayStartBalance,
            autoPlayStopProfit,
            autoPlayStopLoss,
            t,
        ],
    );

    useEffect(() => {
        void loadKeno();
        const socket = getSocket();
        if (!socket) return;

        socket.emit('enter.game', { game: 'keno' });

        const handleDrawStarted = () => {
            setGameState('waiting');
            setActiveDraw((prev) =>
                prev ? { ...prev, status: 'locked' } : prev,
            );
        };

        const handleDrawCompleted = (payload: KenoDrawCompletedPayload) => {
            const drawn = payload.drawnNumbers ?? [];
            const drawId = payload.drawId ?? '';
            const hasTicket = ticketsRef.current.some(
                (tk) => tk.drawId === drawId,
            );

            setAnimatingDrawId(drawId);
            setRevealedNumbers([]);
            setGameState('drawing');

            drawn.forEach((num, idx) => {
                setTimeout(() => {
                    if (hasTicket) {
                        const myNumbers = ticketsRef.current
                            .filter((tk) => tk.drawId === drawId)
                            .flatMap((tk) => tk.selectedNumbers);
                        soundEngine.reveal(myNumbers.includes(num));
                    } else {
                        soundEngine.pop();
                    }
                    setRevealedNumbers((prev) => [...prev, num]);
                }, idx * KENO_REVEAL_DELAY_MS);
            });

            void loadKeno();
        };

        socket.on('keno.draw.started', handleDrawStarted);
        socket.on('keno.draw.completed', handleDrawCompleted);

        return () => {
            socket.emit('leave.game', { game: 'keno' });
            socket.off('keno.draw.started', handleDrawStarted);
            socket.off('keno.draw.completed', handleDrawCompleted);
        };
    }, [loadKeno]);

    useEffect(() => {
        if (
            autoPlayEnabled &&
            activeDraw?.status === 'open' &&
            currentDrawTickets.length === 0 &&
            !submitting
        ) {
            void attemptAutoPlayPurchase(activeDraw.id);
        }
    }, [
        autoPlayEnabled,
        activeDraw,
        currentDrawTickets.length,
        submitting,
        attemptAutoPlayPurchase,
    ]);

    useEffect(() => {
        if (
            !animatingDrawId ||
            tickets.length === 0 ||
            revealedNumbers.length < (config?.drawSize ?? 20)
        )
            return;
        const relevant = tickets.filter(
            (tk) =>
                tk.drawId === animatingDrawId &&
                tk.settlementStatus === 'settled',
        );
        const resultDraw = draws.find((d) => d.id === animatingDrawId);
        if (!resultDraw?.drawnNumbers.length) return;
        const totalPayout = relevant.reduce((s, tk) => s + tk.payoutMinor, 0);

        setGameState(totalPayout > 0 ? 'celebrating' : 'finished');
        const timer = setTimeout(() => {
            if (totalPayout > 0) {
                soundEngine.win();
                void fireConfetti({
                    particleCount: 180,
                    spread: 80,
                    origin: { y: 0.65 },
                    colors: ['#FFE600', '#10B981', '#F59E0B', '#8B5CF6'],
                });
                // Win bell notification is created + pushed by the server at settlement.
            }
            setDrawResult({
                drawId: animatingDrawId,
                drawnNumbers: resultDraw.drawnNumbers,
                userTickets: relevant,
                totalPayout,
            });
            if (autoPlayEnabled) {
                setAutoPlayStats((prev) => ({
                    roundsPlayed: prev.roundsPlayed + 1,
                    netProfit:
                        prev.netProfit +
                        (totalPayout -
                            relevant.reduce((s, tk) => s + tk.stakeMinor, 0)),
                }));
            }
            setAnimatingDrawId(null);
        }, 1200);
        return () => clearTimeout(timer);
    }, [
        revealedNumbers,
        animatingDrawId,
        tickets,
        draws,
        config,
        autoPlayEnabled,
    ]);

    useEffect(() => {
        if (!countdownExpired || !activeDraw || activeDraw.status !== 'open')
            return;
        const id = setInterval(async () => {
            try {
                const next = await kenoApi.getActiveDraw();
                if (!next || next.id !== activeDraw.id) setActiveDraw(next);
            } catch {
                /* ignore */
            }
        }, 2000);
        return () => clearInterval(id);
    }, [countdownExpired, activeDraw]);

    // New draw opened  clear the cart, and clear the draft pick too unless
    // Auto Play is running (it reuses the same numbers round after round).
    useEffect(() => {
        setCart([]);
        if (!autoPlayEnabled) setSelectedNumbers([]);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeDraw?.id]);

    const drawOpen = !!activeDraw && activeDraw.status === 'open';
    const gridLocked =
        hasSubmittedForDraw || !drawOpen || gameState === 'drawing';

    const clampBet = useCallback(
        (v: number) => Math.min(maxStakeConfig, Math.max(minStake, Math.round(v))),
        [minStake, maxStakeConfig],
    );

    const adjustBet = (delta: number) => {
        if (gridLocked) return;
        soundEngine.click();
        setBetAmount((v) => clampBet(v + delta));
    };
    const doubleBet = () => {
        if (gridLocked) return;
        soundEngine.click();
        setBetAmount((v) => clampBet(v * 2));
    };
    const maxBet = () => {
        if (gridLocked) return;
        soundEngine.click();
        const walletCap = wallet ? Math.floor(wallet.availableMinor) : maxStakeConfig;
        setBetAmount(clampBet(Math.min(maxStakeConfig, walletCap || maxStakeConfig)));
    };

    const handleQuickPick = () => {
        if (gridLocked) return;
        soundEngine.click();
        const count =
            allowedSpots[Math.floor(Math.random() * allowedSpots.length)] ??
            4;
        setSelectedNumbers(quickPickNumbers(Math.min(count, maxSpot)));
    };

    const handleClearSelection = () => {
        if (gridLocked) return;
        soundEngine.click();
        setSelectedNumbers([]);
    };

    const toggleNumber = (value: number) => {
        if (gridLocked) return;
        soundEngine.click();
        const cur = selectedNumbers;
        let next: number[];
        if (cur.includes(value)) {
            next = cur.filter((n) => n !== value);
        } else {
            if (cur.length >= maxSpot) return;
            next = [...cur, value].sort((a, b) => a - b);
        }
        setSelectedNumbers(next);
    };

    const handleAddToCart = () => {
        if (gridLocked) return;
        if (selectedNumbers.length === 0) {
            addToast('info', t('keno.pickAtLeastOne'));
            return;
        }
        if (!allowedSpots.includes(selectedNumbers.length)) {
            addToast(
                'info',
                t('keno.spotCountNotOffered', {
                    count: selectedNumbers.length,
                }),
            );
            return;
        }
        if (cart.length >= MAX_TICKETS_PER_DRAW) {
            addToast(
                'info',
                t('keno.maxTicketsReached', { max: MAX_TICKETS_PER_DRAW }),
            );
            return;
        }
        soundEngine.click();
        setCart((prev) => [
            ...prev,
            {
                localId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
                selectedNumbers: [...selectedNumbers],
                stakeMinor: betAmount,
            },
        ]);
        setSelectedNumbers([]);
    };

    const handleRemoveCartItem = (localId: string) => {
        soundEngine.click();
        setCart((prev) => prev.filter((c) => c.localId !== localId));
    };

    const totalCartStake = cart.reduce((s, c) => s + c.stakeMinor, 0);
    const insufficientForCart = !!wallet && wallet.availableMinor < totalCartStake;

    const handleStart = async () => {
        if (cart.length === 0 || !drawOpen || submitting) return;
        if (insufficientForCart) {
            addToast('error', t('keno.insufficientBalance'));
            return;
        }
        setSubmitting(true);
        let purchasedCount = 0;
        try {
            for (const item of cart) {
                await kenoApi.purchaseTicket(
                    item.selectedNumbers,
                    createIdempotencyKey('keno'),
                    item.stakeMinor,
                );
                purchasedCount++;
            }
            setCart([]);
            setGameState('waiting');
            soundEngine.cashout();
            addToast('success', t('keno.betsPlaced', { count: purchasedCount }));
        } catch (err) {
            addToast('error', getErrorMessage(err));
            setCart((prev) => prev.slice(purchasedCount));
        } finally {
            try {
                const nextWallet = await walletApi.getWallet();
                setWallet(nextWallet);
            } catch {
                /* ignore */
            }
            await loadKeno();
            setSubmitting(false);
        }
    };

    const handleStartAutoPlay = () => {
        if (!wallet) return;
        soundEngine.click();
        setAutoPlayStartBalance(wallet.availableMinor);
        setAutoPlayRoundsRemaining(autoPlayRounds);
        setAutoPlayStats({ roundsPlayed: 0, netProfit: 0 });
        setAutoPlayEnabled(true);
        addToast('success', t('keno.autoStarted', { count: autoPlayRounds }));
    };

    const handleStopAutoPlay = () => {
        soundEngine.click();
        setAutoPlayEnabled(false);
        addToast('info', t('keno.autoPaused'));
    };

    const intervalSecs = config
        ? getKenoIntervalSeconds(config)
        : DEFAULT_KENO_INTERVAL_SECONDS;

    // Spot count driving the paytable card: the draft in progress, else the
    // last thing added to the cart, else the round's purchased tickets.
    const currentSpots =
        selectedNumbers.length ||
        cart[cart.length - 1]?.selectedNumbers.length ||
        currentDrawTickets[0]?.selectedNumbers.length ||
        0;
    const representativeStake =
        currentDrawTickets[0]?.stakeMinor ??
        cart[cart.length - 1]?.stakeMinor ??
        betAmount;

    const paytableRows = useMemo(() => {
        if (!config || currentSpots === 0) return [];
        const rows: { matches: number; multiplier: number | null }[] = [];
        for (let m = currentSpots; m >= 0; m--) {
            const entry = config.paytable?.find(
                (e) => e.spots === currentSpots && e.matches === m,
            );
            rows.push({ matches: m, multiplier: entry?.payoutMultiplier ?? null });
        }
        return rows;
    }, [config, currentSpots]);

    const isDrawingOrSettled =
        gameState === 'drawing' ||
        gameState === 'celebrating' ||
        gameState === 'finished';

    const bestMultiplier =
        currentSpots > 0
            ? Math.max(
                  0,
                  ...(config?.paytable
                      ?.filter((e) => e.spots === currentSpots)
                      .map((e) => e.payoutMultiplier) ?? [0]),
              )
            : 0;
    const bestPayout = bestMultiplier * representativeStake;
    const nowPayout = currentDrawTickets.reduce((sum, tk) => {
        const matchesSoFar = tk.selectedNumbers.filter((n) =>
            revealedNumbers.includes(n),
        ).length;
        const entry = config?.paytable?.find(
            (e) => e.spots === tk.selectedNumbers.length && e.matches === matchesSoFar,
        );
        return sum + (entry ? entry.payoutMultiplier * tk.stakeMinor : 0);
    }, 0);

    const ticketRows: TicketRow[] = hasSubmittedForDraw
        ? currentDrawTickets.map((tk) => ({
              key: tk.id,
              selectedNumbers: tk.selectedNumbers,
              stakeMinor: tk.stakeMinor,
              removable: false,
          }))
        : cart.map((c) => ({
              key: c.localId,
              selectedNumbers: c.selectedNumbers,
              stakeMinor: c.stakeMinor,
              removable: true,
              localId: c.localId,
          }));

    // ─── Render ────────────────────────────────────────────────────────────────

    if (loading) {
        return (
            <div
                style={{
                    display: 'flex',
                    justifyContent: 'center',
                    padding: 60,
                }}
            >
                <div className='spinner' />
            </div>
        );
    }

    return (
        <div className='space-y-4 max-w-2xl mx-auto pb-20'>
            {/* Header */}
            <div className='flex items-center justify-between'>
                <button
                    type='button'
                    onClick={onBack}
                    className='btn btn-ghost btn-sm'
                    style={{ gap: 4 }}
                >
                    <ArrowLeft size={16} /> {t('common.back')}
                </button>
                <div className='flex items-center gap-3'>
                    {liveCounts && liveCounts.kenoOnline > 0 && (
                        <span className='live-badge-pulse'>
                            <span className='pulse-dot' />
                            {t('home.playing', {
                                count: liveCounts.kenoOnline,
                            })}
                        </span>
                    )}
                    <button
                        onClick={() => setSoundMuted(!soundMuted)}
                        className='btn btn-ghost btn-sm icon-btn'
                    >
                        {soundMuted ? (
                            <VolumeX size={16} />
                        ) : (
                            <Volume2 size={16} />
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
                            className='w-20 accent-amber-500 cursor-pointer h-1 rounded'
                        />
                    )}
                </div>
            </div>

            {/* Draw status card */}
            <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                className='card text-center relative overflow-hidden'
            >
                <div
                    className='absolute inset-0 pointer-events-none'
                    style={{
                        background:
                            'radial-gradient(ellipse at 50% 0%, rgba(245,158,11,0.06) 0%, transparent 70%)',
                    }}
                />

                {activeDraw && activeDraw.status !== 'open' ? (
                    <div className='py-4'>
                        <motion.div
                            animate={{ opacity: [1, 0.5, 1] }}
                            transition={{ duration: 1.2, repeat: Infinity }}
                            className='text-2xl font-black text-amber-400 uppercase tracking-widest mb-1'
                        >
                            {t('keno.drawingEllipsis')}
                        </motion.div>
                        <p className='text-xs text-slate-400'>
                            {t('keno.numbersRevealed')}
                        </p>
                    </div>
                ) : (
                    <CircularTimer
                        seconds={countdownSeconds}
                        totalSeconds={intervalSecs}
                        urgent={countdownUrgent}
                        expired={countdownExpired}
                        display={countdown}
                    />
                )}

                {/* Drawing reveal  big current ball + smaller history */}
                <AnimatePresence>
                    {gameState === 'drawing' && revealedNumbers.length > 0 && (
                        <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            className='mt-3 pt-3 border-t border-white/[0.05]'
                        >
                            <div className='text-[10px] text-violet-400 font-bold mb-2 uppercase tracking-wider'>
                                {t('keno.ballsOf', {
                                    count: revealedNumbers.length,
                                    max: config?.drawSize ?? 20,
                                })}
                            </div>
                            <div className='flex flex-col items-center gap-3'>
                                <AnimatePresence mode='wait'>
                                    <motion.div
                                        key={
                                            revealedNumbers[
                                                revealedNumbers.length - 1
                                            ]
                                        }
                                        initial={{
                                            scale: 0.4,
                                            opacity: 0,
                                            y: -20,
                                        }}
                                        animate={{ scale: 1, opacity: 1, y: 0 }}
                                        exit={{ scale: 0.6, opacity: 0 }}
                                        transition={{
                                            type: 'spring',
                                            stiffness: 260,
                                            damping: 16,
                                        }}
                                        className={`w-16 h-16 rounded-full flex items-center justify-center text-xl font-black font-mono border-2 shadow-lg ${
                                            highlightNumbers.includes(
                                                revealedNumbers[
                                                    revealedNumbers.length - 1
                                                ],
                                            )
                                                ? 'bg-emerald-500 border-emerald-300 text-black'
                                                : 'bg-violet-950 border-violet-500/60 text-violet-200'
                                        }`}
                                    >
                                        {
                                            revealedNumbers[
                                                revealedNumbers.length - 1
                                            ]
                                        }
                                    </motion.div>
                                </AnimatePresence>
                                <div className='flex flex-wrap gap-1 justify-center max-w-xs'>
                                    {revealedNumbers
                                        .slice(0, -1)
                                        .map((num) => {
                                            const hit =
                                                highlightNumbers.includes(num);
                                            return (
                                                <motion.span
                                                    key={num}
                                                    initial={{
                                                        opacity: 0,
                                                        scale: 0.5,
                                                    }}
                                                    animate={{
                                                        opacity: 1,
                                                        scale: 1,
                                                    }}
                                                    transition={{
                                                        type: 'spring',
                                                        stiffness: 300,
                                                        damping: 18,
                                                    }}
                                                    className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-black font-mono border flex-shrink-0 ${
                                                        hit
                                                            ? 'bg-emerald-500 border-emerald-400 text-black'
                                                            : 'bg-violet-950/80 border-violet-500/40 text-violet-300'
                                                    }`}
                                                >
                                                    {num}
                                                </motion.span>
                                            );
                                        })}
                                </div>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* Config strip */}
                {config && (
                    <div className='grid grid-cols-3 gap-2 mt-4'>
                        {[
                            {
                                key: 'stakeRange',
                                label: t('keno.stakeRange'),
                                value: `${formatCredits(minStake)}-${formatCredits(maxStakeConfig)}`,
                                color: 'text-amber-400',
                            },
                            {
                                key: 'draws',
                                label: t('keno.draws'),
                                value: `${config.drawSize}`,
                                color: 'text-indigo-400',
                            },
                            {
                                key: 'interval',
                                label: t('keno.interval'),
                                value: formatKenoInterval(config, t),
                                color: 'text-teal-400',
                            },
                        ].map(({ key, label, value, color }) => (
                            <div
                                key={key}
                                className='rounded-xl p-2 bg-white/[0.03] border border-white/[0.05] text-center'
                            >
                                <span className='block text-[9px] font-bold uppercase tracking-wider text-slate-500'>
                                    {label}
                                </span>
                                <span className={`text-sm font-black ${color}`}>
                                    {value}
                                </span>
                            </div>
                        ))}
                    </div>
                )}
            </motion.div>

            {/* Result modal  win / lose popup with Play Again */}
            <AnimatePresence>
                {drawResult && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className='fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4'
                        onClick={() => {
                            soundEngine.click();
                            setDrawResult(null);
                        }}
                    >
                        <motion.div
                            initial={{ scale: 0.8, y: 20 }}
                            animate={{ scale: 1, y: 0 }}
                            exit={{ scale: 0.85, opacity: 0 }}
                            transition={{
                                type: 'spring',
                                stiffness: 280,
                                damping: 20,
                            }}
                            onClick={(e) => e.stopPropagation()}
                            className={`relative w-full max-w-sm rounded-3xl border-2 p-6 overflow-hidden ${
                                drawResult.totalPayout > 0
                                    ? 'border-amber-500/50'
                                    : 'border-white/[0.1]'
                            }`}
                            style={{
                                background:
                                    'linear-gradient(135deg, #14110a 0%, #0a0a12 60%, #080814 100%)',
                            }}
                        >
                            <button
                                onClick={() => {
                                    soundEngine.click();
                                    setDrawResult(null);
                                }}
                                className='absolute top-3 right-3 text-slate-500 hover:text-slate-300'
                                aria-label={t('common.close')}
                            >
                                <X size={18} />
                            </button>

                            <div className='text-center mb-4'>
                                <div
                                    className={`inline-flex p-4 rounded-2xl mb-3 ${
                                        drawResult.totalPayout > 0
                                            ? 'bg-amber-500/10 border border-amber-500/25 text-amber-400'
                                            : 'bg-white/[0.04] border border-white/[0.08] text-slate-400'
                                    }`}
                                >
                                    {drawResult.totalPayout > 0 ? (
                                        <Trophy size={36} />
                                    ) : (
                                        <Award size={36} />
                                    )}
                                </div>
                                <h2
                                    className={`text-2xl font-black ${drawResult.totalPayout > 0 ? 'text-amber-400' : 'text-slate-300'}`}
                                >
                                    {drawResult.totalPayout > 0
                                        ? t('keno.youWon')
                                        : t('keno.noLuck')}
                                </h2>
                                <p className='text-[11px] text-slate-500 mt-0.5'>
                                    {drawResult.totalPayout > 0
                                        ? t('keno.drawHash', {
                                              id: drawResult.drawId.slice(-6),
                                          })
                                        : t('keno.betterLuckNextTime')}
                                </p>
                                {drawResult.totalPayout > 0 && (
                                    <div className='mt-3 inline-block bg-emerald-500/10 border border-emerald-500/25 rounded-2xl px-5 py-2'>
                                        <span className='block text-[9px] font-black uppercase tracking-widest text-emerald-600'>
                                            {t('keno.totalWin')}
                                        </span>
                                        <span className='text-2xl font-black text-emerald-400 font-mono'>
                                            +
                                            {formatCreditsFull(
                                                drawResult.totalPayout,
                                            )}
                                        </span>
                                    </div>
                                )}
                            </div>

                            <div className='space-y-2 border-t border-white/[0.06] pt-3 max-h-[40vh] overflow-y-auto'>
                                {drawResult.userTickets.map((tk) => {
                                    const hits = tk.selectedNumbers.filter(
                                        (n) =>
                                            drawResult.drawnNumbers.includes(n),
                                    );
                                    return (
                                        <div
                                            key={tk.id}
                                            className='rounded-xl bg-black/30 border border-white/[0.05] p-3 flex flex-col gap-2'
                                        >
                                            <div className='text-xs'>
                                                <span className='font-bold text-slate-300'>
                                                    {t('keno.spotLabel', {
                                                        count: tk
                                                            .selectedNumbers
                                                            .length,
                                                    })}
                                                </span>
                                                <span className='text-slate-500 ml-2'>
                                                    {t('keno.matchCount', {
                                                        count: tk.matches,
                                                    })}
                                                    {hits.length > 0 && (
                                                        <span className='text-amber-400 ml-1'>
                                                            ({hits.join(', ')})
                                                        </span>
                                                    )}
                                                </span>
                                            </div>
                                            <div className='flex gap-1 flex-wrap'>
                                                {tk.selectedNumbers.map((n) => (
                                                    <span
                                                        key={n}
                                                        className={`w-6 h-6 rounded-full font-bold flex items-center justify-center text-[10px] ${
                                                            hits.includes(n)
                                                                ? 'bg-emerald-500 text-black'
                                                                : 'bg-white/[0.06] text-slate-500'
                                                        }`}
                                                    >
                                                        {n}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>

                            <button
                                onClick={() => {
                                    soundEngine.click();
                                    setDrawResult(null);
                                }}
                                className='btn btn-primary btn-full mt-4 flex items-center justify-center gap-2'
                            >
                                <RotateCcw size={15} /> {t('keno.playAgain')}
                            </button>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Paytable + Tickets  side by side, like the reference layout */}
            <div className='grid grid-cols-2 gap-3'>
                <div className='card'>
                    <div className='flex items-center justify-between mb-2'>
                        <span className='text-[10px] font-black uppercase tracking-widest text-indigo-400'>
                            {t('keno.paytable')}
                        </span>
                        {currentSpots > 0 && (
                            <span className='badge badge-violet'>
                                {currentSpots}P
                            </span>
                        )}
                    </div>
                    {isDrawingOrSettled ? (
                        <div className='space-y-2'>
                            <div className='flex justify-between items-center'>
                                <span className='text-[10px] font-bold text-slate-500 uppercase'>
                                    {t('keno.best')}
                                </span>
                                <span className='text-sm font-black text-amber-400 font-mono'>
                                    {formatCredits(bestPayout)}
                                </span>
                            </div>
                            <div className='flex justify-between items-center'>
                                <span className='text-[10px] font-bold text-slate-500 uppercase'>
                                    {t('keno.now')}
                                </span>
                                <span
                                    className={`text-sm font-black font-mono ${nowPayout > 0 ? 'text-emerald-400' : 'text-slate-500'}`}
                                >
                                    +{formatCredits(nowPayout)}
                                </span>
                            </div>
                        </div>
                    ) : paytableRows.length === 0 ? (
                        <div className='text-center text-slate-500 text-xs py-6'>
                            {t('keno.selectNumbersHint')}
                        </div>
                    ) : (
                        <div className='space-y-1 max-h-40 overflow-y-auto pr-1'>
                            {paytableRows.map((row) => (
                                <div
                                    key={row.matches}
                                    className='flex justify-between text-[11px]'
                                >
                                    <span className='text-slate-400'>
                                        {t('keno.hitsLabel', {
                                            count: row.matches,
                                        })}
                                    </span>
                                    <span
                                        className={
                                            row.multiplier
                                                ? 'text-amber-400 font-black'
                                                : 'text-slate-600'
                                        }
                                    >
                                        {row.multiplier
                                            ? formatCredits(
                                                  row.multiplier *
                                                      representativeStake,
                                              )
                                            : '—'}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div className='card'>
                    <div className='flex items-center justify-between mb-2'>
                        <span className='text-[10px] font-black uppercase tracking-widest text-indigo-400'>
                            {t('keno.ticketsLabel')}
                        </span>
                        <span className='badge badge-violet'>
                            {ticketRows.length}/{MAX_TICKETS_PER_DRAW}
                        </span>
                    </div>
                    {ticketRows.length === 0 ? (
                        <div className='text-center text-slate-500 text-xs py-6'>
                            {t('keno.addPicksHint')}
                        </div>
                    ) : (
                        <div className='space-y-1.5 max-h-40 overflow-y-auto pr-1'>
                            {ticketRows.map((row, idx) => (
                                <div
                                    key={row.key}
                                    className='flex items-center gap-1 rounded-lg bg-white/[0.03] border border-white/[0.06] px-1.5 py-1'
                                >
                                    <span className='text-[9px] font-black text-slate-500 w-3.5 flex-shrink-0'>
                                        {idx + 1}
                                    </span>
                                    <div className='flex flex-wrap gap-0.5 flex-1 min-w-0'>
                                        {row.selectedNumbers.map((n) => (
                                            <span
                                                key={n}
                                                className='inline-flex items-center justify-center w-4 h-4 rounded-full bg-[var(--gold)]/15 text-amber-300 text-[8px] font-black'
                                            >
                                                {n}
                                            </span>
                                        ))}
                                    </div>
                                    <span className='text-[9px] font-black text-amber-400 flex-shrink-0'>
                                        {formatCredits(row.stakeMinor)}
                                    </span>
                                    {row.removable && row.localId && (
                                        <button
                                            onClick={() =>
                                                handleRemoveCartItem(
                                                    row.localId!,
                                                )
                                            }
                                            className='text-slate-500 hover:text-red-400 flex-shrink-0'
                                            aria-label={t('keno.removeTicket')}
                                        >
                                            <X size={11} />
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                    <div className='flex justify-between items-center mt-2 pt-2 border-t border-white/[0.06] text-[11px]'>
                        <span className='text-slate-500 font-bold'>
                            {gameState === 'celebrating' ||
                            gameState === 'finished'
                                ? t('keno.totalWin')
                                : t('keno.totalBet')}
                        </span>
                        <span
                            className={`font-black font-mono ${
                                gameState === 'celebrating' ||
                                gameState === 'finished'
                                    ? drawResult && drawResult.totalPayout > 0
                                        ? 'text-emerald-400'
                                        : 'text-slate-400'
                                    : 'text-amber-400'
                            }`}
                        >
                            {formatCredits(
                                gameState === 'celebrating' ||
                                    gameState === 'finished'
                                    ? (drawResult?.totalPayout ?? 0)
                                    : hasSubmittedForDraw
                                      ? currentDrawTickets.reduce(
                                            (s, tk) => s + tk.stakeMinor,
                                            0,
                                        )
                                      : totalCartStake,
                            )}{' '}
                            ETB
                        </span>
                    </div>
                </div>
            </div>

            {/* Number grid card */}
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className='card relative'
            >
                <div
                    className='absolute inset-0 pointer-events-none rounded-[var(--radius-lg)]'
                    style={{
                        background:
                            'radial-gradient(ellipse at 50% -10%, rgba(245,158,11,0.04) 0%, transparent 60%)',
                    }}
                />

                <div className='mb-3 flex items-center justify-between'>
                    <label className='text-[10px] font-black uppercase tracking-widest text-slate-400'>
                        {hasSubmittedForDraw
                            ? t('keno.ticketsLockedLabel')
                            : t('keno.pickNumbersLabel', {
                                  count: selectedNumbers.length,
                                  max: maxSpot,
                              })}
                    </label>
                </div>

                {/* Result banner  inline over the grid, mirrors the reference app */}
                <AnimatePresence>
                    {drawResult && (
                        <motion.div
                            initial={{ opacity: 0, y: -8 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0 }}
                            className='mb-3 text-center'
                        >
                            <span
                                className={`inline-block text-lg font-black uppercase tracking-widest ${
                                    drawResult.totalPayout > 0
                                        ? 'text-emerald-400'
                                        : 'text-red-400/90'
                                }`}
                            >
                                {drawResult.totalPayout > 0
                                    ? t('keno.youWon')
                                    : t('keno.noLuck')}
                            </span>
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* Grid */}
                <div className='relative'>
                    <div
                        className={`grid grid-cols-10 gap-1 sm:gap-1.5 mb-4 ${gridLocked && !drawResult ? 'opacity-90' : ''}`}
                    >
                        {numbers.map((value) => (
                            <KenoTile
                                key={value}
                                value={value}
                                state={getTileState(
                                    value,
                                    highlightNumbers,
                                    revealedNumbers,
                                    drawComplete,
                                )}
                                onClick={() => toggleNumber(value)}
                                disabled={gridLocked}
                            />
                        ))}
                    </div>
                </div>

                {/* Bet stepper */}
                {!hasSubmittedForDraw && !autoPlayEnabled && (
                    <div className='flex items-center gap-2 mb-3'>
                        <div className='flex-1 flex items-center gap-2 rounded-xl bg-black/30 border border-white/[0.07] px-2 py-1.5'>
                            <button
                                type='button'
                                onClick={() => adjustBet(-betStep)}
                                disabled={gridLocked}
                                className='w-7 h-7 rounded-lg bg-white/[0.05] text-slate-300 font-black text-lg flex items-center justify-center disabled:opacity-40'
                                aria-label='decrease'
                            >
                                −
                            </button>
                            <div className='flex-1 text-center'>
                                <div className='text-lg font-black text-white font-mono leading-none'>
                                    {betAmount}
                                </div>
                                <div className='text-[8px] text-slate-500 tracking-widest'>
                                    ETB
                                </div>
                            </div>
                            <button
                                type='button'
                                onClick={() => adjustBet(betStep)}
                                disabled={gridLocked}
                                className='w-7 h-7 rounded-lg bg-white/[0.05] text-slate-300 font-black text-lg flex items-center justify-center disabled:opacity-40'
                                aria-label='increase'
                            >
                                +
                            </button>
                        </div>
                        <button
                            onClick={doubleBet}
                            disabled={gridLocked}
                            className='btn btn-ghost btn-sm px-3 disabled:opacity-40'
                        >
                            X2
                        </button>
                        <button
                            onClick={maxBet}
                            disabled={gridLocked}
                            className='btn btn-ghost btn-sm px-3 disabled:opacity-40'
                        >
                            {t('keno.max')}
                        </button>
                    </div>
                )}

                {/* Action row  Clear / Quick Pick / +Bet */}
                {!hasSubmittedForDraw && !autoPlayEnabled && (
                    <div className='flex gap-2 mb-3'>
                        <button
                            onClick={handleClearSelection}
                            disabled={
                                gridLocked || selectedNumbers.length === 0
                            }
                            className='btn btn-ghost btn-sm flex-1'
                        >
                            <Trash2 size={13} /> {t('keno.clear')}
                        </button>
                        <button
                            onClick={handleQuickPick}
                            disabled={gridLocked}
                            className='btn btn-ghost btn-sm flex-1'
                        >
                            <Zap size={13} /> {t('keno.quickPick')}
                        </button>
                        <button
                            onClick={handleAddToCart}
                            disabled={
                                gridLocked ||
                                selectedNumbers.length === 0 ||
                                cart.length >= MAX_TICKETS_PER_DRAW
                            }
                            className='btn btn-primary btn-sm flex-1'
                        >
                            {t('keno.addBet')}
                        </button>
                    </div>
                )}

                {/* Start / Auto-play status */}
                {!autoPlayEnabled ? (
                    hasSubmittedForDraw ? (
                        <div className='rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-center'>
                            <p className='text-sm font-black text-emerald-400'>
                                {t('keno.ticketsActive', {
                                    count: currentDrawTickets.length,
                                })}
                            </p>
                            <p className='text-[11px] text-slate-400 mt-0.5'>
                                {drawOpen
                                    ? t('keno.waitingForDraw')
                                    : t('keno.numbersLocked')}
                            </p>
                        </div>
                    ) : (
                        <motion.button
                            whileHover={
                                cart.length > 0 && drawOpen
                                    ? { scale: 1.02 }
                                    : {}
                            }
                            whileTap={{ scale: 0.97 }}
                            onClick={handleStart}
                            disabled={
                                submitting ||
                                !drawOpen ||
                                cart.length === 0 ||
                                insufficientForCart
                            }
                            className={`btn btn-full ${
                                cart.length > 0 && drawOpen && !insufficientForCart
                                    ? 'btn-primary'
                                    : 'btn-secondary opacity-50'
                            }`}
                        >
                            {submitting
                                ? t('keno.processingLabel')
                                : !drawOpen
                                  ? t('keno.drawLockedRunning')
                                  : insufficientForCart
                                    ? t('keno.lowBalance')
                                    : cart.length === 0
                                      ? t('keno.start')
                                      : t('keno.startWithCount', {
                                            count: cart.length,
                                            amount: formatCredits(
                                                totalCartStake,
                                            ),
                                        })}
                        </motion.button>
                    )
                ) : (
                    <div className='rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 flex items-center justify-between'>
                        <div className='text-xs text-slate-300'>
                            {t('keno.autoPlayLabel')}{' '}
                            <strong className='text-amber-400'>
                                {autoPlayRoundsRemaining}
                            </strong>{' '}
                            {t('keno.roundsLeft')}
                            <span
                                className={`ml-2 ${autoPlayStats.netProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}
                            >
                                ({autoPlayStats.netProfit >= 0 ? '+' : ''}
                                {autoPlayStats.netProfit} Cr)
                            </span>
                        </div>
                        <button
                            onClick={handleStopAutoPlay}
                            className='btn btn-danger btn-sm'
                        >
                            <Pause size={12} fill='currentColor' />{' '}
                            {t('keno.stop')}
                        </button>
                    </div>
                )}
            </motion.div>

            {/* Auto Play  collapsible */}
            <CollapsibleSection title={t('keno.autoPlayTitle')}>
                {!autoPlayEnabled ? (
                    <div className='space-y-3'>
                        <div>
                            <div className='flex justify-between text-[10px] text-slate-400 mb-1.5'>
                                <span>{t('keno.rounds')}</span>
                                <strong className='text-amber-400'>
                                    {autoPlayRounds}
                                </strong>
                            </div>
                            <input
                                type='range'
                                min='5'
                                max='100'
                                step='5'
                                value={autoPlayRounds}
                                onChange={(e) =>
                                    setAutoPlayRounds(parseInt(e.target.value))
                                }
                                className='w-full accent-amber-500 cursor-pointer h-1 rounded'
                            />
                        </div>
                        <div className='grid grid-cols-2 gap-2'>
                            {[
                                {
                                    label: t('keno.stopProfit'),
                                    key: 'profit',
                                    value: autoPlayStopProfit,
                                    setter: setAutoPlayStopProfit,
                                },
                                {
                                    label: t('keno.stopLoss'),
                                    key: 'loss',
                                    value: autoPlayStopLoss,
                                    setter: setAutoPlayStopLoss,
                                },
                            ].map(({ label, key, value, setter }) => (
                                <div key={key}>
                                    <span className='block text-[9px] text-slate-500 font-bold uppercase mb-1'>
                                        {label}
                                    </span>
                                    <input
                                        type='number'
                                        placeholder={t('keno.optional')}
                                        value={value}
                                        onChange={(e) => setter(e.target.value)}
                                        className='input text-xs py-1.5 px-2'
                                    />
                                </div>
                            ))}
                        </div>
                        <button
                            onClick={handleStartAutoPlay}
                            className='btn btn-primary btn-full btn-sm'
                        >
                            <Play size={13} fill='currentColor' />{' '}
                            {t('keno.startAutoPlay')}
                        </button>
                    </div>
                ) : (
                    <div className='text-center text-slate-400 text-sm'>
                        {t('keno.autoPlayActive', {
                            count: autoPlayRoundsRemaining,
                        })}
                    </div>
                )}
            </CollapsibleSection>

            {/* History  tabbed: Recent Draws / My Tickets */}
            <div className='card'>
                <div className='flex gap-1 p-1 mb-3 rounded-xl bg-white/[0.03] border border-white/[0.05]'>
                    {(
                        [
                            ['draws', t('keno.recentDraws')],
                            [
                                'tickets',
                                t('keno.myTickets', { count: tickets.length }),
                            ],
                        ] as const
                    ).map(([key, label]) => (
                        <button
                            key={key}
                            onClick={() => {
                                soundEngine.click();
                                setBottomTab(key);
                            }}
                            className={`flex-1 py-2 text-xs font-black rounded-lg transition-all ${
                                bottomTab === key
                                    ? 'bg-[var(--gold)] text-black'
                                    : 'text-slate-400 hover:text-amber-400'
                            }`}
                        >
                            {label}
                        </button>
                    ))}
                </div>

                {bottomTab === 'draws' ? (
                    draws.length === 0 ? (
                        <div className='text-center text-slate-500 text-sm py-4'>
                            {t('keno.noDrawsYet')}
                        </div>
                    ) : (
                        <div className='space-y-3'>
                            {draws.slice(0, 5).map((draw) => {
                                const drawTickets =
                                    ticketsByDrawId.get(draw.id) ?? [];
                                const userPicks = [
                                    ...new Set(
                                        drawTickets.flatMap(
                                            (tk) => tk.selectedNumbers,
                                        ),
                                    ),
                                ].sort((a, b) => a - b);
                                return (
                                    <article
                                        key={draw.id}
                                        className='rounded-xl bg-white/[0.025] border border-white/[0.06] p-3 space-y-2'
                                    >
                                        <div className='flex justify-between items-center'>
                                            <div>
                                                <h4 className='text-xs font-extrabold text-slate-200'>
                                                    {t('keno.drawHash', {
                                                        id: draw.id.slice(-6),
                                                    })}
                                                </h4>
                                                <span className='text-[10px] text-slate-500'>
                                                    {formatDateTime(
                                                        draw.scheduledAt,
                                                    )}
                                                </span>
                                            </div>
                                            <span
                                                className={
                                                    draw.status === 'settled'
                                                        ? 'badge badge-green'
                                                        : draw.status ===
                                                            'cancelled'
                                                          ? 'badge badge-red'
                                                          : 'badge badge-violet'
                                                }
                                            >
                                                {draw.status}
                                            </span>
                                        </div>
                                        {userPicks.length > 0 && (
                                            <div className='flex flex-wrap gap-1'>
                                                {userPicks.map((p) => (
                                                    <span
                                                        key={p}
                                                        className={`w-5 h-5 rounded-full font-bold flex items-center justify-center text-[9px] ${
                                                            draw.drawnNumbers.includes(
                                                                p,
                                                            )
                                                                ? 'bg-emerald-500 text-black'
                                                                : 'bg-white/[0.06] text-slate-500'
                                                        }`}
                                                    >
                                                        {p}
                                                    </span>
                                                ))}
                                            </div>
                                        )}
                                        <div className='flex flex-wrap gap-0.5'>
                                            {draw.drawnNumbers.map((n) => (
                                                <span
                                                    key={n}
                                                    className={`w-5 h-5 rounded-full font-mono text-[9px] flex items-center justify-center ${
                                                        userPicks.includes(n)
                                                            ? 'bg-emerald-500 text-black'
                                                            : 'bg-white/[0.05] text-slate-500'
                                                    }`}
                                                >
                                                    {n}
                                                </span>
                                            ))}
                                        </div>
                                    </article>
                                );
                            })}
                        </div>
                    )
                ) : tickets.length === 0 ? (
                    <div className='text-center text-slate-500 text-sm py-4'>
                        {t('keno.noTicketsYet')}
                    </div>
                ) : (
                    <div className='space-y-3'>
                        {tickets.map((tk) => {
                            const settled = tk.settlementStatus === 'settled';
                            const won = tk.payoutMinor > 0;
                            const draw = draws.find((d) => d.id === tk.drawId);
                            const drawnNums = draw?.drawnNumbers ?? [];
                            return (
                                <article
                                    key={tk.id}
                                    className='rounded-xl bg-white/[0.025] border border-white/[0.06] p-3 flex justify-between gap-3'
                                >
                                    <div className='space-y-1.5 min-w-0'>
                                        <div className='flex items-center gap-2'>
                                            <span className='text-xs font-extrabold text-slate-200'>
                                                #{tk.id.slice(-6)}
                                            </span>
                                            <span className='text-[10px] text-slate-500'>
                                                {t('keno.drawHash', {
                                                    id: tk.drawId.slice(-6),
                                                })}
                                            </span>
                                        </div>
                                        <div className='flex flex-wrap gap-1'>
                                            {tk.selectedNumbers.map((n) => {
                                                const isHit =
                                                    settled &&
                                                    drawnNums.includes(n);
                                                return (
                                                    <span
                                                        key={n}
                                                        className={`w-5 h-5 rounded-full font-bold flex items-center justify-center text-[9px] ${
                                                            isHit
                                                                ? 'bg-emerald-500 text-black'
                                                                : 'bg-white/[0.06] border border-white/[0.08] text-slate-400'
                                                        }`}
                                                    >
                                                        {n}
                                                    </span>
                                                );
                                            })}
                                        </div>
                                    </div>
                                    <div className='flex flex-col items-end gap-1 flex-shrink-0'>
                                        <span
                                            className={`badge ${won ? 'badge-green' : settled ? 'text-slate-500 bg-white/[0.03] border border-white/[0.07]' : 'badge-gold'}`}
                                        >
                                            {won
                                                ? t('keno.won')
                                                : settled
                                                  ? t('keno.noWin')
                                                  : t('keno.pending')}
                                        </span>
                                        {won && (
                                            <span className='text-xs font-black text-emerald-400'>
                                                +{formatCredits(tk.payoutMinor)}
                                            </span>
                                        )}
                                    </div>
                                </article>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
