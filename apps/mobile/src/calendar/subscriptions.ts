import { ICS_MAX_BYTES, importCalendarIcsLenient, type CalendarItem } from "@stone/domain";

/**
 * A read-only calendar feed (iCloud, Google "secret address in iCal format", Outlook, sports
 * fixtures, …). Feeds are device-local: they are never written to the synced calendar, so a
 * subscription cannot duplicate events into Firestore or other devices.
 */
export interface CalendarSubscription {
  id: string;
  name: string;
  url: string;
  addedAt: string;
  lastFetchedAt: string | null;
  lastError: string | null;
  skipped: number;
  items: readonly CalendarItem[];
}

export interface SubscriptionStore {
  read(): Promise<string | null>;
  write(content: string): Promise<void>;
}

export type FeedFetcher = (url: string) => Promise<string>;

/** Calendar items from subscriptions carry this id prefix; the UI treats them as read-only. */
export const SUBSCRIPTION_ITEM_PREFIX = "sub:";
export const SUBSCRIPTION_REFRESH_MS = 6 * 60 * 60 * 1_000;
const MAX_SUBSCRIPTIONS = 20;

interface StoredSubscriptions {
  schema: 1;
  owners: Record<string, CalendarSubscription[]>;
}

/** Accepts https:// and webcal:// (served over https); rejects anything else. */
export function normalizeSubscriptionUrl(input: string): string {
  const trimmed = input.trim().replace(/^webcals?:\/\//iu, "https://");
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("invalid_url");
  }
  if (url.protocol !== "https:") throw new Error("https_required");
  return url.toString();
}

export function isSubscriptionItemId(id: string): boolean {
  return id.startsWith(SUBSCRIPTION_ITEM_PREFIX);
}

export function needsRefresh(subscription: CalendarSubscription, now: number): boolean {
  return (
    subscription.lastFetchedAt === null ||
    now - Date.parse(subscription.lastFetchedAt) >= SUBSCRIPTION_REFRESH_MS
  );
}

/** Items from every subscription, re-identified so they cannot collide with synced items. */
export function subscriptionItems(
  subscriptions: readonly CalendarSubscription[],
): readonly CalendarItem[] {
  return subscriptions.flatMap((subscription) =>
    subscription.items.map((item) => ({
      ...item,
      id: `${SUBSCRIPTION_ITEM_PREFIX}${subscription.id}:${item.id}`,
      recurrenceSeriesId: item.recurrenceSeriesId
        ? `${SUBSCRIPTION_ITEM_PREFIX}${subscription.id}:${item.recurrenceSeriesId}`
        : null,
      planningNote: subscription.name,
      projectId: null,
      taskId: null,
      sourceDocumentId: null,
    })),
  );
}

export function createSubscriptionService(deps: {
  store: SubscriptionStore;
  fetchFeed: FeedFetcher;
  newId: () => string;
}) {
  const load = async (): Promise<StoredSubscriptions> => {
    const raw = await deps.store.read();
    if (!raw) return { schema: 1, owners: {} };
    try {
      const parsed = JSON.parse(raw) as StoredSubscriptions;
      return parsed.schema === 1 && typeof parsed.owners === "object"
        ? parsed
        : { schema: 1, owners: {} };
    } catch {
      return { schema: 1, owners: {} };
    }
  };
  const save = (data: StoredSubscriptions) => deps.store.write(JSON.stringify(data));

  const fetchInto = async (
    subscription: CalendarSubscription,
    context: { ownerId: string; deviceId: string; timezone: string; now: string },
  ): Promise<CalendarSubscription> => {
    try {
      const source = await deps.fetchFeed(subscription.url);
      const { items, skipped } = importCalendarIcsLenient(source, context);
      return { ...subscription, items, skipped, lastFetchedAt: context.now, lastError: null };
    } catch (error) {
      // Keep the last good copy; a feed being briefly unreachable should not empty the calendar.
      return {
        ...subscription,
        lastFetchedAt: context.now,
        lastError: error instanceof Error ? error.message : String(error),
      };
    }
  };

  return {
    async list(ownerId: string): Promise<readonly CalendarSubscription[]> {
      return (await load()).owners[ownerId] ?? [];
    },

    async add(
      ownerId: string,
      input: { name: string; url: string },
      context: { deviceId: string; timezone: string; now: string },
    ): Promise<CalendarSubscription> {
      const data = await load();
      const existing = data.owners[ownerId] ?? [];
      if (existing.length >= MAX_SUBSCRIPTIONS) throw new Error("too_many_subscriptions");
      const url = normalizeSubscriptionUrl(input.url);
      if (existing.some((subscription) => subscription.url === url))
        throw new Error("already_subscribed");
      const fetched = await fetchInto(
        {
          id: deps.newId(),
          name: input.name.trim() || new URL(url).hostname,
          url,
          addedAt: context.now,
          lastFetchedAt: null,
          lastError: null,
          skipped: 0,
          items: [],
        },
        { ...context, ownerId },
      );
      // A feed that fails on the very first fetch is almost always a wrong URL; do not keep it.
      if (fetched.lastError) throw new Error(fetched.lastError);
      data.owners[ownerId] = [...existing, fetched];
      await save(data);
      return fetched;
    },

    async remove(ownerId: string, id: string): Promise<void> {
      const data = await load();
      data.owners[ownerId] = (data.owners[ownerId] ?? []).filter((item) => item.id !== id);
      await save(data);
    },

    /** Refetches stale feeds (or all, with `force`) and returns the updated list. */
    async refresh(
      ownerId: string,
      context: { deviceId: string; timezone: string; now: string },
      force = false,
    ): Promise<readonly CalendarSubscription[]> {
      const data = await load();
      const current = data.owners[ownerId] ?? [];
      const nowMs = Date.parse(context.now);
      const next = await Promise.all(
        current.map((subscription) =>
          force || needsRefresh(subscription, nowMs)
            ? fetchInto(subscription, { ...context, ownerId })
            : Promise.resolve(subscription),
        ),
      );
      data.owners[ownerId] = next;
      await save(data);
      return next;
    },

    /** Removes every subscription of an account (sign-out / account deletion). */
    async clear(ownerId: string): Promise<void> {
      const data = await load();
      delete data.owners[ownerId];
      await save(data);
    },
  };
}

export type SubscriptionService = ReturnType<typeof createSubscriptionService>;

/** Fetches a feed over HTTPS with a timeout and the same size cap as file imports. */
export async function fetchIcsFeed(url: string, timeoutMs = 20_000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "text/calendar, text/plain;q=0.8, */*;q=0.5" },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const length = Number(response.headers.get("content-length") ?? 0);
    if (length > ICS_MAX_BYTES) throw new Error("Calendar file is too large.");
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}
