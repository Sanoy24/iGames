import { useCallback, useEffect, useState } from 'react';
import {
  adminBingoApi,
  adminBotsApi,
  adminKenoApi,
  type BotUser,
} from '../lib/api';
import type { BingoRoom, KenoDraw } from '../lib/models';
import {
  formatDateTime,
  formatRelativeTime,
  getErrorMessage,
  titleCase,
} from '../lib/utils';
import { formatCredits, useStore } from '../store/useStore';

// ─── Sub-pages ────────────────────────────────────────────────────
type AdminTab = 'keno' | 'bingo' | 'bots';

// ══════════════════════════════════════════════════════════════════
// Keno Admin
// ══════════════════════════════════════════════════════════════════
function KenoAdmin() {
  const addToast = useStore((s) => s.addToast);
  const [draws, setDraws] = useState<KenoDraw[]>([]);
  const [config, setConfig] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const [showConfigEdit, setShowConfigEdit] = useState(false);
  const [configForm, setConfigForm] = useState({
    ticketPriceMinor: 100,
    globalBotWinInterval: 0,
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [fetchedDraws, fetchedConfig] = await Promise.all([
        adminKenoApi.listDraws(20),
        adminKenoApi.getConfig(),
      ]);
      setDraws(fetchedDraws);
      setConfig(fetchedConfig);
      setConfigForm({
        ticketPriceMinor: fetchedConfig.ticketPriceMinor,
        globalBotWinInterval: fetchedConfig.globalBotWinInterval || 0,
      });
    } catch (e) {
      addToast('error', getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => { void load(); }, [load]);

  const updateConfig = async () => {
    if (!config) return;
    setBusy('config');
    try {
      await adminKenoApi.createConfig({
        name: config.name,
        numberMin: config.numberMin,
        numberMax: config.numberMax,
        drawSize: config.drawSize,
        allowedSpots: config.allowedSpots,
        paytable: config.paytable,
        ticketPriceMinor: configForm.ticketPriceMinor,
        globalBotWinInterval: configForm.globalBotWinInterval,
      });
      addToast('success', 'New Keno Config Version Activated.');
      setShowConfigEdit(false);
      await load();
    } catch (e) { addToast('error', getErrorMessage(e)); }
    finally { setBusy(null); }
  };

  const schedule = async () => {
    setBusy('schedule');
    try {
      await adminKenoApi.scheduleDraw();
      addToast('success', 'New Keno draw scheduled.');
      await load();
    } catch (e) { addToast('error', getErrorMessage(e)); }
    finally { setBusy(null); }
  };

  const execute = async (id: string) => {
    setBusy(id);
    try {
      await adminKenoApi.executeDraw(id);
      addToast('success', 'Draw executed.');
      await load();
    } catch (e) { addToast('error', getErrorMessage(e)); }
    finally { setBusy(null); }
  };

  const cancel = async (id: string) => {
    setBusy(`cancel-${id}`);
    try {
      await adminKenoApi.cancelDraw(id);
      addToast('info', 'Draw cancelled.');
      await load();
    } catch (e) { addToast('error', getErrorMessage(e)); }
    finally { setBusy(null); }
  };

  return (
    <div className="stack-lg">
      <div className="admin-action-bar">
        <div>
          <div className="section-title">Keno Settings & Draws</div>
          <p className="section-copy">Manage active configuration and schedule rounds.</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn btn-ghost btn-sm" onClick={load}>↺ Refresh</button>
          <button className="btn btn-secondary btn-sm" onClick={() => setShowConfigEdit(!showConfigEdit)}>
             {showConfigEdit ? '✕ Close Config' : '⚙ Edit Config'}
          </button>
          <button className="btn btn-primary btn-sm" disabled={busy === 'schedule'} onClick={schedule}>
            {busy === 'schedule' ? '...' : '+ Schedule Draw'}
          </button>
        </div>
      </div>

      {config && !showConfigEdit && (
        <div className="card" style={{ padding: 16, display: 'flex', gap: 24, fontSize: 13 }}>
          <div><strong>Config Version:</strong> {config.version}</div>
          <div><strong>Ticket Price:</strong> {formatCredits(config.ticketPriceMinor)} credits</div>
          <div><strong>Bot Win Interval:</strong> {config.globalBotWinInterval || 'Disabled'}</div>
          <div><strong>Grid Size:</strong> {config.numberMin}-{config.numberMax}</div>
        </div>
      )}

      {showConfigEdit && config && (
        <div className="card admin-form">
          <div className="section-title" style={{ marginBottom: 16 }}>Create New Keno Config Version</div>
          <div className="admin-form-grid">
            <label className="form-field">
              <span>Ticket Price (credits)</span>
              <input 
                className="input" 
                type="number" 
                value={configForm.ticketPriceMinor} 
                onChange={e => setConfigForm(f => ({ ...f, ticketPriceMinor: Number(e.target.value) }))} 
              />
            </label>
            <label className="form-field">
              <span>Global Bot Win Interval (0 = disabled)</span>
              <input 
                className="input" 
                type="number" 
                value={configForm.globalBotWinInterval} 
                onChange={e => setConfigForm(f => ({ ...f, globalBotWinInterval: Number(e.target.value) }))} 
              />
            </label>
          </div>
          <button
            className="btn btn-primary btn-full"
            style={{ marginTop: 16 }}
            disabled={busy === 'config'}
            onClick={updateConfig}
          >
            {busy === 'config' ? 'Saving...' : 'Save & Activate New Config'}
          </button>
        </div>
      )}

      {loading && draws.length === 0 ? (
        <div className="card-muted">Loading draws...</div>
      ) : draws.length === 0 ? (
        <div className="card-muted">No draws yet. Schedule one above.</div>
      ) : (
        <div className="list-stack">
          {draws.map((draw) => {
            const isPending = draw.status === 'pending';
            const isSettled = draw.status === 'settled' || draw.status === 'cancelled';
            return (
              <article key={draw.id} className="admin-row">
                <div className="admin-row-info">
                  <div className="admin-row-title">
                    Draw <code>{draw.id.slice(-8)}</code>
                    <span className={`badge badge-${draw.status === 'settled' ? 'green' : draw.status === 'cancelled' ? 'red' : 'violet'}`}>
                      {draw.status}
                    </span>
                  </div>
                  <div className="admin-row-meta">
                    {formatDateTime(draw.scheduledAt)}
                    {draw.drawnNumbers.length > 0 && (
                      <span> · {draw.drawnNumbers.length} numbers drawn</span>
                    )}
                  </div>
                  {draw.drawnNumbers.length > 0 && (
                    <div className="ball-row" style={{ marginTop: 8 }}>
                      {draw.drawnNumbers.slice(0, 12).map((n) => (
                        <span key={n} className="ball ball-drawn">{n}</span>
                      ))}
                      {draw.drawnNumbers.length > 12 && (
                        <span className="text-muted">+{draw.drawnNumbers.length - 12} more</span>
                      )}
                    </div>
                  )}
                </div>
                {!isSettled && (
                  <div className="admin-row-actions">
                    {isPending && (
                      <button
                        className="btn btn-primary btn-sm"
                        disabled={busy === draw.id}
                        onClick={() => execute(draw.id)}
                      >
                        {busy === draw.id ? '...' : '▶ Execute'}
                      </button>
                    )}
                    <button
                      className="btn btn-danger btn-sm"
                      disabled={busy === `cancel-${draw.id}`}
                      onClick={() => cancel(draw.id)}
                    >
                      {busy === `cancel-${draw.id}` ? '...' : '✕ Cancel'}
                    </button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// Bingo Admin
// ══════════════════════════════════════════════════════════════════
function BingoAdmin() {
  const addToast = useStore((s) => s.addToast);
  const [rooms, setRooms] = useState<BingoRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  // Create room form state
  const [form, setForm] = useState({
    name: 'Room Alpha',
    ticketPriceMinor: 500,
    maxTickets: 100,
    minutesFromNow: 5,
    oneLine: 20000,
    twoLines: 50000,
    fullHouse: 100000,
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRooms(await adminBingoApi.listAllRooms());
    } catch (e) {
      addToast('error', getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => { void load(); }, [load]);

  const createRoom = async () => {
    setBusy('create');
    try {
      const scheduledStartAt = new Date(Date.now() + form.minutesFromNow * 60 * 1000).toISOString();
      await adminBingoApi.createRoom({
        name: form.name,
        ticketPriceMinor: form.ticketPriceMinor,
        maxTickets: form.maxTickets,
        scheduledStartAt,
        prizes: {
          oneLineMinor: form.oneLine,
          twoLinesMinor: form.twoLines,
          fullHouseMinor: form.fullHouse,
        },
      });
      addToast('success', `Room "${form.name}" created.`);
      setShowCreate(false);
      await load();
    } catch (e) { addToast('error', getErrorMessage(e)); }
    finally { setBusy(null); }
  };

  const drawNext = async (roomId: string) => {
    setBusy(`draw-${roomId}`);
    try {
      await adminBingoApi.drawNext(roomId);
      addToast('success', 'Ball drawn.');
      await load();
    } catch (e) { addToast('error', getErrorMessage(e)); }
    finally { setBusy(null); }
  };

  const cancelRoom = async (roomId: string) => {
    setBusy(`cancel-${roomId}`);
    try {
      await adminBingoApi.cancelRoom(roomId);
      addToast('info', 'Room cancelled.');
      await load();
    } catch (e) { addToast('error', getErrorMessage(e)); }
    finally { setBusy(null); }
  };

  const field = (key: keyof typeof form) => ({
    value: form[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [key]: typeof f[key] === 'number' ? Number(e.target.value) : e.target.value })),
  });

  return (
    <div className="stack-lg">
      <div className="admin-action-bar">
        <div>
          <div className="section-title">Bingo Rooms</div>
          <p className="section-copy">Create rooms, draw balls, and manage settlements.</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost btn-sm" onClick={load}>↺ Refresh</button>
          <button className="btn btn-primary btn-sm" onClick={() => setShowCreate((v) => !v)}>
            {showCreate ? '✕ Close' : '+ New Room'}
          </button>
        </div>
      </div>

      {showCreate && (
        <div className="card admin-form">
          <div className="section-title" style={{ marginBottom: 16 }}>Create Bingo Room</div>
          <div className="admin-form-grid">
            <label className="form-field">
              <span>Room Name</span>
              <input className="input" {...field('name')} />
            </label>
            <label className="form-field">
              <span>Ticket Price (credits)</span>
              <input className="input" type="number" min={1} {...field('ticketPriceMinor')} />
            </label>
            <label className="form-field">
              <span>Max Tickets</span>
              <input className="input" type="number" min={1} {...field('maxTickets')} />
            </label>
            <label className="form-field">
              <span>Start In (minutes)</span>
              <input className="input" type="number" min={1} {...field('minutesFromNow')} />
            </label>
            <label className="form-field">
              <span>One Line Prize</span>
              <input className="input" type="number" min={0} {...field('oneLine')} />
            </label>
            <label className="form-field">
              <span>Two Lines Prize</span>
              <input className="input" type="number" min={0} {...field('twoLines')} />
            </label>
            <label className="form-field">
              <span>Full House Prize</span>
              <input className="input" type="number" min={0} {...field('fullHouse')} />
            </label>
          </div>
          <button
            className="btn btn-primary btn-full"
            style={{ marginTop: 16 }}
            disabled={busy === 'create'}
            onClick={createRoom}
          >
            {busy === 'create' ? 'Creating...' : 'Create Room'}
          </button>
        </div>
      )}

      {loading && rooms.length === 0 ? (
        <div className="card-muted">Loading rooms...</div>
      ) : rooms.length === 0 ? (
        <div className="card-muted">No rooms yet.</div>
      ) : (
        <div className="list-stack">
          {rooms.map((room) => {
            const isActive = room.status === 'open' || room.status === 'running';
            return (
              <article key={room.id} className="admin-row">
                <div className="admin-row-info">
                  <div className="admin-row-title">
                    {room.name}
                    <span className={`badge badge-${room.status === 'settled' ? 'green' : room.status === 'cancelled' ? 'red' : room.status === 'running' ? 'violet' : 'gold'}`}>
                      {room.status}
                    </span>
                  </div>
                  <div className="admin-row-meta">
                    {room.soldTickets}/{room.maxTickets} tickets ·{' '}
                    {formatCredits(room.ticketPriceMinor)} credits each ·{' '}
                    Starts {formatRelativeTime(room.scheduledStartAt)}
                  </div>
                  <div className="admin-row-meta">
                    {room.drawnNumbers.length} balls drawn
                    {Object.entries(room.prizes).map(([tier, amt]) => (
                      <span key={tier}> · {titleCase(tier)}: {formatCredits(amt)}</span>
                    ))}
                  </div>
                </div>
                {isActive && (
                  <div className="admin-row-actions">
                    <button
                      className="btn btn-primary btn-sm"
                      disabled={busy === `draw-${room.id}`}
                      onClick={() => drawNext(room.id)}
                    >
                      {busy === `draw-${room.id}` ? '...' : '🎱 Draw Ball'}
                    </button>
                    <button
                      className="btn btn-danger btn-sm"
                      disabled={busy === `cancel-${room.id}`}
                      onClick={() => cancelRoom(room.id)}
                    >
                      {busy === `cancel-${room.id}` ? '...' : '✕ Cancel'}
                    </button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// Bots Admin
// ══════════════════════════════════════════════════════════════════
function BotsAdmin() {
  const addToast = useStore((s) => s.addToast);
  const [bots, setBots] = useState<BotUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    displayName: 'Bot Alpha',
    initialBalanceMinor: 10000,
    ticketsPerRound: 2,
    spotCount: 4,
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setBots(await adminBotsApi.listBots());
    } catch (e) {
      addToast('error', getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => { void load(); }, [load]);

  const createBot = async () => {
    setBusy('create');
    try {
      await adminBotsApi.createBot(form);
      addToast('success', `Bot "${form.displayName}" created.`);
      setShowCreate(false);
      await load();
    } catch (e) { addToast('error', getErrorMessage(e)); }
    finally { setBusy(null); }
  };

  const toggleActive = async (bot: BotUser) => {
    setBusy(bot.id);
    try {
      await adminBotsApi.updateBot(bot.id, { active: !bot.botPolicy.active });
      addToast('success', `Bot ${bot.botPolicy.active ? 'paused' : 'activated'}.`);
      await load();
    } catch (e) { addToast('error', getErrorMessage(e)); }
    finally { setBusy(null); }
  };

  const field = (key: keyof typeof form) => ({
    value: form[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [key]: typeof f[key] === 'number' ? Number(e.target.value) : e.target.value })),
  });

  return (
    <div className="stack-lg">
      <div className="admin-action-bar">
        <div>
          <div className="section-title">Keno Bots</div>
          <p className="section-copy">AI bots that auto-play Keno tickets each round.</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost btn-sm" onClick={load}>↺ Refresh</button>
          <button className="btn btn-primary btn-sm" onClick={() => setShowCreate((v) => !v)}>
            {showCreate ? '✕ Close' : '+ New Bot'}
          </button>
        </div>
      </div>

      {showCreate && (
        <div className="card admin-form">
          <div className="section-title" style={{ marginBottom: 16 }}>Create Bot</div>
          <div className="admin-form-grid">
            <label className="form-field">
              <span>Display Name</span>
              <input className="input" {...field('displayName')} />
            </label>
            <label className="form-field">
              <span>Starting Balance (credits)</span>
              <input className="input" type="number" min={0} {...field('initialBalanceMinor')} />
            </label>
            <label className="form-field">
              <span>Tickets Per Round</span>
              <input className="input" type="number" min={0} max={10} {...field('ticketsPerRound')} />
            </label>
            <label className="form-field">
              <span>Spot Count (1–12)</span>
              <input className="input" type="number" min={1} max={12} {...field('spotCount')} />
            </label>
          </div>
          <button
            className="btn btn-primary btn-full"
            style={{ marginTop: 16 }}
            disabled={busy === 'create'}
            onClick={createBot}
          >
            {busy === 'create' ? 'Creating...' : 'Create Bot'}
          </button>
        </div>
      )}

      {loading && bots.length === 0 ? (
        <div className="card-muted">Loading bots...</div>
      ) : bots.length === 0 ? (
        <div className="card-muted">No bots yet.</div>
      ) : (
        <div className="list-stack">
          {bots.map((bot) => (
            <article key={bot.id} className="admin-row">
              <div className="admin-row-info">
                <div className="admin-row-title">
                  {bot.displayName}
                  <span className={`badge ${bot.botPolicy?.active ? 'badge-green' : 'badge-red'}`}>
                    {bot.botPolicy?.active ? 'Active' : 'Paused'}
                  </span>
                </div>
                <div className="admin-row-meta">
                  {bot.botPolicy?.ticketsPerRound} ticket{bot.botPolicy?.ticketsPerRound !== 1 ? 's' : ''}/round ·{' '}
                  {bot.botPolicy?.spotCount}-spot
                </div>
              </div>
              <div className="admin-row-actions">
                <button
                  className={`btn btn-sm ${bot.botPolicy?.active ? 'btn-danger' : 'btn-secondary'}`}
                  disabled={busy === bot.id}
                  onClick={() => toggleActive(bot)}
                >
                  {busy === bot.id ? '...' : bot.botPolicy?.active ? '⏸ Pause' : '▶ Activate'}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// Main Admin Page
// ══════════════════════════════════════════════════════════════════
export function Admin() {
  const user = useStore((s) => s.user);
  const setAuth = useStore((s) => s.setAuth);
  const setWallet = useStore((s) => s.setWallet);
  const addToast = useStore((s) => s.addToast);
  const [activeTab, setActiveTab] = useState<AdminTab>('keno');

  if (!user?.roles.includes('admin')) {
    const handleDevLogin = async () => {
      try {
        const { authApi, walletApi } = await import('../lib/api');
        const data = await authApi.devSeedAdmin();
        setAuth(data.user, data.accessToken);
        const wallet = await walletApi.getWallet();
        setWallet(wallet);
        addToast('success', 'Logged in as Admin');
      } catch (err) {
        addToast('error', getErrorMessage(err));
      }
    };

    return (
      <div className="centered-loader" style={{ flex: 1, gap: 16 }}>
        <span style={{ fontSize: 48 }}>🔒</span>
        <p style={{ color: 'var(--text-muted)' }}>Admin access required.</p>
        {import.meta.env.DEV && (
          <button className="btn btn-primary" onClick={handleDevLogin}>
            Login as Dev Admin
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="stack-lg">
      {/* Header */}
      <div className="admin-header">
        <span style={{ fontSize: 28 }}>⚙️</span>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>Admin Panel</h1>
          <p className="section-copy">Manage draws, rooms, and bots.</p>
        </div>
      </div>

      {/* Sub-navigation */}
      <div className="admin-tabs">
        {(['keno', 'bingo', 'bots'] as AdminTab[]).map((tab) => (
          <button
            key={tab}
            className={`admin-tab${activeTab === tab ? ' active' : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab === 'keno' ? '🎰' : tab === 'bingo' ? '🎱' : '🤖'} {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {/* Content */}
      {activeTab === 'keno' && <KenoAdmin />}
      {activeTab === 'bingo' && <BingoAdmin />}
      {activeTab === 'bots' && <BotsAdmin />}
    </div>
  );
}
