import React, {
    memo,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
    motion,
    AnimatePresence,
    useMotionValue,
    useSpring,
} from 'framer-motion';
import {
    ChevronRight,
    HelpCircle,
    Clock,
    TrendingUp,
    Zap,
    Target,
    Trophy,
    Circle,
    Shield,
    Headphones,
    type LucideIcon,
} from 'lucide-react';
import { useStore } from '../store/useStore';
import { bingoApi, kenoApi, walletApi } from '../lib/api';
import type { KenoDraw, LedgerEntry, RecentWin } from '../lib/models';
import type { AppTab } from '../lib/navigation';
import { soundEngine } from '../lib/audio';
import { getSocket } from '../hooks/useSocketConnection';
import { ETHIOPIA_TZ, formatOnlineCount } from '../lib/utils';
import { requestOpenDeposit } from '../lib/walletIntent';

type Props = { onNavigate: (tab: AppTab) => void };

type GameCode = 'keno' | 'bingo' | 'crash' | 'pool' | 'werk';
// Fixed priority order for the Home "Play Now" strip. The rotating window walks
// this list, so all enabled games get a turn in the featured pair over reloads.
const HOME_GAME_ORDER: GameCode[] = ['bingo', 'keno', 'crash', 'pool', 'werk'];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function timeGreeting(t: TFunction): string {
    // Greeting follows Ethiopia time, not the device's timezone.
    const h = Number(
        new Intl.DateTimeFormat('en-GB', {
            timeZone: ETHIOPIA_TZ,
            hour: '2-digit',
            hourCycle: 'h23',
        }).format(new Date()),
    );
    if (h < 12) return t('home.morning');
    if (h < 17) return t('home.afternoon');
    return t('home.evening');
}

// Ledger entryType/sourceType → i18n key under `ledger.*`.
const LEDGER_KEY: Record<string, string> = {
    ticket_win: 'winnings',
    win: 'winnings',
    ticket_purchase: 'ticketPurchase',
    stake: 'ticketPurchase',
    ticket_refund: 'ticketRefund',
    refund: 'refund',
    deposit: 'deposit',
    withdrawal: 'withdrawal',
    bonus: 'bonus',
    admin_adjustment: 'adjustment',
    agent_receipt: 'agentTransfer',
};

const FAQ_KEYS = ['currency', 'deposit', 'withdraw', 'instant'] as const;

function useCountdownSecs(targetIso: string | null | undefined) {
    const [secs, setSecs] = useState<number | null>(null);
    useEffect(() => {
        if (!targetIso) {
            setSecs(null);
            return;
        }
        const tick = () => {
            const ms = new Date(targetIso).getTime() - Date.now();
            setSecs(ms > 0 ? Math.floor(ms / 1000) : 0);
        };
        tick();
        const id = setInterval(tick, 1000);
        return () => clearInterval(id);
    }, [targetIso]);
    if (secs === null) return null;
    if (secs <= 0) return 'Starting…';
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return m > 0 ? `${m}m ${String(s).padStart(2, '0')}s` : `${s}s`;
}

function useAnimatedNumber(target: number) {
    const mv = useMotionValue(target);
    const spring = useSpring(mv, { stiffness: 80, damping: 18, mass: 0.8 });
    const [display, setDisplay] = useState(target);
    useEffect(() => {
        mv.set(target);
    }, [target, mv]);
    useEffect(
        () => spring.on('change', (v) => setDisplay(Math.round(v))),
        [spring],
    );
    return display;
}

// ─── Live wins ticker ─────────────────────────────────────────────────────────

function LiveWinsTicker({ wins }: { wins: RecentWin[] }) {
    const { t } = useTranslation();
    // Duplicate for seamless CSS loop  need enough items to fill viewport twice
    const items = wins.length > 0 ? [...wins, ...wins] : [];

    if (items.length === 0) return null;

    return (
        <div
            className='ticker-wrap'
            style={{
                borderRadius: 10,
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                padding: '6px 0',
            }}
        >
            <div className='ticker-inner'>
                {items.map((w, i) => (
                    <span key={i} className='ticker-item'>
                        <Trophy
                            size={11}
                            style={{ color: 'var(--gold)', flexShrink: 0 }}
                        />
                        <span className='ticker-item-name'>
                            {w.displayName}
                        </span>
                        <span
                            style={{ color: 'var(--text-muted)', fontSize: 10 }}
                        >
                            {t('home.won')}
                        </span>
                        <span className='ticker-item-win'>
                            {new Intl.NumberFormat().format(w.amountMinor)} ETB
                        </span>
                        <span
                            style={{ color: 'var(--text-muted)', fontSize: 10 }}
                        >
                            {t('home.on')} {w.game}
                        </span>
                        <span
                            style={{
                                color: 'rgba(255,255,255,0.1)',
                                margin: '0 4px',
                            }}
                        >
                            •
                        </span>
                    </span>
                ))}
            </div>
        </div>
    );
}

// ─── Trust messages ticker ──────────────────────────────────────────────────────

// Shown in the exact spot LiveWinsTicker would occupy when the admin has the
// real-wins ticker toggled off  never fabricated wins/players, only honest,
// always-true platform facts (no conditional claims like the welcome bonus,
// which has its own on/off toggle).
const TRUST_MESSAGES: Array<{ Icon: LucideIcon; key: string }> = [
    { Icon: Shield, key: 'home.trustFair' },
    { Icon: Zap, key: 'home.trustFastPayouts' },
    { Icon: Headphones, key: 'home.trustSupport' },
];

function TrustMessagesTicker() {
    const { t } = useTranslation();
    const items = [...TRUST_MESSAGES, ...TRUST_MESSAGES];
    return (
        <div
            className='ticker-wrap'
            style={{
                borderRadius: 10,
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                padding: '6px 0',
            }}
        >
            <div className='ticker-inner'>
                {items.map(({ Icon, key }, i) => (
                    <span key={i} className='ticker-item'>
                        <Icon
                            size={11}
                            style={{ color: 'var(--accent)', flexShrink: 0 }}
                        />
                        <span className='ticker-item-name'>{t(key)}</span>
                        <span
                            style={{
                                color: 'rgba(255,255,255,0.1)',
                                margin: '0 4px',
                            }}
                        >
                            •
                        </span>
                    </span>
                ))}
            </div>
        </div>
    );
}

// ─── Pool waiting marquee ──────────────────────────────────────────────────────

// Advertises that a player is sitting in the Pool queue so others can hop in and
// match them. Rendered only while at least one player is actually waiting; tapping
// it jumps straight to the Pool tab.
function PoolWaitingTicker({
    count,
    onGo,
}: {
    count: number;
    onGo: () => void;
}) {
    const { t } = useTranslation();
    if (count <= 0) return null;
    const msg =
        count === 1
            ? t('home.poolWaitingOne')
            : t('home.poolWaiting', { count });
    const items = Array.from({ length: 6 });
    return (
        <button
            onClick={onGo}
            className='ticker-wrap'
            style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                cursor: 'pointer',
                color: 'inherit',
                borderRadius: 10,
                padding: '6px 0',
                background: 'rgba(234,179,8,0.10)',
                border: '1px solid rgba(234,179,8,0.28)',
            }}
        >
            <div className='ticker-inner'>
                {items.map((_, i) => (
                    <span
                        key={i}
                        className='ticker-item'
                        style={{ color: 'var(--gold)' }}
                    >
                        <span
                            className='ticker-item-name'
                            style={{ fontWeight: 700 }}
                        >
                            {msg}
                        </span>
                        <span
                            style={{
                                color: 'rgba(234,179,8,0.35)',
                                margin: '0 10px',
                            }}
                        >
                            •
                        </span>
                    </span>
                ))}
            </div>
        </button>
    );
}

// ─── FAQ ─────────────────────────────────────────────────────────────────────

const FaqItem = memo(function FaqItem({ q, a }: { q: string; a: string }) {
    const [open, setOpen] = React.useState(false);
    return (
        <div className={`rule-item${open ? ' open' : ''}`}>
            <button
                className='rule-question'
                onClick={() => setOpen((v) => !v)}
            >
                <span>{q}</span>
                <motion.span
                    animate={{ rotate: open ? 90 : 0 }}
                    transition={{ duration: 0.18 }}
                >
                    <ChevronRight size={14} />
                </motion.span>
            </button>
            <AnimatePresence initial={false}>
                {open && (
                    <motion.p
                        className='rule-answer'
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        style={{ overflow: 'hidden', margin: 0 }}
                    >
                        {a}
                    </motion.p>
                )}
            </AnimatePresence>
        </div>
    );
});

function entryBadge(entry: LedgerEntry) {
    const type = (entry.entryType ?? entry.sourceType ?? '') as string;
    if (type === 'win' || type === 'ticket_win')
        return { emoji: '🏆', cls: 'activity-badge-bingo' };
    if (type === 'stake' || type === 'ticket_purchase')
        return { emoji: '🎟️', cls: 'activity-badge-keno' };
    if (type === 'deposit') return { emoji: '💰', cls: 'activity-badge-bingo' };
    if (type === 'withdrawal')
        return { emoji: '💸', cls: 'activity-badge-keno' };
    if (type === 'refund' || type === 'ticket_refund')
        return { emoji: '↩️', cls: 'activity-badge-keno' };
    return { emoji: '📋', cls: 'activity-badge-keno' };
}

// ─── Game Card ────────────────────────────────────────────────────────────────

function GameCard({
    onClick,
    gradientFrom,
    gradientTo,
    glowColor,
    icon,
    tag,
    name,
    sub,
    badge,
    badgeColor,
}: {
    onClick: () => void;
    gradientFrom: string;
    gradientTo: string;
    glowColor: string;
    icon: React.ReactNode;
    tag: string;
    name: string;
    sub: React.ReactNode;
    badge?: string;
    badgeColor?: string;
}) {
    return (
        <motion.button
            onClick={onClick}
            className='lobby-card'
            whileHover={{ scale: 1.02, y: -3 }}
            whileTap={{ scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 380, damping: 22 }}
            style={{
                background: `linear-gradient(145deg, ${gradientFrom} 0%, ${gradientTo} 100%)`,
            }}
        >
            <div
                className='lobby-card-overlay'
                style={{
                    background: `radial-gradient(ellipse at 80% 20%, ${glowColor} 0%, transparent 65%)`,
                }}
            />

            {badge && (
                <span
                    className='lobby-card-badge'
                    style={{
                        background: badgeColor ?? 'rgba(245,158,11,0.2)',
                        color: 'var(--gold)',
                        border: `1px solid ${badgeColor ?? 'rgba(245,158,11,0.3)'}`,
                    }}
                >
                    {badge}
                </span>
            )}

            {/* Icon */}
            <div
                style={{
                    position: 'absolute',
                    top: 12,
                    left: 14,
                    fontSize: 28,
                    zIndex: 1,
                    filter: `drop-shadow(0 0 12px ${glowColor})`,
                }}
            >
                {icon}
            </div>

            <div style={{ position: 'relative', zIndex: 1 }}>
                <div className='lobby-card-sub'>{tag}</div>
                <div className='lobby-card-name'>{name}</div>
                <div
                    style={{
                        fontSize: 10,
                        color: 'rgba(255,255,255,0.45)',
                        marginTop: 3,
                        fontWeight: 600,
                    }}
                >
                    {sub}
                </div>
            </div>
        </motion.button>
    );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function Home({ onNavigate }: Props) {
    const { t } = useTranslation();
    const user = useStore((s) => s.user);
    const wallet = useStore((s) => s.wallet);
    const liveCounts = useStore((s) => s.liveCounts);
    const gameCatalog = useStore((s) => s.gameCatalog);
    const addToast = useStore((s) => s.addToast);
    const gameInfo = (code: GameCode) => {
        if (!gameCatalog) return { hidden: false, maint: false, msg: '' };
        const e = gameCatalog.find((g) => g.code === code);
        if (!e) return { hidden: true, maint: false, msg: '' };
        return {
            hidden: e.state === 'hidden',
            maint: e.state === 'maintenance',
            msg: e.maintenanceMessage || `${e.name} is under maintenance.`,
        };
    };
    const openGame = (
        code: GameCode,
        info: { maint: boolean; msg: string },
    ) => {
        soundEngine.click();
        if (info.maint) {
            addToast('info', info.msg);
            return;
        }
        onNavigate(code);
    };
    const [activeDraw, setActiveDraw] = useState<KenoDraw | null>(null);
    const [recentActivity, setRecentActivity] = useState<LedgerEntry[]>([]);
    const [recentWins, setRecentWins] = useState<RecentWin[]>([]);
    const [winsEnabled, setWinsEnabled] = useState(false);

    const loadRecentWins = useCallback(() => {
        walletApi
            .getRecentWins(20)
            .then((res) => {
                setWinsEnabled(res.enabled);
                setRecentWins(res.wins);
            })
            .catch(() => {});
    }, []);

    // Keno's live draw indicator obeys its catalog state (like the cards do).
    const keno = gameInfo('keno');

    useEffect(() => {
        walletApi
            .getLedger(5)
            .then((entries) => setRecentActivity(entries))
            .catch(() => {});
        loadRecentWins();
    }, [loadRecentWins]);

    // Only poll/show Keno's live draw when Keno is actually available. When it's
    // hidden or under maintenance, clear it so no stale "Keno starting" pill shows.
    useEffect(() => {
        if (keno.hidden || keno.maint) {
            setActiveDraw(null);
            return;
        }
        kenoApi
            .getActiveDraw()
            .then((d) => setActiveDraw(d))
            .catch(() => {});
    }, [keno.hidden, keno.maint]);

    // Refresh wins ticker when draws/rooms complete
    useEffect(() => {
        const socket = getSocket();
        if (!socket) return;
        const refresh = () => loadRecentWins();
        socket.on('keno.draw.completed', refresh);
        socket.on('bingo.room.completed', refresh);
        return () => {
            socket.off('keno.draw.completed', refresh);
            socket.off('bingo.room.completed', refresh);
        };
    }, [loadRecentWins]);

    // The "playing" pill shows cartelas actually bought in the live Bingo room,
    // not a generic connection count  a real signal of how much action is
    // happening right now, kept live via the same room-update/draw events the
    // Bingo screen itself listens to.
    const [bingoCartelas, setBingoCartelas] = useState(0);
    const loadBingoCartelas = useCallback(() => {
        bingoApi
            .getCurrentRoom()
            .then((room) => setBingoCartelas(room?.soldTickets ?? 0))
            .catch(() => {});
    }, []);
    useEffect(() => {
        loadBingoCartelas();
    }, [loadBingoCartelas]);
    useEffect(() => {
        const socket = getSocket();
        if (!socket) return;
        socket.on('bingo.room.updated', loadBingoCartelas);
        socket.on('bingo.number.drawn', loadBingoCartelas);
        socket.on('bingo.room.completed', loadBingoCartelas);
        return () => {
            socket.off('bingo.room.updated', loadBingoCartelas);
            socket.off('bingo.number.drawn', loadBingoCartelas);
            socket.off('bingo.room.completed', loadBingoCartelas);
        };
    }, [loadBingoCartelas]);

    const countdown = useCountdownSecs(
        activeDraw?.status === 'open' ? activeDraw.scheduledAt : null,
    );

    const balance = wallet?.availableMinor ?? 0;
    const animatedBalance = useAnimatedNumber(balance);
    const formattedBalance = new Intl.NumberFormat().format(animatedBalance);
    const prevBalanceRef = useRef(balance);
    const [balanceKey, setBalanceKey] = useState(0);

    useEffect(() => {
        if (prevBalanceRef.current !== balance) {
            setBalanceKey((k) => k + 1);
            prevBalanceRef.current = balance;
        }
    }, [balance]);

    // ── Featured "Play Now" pair ───────────────────────────────────────────────
    // Catalog-driven (not hardcoded to Keno+Bingo): take every enabled game, then
    // show a rotating window of two so all enabled games get exposure across loads.
    // One random start per mount; with ≤2 enabled we just show what's enabled.
    const rotateSeed = useRef(Math.floor(Math.random() * 997));
    const featuredGames = useMemo(() => {
        const enabled = HOME_GAME_ORDER.map((code) => ({
            code,
            info: gameInfo(code),
        })).filter((x) => !x.info.hidden);
        if (enabled.length <= 2) return enabled;
        const start = rotateSeed.current % enabled.length;
        return [enabled[start], enabled[(start + 1) % enabled.length]];
        // gameInfo derives purely from gameCatalog, so that's the only real dependency.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [gameCatalog]);

    const cardFor = (
        code: GameCode,
        info: { hidden: boolean; maint: boolean; msg: string },
    ) => {
        const onClick = () => openGame(code, info);
        const maint = info.maint;
        const paused = t('gameCard.paused');
        switch (code) {
            case 'keno':
                return (
                    <GameCard
                        key='keno'
                        onClick={onClick}
                        gradientFrom='rgba(139,92,246,0.18)'
                        gradientTo='rgba(16,18,28,0.95)'
                        glowColor='rgba(139,92,246,0.25)'
                        icon={<Zap style={{ color: '#a78bfa' }} />}
                        tag={t('gameCard.fastDraw')}
                        name='Keno'
                        sub={
                            maint
                                ? t('gameCard.underMaintenance')
                                : countdown && activeDraw?.status === 'open'
                                  ? t('gameCard.drawIn', { time: countdown })
                                  : t('gameCard.pickNumbers')
                        }
                        badge={maint ? paused : t('gameCard.live')}
                        badgeColor='rgba(139,92,246,0.25)'
                    />
                );
            case 'bingo':
                return (
                    <GameCard
                        key='bingo'
                        onClick={onClick}
                        gradientFrom='rgba(239,68,68,0.15)'
                        gradientTo='rgba(16,18,28,0.95)'
                        glowColor='rgba(239,68,68,0.2)'
                        icon={<Target style={{ color: '#f87171' }} />}
                        tag={t('gameCard.liveRooms')}
                        name='Bingo'
                        sub={
                            maint
                                ? t('gameCard.underMaintenance')
                                : t('gameCard.nextBingo')
                        }
                        badge={maint ? paused : t('gameCard.hot')}
                        badgeColor='rgba(239,68,68,0.2)'
                    />
                );
            case 'crash':
                return (
                    <GameCard
                        key='crash'
                        onClick={onClick}
                        gradientFrom='rgba(16,185,129,0.15)'
                        gradientTo='rgba(16,18,28,0.95)'
                        glowColor='rgba(16,185,129,0.2)'
                        icon={<TrendingUp style={{ color: '#10b981' }} />}
                        tag={t('gameCard.crashTag')}
                        name='Crash'
                        sub={
                            maint
                                ? t('gameCard.underMaintenance')
                                : t('gameCard.crashSub')
                        }
                        badge={maint ? paused : t('gameCard.live')}
                        badgeColor='rgba(16,185,129,0.2)'
                    />
                );
            case 'pool':
                return (
                    <GameCard
                        key='pool'
                        onClick={onClick}
                        gradientFrom='rgba(234,179,8,0.15)'
                        gradientTo='rgba(16,18,28,0.95)'
                        glowColor='rgba(234,179,8,0.2)'
                        icon={<Circle style={{ color: '#eab308' }} />}
                        tag={t('gameCard.poolTag')}
                        name='Pool'
                        sub={
                            maint
                                ? t('gameCard.underMaintenance')
                                : t('gameCard.poolSub')
                        }
                        badge={maint ? paused : t('gameCard.new')}
                        badgeColor='rgba(234,179,8,0.2)'
                    />
                );
            case 'werk':
                return (
                    <GameCard
                        key='werk'
                        onClick={onClick}
                        gradientFrom='rgba(252,221,9,0.16)'
                        gradientTo='rgba(10,60,40,0.95)'
                        glowColor='rgba(252,221,9,0.22)'
                        icon={<span style={{ fontSize: 18 }}>⛏️</span>}
                        tag={t('gameCard.werkTag')}
                        name='ወርቅ ፍለጋ'
                        sub={
                            maint
                                ? t('gameCard.underMaintenance')
                                : t('gameCard.werkSub')
                        }
                        badge={maint ? paused : t('gameCard.new')}
                        badgeColor='rgba(252,221,9,0.22)'
                    />
                );
        }
    };

    return (
        <div className='stack-lg'>
            {/* ── Live wins ticker (real players only) or trust-message ticker ── */}
            {winsEnabled ? (
                <LiveWinsTicker wins={recentWins} />
            ) : (
                <TrustMessagesTicker />
            )}

            {/* ── Pool queue call-to-action (only while someone is waiting, Pool visible) ── */}
            {!gameInfo('pool').hidden && (
                <PoolWaitingTicker
                    count={liveCounts?.poolWaiting ?? 0}
                    onGo={() => {
                        soundEngine.click();
                        onNavigate('pool');
                    }}
                />
            )}

            {/* ── Balance hero ── */}
            <section className='jackpot-hero'>
                <div
                    style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'flex-start',
                    }}
                >
                    <div>
                        <p
                            style={{
                                fontSize: 12,
                                color: 'rgba(255,255,255,0.5)',
                                fontWeight: 600,
                                marginBottom: 4,
                            }}
                        >
                            {timeGreeting(t)},{' '}
                            {user?.displayName ?? t('home.player')}
                        </p>
                        <div
                            className='jackpot-label'
                            style={{ textAlign: 'left' }}
                        >
                            {t('home.yourBalance')}
                        </div>
                        <motion.div
                            key={balanceKey}
                            className='jackpot-value'
                            style={{ textAlign: 'left' }}
                            initial={{ scale: 1.08, opacity: 0.8 }}
                            animate={{ scale: 1, opacity: 1 }}
                            transition={{
                                type: 'spring',
                                stiffness: 300,
                                damping: 20,
                            }}
                        >
                            {formattedBalance}
                        </motion.div>
                        <div
                            className='jackpot-sub'
                            style={{ textAlign: 'left' }}
                        >
                            {t('home.etbAvailable')}
                        </div>
                    </div>
                    <motion.button
                        className='btn btn-primary btn-glow btn-sm'
                        onClick={() => {
                            soundEngine.click();
                            requestOpenDeposit();
                            onNavigate('wallet');
                        }}
                        whileHover={{ scale: 1.06 }}
                        whileTap={{ scale: 0.94 }}
                        style={{ marginTop: 8, flexShrink: 0 }}
                    >
                        <TrendingUp size={13} />
                        {t('common.deposit')}
                    </motion.button>
                </div>

                {/* Live pills */}
                <div
                    style={{
                        display: 'flex',
                        gap: 8,
                        marginTop: 14,
                        flexWrap: 'wrap',
                    }}
                >
                    {liveCounts && liveCounts.totalOnline > 0 && (
                        <span
                            className='live-badge-pulse'
                            style={{ fontSize: 10 }}
                        >
                            <span className='pulse-dot' />
                            {t('home.onlineNow', {
                                count: formatOnlineCount(
                                    liveCounts.totalOnline,
                                ),
                            })}
                        </span>
                    )}
                    {bingoCartelas > 0 && (
                        <span
                            className='live-badge-pulse'
                            style={{
                                fontSize: 10,
                                background: 'rgba(239,68,68,0.1)',
                                color: '#f87171',
                                border: '1px solid rgba(239,68,68,0.2)',
                            }}
                        >
                            <span
                                className='pulse-dot'
                                style={{
                                    background: 'var(--danger)',
                                    boxShadow: '0 0 6px rgba(239,68,68,0.5)',
                                }}
                            />
                            {t('home.playing', {
                                count: bingoCartelas,
                            })}
                        </span>
                    )}
                    {activeDraw && (
                        <span
                            className='live-badge-pulse'
                            style={{
                                fontSize: 10,
                                background: 'rgba(245,158,11,0.1)',
                                color: 'var(--gold)',
                                border: '1px solid rgba(245,158,11,0.2)',
                            }}
                        >
                            <Clock size={10} />
                            {activeDraw.status === 'open' && countdown
                                ? t('home.kenoIn', { time: countdown })
                                : t('home.kenoDrawing')}
                        </span>
                    )}
                </div>
            </section>

            {/* ── Game lobby ── */}
            <div>
                <div
                    style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: 10,
                    }}
                >
                    <span className='section-title' style={{ fontSize: 15 }}>
                        {t('home.playNow')}
                    </span>
                    <button
                        className='btn btn-ghost btn-sm'
                        onClick={() => onNavigate('games')}
                    >
                        {t('home.allGames')}
                    </button>
                </div>
                <div className='lobby-grid'>
                    {featuredGames.map((f) => cardFor(f.code, f.info))}
                </div>
            </div>

            {/* ── Recent activity ── */}
            {recentActivity.length > 0 && (
                <section className='card'>
                    <div className='section-header'>
                        <div className='section-title' style={{ fontSize: 14 }}>
                            {t('home.recentActivity')}
                        </div>
                        <button
                            className='btn btn-ghost btn-sm'
                            onClick={() => onNavigate('wallet')}
                        >
                            {t('home.seeAll')}
                        </button>
                    </div>
                    <div className='activity-feed' style={{ marginTop: 8 }}>
                        {recentActivity.slice(0, 4).map((entry, i) => {
                            const badge = entryBadge(entry);
                            const ledgerKey =
                                LEDGER_KEY[
                                    (entry.entryType ??
                                        entry.sourceType ??
                                        '') as string
                                ];
                            const label = ledgerKey
                                ? t(`ledger.${ledgerKey}`)
                                : t('ledger.transaction');
                            const isCredit = entry.direction === 'credit';
                            return (
                                <motion.div
                                    key={entry.id}
                                    className='activity-item'
                                    initial={{ opacity: 0, x: -10 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    transition={{
                                        delay: i * 0.06,
                                        duration: 0.25,
                                    }}
                                >
                                    <div
                                        className={`activity-badge ${badge.cls}`}
                                    >
                                        {badge.emoji}
                                    </div>
                                    <div className='activity-body'>
                                        <span className='activity-name'>
                                            {label}
                                        </span>
                                        <span className='activity-game'>
                                            {new Date(
                                                entry.createdAt ?? 0,
                                            ).toLocaleDateString('en-GB', {
                                                timeZone: ETHIOPIA_TZ,
                                                month: 'short',
                                                day: 'numeric',
                                                hour: 'numeric',
                                                minute: '2-digit',
                                                hour12: true,
                                            })}
                                        </span>
                                    </div>
                                    <span
                                        className='activity-amount'
                                        style={{
                                            color: isCredit
                                                ? 'var(--green)'
                                                : 'var(--danger)',
                                        }}
                                    >
                                        {isCredit ? '+' : '−'}
                                        {new Intl.NumberFormat().format(
                                            entry.amountMinor,
                                        )}
                                    </span>
                                </motion.div>
                            );
                        })}
                    </div>
                </section>
            )}

            {/* ── Help & FAQ ── */}
            <section className='card'>
                <div className='home-faq-header'>
                    <HelpCircle
                        size={16}
                        style={{ color: 'var(--text-muted)', flexShrink: 0 }}
                    />
                    <span className='section-title' style={{ fontSize: 14 }}>
                        {t('home.helpFaq')}
                    </span>
                </div>
                <div className='rules-accordion'>
                    {FAQ_KEYS.map((k) => (
                        <FaqItem
                            key={k}
                            q={t(`faq.${k}.q`)}
                            a={t(`faq.${k}.a`)}
                        />
                    ))}
                </div>
            </section>

            <div style={{ height: 4 }} />
        </div>
    );
}
