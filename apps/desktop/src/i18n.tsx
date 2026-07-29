import {
  parseLocalePreference,
  resolveLocale,
  translate,
  type Locale,
  type LocalePreference,
  type TranslationKey,
  type TranslationParameters,
} from "@stone/i18n";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

const LOCALE_PREFERENCE_KEY = "stone.locale.preference.v1";

interface I18nContextValue {
  locale: Locale;
  preference: LocalePreference;
  setPreference: (preference: LocalePreference) => void;
  t: (key: TranslationKey, parameters?: TranslationParameters) => string;
}

function readPreference(): LocalePreference {
  try {
    return parseLocalePreference(window.localStorage.getItem(LOCALE_PREFERENCE_KEY));
  } catch {
    return "system";
  }
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState(readPreference);
  const locale = resolveLocale(preference, window.navigator.language);
  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      preference,
      setPreference: (next) => {
        setPreferenceState(next);
        try {
          window.localStorage.setItem(LOCALE_PREFERENCE_KEY, next);
        } catch {
          // The current session remains translated; restart falls back safely.
        }
      },
      t: (key, parameters) => translate(locale, key, parameters),
    }),
    [locale, preference],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used inside I18nProvider.");
  return value;
}

export { LOCALE_PREFERENCE_KEY };
