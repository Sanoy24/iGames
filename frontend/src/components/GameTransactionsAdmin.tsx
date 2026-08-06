import { useCallback, useEffect, useState } from 'react';
import { History, Download } from 'lucide-react';
import { adminGameTransactionsApi } from '../lib/api';
import { getErrorMessage, formatCreditsFull } from '../lib/utils';

export function GameTransactionsAdmin() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalBotWinMinor, setTotalBotWinMinor] = useState(0);

  const limit = 20;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminGameTransactionsApi.getGameTransactions(page, limit);
      setData(res.data);
      setTotal(res.total);
      setTotalBotWinMinor(res.totalBotWinMinor);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    void load();
  }, [load]);

  const exportToCsv = () => {
    if (!data || data.length === 0) return;
    const headers = ['Date/Time', 'ID', 'Game Type', 'Tickets Sold', 'Single Stake (ETB)', 'Players', 'Bots', 'Bot Tickets', 'Agents', 'Amount Bot Won (ETB)', 'Real e-Money Earned (ETB)'];
    const rows = data.map(r => [
      `"${new Date(r.createdAt).toLocaleString()}"`,
      r.id,
      r.gameType,
      r.ticketsSold,
      (r.singleStake / 100).toFixed(2),
      r.numberOfPlayers,
      r.numberOfBots,
      r.ticketsTakenByBot,
      `"${r.agents || ''}"`,
      (r.amountBotWon / 100).toFixed(2),
      (r.realEmoneyEarned / 100).toFixed(2)
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `game-transactions-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="adm-panel">
      <div className="adm-panel-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <History size={18} /> Game Transactions
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-sm btn-ghost" onClick={exportToCsv} disabled={data.length === 0}>
            <Download size={14} /> Export CSV
          </button>
          <button className="btn btn-sm btn-ghost" onClick={load} disabled={loading} style={{ margin: 0 }}>
            Refresh
          </button>
        </div>
      </div>

      {error && <div className="adm-error-box" style={{ margin: '12px 16px' }}>{error}</div>}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 16px 12px' }}>
        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Total real money bot has won (all time, all Bingo rooms):</span>
        <span className="badge badge-gold" style={{ fontSize: 13 }}>{formatCreditsFull(totalBotWinMinor)} ETB</span>
      </div>

      <div className="adm-table-wrap">
        <table className="adm-table">
          <thead>
            <tr className="adm-tr">
              <th>Date/Time</th>
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
              <tr><td colSpan={11} style={{ textAlign: 'center', padding: 20 }}>Loading...</td></tr>
            ) : data.length === 0 ? (
              <tr><td colSpan={11} style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)' }}>No completed games found.</td></tr>
            ) : (
              data.map((row) => (
                <tr className="adm-tr" key={row.id}>
                  <td style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{new Date(row.createdAt).toLocaleString()}</td>
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
