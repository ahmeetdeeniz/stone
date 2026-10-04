import type { TaskPriority } from "./entities.js";

export interface QuickAddResult {
  title: string;
  dueDate: string | null;
  dueTime: string | null;
  priority: TaskPriority;
  tags: readonly string[];
  /** Text after `@`, for the caller to match against project titles or slugs. */
  projectHint: string | null;
}

export interface QuickAddContext {
  /** Today's date in the user's timezone (YYYY-MM-DD). */
  today: string;
}

const WEEKDAYS: Readonly<Record<string, number>> = {
  sunday: 0,
  sun: 0,
  pazar: 0,
  monday: 1,
  mon: 1,
  pazartesi: 1,
  tuesday: 2,
  tue: 2,
  salı: 2,
  sali: 2,
  wednesday: 3,
  wed: 3,
  çarşamba: 3,
  carsamba: 3,
  thursday: 4,
  thu: 4,
  perşembe: 4,
  persembe: 4,
  friday: 5,
  fri: 5,
  cuma: 5,
  saturday: 6,
  sat: 6,
  cumartesi: 6,
};

const RELATIVE_DAYS: Readonly<Record<string, number>> = {
  today: 0,
  tonight: 0,
  bugün: 0,
  bugun: 0,
  "bu akşam": 0,
  tomorrow: 1,
  yarın: 1,
  yarin: 1,
  "day after tomorrow": 2,
  "öbür gün": 2,
  "obur gun": 2,
  "yarından sonra": 2,
  "next week": 7,
  haftaya: 7,
  "gelecek hafta": 7,
};

const PRIORITY_WORDS: Readonly<Record<string, TaskPriority>> = {
  low: "low",
  düşük: "low",
  dusuk: "low",
  medium: "medium",
  med: "medium",
  orta: "medium",
  high: "high",
  yüksek: "high",
  yuksek: "high",
  urgent: "high",
  acil: "high",
};

/**
 * Turns a one-line capture such as "yarın 15:00 raporu gönder #iş !yüksek" or
 * "call mom friday 6pm @family" into task fields. Recognised tokens are removed from the title;
 * anything not understood stays in the title, so the parser never loses text.
 */
export function parseQuickAdd(input: string, context: QuickAddContext): QuickAddResult {
  let text = ` ${input.replace(/\s+/gu, " ").trim()} `;
  let dueDate: string | null = null;
  let dueTime: string | null = null;
  let priority: TaskPriority = "none";
  const tags: string[] = [];
  let projectHint: string | null = null;

  const take = (pattern: RegExp, handle: (match: RegExpExecArray) => boolean): void => {
    const match = pattern.exec(text);
    if (match && handle(match))
      text = `${text.slice(0, match.index)} ${text.slice(match.index + match[0].length)}`;
  };

  // #tags (letters incl. Turkish, digits, - and _)
  for (;;) {
    const match = /\s#([\p{L}\p{N}_-]+)(?=\s)/u.exec(text);
    if (!match) break;
    tags.push(match[1]!.toLocaleLowerCase("tr"));
    text = `${text.slice(0, match.index)} ${text.slice(match.index + match[0].length)}`;
  }

  take(/\s@([\p{L}\p{N}_-]+)(?=\s)/u, (match) => {
    projectHint = match[1]!;
    return true;
  });

  // !!! / !! / !high / !yüksek / p1-p3
  take(/\s(!{1,3})(?=\s)/u, (match) => {
    priority = match[1]!.length >= 2 ? "high" : "medium";
    return true;
  });
  take(/\s!([\p{L}]+)(?=\s)/u, (match) => {
    const value = PRIORITY_WORDS[match[1]!.toLocaleLowerCase("tr")];
    if (!value) return false;
    priority = value;
    return true;
  });
  take(/\sp([1-3])(?=\s)/iu, (match) => {
    priority = (["high", "medium", "low"] as const)[Number(match[1]) - 1]!;
    return true;
  });

  // Times: 15:00, 15.30, 3pm, 9:30am, "saat 9", "at 9"
  take(/\s(?:(?:at|saat)\s)?([01]?\d|2[0-3])(?:[:.]([0-5]\d))?\s?(am|pm)(?=\s)/iu, (match) => {
    let hour = Number(match[1]);
    if (hour < 1 || hour > 12) return false;
    const pm = match[3]!.toLowerCase() === "pm";
    hour = (hour % 12) + (pm ? 12 : 0);
    dueTime = `${pad(hour)}:${match[2] ?? "00"}`;
    return true;
  });
  if (!dueTime)
    // "15:30" is always a time; "15.30" only after "saat"/"at", since "15.06" is a Turkish date.
    take(/\s(?:(at|saat)\s)?([01]?\d|2[0-3])([:.])([0-5]\d)(?=\s)/iu, (match) => {
      if (match[3] === "." && !match[1]) return false;
      dueTime = `${pad(Number(match[2]))}:${match[4]}`;
      return true;
    });
  if (!dueTime)
    take(/\s(?:at|saat)\s([01]?\d|2[0-3])(?=\s)/iu, (match) => {
      dueTime = `${pad(Number(match[1]))}:00`;
      return true;
    });

  // Dates: ISO, dd.mm(.yyyy) / dd/mm(/yyyy), relative words, "in 3 days" / "3 gün sonra", weekdays
  take(/\s(\d{4})-(\d{2})-(\d{2})(?=\s)/u, (match) => {
    const date = `${match[1]}-${match[2]}-${match[3]}`;
    if (!isRealDate(date)) return false;
    dueDate = date;
    return true;
  });
  if (!dueDate)
    take(/\s(\d{1,2})[./](\d{1,2})(?:[./](\d{4}))?(?=\s)/u, (match) => {
      const year = match[3] ? Number(match[3]) : Number(context.today.slice(0, 4));
      let date = `${year}-${pad(Number(match[2]))}-${pad(Number(match[1]))}`;
      if (!isRealDate(date)) return false;
      // Without a year, a day already passed this year means next year.
      if (!match[3] && date < context.today) date = `${year + 1}${date.slice(4)}`;
      dueDate = date;
      return true;
    });
  if (!dueDate)
    take(/\s(?:in\s(\d{1,3})\sdays?|(\d{1,3})\sgün\ssonra)(?=\s)/iu, (match) => {
      dueDate = addDays(context.today, Number(match[1] ?? match[2]));
      return true;
    });
  if (!dueDate) {
    const phrases = Object.keys(RELATIVE_DAYS).sort((left, right) => right.length - left.length);
    for (const phrase of phrases) {
      const pattern = new RegExp(`\\s${escapeRegExp(phrase)}(?=\\s)`, "iu");
      const match = pattern.exec(text);
      if (!match) continue;
      dueDate = addDays(context.today, RELATIVE_DAYS[phrase]!);
      text = `${text.slice(0, match.index)} ${text.slice(match.index + match[0].length)}`;
      break;
    }
  }
  if (!dueDate) {
    const names = Object.keys(WEEKDAYS)
      .sort((left, right) => right.length - left.length)
      .map(escapeRegExp)
      .join("|");
    take(new RegExp(`\\s(?:(next|on|this|gelecek|bu)\\s)?(${names})(?=\\s)`, "iu"), (match) => {
      const weekday = WEEKDAYS[match[2]!.toLocaleLowerCase("tr")];
      if (weekday === undefined) return false;
      const qualifier = match[1]?.toLowerCase();
      dueDate = nextWeekday(
        context.today,
        weekday,
        qualifier === "next" || qualifier === "gelecek",
      );
      return true;
    });
  }
  // A time without a date means today.
  if (dueTime && !dueDate) dueDate = context.today;

  const title = text.replace(/\s+/gu, " ").trim();
  return {
    title: title || input.trim(),
    dueDate,
    dueTime,
    priority,
    tags: [...new Set(tags)],
    projectHint,
  };
}

function nextWeekday(today: string, weekday: number, forceNextWeek: boolean): string {
  const current = new Date(`${today}T12:00:00.000Z`).getUTCDay();
  let delta = (weekday - current + 7) % 7;
  if (delta === 0) delta = 7;
  if (forceNextWeek && delta < 7) delta += 7;
  return addDays(today, delta);
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function isRealDate(date: string): boolean {
  const value = new Date(`${date}T12:00:00.000Z`);
  return !Number.isNaN(value.getTime()) && value.toISOString().slice(0, 10) === date;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
