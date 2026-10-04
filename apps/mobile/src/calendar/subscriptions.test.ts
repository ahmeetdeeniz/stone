import { describe, expect, it } from "vitest";
import {
  createSubscriptionService,
  isSubscriptionItemId,
  needsRefresh,
  normalizeSubscriptionUrl,
  SUBSCRIPTION_REFRESH_MS,
  subscriptionItems,
} from "./subscriptions";

const feed = (title: string) =>
  [
    "BEGIN:VCALENDAR",
    "BEGIN:VEVENT",
    "UID:event-1@example.com",
    `SUMMARY:${title}`,
    "DTSTART:20260305T090000Z",
    "DTEND:20260305T100000Z",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

function harness() {
  let stored: string | null = null;
  let response: string | Error = feed("Team sync");
  let ids = 0;
  const service = createSubscriptionService({
    store: {
      read: () => Promise.resolve(stored),
      write: (content) => {
        stored = content;
        return Promise.resolve();
      },
    },
    fetchFeed: () =>
      response instanceof Error ? Promise.reject(response) : Promise.resolve(response),
    newId: () => `sub-${++ids}`,
  });
  return {
    service,
    setResponse: (next: string | Error) => {
      response = next;
    },
  };
}

const context = (now: string) => ({ deviceId: "device", timezone: "UTC", now });

describe("calendar subscriptions", () => {
  it("normalises webcal addresses and requires https", () => {
    expect(normalizeSubscriptionUrl(" webcal://p01.icloud.com/cal.ics ")).toBe(
      "https://p01.icloud.com/cal.ics",
    );
    expect(() => normalizeSubscriptionUrl("http://example.com/cal.ics")).toThrow("https_required");
    expect(() => normalizeSubscriptionUrl("not a url")).toThrow("invalid_url");
  });

  it("adds a feed, rejects duplicates and keeps items per account", async () => {
    const { service } = harness();
    const added = await service.add(
      "owner",
      { name: "", url: "webcal://example.com/cal.ics" },
      context("2026-03-01T00:00:00.000Z"),
    );
    expect(added).toMatchObject({ name: "example.com", lastError: null });
    expect(added.items.map((item) => item.title)).toEqual(["Team sync"]);
    await expect(
      service.add(
        "owner",
        { name: "x", url: "https://example.com/cal.ics" },
        context("2026-03-01T00:00:00.000Z"),
      ),
    ).rejects.toThrow("already_subscribed");
    expect(await service.list("someone-else")).toEqual([]);
  });

  it("does not keep a feed that fails on the first fetch", async () => {
    const { service, setResponse } = harness();
    setResponse(new Error("HTTP 404"));
    await expect(
      service.add(
        "owner",
        { name: "Bad", url: "https://example.com/missing.ics" },
        context("2026-03-01T00:00:00.000Z"),
      ),
    ).rejects.toThrow("HTTP 404");
    expect(await service.list("owner")).toEqual([]);
  });

  it("refreshes stale feeds and keeps the last good copy when a refresh fails", async () => {
    const { service, setResponse } = harness();
    await service.add(
      "owner",
      { name: "Work", url: "https://example.com/cal.ics" },
      context("2026-03-01T00:00:00.000Z"),
    );
    setResponse(feed("Renamed sync"));
    // Not stale yet: nothing refetched.
    let [current] = await service.refresh("owner", context("2026-03-01T01:00:00.000Z"));
    expect(current?.items[0]?.title).toBe("Team sync");
    [current] = await service.refresh("owner", context("2026-03-01T07:00:00.000Z"));
    expect(current?.items[0]?.title).toBe("Renamed sync");
    setResponse(new Error("offline"));
    [current] = await service.refresh("owner", context("2026-03-01T08:00:00.000Z"), true);
    expect(current).toMatchObject({ lastError: "offline" });
    expect(current?.items[0]?.title).toBe("Renamed sync");
  });

  it("re-identifies items so they are recognisably read-only", async () => {
    const { service } = harness();
    const added = await service.add(
      "owner",
      { name: "Work", url: "https://example.com/cal.ics" },
      context("2026-03-01T00:00:00.000Z"),
    );
    const [item] = subscriptionItems([added]);
    expect(isSubscriptionItemId(item!.id)).toBe(true);
    expect(item).toMatchObject({ planningNote: "Work", taskId: null, projectId: null });
    expect(
      needsRefresh(added, Date.parse("2026-03-01T00:00:00.000Z") + SUBSCRIPTION_REFRESH_MS),
    ).toBe(true);
  });
});
