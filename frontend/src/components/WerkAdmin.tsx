import { useEffect, useState, type CSSProperties } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import {
    adminWerkApi,
    type AdminWerkBot,
    type AdminWerkConfig,
    type CreateWerkBotInput,
    type WerkBotPersonality,
} from '../lib/werkApi';
import { useStore } from '../store/useStore';
import { getErrorMessage } from '../lib/utils';

/** The 5 bot AI archetypes, with bilingual labels. */
const PERSONALITIES: Array<{ id: WerkBotPersonality; label: string }> = [
    { id: 'gatherer', label: 'ሰብሳቢ Gatherer' },
    { id: 'sniper', label: 'ተኳሽ Sniper' },
    { id: 'strategist', label: 'ስትራቴጂስት Strategist' },
    { id: 'explorer', label: 'ፈላጊ Explorer' },
    { id: 'chaotic', label: 'ዘፈቀደ Chaotic' },
];
const DEFAULT_BOT_COLORS = [
    '#e6b422',
    '#4ade80',
    '#60a5fa',
    '#f87171',
    '#c084fc',
    '#fb923c',
    '#22d3ee',
];

/** One labelled numeric field, clamped on blur. */
function NumField({
    label,
    value,
    onChange,
    min,
    max,
    hint,
}: {
    label: string;
    value: number;
    onChange: (v: number) => void;
    min?: number;
    max?: number;
    hint?: string;
}) {
    return (
        <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={{ fontSize: 12, fontWeight: 600 }}>{label}</span>
            <input
                type='number'
                value={Number.isFinite(value) ? value : 0}
                min={min}
                max={max}
                onChange={(e) =>
                    onChange(e.target.value === '' ? 0 : Number(e.target.value))
                }
                onBlur={(e) => {
                    let v = Number(e.target.value);
                    if (!Number.isFinite(v)) v = min ?? 0;
                    if (min != null && v < min) v = min;
                    if (max != null && v > max) v = max;
                    onChange(Math.round(v));
                }}
                style={{
                    padding: '7px 9px',
                    borderRadius: 8,
                    border: '1px solid var(--border, rgba(255,255,255,0.15))',
                    background: 'var(--surface,#0c0a08)',
                    color: 'inherit',
                    fontFamily: 'ui-monospace, monospace',
                }}
            />
            {hint && (
                <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                    {hint}
                </span>
            )}
        </label>
    );
}

function Toggle({
    label,
    value,
    onChange,
}: {
    label: string;
    value: boolean;
    onChange: (v: boolean) => void;
}) {
    return (
        <button
            type='button'
            onClick={() => onChange(!value)}
            className={`btn ${value ? 'btn-primary' : ''}`}
            style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                width: '100%',
            }}
        >
            <span style={{ fontWeight: 600 }}>{label}</span>
            <span style={{ fontSize: 11, opacity: 0.85 }}>
                {value ? 'ON' : 'OFF'}
            </span>
        </button>
    );
}

/**
 * Admin configuration panel for Werk Flega. Modal; calls the role-guarded
 * /admin/werk/config endpoints. Rendered only for admins from the game lobby.
 */
export function WerkAdmin({
    onClose,
    embedded = false,
}: {
    onClose?: () => void;
    embedded?: boolean;
}) {
    const addToast = useStore((s) => s.addToast);
    const [cfg, setCfg] = useState<AdminWerkConfig | null>(null);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        adminWerkApi
            .getConfig()
            .then(setCfg)
            .catch((e) => addToast('error', getErrorMessage(e)));
    }, [addToast]);

    const set = <K extends keyof AdminWerkConfig>(
        k: K,
        v: AdminWerkConfig[K],
    ) => setCfg((c) => (c ? { ...c, [k]: v } : c));

    const save = async () => {
        if (!cfg) return;
        setSaving(true);
        try {
            // updateConfig() sends only editable fields, so passing the whole row is safe.
            const updated = await adminWerkApi.updateConfig(cfg);
            setCfg(updated);
            addToast('success', 'Werk Flega config saved');
        } catch (e) {
            addToast('error', getErrorMessage(e));
        } finally {
            setSaving(false);
        }
    };

    const inner = !cfg ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 30 }}>
            <div className='spinner' />
        </div>
    ) : (
        <div style={{ display: 'grid', gap: 12 }}>
            <Toggle
                label='Game enabled'
                value={cfg.enabled}
                onChange={(v) => set('enabled', v)}
            />
            <Toggle
                label='Power-ups'
                value={cfg.powerupsEnabled}
                onChange={(v) => set('powerupsEnabled', v)}
            />

            <div
                style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: 10,
                }}
            >
                <NumField
                    label='Default stake'
                    value={cfg.entryStakeMinor}
                    onChange={(v) => set('entryStakeMinor', v)}
                    min={1}
                />
                <NumField
                    label='Total players'
                    value={cfg.totalPlayers}
                    onChange={(v) => set('totalPlayers', v)}
                    min={1}
                    max={100}
                />
                <NumField
                    label='Min stake'
                    value={cfg.minStakeMinor}
                    onChange={(v) => set('minStakeMinor', v)}
                    min={1}
                />
                <NumField
                    label='Max stake'
                    value={cfg.maxStakeMinor}
                    onChange={(v) => set('maxStakeMinor', v)}
                    min={1}
                />
                <NumField
                    label='Bot count'
                    value={cfg.botCount}
                    onChange={(v) => set('botCount', v)}
                    min={0}
                    max={99}
                    hint='≤ total − 1'
                />
                <NumField
                    label='Duration (s)'
                    value={cfg.gameDurationSec}
                    onChange={(v) => set('gameDurationSec', v)}
                    min={30}
                    max={600}
                />
                <NumField
                    label='Coin density ×100'
                    value={cfg.coinDensityX100}
                    onChange={(v) => set('coinDensityX100', v)}
                    min={5}
                    max={30}
                />
                <NumField
                    label='Sprint warn (s)'
                    value={cfg.finalSprintWarningSec}
                    onChange={(v) => set('finalSprintWarningSec', v)}
                    min={3}
                    max={15}
                />
                <NumField
                    label='Lobby countdown (s)'
                    value={cfg.lobbyCountdownSec}
                    onChange={(v) => set('lobbyCountdownSec', v)}
                    min={3}
                    max={120}
                    hint='join window before start'
                />
                <NumField
                    label='Result display (s)'
                    value={cfg.resultDisplaySec}
                    onChange={(v) => set('resultDisplaySec', v)}
                    min={2}
                    max={60}
                    hint='before the next round'
                />
                <NumField
                    label='Bots off at ≥ N real players'
                    value={cfg.botMaxRealPlayers}
                    onChange={(v) => set('botMaxRealPlayers', v)}
                    min={0}
                    max={100}
                    hint='0 = bots never join'
                />
            </div>

            {/* Bots */}
            <div style={{ fontSize: 12, fontWeight: 700, marginTop: 4 }}>
                Bots
            </div>
            <div
                style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: 10,
                }}
            >
                <label
                    style={{ display: 'flex', flexDirection: 'column', gap: 4 }}
                >
                    <span style={{ fontSize: 12, fontWeight: 600 }}>
                        Seed mode
                    </span>
                    <select
                        value={cfg.botSeedMode}
                        onChange={(e) =>
                            set(
                                'botSeedMode',
                                e.target
                                    .value as AdminWerkConfig['botSeedMode'],
                            )
                        }
                        style={{
                            padding: '8px 9px',
                            borderRadius: 8,
                            border: '1px solid var(--border, rgba(255,255,255,0.15))',
                            background: 'var(--surface,#0c0a08)',
                            color: 'inherit',
                        }}
                    >
                        <option value='auto'>Auto (varied)</option>
                        <option value='custom'>Custom (cycle pool)</option>
                        <option value='zero'>Zero (no bots)</option>
                    </select>
                </label>
                <div
                    style={{ display: 'flex', flexDirection: 'column', gap: 4 }}
                >
                    <span style={{ fontSize: 12, fontWeight: 600 }}>
                        Difficulty presets
                    </span>
                    <div style={{ display: 'flex', gap: 6 }}>
                        {(
                            [
                                ['Easy', 74, 30],
                                ['Medium', 88, 60],
                                ['Hard', 96, 85],
                            ] as const
                        ).map(([label, sp, sk]) => {
                            const active =
                                cfg.botSpeedPct === sp &&
                                cfg.botSkillPct === sk;
                            return (
                                <button
                                    key={label}
                                    type='button'
                                    onClick={() =>
                                        setCfg((c) =>
                                            c
                                                ? {
                                                      ...c,
                                                      botSpeedPct: sp,
                                                      botSkillPct: sk,
                                                  }
                                                : c,
                                        )
                                    }
                                    className={`btn btn-sm ${active ? 'btn-primary' : ''}`}
                                    style={{ flex: 1 }}
                                >
                                    {label}
                                </button>
                            );
                        })}
                    </div>
                </div>
            </div>
            <div
                style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: 10,
                }}
            >
                <NumField
                    label='Bot speed % (of human)'
                    value={cfg.botSpeedPct}
                    onChange={(v) => set('botSpeedPct', v)}
                    min={30}
                    max={100}
                    hint='± small jitter per bot'
                />
                <NumField
                    label='Bot skill % (0–100)'
                    value={cfg.botSkillPct}
                    onChange={(v) => set('botSkillPct', v)}
                    min={0}
                    max={100}
                    hint='target choice + reaction'
                />
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>
                {cfg.botSeedMode === 'zero'
                    ? 'Bots are disabled  games run with the human only.'
                    : `Each game draws ${cfg.botCount} bot(s) from the enabled pool. Speed/skill above are the base; a bot with its own override ignores them. Manage the pool under Admin → Bots → Werk Flega.`}
            </div>

            {/* Winning mode */}
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 12, fontWeight: 600 }}>
                    Winning mode
                </span>
                <select
                    value={cfg.winningMode}
                    onChange={(e) =>
                        set('winningMode', e.target.value as 'A' | 'B')
                    }
                    style={{
                        padding: '8px 9px',
                        borderRadius: 8,
                        border: '1px solid var(--border, rgba(255,255,255,0.15))',
                        background: 'var(--surface,#0c0a08)',
                        color: 'inherit',
                    }}
                >
                    <option value='A'>A Most Coins Collector</option>
                    <option value='B'>B Final Sprint (reach center)</option>
                </select>
            </label>

            {/* Theme */}
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 12, fontWeight: 600 }}>
                    Maze theme
                </span>
                <select
                    value={cfg.mazeTheme}
                    onChange={(e) =>
                        set(
                            'mazeTheme',
                            e.target.value as AdminWerkConfig['mazeTheme'],
                        )
                    }
                    style={{
                        padding: '8px 9px',
                        borderRadius: 8,
                        border: '1px solid var(--border, rgba(255,255,255,0.15))',
                        background: 'var(--surface,#0c0a08)',
                        color: 'inherit',
                    }}
                >
                    <option value='adwa'>Adwa gold walls / cyan sectors</option>
                    <option value='highland'>Highland teal / green</option>
                    <option value='desert'>Desert amber / sand</option>
                </select>
            </label>

            {/* Prize table */}
            <div style={{ fontSize: 12, fontWeight: 700, marginTop: 4 }}>
                Prize table (× stake, ×100 300 = 3.0×)
            </div>
            <div
                style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr',
                    gap: 6,
                }}
            >
                <NumField
                    label='#1'
                    value={cfg.payoutRank1MultX100}
                    onChange={(v) => set('payoutRank1MultX100', v)}
                    min={0}
                />
                <NumField
                    label='#2'
                    value={cfg.payoutRank2MultX100}
                    onChange={(v) => set('payoutRank2MultX100', v)}
                    min={0}
                />
                <NumField
                    label='#3'
                    value={cfg.payoutRank3MultX100}
                    onChange={(v) => set('payoutRank3MultX100', v)}
                    min={0}
                />
                <NumField
                    label='#4'
                    value={cfg.payoutRank4MultX100}
                    onChange={(v) => set('payoutRank4MultX100', v)}
                    min={0}
                />
                <NumField
                    label='#5'
                    value={cfg.payoutRank5MultX100}
                    onChange={(v) => set('payoutRank5MultX100', v)}
                    min={0}
                />
            </div>

            {/* House-edge win control */}
            <div style={{ fontSize: 12, fontWeight: 700, marginTop: 4 }}>
                House edge / win control
            </div>
            <Toggle
                label='Win control enabled'
                value={cfg.winControlEnabled}
                onChange={(v) => set('winControlEnabled', v)}
            />
            <div
                style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: 10,
                    opacity: cfg.winControlEnabled ? 1 : 0.5,
                }}
            >
                <NumField
                    label='House always wins below N players'
                    value={cfg.houseGuaranteedBelowPlayers}
                    onChange={(v) => set('houseGuaranteedBelowPlayers', v)}
                    min={0}
                    max={100}
                    hint='participants incl. human'
                />
                <NumField
                    label='Force bot win every N rounds'
                    value={cfg.botForcedWinEveryNRounds}
                    onChange={(v) => set('botForcedWinEveryNRounds', v)}
                    min={0}
                    max={1000}
                    hint='0 = off (large games)'
                />
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>
                Below the threshold the human is forced under every bot (no top
                prize). Above it, a random bot is pushed above the human every N
                settled rounds. Rolling counter: {cfg.winControlCounter}. Win
                control only applies while bots are present (≥{' '}
                {cfg.botMaxRealPlayers || '∞'} real players → no bots, pure
                competition).
            </div>

            {/* Onboarding win sequence (per new user) */}
            <div style={{ fontSize: 12, fontWeight: 700, marginTop: 4 }}>
                Onboarding win sequence (per user)
            </div>
            <Toggle
                label='Scripted first games'
                value={cfg.onboardingWinControlEnabled}
                onChange={(v) => set('onboardingWinControlEnabled', v)}
            />
            <div
                style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: 10,
                    opacity: cfg.onboardingWinControlEnabled ? 1 : 0.5,
                }}
            >
                <NumField
                    label='First N games are losses'
                    value={cfg.onboardingBotWinGames}
                    onChange={(v) => set('onboardingBotWinGames', v)}
                    min={0}
                    max={50}
                    hint='a bot always beats them'
                />
                <NumField
                    label='Then M games are wins'
                    value={cfg.onboardingUserWinGames}
                    onChange={(v) => set('onboardingUserWinGames', v)}
                    min={0}
                    max={50}
                    hint='boosted above all bots'
                />
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>
                A new user loses their first {cfg.onboardingBotWinGames}{' '}
                game(s), wins the next {cfg.onboardingUserWinGames}, then falls
                back to the house-edge control above. Reward only the top places
                by setting lower ranks to 0 in the prize table.
            </div>

            <button
                className='btn btn-primary'
                disabled={saving}
                onClick={save}
                style={{ width: '100%', marginTop: 6 }}
            >
                {saving ? 'Saving…' : 'Save config'}
            </button>
        </div>
    );

    // Embedded in the main Admin panel (no modal chrome).
    if (embedded) {
        return (
            <div>
                <div className='adm-section-head'>
                    <div>
                        <h2 className='adm-section-title'>⛏️ Werk Flega</h2>
                        <p className='adm-section-sub'>
                            Stakes, round shape, bot pool, prizes &amp; win
                            control.
                        </p>
                    </div>
                </div>
                {inner}
            </div>
        );
    }

    // Modal, opened from the in-game lobby gear.
    return (
        <div
            style={{
                position: 'fixed',
                inset: 0,
                zIndex: 3000,
                background: 'rgba(0,0,0,0.6)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 16,
            }}
            onClick={onClose}
        >
            <div
                onClick={(e) => e.stopPropagation()}
                style={{
                    background: 'var(--surface,#12161c)',
                    border: '1px solid var(--border, rgba(255,255,255,0.12))',
                    borderRadius: 16,
                    padding: 18,
                    maxWidth: 480,
                    width: '100%',
                    maxHeight: '88vh',
                    overflowY: 'auto',
                }}
            >
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        marginBottom: 14,
                    }}
                >
                    <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>
                        ⛏️ Werk Flega Admin
                    </h3>
                    <button
                        className='btn'
                        onClick={onClose}
                        style={{ marginLeft: 'auto', padding: '4px 8px' }}
                    >
                        <X size={16} />
                    </button>
                </div>
                {inner}
            </div>
        </div>
    );
}

const cellStyle: CSSProperties = {
    padding: '6px 8px',
    borderRadius: 7,
    border: '1px solid var(--border, rgba(255,255,255,0.15))',
    background: 'var(--surface,#0c0a08)',
    color: 'inherit',
    fontSize: 12,
    width: '100%',
};

/**
 * Admin CRUD over the DB-backed house-bot pool. Rosters are drawn from the
 * `enabled` rows here  this is where bots actually come from. Changes autosave:
 * text/number fields on blur, toggles/selects immediately.
 */
export function WerkBotManager() {
    const addToast = useStore((s) => s.addToast);
    const [bots, setBots] = useState<AdminWerkBot[] | null>(null);
    const [adding, setAdding] = useState(false);

    useEffect(() => {
        adminWerkApi
            .listBots()
            .then(setBots)
            .catch((e) => addToast('error', getErrorMessage(e)));
    }, [addToast]);

    const patch = async (id: number, dto: Partial<CreateWerkBotInput>) => {
        try {
            const updated = await adminWerkApi.updateBot(id, dto);
            setBots((bs) => bs?.map((b) => (b.id === id ? updated : b)) ?? bs);
        } catch (e) {
            addToast('error', getErrorMessage(e));
        }
    };

    const addBot = async () => {
        setAdding(true);
        try {
            const n = (bots?.length ?? 0) + 1;
            const created = await adminWerkApi.createBot({
                name: `ቦት ${n}`,
                nameEn: `Bot ${n}`,
                color: DEFAULT_BOT_COLORS[n % DEFAULT_BOT_COLORS.length],
                personality: PERSONALITIES[n % PERSONALITIES.length].id,
                sortOrder: n * 10,
            });
            setBots((bs) => [...(bs ?? []), created]);
        } catch (e) {
            addToast('error', getErrorMessage(e));
        } finally {
            setAdding(false);
        }
    };

    const remove = async (id: number) => {
        if (!window.confirm('Delete this bot from the pool?')) return;
        try {
            await adminWerkApi.deleteBot(id);
            setBots((bs) => bs?.filter((b) => b.id !== id) ?? bs);
        } catch (e) {
            addToast('error', getErrorMessage(e));
        }
    };

    const enabledCount = bots?.filter((b) => b.enabled).length ?? 0;

    return (
        <div
            style={{
                border: '1px solid var(--border, rgba(255,255,255,0.12))',
                borderRadius: 12,
                padding: 10,
                display: 'grid',
                gap: 8,
            }}
        >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 700 }}>Bot pool</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {bots
                        ? `${enabledCount} enabled / ${bots.length} total`
                        : 'loading…'}
                </span>
                <button
                    type='button'
                    className='btn btn-sm'
                    disabled={adding}
                    onClick={addBot}
                    style={{
                        marginLeft: 'auto',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                    }}
                >
                    <Plus size={13} /> Add bot
                </button>
            </div>

            {!bots ? (
                <div
                    style={{
                        display: 'flex',
                        justifyContent: 'center',
                        padding: 16,
                    }}
                >
                    <div className='spinner' />
                </div>
            ) : bots.length === 0 ? (
                <div
                    style={{
                        fontSize: 11.5,
                        color: 'var(--text-muted)',
                        padding: '6px 2px',
                    }}
                >
                    No bots yet add one, or games will run with the human only.
                </div>
            ) : (
                <div
                    style={{
                        display: 'grid',
                        gap: 8,
                        maxHeight: 260,
                        overflowY: 'auto',
                        paddingRight: 2,
                    }}
                >
                    {bots.map((b) => (
                        <BotRow
                            key={b.id}
                            bot={b}
                            onPatch={(dto) => patch(b.id, dto)}
                            onRemove={() => remove(b.id)}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

/** One editable bot row. Local draft; commits changed fields to the API. */
function BotRow({
    bot,
    onPatch,
    onRemove,
}: {
    bot: AdminWerkBot;
    onPatch: (dto: Partial<CreateWerkBotInput>) => void;
    onRemove: () => void;
}) {
    const [d, setD] = useState(bot);
    useEffect(() => setD(bot), [bot]);
    const numOrNull = (v: string) => (v === '' ? null : Math.round(Number(v)));

    return (
        <div
            style={{
                display: 'grid',
                gap: 6,
                padding: 8,
                borderRadius: 9,
                opacity: d.enabled ? 1 : 0.5,
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid var(--border, rgba(255,255,255,0.1))',
            }}
        >
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input
                    type='color'
                    value={d.color}
                    title='Colour'
                    onChange={(e) => {
                        setD({ ...d, color: e.target.value });
                        onPatch({ color: e.target.value });
                    }}
                    style={{
                        width: 30,
                        height: 30,
                        padding: 0,
                        border: 'none',
                        background: 'none',
                        cursor: 'pointer',
                    }}
                />
                <input
                    value={d.name}
                    placeholder='ስም (Amharic)'
                    onChange={(e) => setD({ ...d, name: e.target.value })}
                    onBlur={() =>
                        d.name.trim() &&
                        d.name !== bot.name &&
                        onPatch({ name: d.name.trim() })
                    }
                    style={{ ...cellStyle, flex: 1 }}
                />
                <input
                    value={d.nameEn}
                    placeholder='Name (Latin)'
                    onChange={(e) => setD({ ...d, nameEn: e.target.value })}
                    onBlur={() =>
                        d.nameEn.trim() &&
                        d.nameEn !== bot.nameEn &&
                        onPatch({ nameEn: d.nameEn.trim() })
                    }
                    style={{ ...cellStyle, flex: 1 }}
                />
                <button
                    type='button'
                    onClick={onRemove}
                    title='Delete bot'
                    className='btn btn-sm'
                    style={{ padding: '5px 7px', color: '#f87171' }}
                >
                    <Trash2 size={14} />
                </button>
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <select
                    value={d.personality}
                    onChange={(e) => {
                        const p = e.target.value as WerkBotPersonality;
                        setD({ ...d, personality: p });
                        onPatch({ personality: p });
                    }}
                    style={{ ...cellStyle, flex: 1.4 }}
                >
                    {PERSONALITIES.map((p) => (
                        <option key={p.id} value={p.id}>
                            {p.label}
                        </option>
                    ))}
                </select>
                <input
                    type='number'
                    value={d.speedPct ?? ''}
                    placeholder='spd'
                    title='Speed % override (blank = auto)'
                    min={30}
                    max={100}
                    onChange={(e) =>
                        setD({
                            ...d,
                            speedPct:
                                e.target.value === ''
                                    ? null
                                    : Number(e.target.value),
                        })
                    }
                    onBlur={(e) =>
                        onPatch({ speedPct: numOrNull(e.target.value) })
                    }
                    style={{ ...cellStyle, width: 58 }}
                />
                <input
                    type='number'
                    value={d.skillPct ?? ''}
                    placeholder='skl'
                    title='Skill 0–100 override (blank = auto)'
                    min={0}
                    max={100}
                    onChange={(e) =>
                        setD({
                            ...d,
                            skillPct:
                                e.target.value === ''
                                    ? null
                                    : Number(e.target.value),
                        })
                    }
                    onBlur={(e) =>
                        onPatch({ skillPct: numOrNull(e.target.value) })
                    }
                    style={{ ...cellStyle, width: 58 }}
                />
                <button
                    type='button'
                    onClick={() => {
                        setD({ ...d, enabled: !d.enabled });
                        onPatch({ enabled: !d.enabled });
                    }}
                    className={`btn btn-sm ${d.enabled ? 'btn-primary' : ''}`}
                    style={{ padding: '5px 9px', fontSize: 11 }}
                >
                    {d.enabled ? 'On' : 'Off'}
                </button>
            </div>
        </div>
    );
}
