import { useEffect, useState } from 'react';
import { MapPin } from 'lucide-react';
import { agentMatchApi } from '../lib/api';
import type { OnDutyAgentOption } from '../lib/api';
import { useStore } from '../store/useStore';
import { getErrorMessage } from '../lib/utils';

/**
 * One-time, SKIPPABLE agent-connect prompt. Shown only to players who have
 * never answered (the Telegram bot usually captures this at registration, so
 * this is the Mini App backfill for accounts created before the feature, or
 * web/standalone logins). Choosing "Other" or dismissing both count as
 * answered-for-the-house and the prompt never returns.
 *
 * We remember a per-user dismissal in localStorage so a player who taps "Skip"
 * isn't nagged on every launch, while still letting the backend be the source
 * of truth for a real selection.
 */
export function LocationPrompt() {
  const user = useStore((s) => s.user);
  const addToast = useStore((s) => s.addToast);

  const [agents, setAgents] = useState<OnDutyAgentOption[]>([]);
  const [visible, setVisible] = useState(false);
  const [selected, setSelected] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);

  const isPlayer = !!user && !user.roles.includes('admin') && !user.roles.includes('agent');
  const dismissKey = user ? `agentMatchPromptDismissed:${user.id}` : null;

  useEffect(() => {
    if (!isPlayer || !dismissKey) return;
    if (localStorage.getItem(dismissKey) === '1') return;

    let cancelled = false;
    (async () => {
      try {
        const mine = await agentMatchApi.getMine();
        if (cancelled) return;
        // Already answered — nothing to ask.
        if (mine && mine.assignedAgentSource) {
          localStorage.setItem(dismissKey, '1');
          return;
        }
        const list = await agentMatchApi.listAgents();
        if (cancelled) return;
        // No on-duty agents → nothing to pick; don't show an "Other"-only modal.
        if (list.length === 0) return;
        setAgents(list);
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
      await agentMatchApi.setMine({ agentId: selected });
      dismiss();
      addToast('success', 'Thanks — you\'re connected with an agent.');
    } catch (e) {
      addToast('error', getErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const chooseOther = async () => {
    setSaving(true);
    try {
      await agentMatchApi.setMine({ other: true });
    } catch {
      // Even if the write fails, honour the dismissal locally so we don't nag.
    } finally {
      setSaving(false);
      dismiss();
    }
  };

  const useMyLocation = () => {
    if (!navigator.geolocation) {
      addToast('error', 'Location is not available on this device — pick from the list instead.');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const match = await agentMatchApi.attempt(pos.coords.latitude, pos.coords.longitude);
          if (match) {
            dismiss();
            addToast('success', `Connected with ${match.assignedAgentName ?? 'an agent'} nearby.`);
          } else {
            addToast('error', 'No on-duty agent nearby — pick one from the list instead.');
          }
        } catch (e) {
          addToast('error', getErrorMessage(e));
        } finally {
          setLocating(false);
        }
      },
      () => {
        setLocating(false);
        addToast('error', 'Could not read your location — pick from the list instead.');
      },
    );
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
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Connect with an agent</h2>
        </div>
        <p style={{ color: 'var(--text-muted, #999)', fontSize: 13, lineHeight: 1.5, margin: '0 0 16px' }}>
          It is optional, but connecting with a nearby agent makes deposits and withdrawals faster.
        </p>

        <button
          className="btn btn-primary"
          style={{ width: '100%', marginBottom: 10 }}
          disabled={saving || locating}
          onClick={useMyLocation}
        >
          {locating ? 'Finding nearby agent…' : '📍 Use my location'}
        </button>

        <select
          className="input"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          style={{ width: '100%', background: 'var(--bg-2, #222)', color: 'var(--text-primary, #fff)', marginBottom: 16 }}
        >
          <option value="">— Or pick an agent —</option>
          {agents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.name}
            </option>
          ))}
        </select>

        <button
          className="btn btn-secondary"
          style={{ width: '100%', marginBottom: 10 }}
          disabled={!selected || saving || locating}
          onClick={saveSelection}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>

        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', fontSize: 13 }}>
          <button
            onClick={chooseOther}
            disabled={saving || locating}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted, #999)', cursor: 'pointer', textDecoration: 'underline' }}
          >
            Not listed
          </button>
          <button
            onClick={dismiss}
            disabled={saving || locating}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted, #999)', cursor: 'pointer' }}
          >
            Skip
          </button>
        </div>
      </div>
    </div>
  );
}
