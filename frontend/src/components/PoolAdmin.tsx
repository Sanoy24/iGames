import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Circle, Users, Trophy, Sliders, Plus, Play, Scale } from 'lucide-react';
import {
  adminPoolApi,
  type AdminPoolConfig,
  type AdminPoolTournament,
  type PoolBotDifficulty,
} from '../lib/api';
import { useStore } from '../store/useStore';
import { getErrorMessage } from '../lib/utils';

/** One numeric field with a label, optional hint, and min/max clamp on blur. */
function NumField({
  label, value, onChange, min, max, hint, suffix,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  hint?: string;
  suffix?: string;
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 12, fontWeight: 600 }}>{label}{suffix ? <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> ({suffix})</span> : null}</span>
      <input
        className="input"
        type="number"
        value={Number.isFinite(value) ? value : 0}
        min={min}
        max={max}
        onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
        onBlur={(e) => {
          let v = Number(e.target.value);
          if (!Number.isFinite(v)) v = min ?? 0;
          if (min != null && v < min) v = min;
          if (max != null && v > max) v = max;
          onChange(Math.round(v));
        }}
      />
      {hint && <span style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>{hint}</span>}
    </label>
  );
}

/** A labelled on/off pill toggle. */
function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      className={`btn btn-sm ${value ? 'btn-primary' : 'btn-ghost'}`}
      style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between', width: '100%' }}
      onClick={() => onChange(!value)}
    >
      <span style={{ fontWeight: 600 }}>{label}</span>
      <span style={{ fontSize: 11, opacity: 0.85 }}>{value ? 'Enabled' : 'Disabled'}</span>
    </button>
  );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="card" style={{ padding: 14, marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, fontWeight: 700, fontSize: 14 }}>
        {icon} {title}
      </div>
      <div style={{ display: 'grid', gap: 10 }}>{children}</div>
    </div>
  );
}

const DIFFICULTIES: PoolBotDifficulty[] = ['easy', 'medium', 'hard'];

// Only these fields are accepted by UpdatePoolConfigDto. The GET returns the full
// entity (with key/updatedBy/createdAt/updatedAt), and the backend validation pipe
// rejects any non-whitelisted property — so we PATCH just the editable subset.
const EDITABLE_KEYS: (keyof AdminPoolConfig)[] = [
  'singlePlayerEnabled', 'singlePlayerStakeMinor', 'botDifficulty',
  'twoPlayerEnabled', 'minStakeMinor', 'maxStakeMinor', 'rakePct', 'shotClockSeconds', 'maxTimeoutFouls',
  'tournamentEnabled', 'tournamentEntryFeeMinor', 'tournamentSize', 'tournamentRakePct',
  'tournamentPrize1Weight', 'tournamentPrize2Weight', 'tournamentPrize34Weight',
  'strictCallShot',
  'slidingFrictionX100', 'rollingFrictionX1000', 'cushionReboundPct', 'ballReboundPct',
  'pocketSizePct', 'cueMaxSpeedX100', 'maxSideSpin', 'maxRollSpin',
  'rulesetVersion', 'engineVersion',
];

const toUpdateDto = (cfg: AdminPoolConfig): Partial<AdminPoolConfig> => {
  const dto: Record<string, unknown> = {};
  for (const k of EDITABLE_KEYS) dto[k] = cfg[k];
  return dto as Partial<AdminPoolConfig>;
};

export function PoolAdmin() {
  const addToast = useStore((s) => s.addToast);
  const [cfg, setCfg] = useState<AdminPoolConfig | null>(null);
  const [draft, setDraft] = useState<AdminPoolConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Tournament controls
  const [tName, setTName] = useState('');
  const [creating, setCreating] = useState(false);
  const [lastTournament, setLastTournament] = useState<AdminPoolTournament | null>(null);
  const [startingId, setStartingId] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const c = await adminPoolApi.getConfig();
      setCfg(c);
      setDraft(c);
    } catch (e) {
      console.error('[pool-admin] load config failed', e);
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const dirty = useMemo(
    () => !!cfg && !!draft && JSON.stringify(cfg) !== JSON.stringify(draft),
    [cfg, draft],
  );

  const set = <K extends keyof AdminPoolConfig>(key: K, value: AdminPoolConfig[K]) =>
    setDraft((d) => (d ? { ...d, [key]: value } : d));

  const save = async () => {
    if (!draft) return;
    if (draft.minStakeMinor > draft.maxStakeMinor) {
      addToast('error', 'Min stake cannot exceed max stake.');
      return;
    }
    setSaving(true);
    try {
      const saved = await adminPoolApi.updateConfig(toUpdateDto(draft));
      setCfg(saved);
      setDraft(saved);
      addToast('success', 'Pool config saved.');
    } catch (e) {
      console.error('[pool-admin] save config failed', e);
      addToast('error', getErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const createTournament = async () => {
    setCreating(true);
    try {
      const t = await adminPoolApi.createTournament(tName.trim() || undefined);
      setLastTournament(t);
      setTName('');
      addToast('success', `Tournament "${t.name}" created — registration open.`);
    } catch (e) {
      console.error('[pool-admin] create tournament failed', e);
      addToast('error', getErrorMessage(e));
    } finally {
      setCreating(false);
    }
  };

  const startTournament = async () => {
    if (!lastTournament) return;
    setStartingId(true);
    try {
      const t = await adminPoolApi.startTournament(lastTournament.id);
      setLastTournament(t);
      addToast('success', `Tournament started (${t.size} seats, ${t.rounds} rounds).`);
    } catch (e) {
      console.error('[pool-admin] start tournament failed', e);
      addToast('error', getErrorMessage(e));
    } finally {
      setStartingId(false);
    }
  };

  if (loading && !draft) {
    return <div style={{ textAlign: 'center', padding: 24 }}><div className="spinner" /></div>;
  }
  if (error && !draft) {
    return (
      <div style={{ textAlign: 'center', padding: 20, color: 'var(--danger, #ef4444)', fontSize: 13 }}>
        {error}
        <div style={{ marginTop: 10 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => void load()}>Retry</button>
        </div>
      </div>
    );
  }
  if (!draft) return null;

  return (
    <div style={{ maxWidth: 560, margin: '0 auto', paddingBottom: 80 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div>
          <strong style={{ fontSize: 15 }}>Pool (8-ball)</strong>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '2px 0 0' }}>
            Control single-player, two-player and tournament modes. Stakes are in minor units.
          </p>
        </div>
        <button className="btn btn-ghost btn-sm icon-btn" onClick={() => void load()}>
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* ── Single player ── */}
      <Section icon={<Circle size={15} style={{ color: '#10b981' }} />} title="Single player (vs AI)">
        <Toggle label="Single-player mode" value={draft.singlePlayerEnabled} onChange={(v) => set('singlePlayerEnabled', v)} />
        <NumField label="Stake" suffix="minor units, 0 = free" value={draft.singlePlayerStakeMinor} onChange={(v) => set('singlePlayerStakeMinor', v)} min={0} />
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 12, fontWeight: 600 }}>Bot difficulty</span>
          <div style={{ display: 'flex', gap: 6 }}>
            {DIFFICULTIES.map((d) => (
              <button
                key={d}
                className={`btn btn-sm ${draft.botDifficulty === d ? 'btn-primary' : 'btn-ghost'}`}
                style={{ flex: 1, textTransform: 'capitalize' }}
                onClick={() => set('botDifficulty', d)}
              >
                {d}
              </button>
            ))}
          </div>
        </label>
      </Section>

      {/* ── Two player ── */}
      <Section icon={<Users size={15} style={{ color: '#60a5fa' }} />} title="Two player (PvP, staked)">
        <Toggle label="Two-player mode" value={draft.twoPlayerEnabled} onChange={(v) => set('twoPlayerEnabled', v)} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <NumField label="Min stake" suffix="minor" value={draft.minStakeMinor} onChange={(v) => set('minStakeMinor', v)} min={1} />
          <NumField label="Max stake" suffix="minor" value={draft.maxStakeMinor} onChange={(v) => set('maxStakeMinor', v)} min={1} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <NumField label="House rake" suffix="%" value={draft.rakePct} onChange={(v) => set('rakePct', v)} min={0} max={100} />
          <NumField label="Shot clock" suffix="seconds" value={draft.shotClockSeconds} onChange={(v) => set('shotClockSeconds', v)} min={5} max={300} hint="Per-shot timer" />
        </div>
        <NumField label="Timeouts before forfeit" suffix="count" value={draft.maxTimeoutFouls} onChange={(v) => set('maxTimeoutFouls', v)} min={1} max={10} hint="1 = a single timeout loses the match; higher gives grace fouls (opponent ball-in-hand) before forfeit" />
      </Section>

      {/* ── Tournament ── */}
      <Section icon={<Trophy size={15} style={{ color: '#facc15' }} />} title="Tournament">
        <Toggle label="Tournament mode" value={draft.tournamentEnabled} onChange={(v) => set('tournamentEnabled', v)} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <NumField label="Entry fee" suffix="minor" value={draft.tournamentEntryFeeMinor} onChange={(v) => set('tournamentEntryFeeMinor', v)} min={0} />
          <NumField label="Bracket size" suffix="seats" value={draft.tournamentSize} onChange={(v) => set('tournamentSize', v)} min={2} max={128} hint="Power of two (8, 16, 32…)" />
        </div>
        <NumField label="House rake" suffix="%" value={draft.tournamentRakePct} onChange={(v) => set('tournamentRakePct', v)} min={0} max={100} />

        <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', marginTop: 4, paddingTop: 12, display: 'grid', gap: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 600 }}>Prize split (relative weights)</span>
          <p style={{ fontSize: 10.5, color: 'var(--text-muted)', margin: 0 }}>
            After-rake pool splits across the tiers that have finishers, each taking weight ÷ (sum of active weights). 3rd–4th share their tier equally. 100/0/0 = winner-take-all.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            <NumField label="1st" value={draft.tournamentPrize1Weight} onChange={(v) => set('tournamentPrize1Weight', v)} min={1} max={1000} />
            <NumField label="2nd" value={draft.tournamentPrize2Weight} onChange={(v) => set('tournamentPrize2Weight', v)} min={0} max={1000} />
            <NumField label="3rd–4th" value={draft.tournamentPrize34Weight} onChange={(v) => set('tournamentPrize34Weight', v)} min={0} max={1000} />
          </div>
        </div>

        <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', marginTop: 4, paddingTop: 12, display: 'grid', gap: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 600 }}>Run a tournament</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              className="input"
              placeholder="Tournament name (optional)"
              value={tName}
              onChange={(e) => setTName(e.target.value)}
              maxLength={80}
              style={{ flex: 1 }}
            />
            <button className="btn btn-primary btn-sm" disabled={creating || !draft.tournamentEnabled} onClick={createTournament} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Plus size={14} /> {creating ? 'Creating…' : 'Create'}
            </button>
          </div>
          {!draft.tournamentEnabled && (
            <span style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>Enable tournament mode (and save) to create tournaments.</span>
          )}
          {lastTournament && (
            <div className="card" style={{ padding: 10, background: 'rgba(250,204,21,0.06)', border: '1px solid rgba(250,204,21,0.2)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lastTournament.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {lastTournament.status} · {lastTournament.size} seats · pool {lastTournament.prizePoolMinor}
                  </div>
                </div>
                {lastTournament.status === 'registering' && (
                  <button className="btn btn-primary btn-sm" disabled={startingId} onClick={startTournament} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Play size={13} /> {startingId ? 'Starting…' : 'Start'}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </Section>

      {/* ── Rules ── */}
      <Section icon={<Scale size={15} style={{ color: '#f6c945' }} />} title="Rules">
        <Toggle label="Strict called-shot mode" value={draft.strictCallShot} onChange={(v) => set('strictCallShot', v)} />
        <p style={{ fontSize: 10.5, color: 'var(--text-muted)', margin: 0 }}>
          On: every shot must call a pocket and a legal ball must drop there to continue (a ball made
          elsewhere is "slop" — it stays down but the turn ends), and groups are assigned only on a called
          pot. Off (casual): regular balls count in any pocket; only the 8-ball's pocket is called.
        </p>
      </Section>

      {/* ── Physics tuning ── */}
      <Section icon={<Sliders size={15} style={{ color: '#c084fc' }} />} title="Physics feel">
        <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0 }}>
          Snapshotted onto each match at creation, so edits never disturb in-flight games. Integer-scaled.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <NumField label="Sliding friction" suffix="×100" value={draft.slidingFrictionX100} onChange={(v) => set('slidingFrictionX100', v)} min={1} max={100} />
          <NumField label="Rolling friction" suffix="×1000" value={draft.rollingFrictionX1000} onChange={(v) => set('rollingFrictionX1000', v)} min={1} max={500} hint="Higher = balls settle sooner (snappier)" />
          <NumField label="Cushion rebound" suffix="%" value={draft.cushionReboundPct} onChange={(v) => set('cushionReboundPct', v)} min={0} max={100} />
          <NumField label="Ball rebound" suffix="%" value={draft.ballReboundPct} onChange={(v) => set('ballReboundPct', v)} min={0} max={100} />
          <NumField label="Pocket size" suffix="%" value={draft.pocketSizePct} onChange={(v) => set('pocketSizePct', v)} min={100} max={300} />
          <NumField label="Cue max speed" suffix="×100 m/s" value={draft.cueMaxSpeedX100} onChange={(v) => set('cueMaxSpeedX100', v)} min={100} max={1200} />
          <NumField label="Max side spin" suffix="rad/s" value={draft.maxSideSpin} onChange={(v) => set('maxSideSpin', v)} min={0} max={200} />
          <NumField label="Max roll spin" suffix="rad/s" value={draft.maxRollSpin} onChange={(v) => set('maxRollSpin', v)} min={0} max={400} />
        </div>
      </Section>

      {/* ── Sticky save bar ── */}
      <div
        style={{
          position: 'sticky', bottom: 0, display: 'flex', gap: 8, padding: '10px 0',
          background: 'linear-gradient(180deg, transparent, var(--bg, #0b0f14) 40%)',
        }}
      >
        <button className="btn btn-ghost" style={{ flex: 1 }} disabled={!dirty || saving} onClick={() => setDraft(cfg)}>
          Discard
        </button>
        <button className="btn btn-primary" style={{ flex: 2 }} disabled={!dirty || saving} onClick={save}>
          {saving ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
        </button>
      </div>
    </div>
  );
}
