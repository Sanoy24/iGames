import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { adminWerkApi, type AdminWerkConfig, type WerkBotPersonality } from '../lib/werkApi';
import { useStore } from '../store/useStore';
import { getErrorMessage } from '../lib/utils';

/** One labelled numeric field, clamped on blur. */
function NumField({ label, value, onChange, min, max, hint }: {
  label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; hint?: string;
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <span style={{ fontSize: 12, fontWeight: 600 }}>{label}</span>
      <input
        type="number" value={Number.isFinite(value) ? value : 0} min={min} max={max}
        onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
        onBlur={(e) => {
          let v = Number(e.target.value);
          if (!Number.isFinite(v)) v = min ?? 0;
          if (min != null && v < min) v = min;
          if (max != null && v > max) v = max;
          onChange(Math.round(v));
        }}
        style={{ padding: '7px 9px', borderRadius: 8, border: '1px solid var(--border, rgba(255,255,255,0.15))', background: 'var(--surface,#0c0a08)', color: 'inherit', fontFamily: 'ui-monospace, monospace' }}
      />
      {hint && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{hint}</span>}
    </label>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" onClick={() => onChange(!value)}
      className={`btn ${value ? 'btn-primary' : ''}`}
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
      <span style={{ fontWeight: 600 }}>{label}</span>
      <span style={{ fontSize: 11, opacity: 0.85 }}>{value ? 'ON' : 'OFF'}</span>
    </button>
  );
}

/**
 * Admin configuration panel for Werk Flega. Modal; calls the role-guarded
 * /admin/werk/config endpoints. Rendered only for admins from the game lobby.
 */
export function WerkAdmin({ onClose }: { onClose: () => void }) {
  const addToast = useStore((s) => s.addToast);
  const [cfg, setCfg] = useState<AdminWerkConfig | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    adminWerkApi.getConfig().then(setCfg).catch((e) => addToast('error', getErrorMessage(e)));
  }, [addToast]);

  const set = <K extends keyof AdminWerkConfig>(k: K, v: AdminWerkConfig[K]) =>
    setCfg((c) => (c ? { ...c, [k]: v } : c));

  const ALL_PERSONALITIES: Array<{ id: WerkBotPersonality; label: string }> = [
    { id: 'gatherer', label: 'ሰብሳቢ Gatherer' },
    { id: 'sniper', label: 'ተወዳዳሪ Sniper' },
    { id: 'strategist', label: 'ስትራቴጂስት Strategist' },
    { id: 'explorer', label: 'ፈላጊ Explorer' },
    { id: 'chaotic', label: 'ዘፈቀደ Chaotic' },
  ];
  const activePersonalities = cfg?.botPersonalities ?? ALL_PERSONALITIES.map((p) => p.id);
  const togglePersonality = (id: WerkBotPersonality) => {
    const next = activePersonalities.includes(id)
      ? activePersonalities.filter((p) => p !== id)
      : [...activePersonalities, id];
    if (next.length) set('botPersonalities', next); // never allow an empty pool
  };

  const save = async () => {
    if (!cfg) return;
    setSaving(true);
    try {
      const { key, ...dto } = cfg;
      void key;
      const updated = await adminWerkApi.updateConfig(dto);
      setCfg(updated);
      addToast('success', 'Werk Flega config saved');
    } catch (e) {
      addToast('error', getErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--surface,#12161c)', border: '1px solid var(--border, rgba(255,255,255,0.12))', borderRadius: 16, padding: 18, maxWidth: 480, width: '100%', maxHeight: '88vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>⛏️ Werk Flega — Admin</h3>
          <button className="btn" onClick={onClose} style={{ marginLeft: 'auto', padding: '4px 8px' }}><X size={16} /></button>
        </div>

        {!cfg ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 30 }}><div className="spinner" /></div>
        ) : (
          <div style={{ display: 'grid', gap: 12 }}>
            <Toggle label="Game enabled" value={cfg.enabled} onChange={(v) => set('enabled', v)} />
            <Toggle label="Power-ups" value={cfg.powerupsEnabled} onChange={(v) => set('powerupsEnabled', v)} />

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <NumField label="Default stake" value={cfg.entryStakeMinor} onChange={(v) => set('entryStakeMinor', v)} min={1} />
              <NumField label="Total players" value={cfg.totalPlayers} onChange={(v) => set('totalPlayers', v)} min={1} max={100} />
              <NumField label="Min stake" value={cfg.minStakeMinor} onChange={(v) => set('minStakeMinor', v)} min={1} />
              <NumField label="Max stake" value={cfg.maxStakeMinor} onChange={(v) => set('maxStakeMinor', v)} min={1} />
              <NumField label="Bot count" value={cfg.botCount} onChange={(v) => set('botCount', v)} min={0} max={99} hint="≤ total − 1" />
              <NumField label="Duration (s)" value={cfg.gameDurationSec} onChange={(v) => set('gameDurationSec', v)} min={30} max={600} />
              <NumField label="Coin density ×100" value={cfg.coinDensityX100} onChange={(v) => set('coinDensityX100', v)} min={5} max={30} />
              <NumField label="Sprint warn (s)" value={cfg.finalSprintWarningSec} onChange={(v) => set('finalSprintWarningSec', v)} min={3} max={15} />
            </div>

            {/* Bots */}
            <div style={{ fontSize: 12, fontWeight: 700, marginTop: 4 }}>Bots</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 12, fontWeight: 600 }}>Seed mode</span>
                <select value={cfg.botSeedMode} onChange={(e) => set('botSeedMode', e.target.value as AdminWerkConfig['botSeedMode'])}
                  style={{ padding: '8px 9px', borderRadius: 8, border: '1px solid var(--border, rgba(255,255,255,0.15))', background: 'var(--surface,#0c0a08)', color: 'inherit' }}>
                  <option value="auto">Auto (varied)</option>
                  <option value="custom">Custom (cycle pool)</option>
                  <option value="zero">Zero (no bots)</option>
                </select>
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 12, fontWeight: 600 }}>Difficulty</span>
                <select value={cfg.botDifficulty} onChange={(e) => set('botDifficulty', e.target.value as AdminWerkConfig['botDifficulty'])}
                  style={{ padding: '8px 9px', borderRadius: 8, border: '1px solid var(--border, rgba(255,255,255,0.15))', background: 'var(--surface,#0c0a08)', color: 'inherit' }}>
                  <option value="easy">Easy</option>
                  <option value="medium">Medium</option>
                  <option value="hard">Hard</option>
                </select>
              </label>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
                Personality pool {cfg.botSeedMode === 'zero' ? '(bots disabled)' : cfg.botSeedMode === 'custom' ? '(cycled in order)' : '(picked at random)'}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, opacity: cfg.botSeedMode === 'zero' ? 0.5 : 1 }}>
                {ALL_PERSONALITIES.map((p) => {
                  const on = activePersonalities.includes(p.id);
                  return (
                    <button key={p.id} type="button" onClick={() => togglePersonality(p.id)} disabled={cfg.botSeedMode === 'zero'}
                      style={{ fontSize: 11.5, padding: '5px 9px', borderRadius: 999, cursor: 'pointer',
                        background: on ? 'rgba(252,221,9,0.16)' : 'rgba(255,255,255,0.05)',
                        border: `1px solid ${on ? 'rgba(252,221,9,0.5)' : 'var(--border, rgba(255,255,255,0.15))'}`,
                        color: on ? '#FCDD09' : 'var(--text-muted)' }}>
                      {p.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Winning mode */}
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 12, fontWeight: 600 }}>Winning mode</span>
              <select value={cfg.winningMode} onChange={(e) => set('winningMode', e.target.value as 'A' | 'B')}
                style={{ padding: '8px 9px', borderRadius: 8, border: '1px solid var(--border, rgba(255,255,255,0.15))', background: 'var(--surface,#0c0a08)', color: 'inherit' }}>
                <option value="A">A — Most Coins Collector</option>
                <option value="B">B — Final Sprint (reach center)</option>
              </select>
            </label>

            {/* Theme */}
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 12, fontWeight: 600 }}>Maze theme</span>
              <select value={cfg.mazeTheme} onChange={(e) => set('mazeTheme', e.target.value as AdminWerkConfig['mazeTheme'])}
                style={{ padding: '8px 9px', borderRadius: 8, border: '1px solid var(--border, rgba(255,255,255,0.15))', background: 'var(--surface,#0c0a08)', color: 'inherit' }}>
                <option value="adwa">Adwa</option>
                <option value="highland">Highland</option>
                <option value="desert">Desert</option>
              </select>
            </label>

            {/* Prize table */}
            <div style={{ fontSize: 12, fontWeight: 700, marginTop: 4 }}>Prize table (× stake, ×100 — 300 = 3.0×)</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr', gap: 6 }}>
              <NumField label="#1" value={cfg.payoutRank1MultX100} onChange={(v) => set('payoutRank1MultX100', v)} min={0} />
              <NumField label="#2" value={cfg.payoutRank2MultX100} onChange={(v) => set('payoutRank2MultX100', v)} min={0} />
              <NumField label="#3" value={cfg.payoutRank3MultX100} onChange={(v) => set('payoutRank3MultX100', v)} min={0} />
              <NumField label="#4" value={cfg.payoutRank4MultX100} onChange={(v) => set('payoutRank4MultX100', v)} min={0} />
              <NumField label="#5" value={cfg.payoutRank5MultX100} onChange={(v) => set('payoutRank5MultX100', v)} min={0} />
            </div>

            <button className="btn btn-primary" disabled={saving} onClick={save} style={{ width: '100%', marginTop: 6 }}>
              {saving ? 'Saving…' : 'Save config'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
