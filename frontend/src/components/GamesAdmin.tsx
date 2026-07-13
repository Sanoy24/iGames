import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Gamepad2 } from 'lucide-react';
import { adminGamesApi, type GameCatalogEntry, type GameState } from '../lib/api';
import { useStore } from '../store/useStore';
import { getErrorMessage } from '../lib/utils';

const STATE_META: Record<GameState, { label: string; color: string; hint: string }> = {
  enabled: { label: 'Enabled', color: '#10b981', hint: 'Visible and playable.' },
  maintenance: { label: 'Maintenance', color: '#f59e0b', hint: 'Shown greyed-out, plays blocked, message displayed.' },
  hidden: { label: 'Hidden', color: '#ef4444', hint: 'Completely removed from the player app.' },
};
const STATES: GameState[] = ['enabled', 'maintenance', 'hidden'];

function GameRow({ game, onSaved }: { game: GameCatalogEntry; onSaved: () => void }) {
  const addToast = useStore((s) => s.addToast);
  const [state, setState] = useState<GameState>(game.state);
  const [message, setMessage] = useState(game.maintenanceMessage ?? '');
  const [saving, setSaving] = useState(false);

  const dirty = state !== game.state || (message ?? '') !== (game.maintenanceMessage ?? '');

  const save = async () => {
    setSaving(true);
    try {
      await adminGamesApi.update(game.code, {
        state,
        maintenanceMessage: state === 'maintenance' ? message.trim() || null : null,
      });
      addToast('success', `${game.name} set to ${STATE_META[state].label}.`);
      onSaved();
    } catch (e) {
      addToast('error', getErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card" style={{ padding: 14, marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 15 }}>
          <Gamepad2 size={16} style={{ color: STATE_META[state].color }} /> {game.name}
        </span>
        <span className="badge" style={{ fontSize: 10, color: STATE_META[game.state].color, borderColor: STATE_META[game.state].color }}>
          {STATE_META[game.state].label}
        </span>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        {STATES.map((s) => (
          <button
            key={s}
            className={`btn btn-sm ${state === s ? 'btn-primary' : 'btn-ghost'}`}
            style={{ flex: 1, fontSize: 12 }}
            onClick={() => setState(s)}
          >
            {STATE_META[s].label}
          </button>
        ))}
      </div>
      <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '0 0 8px' }}>{STATE_META[state].hint}</p>

      {state === 'maintenance' && (
        <input
          className="input"
          placeholder="Message shown to players (optional)"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          maxLength={300}
          style={{ marginBottom: 8 }}
        />
      )}

      <button className="btn btn-primary btn-sm" style={{ width: '100%' }} disabled={!dirty || saving} onClick={save}>
        {saving ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
      </button>
    </div>
  );
}

export function GamesAdmin() {
  const [games, setGames] = useState<GameCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try { setGames(await adminGamesApi.list()); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <div style={{ maxWidth: 520, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div>
          <strong style={{ fontSize: 15 }}>Game availability</strong>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '2px 0 0' }}>
            Control which games players can see and play. Changes apply instantly.
          </p>
        </div>
        <button className="btn btn-ghost btn-sm icon-btn" onClick={() => void load()}>
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {loading && games.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 24 }}><div className="spinner" /></div>
      ) : (
        games.map((g) => <GameRow key={g.code} game={g} onSaved={load} />)
      )}
    </div>
  );
}
