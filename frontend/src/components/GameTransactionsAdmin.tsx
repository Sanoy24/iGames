import { useCallback, useEffect, useState } from 'react';
import { History } from 'lucide-react';
import { adminGameTransactionsApi } from '../lib/api';
import { getErrorMessage, formatCreditsFull } from '../lib/utils';

export function GameTransactionsAdmin() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  const limit = 20;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminGameTransactionsApi.getGameTransactions(page, limit);
      setData(res.data);
      setTotal(res.total);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 16, margin: 0 }}>
          <History size={18} /> Game Transactions
        </h2>
        <button className="btn btn-sm btn-ghost" onClick={load} disabled={loading}>
          Refresh
        </button>
      </div>

      {error && <div className="adm-error-box" style={{ marginBottom: 12 }}>{error}</div>}

      <div className="table-responsive">
        <table className="table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Game Type</th>
              <th>Tickets Sold</th>
              <th>Single Stake</th>
              <th>Players</th>
              <th>Bots</th>
              <th>Bot Tickets</th>
              <th>Agents</th>
              <th>Amount Bot Won</th>
              <th>Real e-Money Earned</th>
            </tr>
          </thead>
          <tbody>
            {loading && data.length === 0 ? (
              <tr><td colSpan={10} style={{ textAlign: 'center', padding: 20 }}>Loading...</td></tr>
            ) : data.length === 0 ? (
              <tr><td colSpan={10} style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)' }}>No completed games found.</td></tr>
            ) : (
              data.map((row) => (
                <tr key={row.id}>
                  <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{row.id.slice(0, 8)}...</td>
                  <td><span className="badge badge-indigo">{row.gameType}</span></td>
                  <td>{row.ticketsSold}</td>
                  <td>{formatCreditsFull(row.singleStake)} ETB</td>
                  <td>{row.numberOfPlayers}</td>
                  <td>{row.numberOfBots}</td>
                  <td>{row.ticketsTakenByBot}</td>
                  <td style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row.agents}>
                    {row.agents || '-'}
                  </td>
                  <td><span className="badge badge-gold">{formatCreditsFull(row.amountBotWon)} ETB</span></td>
                  <td><span className="badge badge-green">{formatCreditsFull(row.realEmoneyEarned)} ETB</span></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {total > limit && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Showing {(page - 1) * limit + 1} - {Math.min(page * limit, total)} of {total}
          </span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn btn-sm btn-ghost" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1 || loading}>
              Previous
            </button>
            <button className="btn btn-sm btn-ghost" onClick={() => setPage((p) => p + 1)} disabled={page * limit >= total || loading}>
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
