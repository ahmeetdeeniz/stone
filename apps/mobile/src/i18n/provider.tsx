import * as SecureStore from "expo-secure-store";
import {
  parseLocalePreference,
  resolveLocale,
  translate,
  translatePlural,
  type Locale,
  type LocalePreference,
  type TranslationKey,
  type TranslationParameters,
} from "@stone/i18n";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

const LOCALE_PREFERENCE_KEY = "stone.locale.preference.v1";

interface I18nContextValue {
  locale: Locale;
  preference: LocalePreference;
  ready: boolean;
  setPreference: (preference: LocalePreference) => Promise<void>;
  t: (key: TranslationKey, parameters?: TranslationParameters) => string;
  tp: (baseKey: string, count: number, parameters?: TranslationParameters) => string;
}

const systemLocale = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale;
  } catch {
    return null;
  }
};

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<LocalePreference>("system");
  const [ready, setReady] = useState(false);
  const locale = resolveLocale(preference, systemLocale());

  useEffect(() => {
    let active = true;
    void SecureStore.getItemAsync(LOCALE_PREFERENCE_KEY)
      .then((stored) => {
        if (active) setPreferenceState(parseLocalePreference(stored));
      })
      .catch(() => {
        if (active) setPreferenceState("system");
      })
      .finally(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      preference,
      ready,
      setPreference: async (next) => {
        setPreferenceState(next);
        try {
          await SecureStore.setItemAsync(LOCALE_PREFERENCE_KEY, next);
        } catch {
          // The in-memory selection remains usable; the next launch safely falls back to system.
        }
      },
      t: (key, parameters) => translate(locale, key, parameters),
      tp: (baseKey, count, parameters) => translatePlural(locale, baseKey, count, parameters),
    }),
    [locale, preference, ready],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used inside I18nProvider.");
  return value;
}

export { LOCALE_PREFERENCE_KEY };
