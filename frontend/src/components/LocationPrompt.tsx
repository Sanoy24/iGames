import { useEffect, useState } from 'react';
import { MapPin } from 'lucide-react';
import { locationsApi } from '../lib/api';
import type { PublicLocation } from '../lib/models';
import { useStore } from '../store/useStore';
import { getErrorMessage } from '../lib/utils';

/**
 * One-time, SKIPPABLE area prompt. Shown only to players who have never answered
 * (the Telegram bot usually captures this at registration, so this is the Mini
 * App backfill for accounts created before the feature, or web/standalone
 * logins). Choosing "Other" or dismissing both count as answered-for-the-house
 * and the prompt never returns.
 *
 * We remember a per-user dismissal in localStorage so a player who taps "Skip"
 * isn't nagged on every launch, while still letting the backend be the source of
 * truth for a real selection.
 */
export function LocationPrompt() {
  const user = useStore((s) => s.user);
  const addToast = useStore((s) => s.addToast);

  const [locations, setLocations] = useState<PublicLocation[]>([]);
  const [visible, setVisible] = useState(false);
  const [selected, setSelected] = useState<string>('');
  const [saving, setSaving] = useState(false);

  const isPlayer = !!user && !user.roles.includes('admin') && !user.roles.includes('agent');
  const dismissKey = user ? `locationPromptDismissed:${user.id}` : null;

  useEffect(() => {
    if (!isPlayer || !dismissKey) return;
    if (localStorage.getItem(dismissKey) === '1') return;

    let cancelled = false;
    (async () => {
      try {
        const mine = await locationsApi.getMine();
        if (cancelled) return;
        // Already answered — nothing to ask.
        if (mine && mine.locationSource) {
          localStorage.setItem(dismissKey, '1');
          return;
        }
        const list = await locationsApi.list();
        if (cancelled) return;
        // No configured areas → nothing to pick; don't show an "Other"-only modal.
        if (list.length === 0) return;
        setLocations(list);
        setVisible(true);
      } catch {
        // Non-critical: if the check fails, just don't prompt.
      }
    })();
    return () => { cancelled = true; };
  }, [isPlayer, dismissKey]);

  if (!visible) return null;

  const dismiss = () => {
    if (dismissKey) localStorage.setItem(dismissKey, '1');
    setVisible(false);
  };

  const saveSelection = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await locationsApi.setMine({ locationId: selected });
      dismiss();
      addToast('success', 'Thanks — your area has been saved.');
    } catch (e) {
      addToast('error', getErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const chooseOther = async () => {
    setSaving(true);
    try {
      await locationsApi.setMine({ other: true });
    } catch {
      // Even if the write fails, honour the dismissal locally so we don't nag.
    } finally {
      setSaving(false);
      dismiss();
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(2px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      }}
      onClick={dismiss}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 380, background: 'var(--surface, #17171b)',
          border: '1px solid var(--border, #2a2a30)', borderRadius: 16, padding: 22,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--bg-2, #222)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <MapPin size={20} style={{ color: 'var(--accent, #f0a500)' }} />
          </div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Which area are you in?</h2>
        </div>
        <p style={{ color: 'var(--text-muted, #999)', fontSize: 13, lineHeight: 1.5, margin: '0 0 16px' }}>
          It is optional, but if you choose your nearest place it is easy to assign an agent for you to make a fast deposit and withdraw.
        </p>

        <select
          className="input"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          style={{ width: '100%', background: 'var(--bg-2, #222)', color: 'var(--text-primary, #fff)', marginBottom: 16 }}
        >
          <option value="">— Select your area —</option>
          {locations.map((loc) => (
            <option key={loc.id} value={loc.id}>
              {loc.region ? `${loc.name} (${loc.region})` : loc.name}
            </option>
          ))}
        </select>

        <button
          className="btn btn-primary"
          style={{ width: '100%', marginBottom: 10 }}
          disabled={!selected || saving}
          onClick={saveSelection}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>

        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', fontSize: 13 }}>
          <button
            onClick={chooseOther}
            disabled={saving}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted, #999)', cursor: 'pointer', textDecoration: 'underline' }}
          >
            My area isn't listed
          </button>
          <button
            onClick={dismiss}
            disabled={saving}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted, #999)', cursor: 'pointer' }}
          >
            Skip
          </button>
        </div>
      </div>
    </div>
  );
}
