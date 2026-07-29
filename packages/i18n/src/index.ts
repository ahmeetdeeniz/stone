import { en, type TranslationKey } from "./en.js";
import { tr } from "./tr.js";

export type Locale = "en" | "tr";
export type LocalePreference = "system" | Locale;
export type TranslationParameters = Readonly<Record<string, string | number>>;

const resources: Readonly<Record<Locale, Readonly<Record<TranslationKey, string>>>> = { en, tr };
const formatterCache = new Map<string, Intl.DateTimeFormat | Intl.NumberFormat>();

export function resolveSystemLocale(locale: string | null | undefined): Locale {
  if (!locale) return "en";
  try {
    return Intl.getCanonicalLocales(locale)[0]?.toLowerCase().startsWith("tr") ? "tr" : "en";
  } catch {
    return "en";
  }
}

export function resolveLocale(
  preference: LocalePreference,
  systemLocale: string | null | undefined,
): Locale {
  return preference === "system" ? resolveSystemLocale(systemLocale) : preference;
}

export function parseLocalePreference(value: string | null | undefined): LocalePreference {
  return value === "en" || value === "tr" || value === "system" ? value : "system";
}

export function translate(
  locale: Locale,
  key: TranslationKey,
  parameters: TranslationParameters = {},
): string {
  const template = resources[locale][key] ?? en[key];
  return template.replace(/\{\{([a-zA-Z][a-zA-Z0-9_]*)\}\}/gu, (_, name: string) => {
    const value = parameters[name];
    return value === undefined ? `{{${name}}}` : String(value);
  });
}

export function translatePlural(
  locale: Locale,
  baseKey: string,
  count: number,
  parameters: TranslationParameters = {},
): string {
  const category = new Intl.PluralRules(locale).select(count);
  const candidate = `${baseKey}.${category}` as TranslationKey;
  const fallback = `${baseKey}.other` as TranslationKey;
  const key = candidate in en ? candidate : fallback;
  return translate(locale, key, { ...parameters, count });
}

function dateFormatter(
  locale: Locale,
  timezone: string | undefined,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const key = `date:${locale}:${timezone ?? ""}:${JSON.stringify(options)}`;
  const cached = formatterCache.get(key);
  if (cached instanceof Intl.DateTimeFormat) return cached;
  const formatter = new Intl.DateTimeFormat(locale, { ...options, timeZone: timezone });
  formatterCache.set(key, formatter);
  return formatter;
}

export function formatDateOnly(
  locale: Locale,
  date: string,
  options: Intl.DateTimeFormatOptions = { dateStyle: "medium" },
): string {
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1, 12));
  return dateFormatter(locale, "UTC", options).format(value);
}

export function formatInstant(
  locale: Locale,
  instant: string | Date,
  timezone: string,
  options: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" },
): string {
  return dateFormatter(locale, timezone, options).format(
    typeof instant === "string" ? new Date(instant) : instant,
  );
}

export function formatNumber(locale: Locale, value: number): string {
  const key = `number:${locale}`;
  const cached = formatterCache.get(key);
  if (cached instanceof Intl.NumberFormat) return cached.format(value);
  const formatter = new Intl.NumberFormat(locale);
  formatterCache.set(key, formatter);
  return formatter.format(value);
}

export function formatDuration(locale: Locale, minutes: number): string {
  if (minutes < 60) return translatePlural(locale, "duration.minutes", minutes);
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  const hourText = translatePlural(locale, "duration.hours", hours);
  return remainder
    ? `${hourText} ${translatePlural(locale, "duration.minutes", remainder)}`
    : hourText;
}

export interface RecurrenceDescription {
  frequency: "daily" | "weekdays" | "weekly" | "monthly" | "custom";
  interval: number;
  unit: "day" | "week" | "month";
}

export function formatRecurrence(locale: Locale, recurrence: RecurrenceDescription | null): string {
  if (!recurrence) return translate(locale, "recurrence.none");
  if (recurrence.frequency !== "custom")
    return translate(locale, `recurrence.${recurrence.frequency}` as TranslationKey);
  return translatePlural(locale, `recurrence.custom.${recurrence.unit}`, recurrence.interval);
}

export function formatTaskPriority(
  locale: Locale,
  priority: "none" | "low" | "medium" | "high" | "urgent",
): string {
  return translate(locale, `tasks.priority.${priority}` as TranslationKey);
}

export function formatTaskState(locale: Locale, state: "open" | "completed" | "cancelled"): string {
  return translate(locale, `tasks.status.${state}` as TranslationKey);
}

export { en, tr };
export type { TranslationKey };
