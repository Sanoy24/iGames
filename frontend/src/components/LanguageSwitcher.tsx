import { useTranslation } from 'react-i18next';
import { Languages } from 'lucide-react';
import { SUPPORTED_LANGUAGES } from '../i18n';

/** Dropdown to switch UI language. Persists to localStorage via i18next detector. */
export function LanguageSwitcher() {
  const { i18n } = useTranslation();
  const current = i18n.resolvedLanguage ?? 'en';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <Languages size={16} style={{ color: 'var(--accent)', flexShrink: 0 }} />
      <select
        className="input"
        value={current}
        onChange={(e) => void i18n.changeLanguage(e.target.value)}
        style={{ flex: 1 }}
        aria-label="Language"
      >
        {SUPPORTED_LANGUAGES.map((l) => (
          <option key={l.code} value={l.code}>{l.label}</option>
        ))}
      </select>
    </div>
  );
}
