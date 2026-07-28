import { importCalendarIcs, type CalendarItem } from "@stone/domain";
import type { SQLiteCalendarRepository } from "../infrastructure/storage/calendar";

export interface CalendarImportReview {
  items: readonly CalendarItem[];
  newItems: number;
  duplicates: number;
  requiresConfirmation: boolean;
}

export async function reviewCalendarIcsImport(
  source: string,
  context: {
    ownerId: string;
    deviceId: string;
    now: string;
    timezone: string;
  },
  repository: SQLiteCalendarRepository,
): Promise<CalendarImportReview> {
  const parsed = importCalendarIcs(source, context);
  const items: CalendarItem[] = [];
  let duplicates = 0;
  for (const item of parsed) {
    const existing = await repository.getById(context.ownerId, item.id, true);
    if (existing) duplicates += 1;
    else items.push(item);
  }
  return {
    items,
    newItems: items.length,
    duplicates,
    requiresConfirmation: parsed.length >= 100,
  };
}

export async function commitCalendarIcsImport(
  review: CalendarImportReview,
  repository: SQLiteCalendarRepository,
  confirmed: boolean,
): Promise<readonly CalendarItem[]> {
  if (review.requiresConfirmation && !confirmed)
    throw new Error("Large calendar imports require explicit confirmation.");
  const imported: CalendarItem[] = [];
  for (const item of review.items) imported.push(await repository.create(item));
  return imported;
}
