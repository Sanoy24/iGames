import { useEffect, useState } from 'react';
import { agentApi, type AgentSettlement } from '../lib/api';
import {
    formatCreditsFull,
    formatDateTime,
    getErrorMessage,
} from '../lib/utils';

const STATUS_BADGE: Record<string, string> = {
    pending: 'badge-gold',
    approved: 'badge-violet',
    paid: 'badge-green',
    rejected: 'badge-red',
};

const PAYMENT_METHOD_LABEL: Record<string, string> = {
    bank_transfer: 'Bank Transfer',
    cash: 'Cash',
    mobile_money: 'Mobile Money',
    bank_branch: 'Bank Branch',
    other: 'Other',
};

export function AgentSettlementsView() {
    const [settlements, setSettlements] = useState<AgentSettlement[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        agentApi
            .getSettlements()
            .then((r) => setSettlements(r.data))
            .catch((e) => setError(getErrorMessage(e)))
            .finally(() => setLoading(false));
    }, []);

    if (loading) {
        return (
            <div
                style={{
                    textAlign: 'center',
                    padding: 24,
                    color: 'var(--text-muted)',
                    fontSize: 13,
                }}
            >
                Loading…
            </div>
        );
    }
    if (error) {
        return (
            <div style={{ padding: 12, color: 'var(--danger)', fontSize: 13 }}>
                {error}
            </div>
        );
    }
    if (settlements.length === 0) {
        return (
            <div
                style={{
                    textAlign: 'center',
                    padding: 24,
                    color: 'var(--text-muted)',
                    fontSize: 13,
                }}
            >
                No settlements recorded yet. Earnings you've made are shown on
                the Dashboard tab a settlement is recorded here once an admin
                actually pays you out.
            </div>
        );
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {settlements.map((s) => (
                <div
                    key={s.id}
                    style={{
                        background: 'var(--card-bg)',
                        border: '1px solid var(--border)',
                        borderRadius: 12,
                        padding: 12,
                    }}
                >
                    <div
                        style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            marginBottom: 8,
                        }}
                    >
                        <div style={{ fontSize: 12, fontWeight: 700 }}>
                            {formatDateTime(s.periodStart)} –{' '}
                            {formatDateTime(s.periodEnd)}
                        </div>
                        <span
                            className={`badge ${STATUS_BADGE[s.status] ?? 'badge-gold'}`}
                        >
                            {s.status}
                        </span>
                    </div>
                    <div
                        style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(2, 1fr)',
                            gap: 6,
                            fontSize: 12,
                        }}
                    >
                        <div>
                            <span style={{ color: 'var(--text-muted)' }}>
                                Game Commission
                            </span>{' '}
                            {formatCreditsFull(s.gameCommissionMinor)}
                        </div>
                        <div>
                            <span style={{ color: 'var(--text-muted)' }}>
                                Withdrawal Fees
                            </span>{' '}
                            {formatCreditsFull(s.withdrawalFeesMinor)}
                        </div>
                        <div>
                            <span style={{ color: 'var(--text-muted)' }}>
                                Total Earned
                            </span>{' '}
                            {formatCreditsFull(s.totalEarnedMinor)}
                        </div>
                        <div>
                            <span style={{ color: 'var(--text-muted)' }}>
                                {s.status === 'paid'
                                    ? 'Amount Paid'
                                    : 'Amount Requested'}
                            </span>{' '}
                            <strong style={{ color: 'var(--accent)' }}>
                                {formatCreditsFull(s.amountPaidMinor)}
                            </strong>
                        </div>
                        <div style={{ gridColumn: 'span 2' }}>
                            <span style={{ color: 'var(--text-muted)' }}>
                                Outstanding Balance
                            </span>{' '}
                            {formatCreditsFull(s.outstandingBalanceMinor)}
                        </div>
                    </div>
                    {s.status === 'paid' && (
                        <div
                            style={{
                                marginTop: 8,
                                paddingTop: 8,
                                borderTop: '1px solid var(--border)',
                                fontSize: 11,
                                color: 'var(--text-muted)',
                            }}
                        >
                            <div>
                                Paid {s.paidAt ? formatDateTime(s.paidAt) : ''}{' '}
                                via{' '}
                                {s.paymentMethod
                                    ? (PAYMENT_METHOD_LABEL[s.paymentMethod] ??
                                      s.paymentMethod)
                                    : ''}
                            </div>
                            <div>FT Number: {s.ftNumber ?? ''}</div>
                            {s.receiptFileUrl && (
                                <a
                                    href={`/uploads/${s.receiptFileUrl}`}
                                    target='_blank'
                                    rel='noreferrer'
                                >
                                    View receipt
                                </a>
                            )}
                        </div>
                    )}
                    {s.notes && (
                        <div
                            style={{
                                marginTop: 6,
                                fontSize: 11,
                                color: 'var(--text-muted)',
                                fontStyle: 'italic',
                            }}
                        >
                            {s.notes}
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
}
