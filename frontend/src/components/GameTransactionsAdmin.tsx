import { useCallback, useEffect, useState } from 'react';
import { History, Download } from 'lucide-react';
import { adminGameTransactionsApi, type GameTransactionsDashboard } from '../lib/api';
import { getErrorMessage, formatCreditsFull } from '../lib/utils';
import { Donut, Bar, MiniTrendChart } from './AdminCharts';

const BOT_COLOR = '#a855f7';
const REAL_COLOR = '#10b981';

const SOURCE_LABEL: Record<string, string> = {
  bingo_ticket: 'Ticket-tied wins (natural + redirected)',
  bingo_bot_win_interval: 'Bonus faucet (no ticket/stake behind it)',
};

function GameTransactionsDashboardPanels({ d }: { d: GameTransactionsDashboard }) {
  const winTotal = d.winSplit.botWinMinor + d.winSplit.realWinMinor;
  const ticketTotal = d.ticketSplit.botTickets + d.ticketSplit.realTickets;
  const maxSourceAmount = Math.max(1, ...d.botWinBySource.map((s) => s.amountMinor));
  const maxAgentEarned = Math.max(
    1,
    ...d.revenueByAgent.map((a) => Math.abs(a.realEmoneyEarnedMinor)),
  );

  const roomTrendData = d.roomParticipationTrend.map((r) => ({
    label: new Date(r.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    series: [
      { value: r.realPlayers, color: REAL_COLOR, title: `${r.realPlayers} real players` },
      { value: r.bots, color: BOT_COLOR, title: `${r.bots} bots` },
    ],
  }));

  const dailyTrendData = d.dailyTrend.map((r) => ({
    label: new Date(r.day).toLocaleDateString([], { month: 'numeric', day: 'numeric' }),
    series: [
      { value: r.realStakeMinor, color: '#3b82f6', title: `Real stake: ${formatCreditsFull(r.realStakeMinor)} ETB` },
      { value: r.realPayoutMinor, color: REAL_COLOR, title: `Real payout: ${formatCreditsFull(r.realPayoutMinor)} ETB` },
      { value: r.botPayoutMinor, color: BOT_COLOR, title: `Bot payout: ${formatCreditsFull(r.botPayoutMinor)} ETB` },
    ],
  }));

  return (
    <div className="stack-lg" style={{ marginBottom: 16 }}>
      <div className="adm-dash-grid">
        {/* #1: Bot win vs real player win */}
        <div className="adm-panel">
          <div className="adm-panel-head">Bot Win vs Real Player Win</div>
          <div className="adm-donut-wrap">
            {winTotal === 0 ? (
              <div className="adm-empty" style={{ width: '100%' }}>No win activity yet.</div>
            ) : (
              <>
                <Donut
                  segments={[
                    { label: 'Bot winnings', value: d.winSplit.botWinMinor, color: BOT_COLOR },
                    { label: 'Real player winnings', value: d.winSplit.realWinMinor, color: REAL_COLOR },
                  ]}
                />
                <div className="adm-legend">
                  <div className="adm-legend-row">
                    <span className="adm-legend-dot" style={{ background: BOT_COLOR }} />
                    <span className="adm-legend-label">Bot winnings</span>
                    <span className="adm-legend-val">{formatCreditsFull(d.winSplit.botWinMinor)} ETB</span>
                  </div>
                  <div className="adm-legend-row">
                    <span className="adm-legend-dot" style={{ background: REAL_COLOR }} />
                    <span className="adm-legend-label">Real player winnings</span>
                    <span className="adm-legend-val">{formatCreditsFull(d.winSplit.realWinMinor)} ETB</span>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* #4: Bot win by source */}
        <div className="adm-panel">
          <div className="adm-panel-head">Bot Winnings — Where It Comes From</div>
          <p className="adm-field-hint" style={{ padding: '0 16px' }}>
            Splits bot winnings into wins tied to an actual ticket vs. the unconditional bonus
            credit that has no stake or game outcome behind it.
          </p>
          <div className="adm-metric-list">
            {d.botWinBySource.length === 0 ? (
              <div className="adm-empty">No bot winnings recorded yet.</div>
            ) : (
              d.botWinBySource.map((s) => (
                <div key={s.source} className="adm-metric-row">
                  <span className="adm-metric-label">{SOURCE_LABEL[s.source] ?? s.source}</span>
                  <Bar
                    value={s.amountMinor}
                    max={maxSourceAmount}
                    color={s.source === 'bingo_bot_win_interval' ? '#ef4444' : BOT_COLOR}
                  />
                  <span className="adm-metric-val">{formatCreditsFull(s.amountMinor)} ETB</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="adm-dash-grid">
        {/* #2: Tickets sold real vs bot */}
        <div className="adm-panel">
          <div className="adm-panel-head">Tickets Sold — Real vs Bot</div>
          <div className="adm-donut-wrap">
            {ticketTotal === 0 ? (
              <div className="adm-empty" style={{ width: '100%' }}>No tickets sold yet.</div>
            ) : (
              <>
                <Donut
                  segments={[
                    { label: 'Bot tickets', value: d.ticketSplit.botTickets, color: BOT_COLOR },
                    { label: 'Real player tickets', value: d.ticketSplit.realTickets, color: REAL_COLOR },
                  ]}
                />
                <div className="adm-legend">
                  <div className="adm-legend-row">
                    <span className="adm-legend-dot" style={{ background: BOT_COLOR }} />
                    <span className="adm-legend-label">Bot tickets</span>
                    <span className="adm-legend-val">{d.ticketSplit.botTickets}</span>
                  </div>
                  <div className="adm-legend-row">
                    <span className="adm-legend-dot" style={{ background: REAL_COLOR }} />
                    <span className="adm-legend-label">Real player tickets</span>
                    <span className="adm-legend-val">{d.ticketSplit.realTickets}</span>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* #6: Revenue by agent */}
        <div className="adm-panel">
          <div className="adm-panel-head">Real-Player Revenue by Agent</div>
          <p className="adm-field-hint" style={{ padding: '0 16px' }}>
            Real stake minus real payout, per agent-owned room. Bot activity excluded. Red = the
            agent's rooms are a net loss on real players alone.
          </p>
          <div className="adm-metric-list">
            {d.revenueByAgent.length === 0 ? (
              <div className="adm-empty">No agent-owned room activity yet.</div>
            ) : (
              d.revenueByAgent.map((a) => (
                <div key={a.agentId} className="adm-metric-row">
                  <span className="adm-metric-label">{a.agentName}</span>
                  <Bar
                    value={Math.abs(a.realEmoneyEarnedMinor)}
                    max={maxAgentEarned}
                    color={a.realEmoneyEarnedMinor >= 0 ? REAL_COLOR : '#ef4444'}
                  />
                  <span
                    className="adm-metric-val"
                    style={{ color: a.realEmoneyEarnedMinor >= 0 ? undefined : 'var(--danger)' }}
                  >
                    {formatCreditsFull(a.realEmoneyEarnedMinor)} ETB
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="adm-dash-grid">
        {/* #3: Room participation trend */}
        <div className="adm-panel">
          <div className="adm-panel-head">Real Players vs Bots per Room (last 30)</div>
          {roomTrendData.length === 0 ? (
            <div className="adm-empty">No completed rooms yet.</div>
          ) : (
            <>
              <MiniTrendChart data={roomTrendData} />
              <div className="adm-legend" style={{ padding: '0 16px 12px' }}>
                <div className="adm-legend-row">
                  <span className="adm-legend-dot" style={{ background: REAL_COLOR }} />
                  <span className="adm-legend-label">Real players</span>
                </div>
                <div className="adm-legend-row">
                  <span className="adm-legend-dot" style={{ background: BOT_COLOR }} />
                  <span className="adm-legend-label">Bots</span>
                </div>
              </div>
            </>
          )}
        </div>

        {/* #5: Daily trend */}
        <div className="adm-panel">
          <div className="adm-panel-head">Real Stake vs Payouts (last 14 days)</div>
          {dailyTrendData.length === 0 ? (
            <div className="adm-empty">No completed rooms yet.</div>
          ) : (
            <>
              <MiniTrendChart data={dailyTrendData} />
              <div className="adm-legend" style={{ padding: '0 16px 12px' }}>
                <div className="adm-legend-row">
                  <span className="adm-legend-dot" style={{ background: '#3b82f6' }} />
                  <span className="adm-legend-label">Real stake</span>
                </div>
                <div className="adm-legend-row">
                  <span className="adm-legend-dot" style={{ background: REAL_COLOR }} />
                  <span className="adm-legend-label">Real payout</span>
                </div>
                <div className="adm-legend-row">
                  <span className="adm-legend-dot" style={{ background: BOT_COLOR }} />
                  <span className="adm-legend-label">Bot payout</span>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function GameTransactionsAdmin() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalBotWinMinor, setTotalBotWinMinor] = useState(0);

  const [dashboard, setDashboard] = useState<GameTransactionsDashboard | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(true);

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

  const loadDashboard = useCallback(async () => {
    setDashboardLoading(true);
    try {
      setDashboard(await adminGameTransactionsApi.getDashboard());
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setDashboardLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

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
    <div className="stack-lg">
      {dashboardLoading ? (
        <div className="adm-panel"><div className="adm-empty">Loading dashboard…</div></div>
      ) : dashboard ? (
        <GameTransactionsDashboardPanels d={dashboard} />
      ) : null}

      <div className="adm-panel">
      <div className="adm-panel-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <History size={18} /> Game Transactions
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-sm btn-ghost" onClick={exportToCsv} disabled={data.length === 0}>
            <Download size={14} /> Export CSV
          </button>
          <button className="btn btn-sm btn-ghost" onClick={() => { void load(); void loadDashboard(); }} disabled={loading} style={{ margin: 0 }}>
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
    </div>
  );
}
