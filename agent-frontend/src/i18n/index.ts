import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import en from './locales/en.json';
import am from './locales/am.json';
import om from './locales/om.json';
import ti from './locales/ti.json';
import mt from './locales/mt.json';

/** Languages offered in the switcher. `label` is the language's own name. */
export const SUPPORTED_LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'am', label: 'አማርኛ' },
  { code: 'om', label: 'Afaan Oromo' },
  { code: 'ti', label: 'ትግርኛ' },
  { code: 'mt', label: 'Malti' },
] as const;

export const SUPPORTED_CODES = SUPPORTED_LANGUAGES.map((l) => l.code);

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      am: { translation: am },
      om: { translation: om },
      ti: { translation: ti },
      mt: { translation: mt },
    },
    fallbackLng: 'en',
    supportedLngs: SUPPORTED_CODES,
    // Missing keys in am/om/ti/mt fall back to the English string automatically.
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'lang',
    },
    interpolation: { escapeValue: false },
  });

// Keep <html lang> in sync so screen readers and font selection follow the UI.
i18n.on('languageChanged', (lng) => {
  document.documentElement.lang = lng;
});
document.documentElement.lang = i18n.resolvedLanguage ?? 'en';

export default i18n;
