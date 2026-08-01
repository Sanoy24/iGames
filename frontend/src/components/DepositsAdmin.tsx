import { useCallback, useEffect, useState } from 'react';
import { Banknote } from 'lucide-react';
import { adminDepositsApi } from '../lib/api';
import { getErrorMessage, formatCreditsFull } from '../lib/utils';

const FUNDED_BY_LABEL: Record<string, string> = {
  agent_wallet: 'Agent Wallet',
  master_wallet: 'Master Wallet',
};
const FUNDED_BY_BADGE: Record<string, string> = {
  agent_wallet: 'badge-violet',
  master_wallet: 'badge-indigo',
};
const FALLBACK_REASON_LABEL: Record<string, string> = {
  agent_inactive: 'agent inactive',
  insufficient_agent_balance: 'insufficient agent balance',
  no_agent_matched: 'no agent matched',
};
const VERIFICATION_BADGE: Record<string, string> = {
  unverified: 'badge-gold',
  verified: 'badge-green',
  flagged: 'badge-red',
};

export function DepositsAdmin() {
  const [provider, setProvider] = useState<'telebirr' | 'mpesa'>('telebirr');
  const [status, setStatus] = useState<'' | 'credited' | 'rejected'>('');
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [verifying, setVerifying] = useState<string | null>(null);

  const limit = 20;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminDepositsApi.getDeposits(provider, page, limit, status || undefined);
      setData(res.data);
      setTotal(res.total);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [provider, page, status]);

  useEffect(() => {
    void load();
  }, [load]);

  const switchProvider = (p: 'telebirr' | 'mpesa') => {
    setProvider(p);
    setPage(1);
  };

  const switchStatus = (s: '' | 'credited' | 'rejected') => {
    setStatus(s);
    setPage(1);
  };

  const verify = async (id: string, verificationStatus: 'verified' | 'flagged') => {
    setVerifying(id);
    try {
      await adminDepositsApi.verifyDeposit(provider, id, verificationStatus);
      await load();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setVerifying(null);
    }
  };

  return (
    <div className="adm-panel">
      <div className="adm-panel-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Banknote size={18} /> Deposits
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className={`btn btn-sm ${provider === 'telebirr' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => switchProvider('telebirr')}>Telebirr</button>
          <button className={`btn btn-sm ${provider === 'mpesa' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => switchProvider('mpesa')}>M-Pesa</button>
          <select className="input" value={status} onChange={(e) => switchStatus(e.target.value as '' | 'credited' | 'rejected')} style={{ fontSize: 12 }}>
            <option value="">All statuses</option>
            <option value="credited">Credited</option>
            <option value="rejected">Rejected</option>
          </select>
          <button className="btn btn-sm btn-ghost" onClick={load} disabled={loading} style={{ margin: 0 }}>Refresh</button>
        </div>
      </div>

      {error && <div className="adm-error-box" style={{ margin: '12px 16px' }}>{error}</div>}

      <div className="adm-table-wrap">
        <table className="adm-table">
          <thead>
            <tr className="adm-tr">
              <th>Date/Time</th>
              <th>Player</th>
              <th>Phone</th>
              <th>Agent</th>
              <th>Amount</th>
              <th>Status</th>
              <th>Funded By</th>
              <th>Reason</th>
              <th>FT Number</th>
              <th>Receipt</th>
              <th>Verification</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading && data.length === 0 ? (
              <tr><td colSpan={12} style={{ textAlign: 'center', padding: 20 }}>Loading...</td></tr>
            ) : data.length === 0 ? (
              <tr><td colSpan={12} style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)' }}>No deposits found.</td></tr>
            ) : (
              data.map((row) => {
                const reference = row.receiptNo ?? row.confirmationCode;
                const rejectionError = row.status === 'rejected'
                  ? (row.verification?.error as string | undefined)
                  : undefined;
                const reason = row.status === 'credited'
                  ? (row.fundingFallbackReason ? FALLBACK_REASON_LABEL[row.fundingFallbackReason] ?? row.fundingFallbackReason : '—')
                  : (rejectionError ?? '—');
                const verificationStatus = row.verificationStatus ?? 'unverified';
                return (
                  <tr className="adm-tr" key={row.id}>
                    <td style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{new Date(row.createdAt).toLocaleString()}</td>
                    <td style={{ fontSize: 12 }}>{row.user?.displayName ?? row.userId?.slice(0, 8)}</td>
                    <td style={{ fontSize: 12 }}>{row.user?.phoneNumber ?? '—'}</td>
                    <td style={{ fontSize: 12 }}>{row.agent?.displayName ?? '—'}</td>
                    <td>{formatCreditsFull(row.amountMinor)} ETB</td>
                    <td><span className={`badge ${row.status === 'credited' ? 'badge-green' : 'badge-red'}`}>{row.status}</span></td>
                    <td>
                      {row.status === 'credited' && row.fundedBy
                        ? <span className={`badge ${FUNDED_BY_BADGE[row.fundedBy] ?? 'badge-gold'}`}>{FUNDED_BY_LABEL[row.fundedBy] ?? row.fundedBy}</span>
                        : '—'}
                    </td>
                    <td style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={reason}>{reason}</td>
                    <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{reference}</td>
                    <td style={{ fontSize: 11 }}>
                      {row.receiptFileUrl
                        ? <a href={`/uploads/${row.receiptFileUrl}`} target="_blank" rel="noreferrer">View</a>
                        : '—'}
                    </td>
                    <td style={{ fontSize: 11 }}>
                      <span className={`badge ${VERIFICATION_BADGE[verificationStatus]}`}>{verificationStatus}</span>
                      {row.verifiedBy && (
                        <div style={{ color: 'var(--text-muted)', marginTop: 2 }}>
                          by {row.verifiedBy.slice(0, 8)}{row.verifiedAt ? ` · ${new Date(row.verifiedAt).toLocaleString()}` : ''}
                        </div>
                      )}
                    </td>
                    <td style={{ display: 'flex', gap: 4 }}>
                      <button className="btn btn-sm btn-ghost" disabled={verifying === row.id} onClick={() => verify(row.id, 'verified')}>Verify</button>
                      <button className="btn btn-sm btn-ghost" disabled={verifying === row.id} onClick={() => verify(row.id, 'flagged')}>Flag</button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {total > limit && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderTop: '1px solid var(--border)' }}>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            Page <strong>{page}</strong> of <strong>{Math.ceil(total / limit)}</strong> ({total} entries)
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary btn-sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1 || loading}>
              Previous
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => setPage((p) => p + 1)} disabled={page * limit >= total || loading}>
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
