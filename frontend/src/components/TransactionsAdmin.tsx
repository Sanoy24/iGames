import { Fragment, useCallback, useEffect, useState } from 'react';
import { Receipt, X, Download } from 'lucide-react';
import {
    adminTransactionsApi,
    type AdminTransaction,
    type AdminTransactionEntryType,
    type TransactionSourceDetail,
} from '../lib/api';
import { getErrorMessage, formatCreditsFull } from '../lib/utils';

const ENTRY_TYPES: AdminTransactionEntryType[] = [
    'deposit',
    'adjustment',
    'bonus',
    'withdrawal',
    'agent_receipt',
    'reversal',
];

const ENTRY_TYPE_LABEL: Record<AdminTransactionEntryType, string> = {
    deposit: 'Deposit',
    adjustment: 'Adjustment',
    bonus: 'Bonus',
    withdrawal: 'Withdrawal',
    agent_receipt: 'Agent Receipt',
    reversal: 'Reversal',
};

/** Which admin action produced a row  human label + badge color, keyed by
 * ledger sourceType. Unknown sourceTypes just render as-is (still readable). */
const SOURCE_TYPE_LABEL: Record<string, string> = {
    telebirr_receipt: 'Telebirr Deposit',
    mpesa_receipt: 'M-Pesa Deposit',
    admin_topup: 'Admin Top-up',
    admin_to_agent_transfer: 'Transfer to Agent',
    agent_to_user_transfer: 'Agent → Player',
    agent_deposit_funding: 'Agent-Funded Deposit',
    master_wallet_funding: 'Master Wallet Funding',
    admin_adjustment: 'Manual Adjustment',
    withdrawal: 'Withdrawal',
    welcome_bonus: 'Welcome Bonus',
    deposit_cashback: 'Deposit Cashback',
    deposit_cashback_funding: 'Deposit Cashback (funding)',
};

/** Turns a camelCase/snake_case key into a human-readable label. */
function humanizeKey(key: string): string {
    return key
        .replace(/_/g, ' ')
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/\b\w/g, (c) => c.toUpperCase());
}

function RawFieldsTable({
    title,
    data,
}: {
    title: string;
    data: Record<string, unknown> | null | undefined;
}) {
    if (!data || Object.keys(data).length === 0) return null;
    return (
        <div>
            <div
                style={{
                    fontSize: 11,
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                    color: 'var(--text-muted)',
                    marginBottom: 6,
                }}
            >
                {title}
            </div>
            <div
                style={{
                    display: 'grid',
                    gridTemplateColumns: 'max-content 1fr',
                    gap: '4px 12px',
                    fontSize: 12,
                }}
            >
                {Object.entries(data).map(([key, value]) => (
                    <Fragment key={key}>
                        <span style={{ color: 'var(--text-muted)' }}>
                            {humanizeKey(key)}
                        </span>
                        <span style={{ wordBreak: 'break-word' }}>
                            {value === null ||
                            value === undefined ||
                            value === ''
                                ? ''
                                : String(value)}
                        </span>
                    </Fragment>
                ))}
            </div>
        </div>
    );
}

/** Does this row have a richer source record worth fetching (a deposit
 * receipt or a withdrawal), as opposed to one where the ledger entry itself
 * (shown via its own metadata) is already the whole story? */
function sourceKind(
    row: AdminTransaction,
): 'telebirr' | 'mpesa' | 'withdrawal' | null {
    if (row.sourceType === 'telebirr_receipt') return 'telebirr';
    if (row.sourceType === 'mpesa_receipt') return 'mpesa';
    if (row.sourceType === 'withdrawal') return 'withdrawal';
    return null;
}

export function TransactionsAdmin() {
    const [data, setData] = useState<AdminTransaction[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [page, setPage] = useState(1);
    const [total, setTotal] = useState(0);
    const [exporting, setExporting] = useState(false);

    const [search, setSearch] = useState('');
    const [entryType, setEntryType] = useState<Set<AdminTransactionEntryType>>(
        new Set(),
    );
    const [sourceType, setSourceType] = useState('');
    const [direction, setDirection] = useState<'' | 'credit' | 'debit'>('');
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');

    const [detailRow, setDetailRow] = useState<AdminTransaction | null>(null);

    const limit = 50;

    const filters = {
        page,
        limit,
        search: search.trim() || undefined,
        entryType: entryType.size > 0 ? Array.from(entryType) : undefined,
        sourceType: sourceType.trim() || undefined,
        direction: direction || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
    };
    // Stable key so the load effect only re-fires when a filter actually
    // changes, not on every render (the object above is a fresh reference
    // each time).
    const filterKey = JSON.stringify(filters);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await adminTransactionsApi.list(
                JSON.parse(filterKey),
            );
            setData(res.data);
            setTotal(res.total);
        } catch (e) {
            setError(getErrorMessage(e));
        } finally {
            setLoading(false);
        }
    }, [filterKey]);

    useEffect(() => {
        void load();
    }, [load]);

    const toggleEntryType = (t: AdminTransactionEntryType) => {
        setPage(1);
        setEntryType((prev) => {
            const next = new Set(prev);
            if (next.has(t)) next.delete(t);
            else next.add(t);
            return next;
        });
    };

    const runExport = async () => {
        setExporting(true);
        try {
            await adminTransactionsApi.exportCsv(JSON.parse(filterKey));
        } catch (e) {
            setError(getErrorMessage(e));
        } finally {
            setExporting(false);
        }
    };

    return (
        <div className='adm-panel'>
            <div
                className='adm-panel-head'
                style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: 8,
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Receipt size={18} /> Transactions
                </div>
                <button
                    className='btn btn-sm btn-ghost'
                    onClick={runExport}
                    disabled={exporting}
                    style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                >
                    <Download size={14} />
                    {exporting ? 'Exporting…' : 'Export CSV'}
                </button>
            </div>

            <div
                style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 8,
                    padding: '12px 16px',
                    borderBottom: '1px solid var(--border)',
                }}
            >
                <input
                    className='input'
                    placeholder='Search player/agent name or phone'
                    value={search}
                    onChange={(e) => {
                        setSearch(e.target.value);
                        setPage(1);
                    }}
                    style={{ minWidth: 220, fontSize: 12 }}
                />
                <input
                    className='input'
                    placeholder='Source type (e.g. admin_to_agent_transfer)'
                    value={sourceType}
                    onChange={(e) => {
                        setSourceType(e.target.value);
                        setPage(1);
                    }}
                    style={{ minWidth: 220, fontSize: 12 }}
                />
                <select
                    className='input'
                    value={direction}
                    onChange={(e) => {
                        setDirection(e.target.value as '' | 'credit' | 'debit');
                        setPage(1);
                    }}
                    style={{ fontSize: 12 }}
                >
                    <option value=''>Credit + Debit</option>
                    <option value='credit'>Credit only</option>
                    <option value='debit'>Debit only</option>
                </select>
                <input
                    className='input'
                    type='date'
                    value={dateFrom}
                    onChange={(e) => {
                        setDateFrom(e.target.value);
                        setPage(1);
                    }}
                    style={{ fontSize: 12 }}
                />
                <span
                    style={{
                        alignSelf: 'center',
                        color: 'var(--text-muted)',
                        fontSize: 12,
                    }}
                >
                    to
                </span>
                <input
                    className='input'
                    type='date'
                    value={dateTo}
                    onChange={(e) => {
                        setDateTo(e.target.value);
                        setPage(1);
                    }}
                    style={{ fontSize: 12 }}
                />
                <button
                    className='btn btn-sm btn-ghost'
                    onClick={load}
                    disabled={loading}
                >
                    Refresh
                </button>
            </div>

            <div
                style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 6,
                    padding: '0 16px 12px',
                }}
            >
                {ENTRY_TYPES.map((t) => (
                    <button
                        key={t}
                        className={`btn btn-sm ${entryType.has(t) ? 'btn-primary' : 'btn-ghost'}`}
                        onClick={() => toggleEntryType(t)}
                    >
                        {ENTRY_TYPE_LABEL[t]}
                    </button>
                ))}
                {entryType.size > 0 && (
                    <button
                        className='btn btn-sm btn-ghost'
                        onClick={() => {
                            setEntryType(new Set());
                            setPage(1);
                        }}
                    >
                        Clear types
                    </button>
                )}
            </div>

            {error && (
                <div className='adm-error-box' style={{ margin: '0 16px 12px' }}>
                    {error}
                </div>
            )}

            <div className='adm-table-wrap'>
                <table className='adm-table'>
                    <thead>
                        <tr className='adm-tr'>
                            <th>Date/Time</th>
                            <th>User</th>
                            <th>Phone</th>
                            <th>Direction</th>
                            <th>Type</th>
                            <th>Source</th>
                            <th>Amount</th>
                            <th>Balance After</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading && data.length === 0 ? (
                            <tr>
                                <td
                                    colSpan={9}
                                    style={{ textAlign: 'center', padding: 20 }}
                                >
                                    Loading...
                                </td>
                            </tr>
                        ) : data.length === 0 ? (
                            <tr>
                                <td
                                    colSpan={9}
                                    style={{
                                        textAlign: 'center',
                                        padding: 20,
                                        color: 'var(--text-muted)',
                                    }}
                                >
                                    No transactions found.
                                </td>
                            </tr>
                        ) : (
                            data.map((row) => (
                                <tr className='adm-tr' key={row.id}>
                                    <td
                                        style={{
                                            fontSize: 11,
                                            whiteSpace: 'nowrap',
                                        }}
                                    >
                                        {new Date(
                                            row.createdAt,
                                        ).toLocaleString()}
                                    </td>
                                    <td style={{ fontSize: 12 }}>
                                        {row.user?.displayName ??
                                            row.userId.slice(0, 8)}
                                    </td>
                                    <td style={{ fontSize: 12 }}>
                                        {row.user?.phoneNumber ?? ''}
                                    </td>
                                    <td>
                                        <span
                                            className={`badge ${row.direction === 'credit' ? 'badge-green' : 'badge-red'}`}
                                        >
                                            {row.direction}
                                        </span>
                                    </td>
                                    <td style={{ fontSize: 12 }}>
                                        {ENTRY_TYPE_LABEL[row.entryType] ??
                                            row.entryType}
                                    </td>
                                    <td style={{ fontSize: 12 }}>
                                        {SOURCE_TYPE_LABEL[row.sourceType] ??
                                            row.sourceType}
                                    </td>
                                    <td>
                                        {formatCreditsFull(row.amountMinor)}{' '}
                                        ETB
                                    </td>
                                    <td style={{ color: 'var(--text-muted)' }}>
                                        {formatCreditsFull(
                                            row.balanceAfterMinor,
                                        )}{' '}
                                        ETB
                                    </td>
                                    <td>
                                        <button
                                            className='btn btn-sm btn-ghost'
                                            onClick={() => setDetailRow(row)}
                                        >
                                            Details
                                        </button>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            {total > limit && (
                <div
                    style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '12px 16px',
                        borderTop: '1px solid var(--border)',
                    }}
                >
                    <span
                        style={{ fontSize: 12, color: 'var(--text-secondary)' }}
                    >
                        Page <strong>{page}</strong> of{' '}
                        <strong>{Math.ceil(total / limit)}</strong> ({total}{' '}
                        entries)
                    </span>
                    <div style={{ display: 'flex', gap: 8 }}>
                        <button
                            className='btn btn-secondary btn-sm'
                            onClick={() => setPage((p) => Math.max(1, p - 1))}
                            disabled={page === 1 || loading}
                        >
                            Previous
                        </button>
                        <button
                            className='btn btn-secondary btn-sm'
                            onClick={() => setPage((p) => p + 1)}
                            disabled={page * limit >= total || loading}
                        >
                            Next
                        </button>
                    </div>
                </div>
            )}

            {detailRow && (
                <TransactionDetailModal
                    row={detailRow}
                    onClose={() => setDetailRow(null)}
                />
            )}
        </div>
    );
}

function TransactionDetailModal({
    row,
    onClose,
}: {
    row: AdminTransaction;
    onClose: () => void;
}) {
    const kind = sourceKind(row);
    const [sourceDetail, setSourceDetail] =
        useState<TransactionSourceDetail | null>(null);
    const [loadingSource, setLoadingSource] = useState(!!kind);
    const [sourceError, setSourceError] = useState<string | null>(null);

    useEffect(() => {
        if (!kind) return;
        let cancelled = false;
        setLoadingSource(true);
        setSourceError(null);
        const fetchPromise =
            kind === 'withdrawal'
                ? adminTransactionsApi.getWithdrawalDetail(row.sourceId)
                : adminTransactionsApi.getDepositDetail(kind, row.sourceId);
        fetchPromise
            .then((detail) => {
                if (!cancelled) setSourceDetail(detail);
            })
            .catch((e) => {
                if (!cancelled) setSourceError(getErrorMessage(e));
            })
            .finally(() => {
                if (!cancelled) setLoadingSource(false);
            });
        return () => {
            cancelled = true;
        };
    }, [kind, row.sourceId]);

    return (
        <div
            onClick={onClose}
            style={{
                position: 'fixed',
                inset: 0,
                background: 'rgba(0,0,0,0.6)',
                zIndex: 1000,
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'center',
                overflowY: 'auto',
                padding: 20,
            }}
        >
            <div
                className='adm-panel'
                onClick={(e) => e.stopPropagation()}
                style={{
                    maxWidth: 640,
                    width: '100%',
                    margin: 'auto',
                    maxHeight: '90vh',
                    overflowY: 'auto',
                }}
            >
                <div
                    className='adm-panel-head'
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                    }}
                >
                    <span>
                        {SOURCE_TYPE_LABEL[row.sourceType] ?? row.sourceType}
                    </span>
                    <button className='adm-icon-btn' onClick={onClose}>
                        <X size={15} />
                    </button>
                </div>

                <div
                    style={{
                        padding: 16,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 16,
                    }}
                >
                    <div
                        style={{
                            display: 'flex',
                            flexWrap: 'wrap',
                            gap: 8,
                            alignItems: 'center',
                        }}
                    >
                        <span
                            className={`badge ${row.direction === 'credit' ? 'badge-green' : 'badge-red'}`}
                        >
                            {row.direction}
                        </span>
                        <strong style={{ fontSize: 18 }}>
                            {formatCreditsFull(row.amountMinor)} ETB
                        </strong>
                        <span
                            style={{ fontSize: 11, color: 'var(--text-muted)' }}
                        >
                            {new Date(row.createdAt).toLocaleString()}
                        </span>
                    </div>

                    <RawFieldsTable
                        title='Ledger entry'
                        data={{
                            user: row.user?.displayName,
                            phone: row.user?.phoneNumber,
                            userId: row.userId,
                            entryType: row.entryType,
                            sourceType: row.sourceType,
                            sourceId: row.sourceId,
                            balanceAfter: `${formatCreditsFull(row.balanceAfterMinor)} ETB`,
                        }}
                    />

                    <RawFieldsTable title='Metadata' data={row.metadata} />

                    {kind && loadingSource && (
                        <div
                            style={{ fontSize: 12, color: 'var(--text-muted)' }}
                        >
                            Loading source record…
                        </div>
                    )}
                    {kind && sourceError && (
                        <div className='adm-error-box'>{sourceError}</div>
                    )}
                    {kind === 'withdrawal' && sourceDetail && (
                        <RawFieldsTable
                            title='Withdrawal record'
                            data={{
                                status: sourceDetail.status,
                                destinationAccount:
                                    sourceDetail.destinationAccount,
                                agent: sourceDetail.agent?.displayName,
                                serviceCharge: sourceDetail.serviceChargeMinor,
                                netAmount: sourceDetail.netAmountMinor,
                                telebirrReference:
                                    sourceDetail.telebirrReference,
                                adminNotes: sourceDetail.adminNotes,
                            }}
                        />
                    )}
                    {(kind === 'telebirr' || kind === 'mpesa') &&
                        sourceDetail && (
                            <RawFieldsTable
                                title='Deposit record'
                                data={{
                                    status: sourceDetail.status,
                                    fundedBy: sourceDetail.fundedBy,
                                    agent: sourceDetail.agent?.displayName,
                                    payerName: sourceDetail.payerName,
                                    payerPhone: sourceDetail.payerPhone,
                                    verificationStatus:
                                        sourceDetail.verificationStatus,
                                }}
                            />
                        )}
                </div>
            </div>
        </div>
    );
}
