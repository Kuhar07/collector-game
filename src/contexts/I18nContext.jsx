import { createContext, useContext, useEffect, useState, useCallback } from 'react';

const I18nContext = createContext(null);
const STORAGE_KEY = 'language';
const DEFAULT_LANG = 'en';

export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(() => localStorage.getItem(STORAGE_KEY) || DEFAULT_LANG);
  const [translations, setTranslations] = useState({});
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/i18n/${lang}.json`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setTranslations(data);
        setReady(true);
        document.title = data.app_title || 'Sakupljač';
      })
      .catch((e) => console.error('Failed to load translations', e));
    return () => {
      cancelled = true;
    };
  }, [lang]);

  const setLang = useCallback((newLang) => {
    localStorage.setItem(STORAGE_KEY, newLang);
    setLangState(newLang);
  }, []);

  const toggleLang = useCallback(() => {
    setLang(lang === 'en' ? 'hr' : 'en');
  }, [lang, setLang]);

  const t = useCallback(
    (key, placeholders = {}) => {
      const keys = key.split('.');
      let value = translations;
      for (const k of keys) value = value?.[k];
      if (value == null) return key;
      if (typeof value !== 'string') return value;
      let out = value;
      for (const [p, repl] of Object.entries(placeholders)) {
        out = out.replaceAll(`{${p}}`, repl);
      }
      return out;
    },
    [translations]
  );

  return (
    <I18nContext.Provider value={{ lang, setLang, toggleLang, t, ready }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside I18nProvider');
  return ctx;
}
