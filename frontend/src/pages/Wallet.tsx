import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    motion,
    AnimatePresence,
    useMotionValue,
    useSpring,
} from 'framer-motion';
import {
    ArrowUpRight,
    ArrowDownLeft,
    ArrowUpToLine,
    ArrowDownToLine,
    CheckCircle,
    X,
    RefreshCw,
    Wallet as WalletIcon,
    TrendingUp,
    Search,
    Phone,
    User as UserIcon,
    Copy,
    LifeBuoy,
    ChevronRight,
    Image as ImageIcon,
} from 'lucide-react';
import type { LedgerEntry, Withdrawal } from '../lib/models';
import type { AppTab } from '../lib/navigation';
import { useStore } from '../store/useStore';
import {
    formatCreditsFull,
    formatDateTimeFull,
    getErrorMessage,
    isRetryableInfraError,
} from '../lib/utils';
import { authApi, walletApi, paymentsApi, type ActiveAgent } from '../lib/api';
import { consumeOpenDepositRequest } from '../lib/walletIntent';

// Deposit provider the player is using. Both flows paste a confirmation from the
// same on-duty agent; only the parse/verify endpoint differs.
type DepositProvider = 'telebirr' | 'mpesa';

// Normalised preview so the confirm card renders the same for both providers.
type NormalizedPreview = {
    ref: string;
    amountMinor: number;
    payerName?: string;
    payerPhone?: string;
    receiverName?: string;
    date?: string;
};

// Keys are the backend ledger `entryType` values
// (see LedgerEntryType: stake | win | refund | adjustment | bonus | deposit |
//  reversal | withdrawal | agent_receipt).
// Ledger entryType/sourceType → i18n key for the transaction label.
const ENTRY_KEY: Record<string, string> = {
    stake: 'wallet.entryTicketPurchase',
    win: 'wallet.entryWinnings',
    refund: 'wallet.entryRefund',
    deposit: 'wallet.entryDeposit',
    withdrawal: 'wallet.entryWithdrawal',
    bonus: 'wallet.entryBonus',
    adjustment: 'wallet.entryAdjustment',
    agent_receipt: 'wallet.entryAgentTransfer',
    reversal: 'wallet.entryReversal',
};

type TxFilter = 'all' | 'wins' | 'purchases' | 'deposits';

const TX_FILTERS: { id: TxFilter; labelKey: string; icon: string }[] = [
    { id: 'all', labelKey: 'wallet.filterAll', icon: '📋' },
    { id: 'wins', labelKey: 'wallet.filterWins', icon: '🏆' },
    { id: 'purchases', labelKey: 'wallet.filterPurchases', icon: '🎟' },
    { id: 'deposits', labelKey: 'wallet.filterDeposits', icon: '💰' },
];

function formatLedgerTitle(
    entry: LedgerEntry,
    t: (k: string) => string,
): string {
    const key = ENTRY_KEY[entry.entryType] ?? ENTRY_KEY[entry.sourceType];
    return key ? t(key) : t('wallet.entryTransaction');
}

function matchesTxFilter(entry: LedgerEntry, filter: TxFilter): boolean {
    if (filter === 'all') return true;
    const type = entry.entryType ?? entry.sourceType ?? '';
    if (filter === 'wins') return type === 'win' || type === 'bonus';
    if (filter === 'purchases') return type === 'stake';
    if (filter === 'deposits')
        return type === 'deposit' || type === 'agent_receipt';
    return true;
}

const WITHDRAW_PRESETS = [500, 1000, 5000, 10000];

function AnimatedBalance({ value }: { value: number }) {
    const mv = useMotionValue(value);
    const spring = useSpring(mv, { stiffness: 80, damping: 18 });
    const [display, setDisplay] = useState(value);

    useEffect(() => {
        mv.set(value);
    }, [value, mv]);
    useEffect(
        () => spring.on('change', (v) => setDisplay(Math.round(v))),
        [spring],
    );

    return <>{new Intl.NumberFormat().format(display)}</>;
}

// Shown when we couldn't reach the Telebirr/M-Pesa verification proxy (as
// opposed to the receipt itself being rejected) — the same input is worth
// trying again, so this offers a direct retry instead of a dead-end error.
function RetryBanner({
    busy,
    onRetry,
}: {
    busy: boolean;
    onRetry: () => void;
}) {
    return (
        <div
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 12px',
                marginTop: 10,
                borderRadius: 10,
                background: 'rgba(239,68,68,0.08)',
                border: '1px solid rgba(239,68,68,0.25)',
            }}
        >
            <span style={{ fontSize: 12, color: 'var(--text-secondary)', flex: 1 }}>
                We couldn't reach the verification service. This is usually
                temporary — check your connection and try again.
            </span>
            <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={onRetry}
                disabled={busy}
                style={{ flexShrink: 0 }}
            >
                {busy ? 'Retrying…' : 'Retry'}
            </button>
        </div>
    );
}

function DevTopup({ onSuccess }: { onSuccess: () => Promise<void> }) {
    const addToast = useStore((s) => s.addToast);
    const setWallet = useStore((s) => s.setWallet);
    const user = useStore((s) => s.user);
    const [loading, setLoading] = useState(false);

    const topup = async (amountMinor: number) => {
        if (!user?.id) return;
        setLoading(true);
        try {
            await authApi.devTopup(user.id, amountMinor);
            const w = await walletApi.getWallet();
            setWallet(w);
            await onSuccess();
            addToast('success', `Added ${amountMinor} ETB to your wallet.`);
        } catch (e) {
            addToast('error', getErrorMessage(e));
        } finally {
            setLoading(false);
        }
    };

    return (
        <div
            style={{
                marginTop: 12,
                padding: '10px 12px',
                background: 'rgba(250,204,21,0.08)',
                border: '1px dashed rgba(250,204,21,0.3)',
                borderRadius: 10,
                display: 'flex',
                gap: 8,
                alignItems: 'center',
                flexWrap: 'wrap',
            }}
        >
            <span
                style={{
                    fontSize: '0.75rem',
                    color: 'var(--text-muted)',
                    flex: 1,
                }}
            >
                DEV add test ETB:
            </span>
            {[10, 100, 1000].map((amt) => (
                <button
                    key={amt}
                    className='btn btn-ghost'
                    disabled={loading}
                    onClick={() => topup(amt)}
                    style={{
                        fontSize: '0.75rem',
                        padding: '4px 10px',
                        border: '1px solid rgba(250,204,21,0.4)',
                    }}
                >
                    +{amt}
                </button>
            ))}
        </div>
    );
}

const staggerList = {
    hidden: {},
    show: { transition: { staggerChildren: 0.05 } },
};
const listItem = {
    hidden: { opacity: 0, x: -8 },
    show: {
        opacity: 1,
        x: 0,
        transition: { type: 'spring' as const, stiffness: 300, damping: 28 },
    },
};

export function Wallet({ onNavigate }: { onNavigate?: (tab: AppTab) => void }) {
    const { t } = useTranslation();
    const wallet = useStore((state) => state.wallet);
    const setWallet = useStore((state) => state.setWallet);
    const addToast = useStore((state) => state.addToast);
    const [ledger, setLedger] = useState<LedgerEntry[]>([]);
    const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
    const [loading, setLoading] = useState(true);
    const [txFilter, setTxFilter] = useState<TxFilter>('all');

    const [showTopup, setShowTopup] = useState(false);
    const [provider, setProvider] = useState<DepositProvider>('telebirr');
    const [receiptInput, setReceiptInput] = useState('');
    const [receiptFile, setReceiptFile] = useState<File | null>(null);
    const [isPreviewing, setIsPreviewing] = useState(false);
    const [preview, setPreview] = useState<NormalizedPreview | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Set when the LAST preview/submit/screenshot attempt failed because we
    // couldn't reach the Telebirr/M-Pesa verification proxy (or got no usable
    // data back)  as opposed to the receipt itself being rejected. Only this
    // case gets a "Retry" affordance, since retrying a rejected receipt with
    // the same input would just fail again.
    const [infraRetry, setInfraRetry] = useState<
        'preview' | 'submit' | 'screenshot' | null
    >(null);
    // Kept so a screenshot retry can re-run OCR on the same file without
    // making the user re-open the file picker (the input itself is cleared
    // right after each selection).
    const [lastScreenshotFile, setLastScreenshotFile] = useState<File | null>(
        null,
    );

    // Telebirr-only alternative to pasting SMS text: upload a screenshot of the
    // app's "Successful" screen and let server-side OCR find the transaction
    // number. `ocrReceiptNo`/`ocrFileUrl` carry that result into Step 2 so submit
    // doesn't need to re-parse text or re-upload the (already-saved) screenshot.
    const [depositMode, setDepositMode] = useState<'sms' | 'screenshot'>('sms');
    const [isOcrProcessing, setIsOcrProcessing] = useState(false);
    const [ocrReceiptNo, setOcrReceiptNo] = useState<string | null>(null);
    const [ocrFileUrl, setOcrFileUrl] = useState<string | null>(null);
    const [activeAgent, setActiveAgent] = useState<ActiveAgent | null>(null);
    const [agentList, setAgentList] = useState<ActiveAgent[]>([]);
    const [agentLoading, setAgentLoading] = useState(false);
    const [minDepositMinor, setMinDepositMinor] = useState(0);

    const [showWithdraw, setShowWithdraw] = useState(false);
    const [withdrawAmount, setWithdrawAmount] = useState('');
    const [withdrawPhone, setWithdrawPhone] = useState('');
    const [isWithdrawing, setIsWithdrawing] = useState(false);
    const [withdrawFeeConfig, setWithdrawFeeConfig] = useState<{
        withdrawalFeeRanges: Array<{
            minAmountMinor: number;
            maxAmountMinor: number | null;
            feeMinor: number;
        }>;
    } | null>(null);
    const [withdrawSchedule, setWithdrawSchedule] = useState<{
        open: boolean;
        message?: string;
    } | null>(null);

    const loadWallet = useCallback(async () => {
        try {
            const [nextWallet, nextLedger, nextWithdrawals] = await Promise.all(
                [
                    walletApi.getWallet(),
                    walletApi.getLedger(30),
                    walletApi.getWithdrawals(),
                ],
            );
            setWallet(nextWallet);
            setLedger(nextLedger);
            setWithdrawals(nextWithdrawals);
        } catch (error) {
            addToast('error', getErrorMessage(error));
        } finally {
            setLoading(false);
        }
    }, [addToast, setWallet]);

    useEffect(() => {
        void loadWallet();
    }, [loadWallet]);

    const receiptInputRef = useRef<HTMLTextAreaElement>(null);

    const openTopup = () => {
        setShowWithdraw(false);
        setShowTopup(true);
        setAgentLoading(true);
        paymentsApi
            .getActiveAgents()
            .then((list) => {
                setAgentList(list);
                // Default to the primary (first) on-duty agent; the player can switch
                // when more than one is available.
                setActiveAgent(list[0] ?? null);
            })
            .catch(() => {
                setAgentList([]);
                setActiveAgent(null);
            })
            .finally(() => setAgentLoading(false));
        paymentsApi
            .getConfig()
            .then((c) => setMinDepositMinor(c.minDepositMinor))
            .catch(() => setMinDepositMinor(0));
        // Land the player straight in the paste box  no extra tap to start typing.
        requestAnimationFrame(() => receiptInputRef.current?.focus());
    };

    const toggleTopup = () => {
        if (showTopup) {
            resetTopup();
            setShowTopup(false);
        } else {
            openTopup();
        }
    };

    // Home's "Deposit" quick-action requests this panel open on arrival instead
    // of landing on the Wallet page and requiring a second "Top Up" tap.
    useEffect(() => {
        if (consumeOpenDepositRequest()) openTopup();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handlePreview = async () => {
        if (!receiptInput.trim()) return;
        setIsPreviewing(true);
        setPreview(null);
        setInfraRetry(null);
        try {
            if (provider === 'mpesa') {
                const r = await paymentsApi.previewMpesaSms(
                    receiptInput.trim(),
                );
                setPreview({
                    ref: r.confirmationCode,
                    amountMinor: r.amountMinor,
                    payerPhone: r.payerPhone,
                    receiverName: r.receiverName,
                    date: r.date,
                });
            } else {
                const r = await paymentsApi.previewTelebirrReceipt(
                    receiptInput.trim(),
                );
                setPreview({
                    ref: r.receiptNo,
                    amountMinor: r.amountMinor,
                    payerName: r.payerName,
                    payerPhone: r.payerPhone,
                    receiverName: r.receiverName,
                    date: r.date,
                });
            }
        } catch (e) {
            if (isRetryableInfraError(e)) {
                setInfraRetry('preview');
                addToast(
                    'error',
                    "Couldn't reach the verification service  this is usually temporary. Tap Retry below.",
                );
            } else {
                addToast('error', getErrorMessage(e));
            }
        } finally {
            setIsPreviewing(false);
        }
    };

    const handleTopup = async () => {
        setInfraRetry(null);
        // Screenshot flow already has a verified receiptNo + saved fileUrl from
        // handleScreenshotSelect  submit that directly, no text to re-parse.
        if (depositMode === 'screenshot') {
            if (!ocrReceiptNo) return;
            setIsSubmitting(true);
            try {
                await paymentsApi.submitTelebirrReceiptByNo(
                    ocrReceiptNo,
                    ocrFileUrl ?? undefined,
                );
                addToast(
                    'success',
                    'Deposit confirmed! Your account has been credited.',
                );
                resetTopup();
                setShowTopup(false);
                await loadWallet();
            } catch (e) {
                if (isRetryableInfraError(e)) {
                    setInfraRetry('submit');
                    addToast(
                        'error',
                        "Couldn't reach the verification service  this is usually temporary. Tap Retry below.",
                    );
                } else {
                    addToast('error', getErrorMessage(e));
                }
            } finally {
                setIsSubmitting(false);
            }
            return;
        }

        if (!receiptInput.trim()) return;
        setIsSubmitting(true);
        try {
            // Photo/PDF attachment is optional  the pasted SMS text or receipt
            // link is enough to verify and credit the deposit on its own.
            let fileUrl: string | undefined;
            if (receiptFile) {
                const uploaded = await paymentsApi.uploadReceipt(receiptFile);
                if (!uploaded.fileUrl) {
                    addToast(
                        'error',
                        'Receipt upload failed  please try attaching the file again',
                    );
                    return;
                }
                fileUrl = uploaded.fileUrl;
            }
            if (provider === 'mpesa') {
                await paymentsApi.submitMpesaSms(receiptInput.trim(), fileUrl);
            } else {
                await paymentsApi.submitTelebirrReceipt(
                    receiptInput.trim(),
                    fileUrl,
                );
            }
            addToast(
                'success',
                'Deposit confirmed! Your account has been credited.',
            );
            resetTopup();
            setShowTopup(false);
            await loadWallet();
        } catch (e) {
            if (isRetryableInfraError(e)) {
                setInfraRetry('submit');
                addToast(
                    'error',
                    "Couldn't reach the verification service  this is usually temporary. Tap Retry below.",
                );
            } else {
                addToast('error', getErrorMessage(e));
            }
        } finally {
            setIsSubmitting(false);
        }
    };

    // OCR is trusted only to find the transaction number  the returned preview
    // (amount/payer/status) comes from the same verified Ethiotelecom fetch the
    // paste flow uses, so Step 2 renders identically either way.
    const handleScreenshotSelect = async (file: File | null) => {
        setPreview(null);
        setOcrReceiptNo(null);
        setOcrFileUrl(null);
        setInfraRetry(null);
        if (!file) return;
        setLastScreenshotFile(file);
        setIsOcrProcessing(true);
        try {
            const r = await paymentsApi.previewTelebirrScreenshot(file);
            setOcrReceiptNo(r.receiptNo);
            setOcrFileUrl(r.fileUrl);
            setPreview({
                ref: r.receiptNo,
                amountMinor: r.amountMinor,
                payerName: r.payerName,
                payerPhone: r.payerPhone,
                receiverName: r.receiverName,
                date: r.date,
            });
        } catch (e) {
            if (isRetryableInfraError(e)) {
                setInfraRetry('screenshot');
                addToast(
                    'error',
                    "Couldn't reach the verification service  this is usually temporary. Tap Retry below.",
                );
            } else {
                addToast('error', getErrorMessage(e));
            }
        } finally {
            setIsOcrProcessing(false);
        }
    };

    const retryScreenshot = () => {
        if (lastScreenshotFile) void handleScreenshotSelect(lastScreenshotFile);
    };

    // Switching provider clears any in-progress paste/preview so the two flows
    // never cross-contaminate.
    const switchProvider = (next: DepositProvider) => {
        if (next === provider) return;
        setProvider(next);
        setDepositMode('sms');
        setReceiptInput('');
        setReceiptFile(null);
        setOcrReceiptNo(null);
        setOcrFileUrl(null);
        setPreview(null);
        setInfraRetry(null);
        setLastScreenshotFile(null);
    };

    const switchDepositMode = (next: 'sms' | 'screenshot') => {
        if (next === depositMode) return;
        setDepositMode(next);
        setReceiptInput('');
        setReceiptFile(null);
        setOcrReceiptNo(null);
        setOcrFileUrl(null);
        setPreview(null);
        setInfraRetry(null);
        setLastScreenshotFile(null);
    };

    const resetTopup = () => {
        setReceiptInput('');
        setReceiptFile(null);
        setOcrReceiptNo(null);
        setOcrFileUrl(null);
        setPreview(null);
        setInfraRetry(null);
        setLastScreenshotFile(null);
    };

    const toggleWithdraw = () => {
        setShowWithdraw((open) => {
            const next = !open;
            if (next) {
                setShowTopup(false);
                resetTopup();
                // Fetch fee tiers so we can show an estimate before submission. Uses the
                // player-scoped endpoint (not agentApi.getConfig, which is agent-role-only
                // and would 403 for a plain player, silently zeroing out the fee note).
                // Also carries the withdrawal-schedule status, so a player who opens this
                // form outside the configured window is told immediately, not after typing
                // an amount and hitting submit.
                walletApi
                    .getWithdrawalFeeConfig()
                    .then((c) => {
                        setWithdrawFeeConfig(c);
                        setWithdrawSchedule(c.schedule);
                        if (!c.schedule.open) {
                            addToast(
                                'error',
                                c.schedule.message ??
                                    'Withdrawals are currently closed.',
                            );
                        }
                    })
                    .catch(() => {
                        setWithdrawFeeConfig(null);
                        setWithdrawSchedule(null);
                    });
            }
            return next;
        });
    };

    /** Mirror of AgentsService/resolveWithdrawalFeeMinor  same lookup, client side. */
    const resolveFeeMinor = (amountMinor: number): number | null => {
        if (!withdrawFeeConfig) return null;
        const match = withdrawFeeConfig.withdrawalFeeRanges.find(
            (r) =>
                amountMinor >= r.minAmountMinor &&
                (r.maxAmountMinor === null || amountMinor <= r.maxAmountMinor),
        );
        return match ? match.feeMinor : null;
    };

    const handleWithdraw = async () => {
        const credits = parseFloat(withdrawAmount);
        if (isNaN(credits) || credits <= 0) {
            addToast('error', 'Please enter a valid amount');
            return;
        }
        const amountMinor = Math.round(credits);
        const available = wallet?.availableMinor ?? 0;
        if (amountMinor > available) {
            addToast(
                'error',
                `Insufficient balance  available: ${new Intl.NumberFormat().format(available)} ETB`,
            );
            return;
        }
        if (!withdrawPhone.trim()) {
            addToast('error', 'Please enter your Telebirr phone number');
            return;
        }
        setIsWithdrawing(true);
        try {
            await walletApi.requestWithdrawal(
                amountMinor,
                withdrawPhone.trim(),
            );
            addToast('success', 'Withdrawal request submitted!');
            setWithdrawAmount('');
            setWithdrawPhone('');
            setShowWithdraw(false);
            await loadWallet();
        } catch (e) {
            addToast('error', getErrorMessage(e));
        } finally {
            setIsWithdrawing(false);
        }
    };

    const filteredLedger = ledger.filter((e) => matchesTxFilter(e, txFilter));
    const available = wallet?.availableMinor ?? 0;

    return (
        <motion.div
            className='stack-lg'
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 28 }}
        >
            {/* ── Balance hero ── */}
            <motion.section
                className='card'
                style={{
                    background:
                        'linear-gradient(135deg, rgba(250,204,21,0.06) 0%, rgba(139,92,246,0.04) 100%)',
                    border: '1px solid rgba(250,204,21,0.12)',
                }}
                initial={{ scale: 0.97, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 280, damping: 24 }}
            >
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        marginBottom: 4,
                    }}
                >
                    <div
                        className='badge badge-gold'
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 5,
                        }}
                    >
                        <WalletIcon size={11} /> Wallet
                    </div>
                    {wallet?.status === 'active' && (
                        <span
                            style={{
                                fontSize: 10,
                                color: 'var(--green)',
                                fontWeight: 700,
                            }}
                        >
                            ● Active
                        </span>
                    )}
                </div>

                <div
                    className='jackpot-value'
                    style={{ fontSize: '2.2rem', margin: '8px 0 4px' }}
                >
                    <AnimatedBalance value={available} />
                    <span
                        style={{
                            fontSize: '1rem',
                            marginLeft: 6,
                            color: 'var(--text-muted)',
                            fontWeight: 600,
                        }}
                    >
                        ETB
                    </span>
                </div>

                <div className='stats-grid' style={{ marginBottom: 16 }}>
                    <div className='stat-card'>
                        <span className='stat-label'>
                            {t('wallet.available')}
                        </span>
                        <strong>
                            {formatCreditsFull(wallet?.availableMinor ?? 0)}
                        </strong>
                    </div>
                    <div className='stat-card'>
                        <span className='stat-label'>
                            {t('wallet.reserved')}
                        </span>
                        <strong>
                            {formatCreditsFull(wallet?.reservedMinor ?? 0)}
                        </strong>
                    </div>
                    <div className='stat-card'>
                        <span className='stat-label'>{t('wallet.status')}</span>
                        <strong
                            style={{
                                textTransform: 'capitalize',
                                color:
                                    wallet?.status === 'active'
                                        ? 'var(--green)'
                                        : 'var(--danger)',
                            }}
                        >
                            {wallet?.status ?? ''}
                        </strong>
                    </div>
                </div>

                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <motion.button
                        className='btn btn-primary'
                        onClick={toggleTopup}
                        style={{ flex: 1, minWidth: 140 }}
                        whileTap={{ scale: 0.96 }}
                    >
                        {showTopup ? (
                            <>
                                <X size={15} /> {t('common.cancel')}
                            </>
                        ) : (
                            <>
                                <ArrowUpToLine size={15} />{' '}
                                {t('common.deposit')}
                            </>
                        )}
                    </motion.button>
                    <motion.button
                        className='btn btn-secondary'
                        onClick={toggleWithdraw}
                        style={{ flex: 1, minWidth: 140 }}
                        whileTap={{ scale: 0.96 }}
                    >
                        {showWithdraw ? (
                            <>
                                <X size={15} /> {t('common.cancel')}
                            </>
                        ) : (
                            <>
                                <ArrowDownToLine size={15} />{' '}
                                {t('common.withdraw')}
                            </>
                        )}
                    </motion.button>
                </div>

                <button
                    type='button'
                    onClick={() => onNavigate?.('support')}
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        width: '100%',
                        marginTop: 10,
                        padding: '10px 12px',
                        background: 'rgba(255,255,255,0.03)',
                        border: '1px solid var(--border)',
                        borderRadius: 10,
                        cursor: 'pointer',
                        color: 'var(--text-secondary)',
                    }}
                >
                    <span
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            fontSize: 13,
                            fontWeight: 600,
                        }}
                    >
                        <LifeBuoy
                            size={15}
                            style={{ color: 'var(--accent)' }}
                        />
                        {t('wallet.getHelp')}
                    </span>
                    <ChevronRight
                        size={15}
                        style={{ color: 'var(--text-muted)' }}
                    />
                </button>

                {import.meta.env.DEV && <DevTopup onSuccess={loadWallet} />}

                {/* ── Topup form ── */}
                <AnimatePresence initial={false}>
                    {showTopup && (
                        <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.22 }}
                            style={{ overflow: 'hidden' }}
                        >
                            <div
                                className='admin-form'
                                style={{ marginTop: 16 }}
                            >
                                <h3
                                    style={{ margin: '0 0 10px', fontSize: 16 }}
                                >
                                    Deposit
                                </h3>

                                {/* Provider chooser  Telebirr or M-Pesa */}
                                <div
                                    style={{
                                        display: 'flex',
                                        gap: 8,
                                        marginBottom: 12,
                                    }}
                                >
                                    {(['telebirr', 'mpesa'] as const).map(
                                        (p) => {
                                            const selected = provider === p;
                                            return (
                                                <button
                                                    key={p}
                                                    type='button'
                                                    onClick={() =>
                                                        switchProvider(p)
                                                    }
                                                    style={{
                                                        flex: 1,
                                                        padding: '9px 12px',
                                                        borderRadius: 10,
                                                        cursor: 'pointer',
                                                        fontSize: 13,
                                                        fontWeight: 700,
                                                        background: selected
                                                            ? 'rgba(250,204,21,0.14)'
                                                            : 'rgba(255,255,255,0.03)',
                                                        border: `1px solid ${selected ? 'rgba(250,204,21,0.55)' : 'var(--border)'}`,
                                                        color: selected
                                                            ? 'var(--gold)'
                                                            : 'var(--text-secondary)',
                                                    }}
                                                >
                                                    {p === 'telebirr'
                                                        ? 'Telebirr'
                                                        : 'M-Pesa'}
                                                </button>
                                            );
                                        },
                                    )}
                                </div>

                                {/* SMS vs Screenshot  Telebirr only, and only before a preview is showing */}
                                {provider === 'telebirr' && !preview && (
                                    <div
                                        style={{
                                            display: 'flex',
                                            gap: 18,
                                            marginBottom: 14,
                                            borderBottom:
                                                '1px solid var(--border)',
                                        }}
                                    >
                                        {(['sms', 'screenshot'] as const).map(
                                            (m) => {
                                                const selected =
                                                    depositMode === m;
                                                return (
                                                    <button
                                                        key={m}
                                                        type='button'
                                                        onClick={() =>
                                                            switchDepositMode(m)
                                                        }
                                                        style={{
                                                            background: 'none',
                                                            border: 'none',
                                                            cursor: 'pointer',
                                                            padding:
                                                                '0 2px 10px',
                                                            fontSize: 13,
                                                            fontWeight: 700,
                                                            color: selected
                                                                ? 'var(--danger)'
                                                                : 'var(--text-muted)',
                                                            borderBottom:
                                                                selected
                                                                    ? '2px solid var(--danger)'
                                                                    : '2px solid transparent',
                                                            marginBottom: -1,
                                                        }}
                                                    >
                                                        {m === 'sms'
                                                            ? 'SMS'
                                                            : 'Screenshot'}
                                                    </button>
                                                );
                                            },
                                        )}
                                    </div>
                                )}

                                <p
                                    className='text-muted'
                                    style={{
                                        fontSize: 13,
                                        marginBottom:
                                            minDepositMinor > 0 ? 8 : 14,
                                    }}
                                >
                                    {provider === 'mpesa'
                                        ? 'Send your M-Pesa transfer to the agent below, then paste the confirmation SMS you receive.'
                                        : depositMode === 'screenshot'
                                          ? 'Send your Telebirr transfer to the agent below, then upload a screenshot of the "Successful" confirmation screen.'
                                          : 'Send your Telebirr transfer to the agent below, then paste your SMS confirmation message or the receipt link.'}
                                </p>
                                {minDepositMinor > 0 && (
                                    <p
                                        style={{
                                            fontSize: 12,
                                            color: 'var(--gold)',
                                            fontWeight: 700,
                                            margin: '0 0 14px',
                                        }}
                                    >
                                        Minimum deposit:{' '}
                                        {new Intl.NumberFormat().format(
                                            minDepositMinor,
                                        )}{' '}
                                        ETB
                                    </p>
                                )}

                                {/* Agent chooser  only when more than one on-duty agent is available */}
                                {!agentLoading && agentList.length > 1 && (
                                    <div style={{ marginBottom: 12 }}>
                                        <div
                                            style={{
                                                fontSize: 10,
                                                textTransform: 'uppercase',
                                                letterSpacing: '0.06em',
                                                color: 'var(--text-muted)',
                                                marginBottom: 8,
                                            }}
                                        >
                                            Choose an agent to send to
                                        </div>
                                        <div
                                            style={{
                                                display: 'flex',
                                                flexWrap: 'wrap',
                                                gap: 8,
                                            }}
                                        >
                                            {agentList.map((a) => {
                                                const selected = activeAgent
                                                    ? a.id
                                                        ? a.id ===
                                                          activeAgent.id
                                                        : a.phoneNumber ===
                                                          activeAgent.phoneNumber
                                                    : false;
                                                return (
                                                    <button
                                                        key={
                                                            a.id ??
                                                            a.phoneNumber ??
                                                            a.displayName
                                                        }
                                                        type='button'
                                                        onClick={() =>
                                                            setActiveAgent(a)
                                                        }
                                                        style={{
                                                            display: 'flex',
                                                            alignItems:
                                                                'center',
                                                            gap: 6,
                                                            padding: '7px 12px',
                                                            borderRadius: 999,
                                                            cursor: 'pointer',
                                                            fontSize: 13,
                                                            fontWeight: 700,
                                                            background: selected
                                                                ? 'rgba(250,204,21,0.14)'
                                                                : 'rgba(255,255,255,0.03)',
                                                            border: `1px solid ${selected ? 'rgba(250,204,21,0.55)' : 'var(--border)'}`,
                                                            color: selected
                                                                ? 'var(--gold)'
                                                                : 'var(--text-secondary)',
                                                        }}
                                                    >
                                                        <UserIcon size={13} />
                                                        {a.displayName}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}

                                {/* Active agent  where to send the Telebirr transfer */}
                                {agentLoading ? (
                                    <div
                                        className='card-muted'
                                        style={{
                                            marginBottom: 14,
                                            fontSize: 13,
                                        }}
                                    >
                                        <RefreshCw
                                            size={13}
                                            style={{
                                                animation:
                                                    'spin 1s linear infinite',
                                                marginRight: 6,
                                                verticalAlign: 'middle',
                                            }}
                                        />
                                        Finding the agent on duty…
                                    </div>
                                ) : activeAgent ? (
                                    (() => {
                                        // M-Pesa and Telebirr are different networks, so an agent may
                                        // register a different number with each  never fall back to
                                        // the Telebirr phoneNumber while on the M-Pesa tab (that was the
                                        // bug: both tabs showed the same number regardless of provider).
                                        const depositPhoneNumber =
                                            provider === 'mpesa'
                                                ? (activeAgent.mpesaPhoneNumber ??
                                                  activeAgent.phoneNumber)
                                                : activeAgent.phoneNumber;
                                        return (
                                    <div
                                        style={{
                                            background: 'rgba(250,204,21,0.07)',
                                            border: '1px solid rgba(250,204,21,0.25)',
                                            borderRadius: 10,
                                            padding: '14px 16px',
                                            marginBottom: 14,
                                        }}
                                    >
                                        <div
                                            style={{
                                                fontSize: 10,
                                                textTransform: 'uppercase',
                                                letterSpacing: '0.06em',
                                                color: 'var(--text-muted)',
                                                marginBottom: 10,
                                            }}
                                        >
                                            {provider === 'mpesa'
                                                ? 'Send M-Pesa to'
                                                : 'Send Telebirr to'}
                                        </div>
                                        <div
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: 8,
                                                marginBottom: 8,
                                            }}
                                        >
                                            <UserIcon
                                                size={14}
                                                style={{ color: 'var(--gold)' }}
                                            />
                                            <strong style={{ fontSize: 14 }}>
                                                {activeAgent.displayName}
                                            </strong>
                                        </div>
                                        <div
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: 8,
                                            }}
                                        >
                                            <Phone
                                                size={14}
                                                style={{ color: 'var(--gold)' }}
                                            />
                                            {depositPhoneNumber ? (
                                                <>
                                                    <strong
                                                        style={{
                                                            fontSize: 15,
                                                            letterSpacing:
                                                                '0.02em',
                                                        }}
                                                    >
                                                        {depositPhoneNumber}
                                                    </strong>
                                                    <button
                                                        type='button'
                                                        className='btn btn-ghost btn-sm'
                                                        onClick={() => {
                                                            // Telebirr's own app expects the local
                                                            // 9XXXXXXXX form, not the +251 we display
                                                            // for readability - copying the +251
                                                            // version made every paste-in fail until
                                                            // the player manually stripped it first.
                                                            void navigator.clipboard?.writeText(
                                                                depositPhoneNumber!.replace(
                                                                    /^\+?251/,
                                                                    '',
                                                                ),
                                                            );
                                                            addToast(
                                                                'success',
                                                                'Phone number copied',
                                                            );
                                                        }}
                                                        style={{
                                                            marginLeft: 'auto',
                                                            display: 'flex',
                                                            alignItems:
                                                                'center',
                                                            gap: 4,
                                                            padding: '3px 8px',
                                                        }}
                                                    >
                                                        <Copy size={12} /> Copy
                                                    </button>
                                                </>
                                            ) : (
                                                <span
                                                    className='text-muted'
                                                    style={{ fontSize: 13 }}
                                                >
                                                    No phone number on file
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                        );
                                    })()
                                ) : (
                                    <div
                                        style={{
                                            background: 'rgba(239,68,68,0.07)',
                                            border: '1px solid rgba(239,68,68,0.25)',
                                            borderRadius: 10,
                                            padding: '12px 14px',
                                            marginBottom: 14,
                                            fontSize: 13,
                                            color: 'var(--danger)',
                                        }}
                                    >
                                        No agent is currently available for
                                        deposits. Please try again shortly
                                        before sending your deposit.
                                    </div>
                                )}

                                {/* Step 1  screenshot upload (Telebirr only) */}
                                {!preview &&
                                    provider === 'telebirr' &&
                                    depositMode === 'screenshot' && (
                                        <>
                                            <label
                                                htmlFor='deposit-screenshot-input'
                                                style={{
                                                    display: 'flex',
                                                    flexDirection: 'column',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    gap: 6,
                                                    padding: '28px 12px',
                                                    borderRadius: 10,
                                                    cursor: isOcrProcessing
                                                        ? 'default'
                                                        : 'pointer',
                                                    border: '1px dashed var(--border)',
                                                    background:
                                                        'rgba(255,255,255,0.02)',
                                                    marginBottom: 12,
                                                    textAlign: 'center',
                                                }}
                                            >
                                                {isOcrProcessing ? (
                                                    <>
                                                        <RefreshCw
                                                            size={20}
                                                            style={{
                                                                animation:
                                                                    'spin 1s linear infinite',
                                                                color: 'var(--text-muted)',
                                                            }}
                                                        />
                                                        <span
                                                            style={{
                                                                fontSize: 13,
                                                                color: 'var(--text-muted)',
                                                            }}
                                                        >
                                                            Reading receipt…
                                                        </span>
                                                    </>
                                                ) : (
                                                    <>
                                                        <ImageIcon
                                                            size={20}
                                                            style={{
                                                                color: 'var(--text-muted)',
                                                            }}
                                                        />
                                                        <span
                                                            style={{
                                                                fontSize: 13,
                                                                fontWeight: 700,
                                                                color: 'var(--text-secondary)',
                                                            }}
                                                        >
                                                            Upload screenshot
                                                        </span>
                                                    </>
                                                )}
                                            </label>
                                            <input
                                                id='deposit-screenshot-input'
                                                type='file'
                                                accept='image/jpeg,image/png,image/webp,image/gif'
                                                disabled={isOcrProcessing}
                                                onChange={(e) => {
                                                    void handleScreenshotSelect(
                                                        e.target.files?.[0] ??
                                                            null,
                                                    );
                                                    e.target.value = '';
                                                }}
                                                style={{ display: 'none' }}
                                            />
                                            <p
                                                style={{
                                                    fontSize: 11,
                                                    color: 'var(--text-muted)',
                                                    margin: '-4px 0 0',
                                                }}
                                            >
                                                Couldn't find a transaction
                                                number?{' '}
                                                <button
                                                    type='button'
                                                    onClick={() =>
                                                        switchDepositMode('sms')
                                                    }
                                                    style={{
                                                        background: 'none',
                                                        border: 'none',
                                                        padding: 0,
                                                        color: 'var(--gold)',
                                                        fontWeight: 700,
                                                        cursor: 'pointer',
                                                        fontSize: 11,
                                                    }}
                                                >
                                                    Paste the SMS instead
                                                </button>
                                            </p>
                                            {infraRetry === 'screenshot' && (
                                                <RetryBanner
                                                    busy={isOcrProcessing}
                                                    onRetry={retryScreenshot}
                                                />
                                            )}
                                        </>
                                    )}

                                {/* Step 1  paste & verify */}
                                {!preview &&
                                    !(
                                        provider === 'telebirr' &&
                                        depositMode === 'screenshot'
                                    ) && (
                                        <>
                                            <textarea
                                                ref={receiptInputRef}
                                                className='input'
                                                rows={4}
                                                placeholder={
                                                    provider === 'mpesa'
                                                        ? 'Paste your M-Pesa confirmation SMS…'
                                                        : 'Paste your Telebirr SMS message or receipt link…'
                                                }
                                                value={receiptInput}
                                                onChange={(e) => {
                                                    setReceiptInput(
                                                        e.target.value,
                                                    );
                                                }}
                                                style={{
                                                    width: '100%',
                                                    marginBottom: 12,
                                                    resize: 'vertical',
                                                }}
                                            />
                                            <button
                                                className='btn btn-primary btn-full'
                                                onClick={handlePreview}
                                                disabled={
                                                    isPreviewing ||
                                                    !receiptInput.trim()
                                                }
                                            >
                                                {isPreviewing ? (
                                                    <>
                                                        <RefreshCw
                                                            size={14}
                                                            style={{
                                                                animation:
                                                                    'spin 1s linear infinite',
                                                            }}
                                                        />{' '}
                                                        Verifying…
                                                    </>
                                                ) : (
                                                    <>
                                                        <Search size={14} />{' '}
                                                        Verify Receipt
                                                    </>
                                                )}
                                            </button>
                                            {infraRetry === 'preview' && (
                                                <RetryBanner
                                                    busy={isPreviewing}
                                                    onRetry={handlePreview}
                                                />
                                            )}
                                        </>
                                    )}

                                {/* Step 2  confirm details */}
                                {preview && (
                                    <motion.div
                                        initial={{ opacity: 0, y: 6 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{
                                            type: 'spring',
                                            stiffness: 300,
                                            damping: 26,
                                        }}
                                    >
                                        <div
                                            style={{
                                                background:
                                                    'rgba(16,185,129,0.07)',
                                                border: '1px solid rgba(16,185,129,0.25)',
                                                borderRadius: 10,
                                                padding: '14px 16px',
                                                marginBottom: 14,
                                            }}
                                        >
                                            <div
                                                style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: 7,
                                                    marginBottom: 10,
                                                }}
                                            >
                                                <CheckCircle
                                                    size={15}
                                                    color='#10b981'
                                                />
                                                <span
                                                    style={{
                                                        fontSize: 13,
                                                        fontWeight: 700,
                                                        color: '#10b981',
                                                    }}
                                                >
                                                    Receipt Verified
                                                </span>
                                                <span
                                                    style={{
                                                        fontSize: 11,
                                                        color: 'var(--text-muted)',
                                                        marginLeft: 'auto',
                                                    }}
                                                >
                                                    #{preview.ref}
                                                </span>
                                            </div>
                                            <div
                                                style={{
                                                    display: 'grid',
                                                    gridTemplateColumns:
                                                        '1fr 1fr',
                                                    gap: '6px 12px',
                                                    fontSize: 12,
                                                }}
                                            >
                                                <div>
                                                    <span
                                                        style={{
                                                            color: 'var(--text-muted)',
                                                            display: 'block',
                                                            fontSize: 10,
                                                            textTransform:
                                                                'uppercase',
                                                            letterSpacing:
                                                                '0.06em',
                                                        }}
                                                    >
                                                        Amount
                                                    </span>
                                                    <strong
                                                        style={{
                                                            fontSize: 18,
                                                            color: '#10b981',
                                                        }}
                                                    >
                                                        {formatCreditsFull(
                                                            preview.amountMinor,
                                                        )}{' '}
                                                        ETB
                                                    </strong>
                                                </div>
                                                {preview.payerName && (
                                                    <div>
                                                        <span
                                                            style={{
                                                                color: 'var(--text-muted)',
                                                                display:
                                                                    'block',
                                                                fontSize: 10,
                                                                textTransform:
                                                                    'uppercase',
                                                                letterSpacing:
                                                                    '0.06em',
                                                            }}
                                                        >
                                                            From
                                                        </span>
                                                        <strong>
                                                            {preview.payerName}
                                                        </strong>
                                                    </div>
                                                )}
                                                {preview.payerPhone && (
                                                    <div>
                                                        <span
                                                            style={{
                                                                color: 'var(--text-muted)',
                                                                display:
                                                                    'block',
                                                                fontSize: 10,
                                                                textTransform:
                                                                    'uppercase',
                                                                letterSpacing:
                                                                    '0.06em',
                                                            }}
                                                        >
                                                            Phone
                                                        </span>
                                                        <strong>
                                                            {preview.payerPhone}
                                                        </strong>
                                                    </div>
                                                )}
                                                {preview.receiverName && (
                                                    <div>
                                                        <span
                                                            style={{
                                                                color: 'var(--text-muted)',
                                                                display:
                                                                    'block',
                                                                fontSize: 10,
                                                                textTransform:
                                                                    'uppercase',
                                                                letterSpacing:
                                                                    '0.06em',
                                                            }}
                                                        >
                                                            To (Agent)
                                                        </span>
                                                        <strong>
                                                            {
                                                                preview.receiverName
                                                            }
                                                        </strong>
                                                    </div>
                                                )}
                                                {preview.date && (
                                                    <div>
                                                        <span
                                                            style={{
                                                                color: 'var(--text-muted)',
                                                                display:
                                                                    'block',
                                                                fontSize: 10,
                                                                textTransform:
                                                                    'uppercase',
                                                                letterSpacing:
                                                                    '0.06em',
                                                            }}
                                                        >
                                                            Date
                                                        </span>
                                                        <strong>
                                                            {formatDateTimeFull(
                                                                preview.date,
                                                            )}
                                                        </strong>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        {ocrFileUrl ? (
                                            <div
                                                style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: 6,
                                                    fontSize: 11,
                                                    color: 'var(--green)',
                                                    marginBottom: 12,
                                                }}
                                            >
                                                <ImageIcon size={13} />{' '}
                                                Screenshot attached as receipt
                                                proof
                                            </div>
                                        ) : (
                                            <div style={{ marginBottom: 12 }}>
                                                <label
                                                    style={{
                                                        display: 'block',
                                                        fontSize: 12,
                                                        color: 'var(--text-muted)',
                                                        marginBottom: 4,
                                                    }}
                                                >
                                                    Attach a photo or PDF of the
                                                    receipt (optional)
                                                </label>
                                                <input
                                                    type='file'
                                                    accept='image/jpeg,image/png,image/webp,image/gif,application/pdf'
                                                    onChange={(e) =>
                                                        setReceiptFile(
                                                            e.target
                                                                .files?.[0] ??
                                                                null,
                                                        )
                                                    }
                                                    style={{ width: '100%' }}
                                                />
                                                {receiptFile && (
                                                    <div
                                                        style={{
                                                            fontSize: 11,
                                                            color: 'var(--green)',
                                                            marginTop: 4,
                                                        }}
                                                    >
                                                        {receiptFile.name}
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                        <div
                                            style={{ display: 'flex', gap: 8 }}
                                        >
                                            <button
                                                className='btn btn-secondary'
                                                onClick={resetTopup}
                                                style={{ flex: 1 }}
                                            >
                                                <X size={13} /> Change
                                            </button>
                                            <button
                                                className='btn btn-success'
                                                onClick={handleTopup}
                                                disabled={isSubmitting}
                                                style={{ flex: 2 }}
                                            >
                                                {isSubmitting ? (
                                                    <>
                                                        <RefreshCw
                                                            size={13}
                                                            style={{
                                                                animation:
                                                                    'spin 1s linear infinite',
                                                            }}
                                                        />{' '}
                                                        Processing…
                                                    </>
                                                ) : (
                                                    <>
                                                        <CheckCircle
                                                            size={13}
                                                        />{' '}
                                                        Confirm Deposit
                                                    </>
                                                )}
                                            </button>
                                        </div>
                                        {infraRetry === 'submit' && (
                                            <RetryBanner
                                                busy={isSubmitting}
                                                onRetry={handleTopup}
                                            />
                                        )}
                                    </motion.div>
                                )}
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* ── Withdraw form ── */}
                <AnimatePresence initial={false}>
                    {showWithdraw && (
                        <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.22 }}
                            style={{ overflow: 'hidden' }}
                        >
                            <div
                                className='admin-form'
                                style={{ marginTop: 16 }}
                            >
                                <h3 style={{ margin: '0 0 4px', fontSize: 16 }}>
                                    Telebirr Cashout Request
                                </h3>
                                <p
                                    style={{
                                        fontSize: 12,
                                        color: 'var(--green)',
                                        margin: '0 0 12px',
                                    }}
                                >
                                    Available:{' '}
                                    <strong>
                                        {new Intl.NumberFormat().format(
                                            available,
                                        )}{' '}
                                        ETB
                                    </strong>
                                </p>

                                {withdrawSchedule &&
                                    !withdrawSchedule.open && (
                                        <p
                                            style={{
                                                fontSize: 13,
                                                color: 'var(--red, #ef4444)',
                                                background:
                                                    'rgba(239,68,68,0.1)',
                                                border: '1px solid rgba(239,68,68,0.3)',
                                                borderRadius: 8,
                                                padding: '8px 12px',
                                                margin: '0 0 12px',
                                            }}
                                        >
                                            {withdrawSchedule.message ??
                                                'Withdrawals are currently closed.'}
                                        </p>
                                    )}

                                <div
                                    className='preset-amounts'
                                    style={{ marginBottom: 12 }}
                                >
                                    {WITHDRAW_PRESETS.filter(
                                        (p) => p <= available,
                                    ).map((preset) => (
                                        <motion.button
                                            key={preset}
                                            className='preset-amount'
                                            onClick={() =>
                                                setWithdrawAmount(
                                                    String(preset),
                                                )
                                            }
                                            type='button'
                                            whileTap={{ scale: 0.9 }}
                                            style={
                                                withdrawAmount ===
                                                String(preset)
                                                    ? {
                                                          borderColor:
                                                              'var(--gold)',
                                                          color: 'var(--gold)',
                                                          background:
                                                              'rgba(250,204,21,0.1)',
                                                      }
                                                    : {}
                                            }
                                        >
                                            {new Intl.NumberFormat().format(
                                                preset,
                                            )}
                                        </motion.button>
                                    ))}
                                    {available > 0 && (
                                        <motion.button
                                            className='preset-amount'
                                            onClick={() =>
                                                setWithdrawAmount(
                                                    String(available),
                                                )
                                            }
                                            type='button'
                                            whileTap={{ scale: 0.9 }}
                                            style={
                                                withdrawAmount ===
                                                String(available)
                                                    ? {
                                                          borderColor:
                                                              'var(--green)',
                                                          color: 'var(--green)',
                                                          background:
                                                              'rgba(16,185,129,0.1)',
                                                      }
                                                    : {
                                                          borderColor:
                                                              'rgba(16,185,129,0.35)',
                                                          color: 'var(--green)',
                                                      }
                                            }
                                        >
                                            All (
                                            {new Intl.NumberFormat().format(
                                                available,
                                            )}
                                            )
                                        </motion.button>
                                    )}
                                </div>

                                <div style={{ marginBottom: 12 }}>
                                    <label
                                        style={{
                                            display: 'block',
                                            fontSize: 13,
                                            marginBottom: 4,
                                        }}
                                    >
                                        Amount (ETB)
                                    </label>
                                    <input
                                        type='number'
                                        step='1'
                                        min='1'
                                        max={available}
                                        className='input'
                                        placeholder={`e.g. ${Math.floor(available / 2)}`}
                                        value={withdrawAmount}
                                        onChange={(e) =>
                                            setWithdrawAmount(e.target.value)
                                        }
                                        style={{ width: '100%' }}
                                    />
                                </div>

                                {/* Fee estimate  shown whenever a valid amount is entered */}
                                {(() => {
                                    const raw = parseFloat(withdrawAmount);
                                    if (
                                        isNaN(raw) ||
                                        raw <= 0 ||
                                        !withdrawFeeConfig
                                    )
                                        return null;
                                    const amtMinor = Math.round(raw);
                                    const feeMinor = resolveFeeMinor(amtMinor);
                                    if (feeMinor === null) return null;
                                    const netMinor = amtMinor - feeMinor;
                                    if (feeMinor === 0) return null;
                                    return (
                                        <div
                                            style={{
                                                marginBottom: 12,
                                                padding: '10px 12px',
                                                background:
                                                    'rgba(250,204,21,0.06)',
                                                border: '1px solid rgba(250,204,21,0.2)',
                                                borderRadius: 10,
                                                fontSize: 12,
                                            }}
                                        >
                                            <div
                                                style={{
                                                    fontWeight: 700,
                                                    marginBottom: 6,
                                                    color: 'var(--gold)',
                                                }}
                                            >
                                                Fee Breakdown
                                            </div>
                                            <div
                                                style={{
                                                    display: 'flex',
                                                    justifyContent:
                                                        'space-between',
                                                    marginBottom: 4,
                                                    color: 'var(--text-muted)',
                                                }}
                                            >
                                                <span>Withdrawal fee</span>
                                                <span
                                                    style={{ color: '#ef4444' }}
                                                >
                                                    −
                                                    {new Intl.NumberFormat().format(
                                                        feeMinor,
                                                    )}{' '}
                                                    ETB
                                                </span>
                                            </div>
                                            <div
                                                style={{
                                                    display: 'flex',
                                                    justifyContent:
                                                        'space-between',
                                                    borderTop:
                                                        '1px solid rgba(255,255,255,0.08)',
                                                    paddingTop: 6,
                                                    fontWeight: 700,
                                                    color: 'var(--green)',
                                                }}
                                            >
                                                <span>You receive</span>
                                                <span>
                                                    {new Intl.NumberFormat().format(
                                                        netMinor,
                                                    )}{' '}
                                                    ETB
                                                </span>
                                            </div>
                                        </div>
                                    );
                                })()}

                                <div style={{ marginBottom: 16 }}>
                                    <label
                                        style={{
                                            display: 'block',
                                            fontSize: 13,
                                            marginBottom: 4,
                                        }}
                                    >
                                        Telebirr Phone Number
                                    </label>
                                    <input
                                        type='tel'
                                        className='input'
                                        placeholder='e.g. 0912345678'
                                        value={withdrawPhone}
                                        onChange={(e) =>
                                            setWithdrawPhone(e.target.value)
                                        }
                                        style={{ width: '100%' }}
                                    />
                                </div>
                                <button
                                    className='btn btn-success btn-full'
                                    onClick={handleWithdraw}
                                    disabled={
                                        isWithdrawing ||
                                        !withdrawAmount ||
                                        !withdrawPhone.trim() ||
                                        withdrawSchedule?.open === false
                                    }
                                >
                                    {isWithdrawing
                                        ? 'Submitting…'
                                        : withdrawSchedule?.open === false
                                          ? 'Withdrawals Closed'
                                          : 'Submit Withdrawal Request'}
                                </button>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </motion.section>

            {/* ── Withdrawal requests ── */}
            <AnimatePresence>
                {withdrawals.length > 0 && (
                    <motion.section
                        className='card'
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                    >
                        <div className='section-header'>
                            <div>
                                <div className='section-title'>
                                    {t('wallet.withdrawals')}
                                </div>
                                <p className='section-copy'>
                                    Track your Telebirr cashout requests.
                                </p>
                            </div>
                        </div>
                        <motion.div
                            className='list-stack'
                            variants={staggerList}
                            initial='hidden'
                            animate='show'
                        >
                            {withdrawals.map((w) => (
                                <motion.article
                                    key={w.id}
                                    className='list-card'
                                    variants={listItem}
                                >
                                    <div className='list-card-header'>
                                        <div>
                                            <h3>Telebirr Cashout</h3>
                                            <p
                                                style={{
                                                    margin: '4px 0 0',
                                                    fontSize: 13,
                                                }}
                                            >
                                                Phone: {w.destinationAccount}
                                            </p>
                                            {w.adminNotes && (
                                                <p
                                                    style={{
                                                        color: 'var(--yellow-1)',
                                                        fontSize: 12,
                                                        marginTop: 4,
                                                    }}
                                                >
                                                    Note: {w.adminNotes}
                                                </p>
                                            )}
                                        </div>
                                        <div style={{ textAlign: 'right' }}>
                                            <span
                                                className='badge'
                                                style={{
                                                    display: 'block',
                                                    marginBottom: 4,
                                                }}
                                            >
                                                {new Intl.NumberFormat().format(
                                                    w.amountMinor,
                                                )}{' '}
                                                ETB
                                            </span>
                                            <span
                                                className={`badge ${
                                                    w.status === 'completed'
                                                        ? 'badge-green'
                                                        : w.status ===
                                                            'rejected'
                                                          ? 'badge-red'
                                                          : w.status ===
                                                              'processing'
                                                            ? 'badge-violet'
                                                            : 'badge-gold'
                                                }`}
                                            >
                                                {w.status === 'pending'
                                                    ? t('wallet.pending')
                                                    : w.status === 'processing'
                                                      ? t('wallet.processing')
                                                      : w.status === 'completed'
                                                        ? t('wallet.completed')
                                                        : w.status ===
                                                            'rejected'
                                                          ? t('wallet.rejected')
                                                          : w.status}
                                            </span>
                                        </div>
                                    </div>
                                    <div className='ticket-meta'>
                                        <span>
                                            Requested:{' '}
                                            {formatDateTimeFull(w.createdAt)}
                                        </span>
                                        {w.processedAt && (
                                            <span>
                                                Processed:{' '}
                                                {formatDateTimeFull(
                                                    w.processedAt,
                                                )}
                                            </span>
                                        )}
                                    </div>
                                </motion.article>
                            ))}
                        </motion.div>
                    </motion.section>
                )}
            </AnimatePresence>

            {/* ── Transaction history ── */}
            <motion.section
                className='card'
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
            >
                <div className='section-header'>
                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                        }}
                    >
                        <TrendingUp
                            size={16}
                            style={{ color: 'var(--gold)' }}
                        />
                        <div>
                            <div className='section-title'>
                                {t('wallet.transactionHistory')}
                            </div>
                            <p className='section-copy'>
                                {t('wallet.balanceActivity')}
                            </p>
                        </div>
                    </div>
                    <motion.button
                        className='btn btn-ghost btn-sm'
                        onClick={() => void loadWallet()}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                        }}
                        whileTap={{ scale: 0.9, rotate: 180 }}
                    >
                        <RefreshCw size={13} /> {t('common.refresh')}
                    </motion.button>
                </div>

                {/* Filter chips */}
                <div className='tx-filter-row' style={{ marginBottom: 12 }}>
                    {TX_FILTERS.map((f) => (
                        <motion.button
                            key={f.id}
                            className={`tx-filter-chip${txFilter === f.id ? ' active' : ''}`}
                            onClick={() => setTxFilter(f.id)}
                            whileTap={{ scale: 0.9 }}
                            style={{ position: 'relative', overflow: 'hidden' }}
                        >
                            <span style={{ marginRight: 4 }}>{f.icon}</span>
                            {t(f.labelKey)}
                            {txFilter === f.id && (
                                <motion.span
                                    layoutId='tx-pill'
                                    style={{
                                        position: 'absolute',
                                        inset: 0,
                                        borderRadius: 'inherit',
                                        background: 'rgba(250,204,21,0.08)',
                                        zIndex: -1,
                                    }}
                                    transition={{
                                        type: 'spring',
                                        stiffness: 340,
                                        damping: 26,
                                    }}
                                />
                            )}
                        </motion.button>
                    ))}
                </div>

                {loading && ledger.length === 0 ? (
                    <div className='card-muted'>
                        {t('wallet.loadingActivity')}
                    </div>
                ) : filteredLedger.length === 0 ? (
                    <motion.div
                        className='card-muted'
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                    >
                        {txFilter === 'all'
                            ? t('wallet.noActivity')
                            : t('wallet.noTxCategory')}
                    </motion.div>
                ) : (
                    <motion.div
                        className='list-stack'
                        key={txFilter}
                        variants={staggerList}
                        initial='hidden'
                        animate='show'
                    >
                        {filteredLedger.map((entry) => (
                            <motion.article
                                key={entry.id}
                                className='list-card'
                                variants={listItem}
                            >
                                <div className='list-card-header'>
                                    <div
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 10,
                                        }}
                                    >
                                        <motion.span
                                            className={`ledger-icon ${entry.direction === 'credit' ? 'ledger-icon-credit' : 'ledger-icon-debit'}`}
                                            whileHover={{ scale: 1.15 }}
                                        >
                                            {entry.direction === 'credit' ? (
                                                <ArrowDownLeft size={14} />
                                            ) : (
                                                <ArrowUpRight size={14} />
                                            )}
                                        </motion.span>
                                        <div>
                                            <h3>
                                                {formatLedgerTitle(entry, t)}
                                            </h3>
                                            {entry.createdAt && (
                                                <p
                                                    style={{
                                                        fontSize: 12,
                                                        color: 'var(--text-muted)',
                                                        marginTop: 2,
                                                    }}
                                                >
                                                    {formatDateTimeFull(
                                                        entry.createdAt,
                                                    )}
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                    <motion.span
                                        className={`badge ${entry.direction === 'credit' ? 'badge-green' : 'badge-red'}`}
                                        initial={{ scale: 0.8, opacity: 0 }}
                                        animate={{ scale: 1, opacity: 1 }}
                                        transition={{
                                            type: 'spring',
                                            stiffness: 300,
                                            damping: 22,
                                        }}
                                    >
                                        {entry.direction === 'credit'
                                            ? '+'
                                            : '-'}
                                        {new Intl.NumberFormat().format(
                                            entry.amountMinor,
                                        )}
                                    </motion.span>
                                </div>
                                <div className='ticket-meta'>
                                    <span>
                                        {t('wallet.balanceAfter', {
                                            amount: formatCreditsFull(
                                                entry.balanceAfterMinor,
                                            ),
                                        })}
                                    </span>
                                </div>
                            </motion.article>
                        ))}
                    </motion.div>
                )}
            </motion.section>
        </motion.div>
    );
}
