import { describe, expect, it } from "vitest";
import { parseQuickAdd } from "./quick-add.js";

// 2026-03-02 is a Monday.
const context = { today: "2026-03-02" };

describe("quick add parsing", () => {
  it("parses a Turkish capture with date, time, tag and priority", () => {
    expect(parseQuickAdd("yarın 15:00 raporu gönder #iş !yüksek", context)).toEqual({
      title: "raporu gönder",
      dueDate: "2026-03-03",
      dueTime: "15:00",
      priority: "high",
      tags: ["iş"],
      projectHint: null,
    });
  });

  it("parses an English capture with a weekday, 12-hour time and project", () => {
    expect(parseQuickAdd("call mom friday 6pm @family", context)).toMatchObject({
      title: "call mom",
      dueDate: "2026-03-06",
      dueTime: "18:00",
      projectHint: "family",
    });
  });

  it("understands relative days, durations and explicit dates", () => {
    expect(parseQuickAdd("pay rent today", context).dueDate).toBe("2026-03-02");
    expect(parseQuickAdd("öbür gün dişçi", context).dueDate).toBe("2026-03-04");
    expect(parseQuickAdd("haftaya sunum", context).dueDate).toBe("2026-03-09");
    expect(parseQuickAdd("renew passport in 10 days", context).dueDate).toBe("2026-03-12");
    expect(parseQuickAdd("3 gün sonra kargo", context).dueDate).toBe("2026-03-05");
    expect(parseQuickAdd("vergi 2026-04-30", context).dueDate).toBe("2026-04-30");
    expect(parseQuickAdd("doğum günü 15.06", context).dueDate).toBe("2026-06-15");
    // Day/month already passed this year rolls into next year.
    expect(parseQuickAdd("yılbaşı 01.01", context).dueDate).toBe("2027-01-01");
  });

  it("handles weekday qualifiers and Turkish weekday names", () => {
    expect(parseQuickAdd("cuma toplantı", context).dueDate).toBe("2026-03-06");
    expect(parseQuickAdd("gym monday", context).dueDate).toBe("2026-03-09");
    expect(parseQuickAdd("review next friday", context).dueDate).toBe("2026-03-13");
    expect(parseQuickAdd("Pazartesi rapor", context).dueDate).toBe("2026-03-09");
  });

  it("supports the priority shorthands", () => {
    expect(parseQuickAdd("fix bug !!", context).priority).toBe("high");
    expect(parseQuickAdd("fix bug !", context).priority).toBe("medium");
    expect(parseQuickAdd("fix bug p3", context).priority).toBe("low");
    expect(parseQuickAdd("fix bug !düşük", context).priority).toBe("low");
  });

  it("treats a lone time as today and keeps unknown text in the title", () => {
    expect(parseQuickAdd("standup saat 9", context)).toMatchObject({
      title: "standup",
      dueDate: "2026-03-02",
      dueTime: "09:00",
    });
    expect(parseQuickAdd("read chapter 31.13 notes !shiny", context)).toMatchObject({
      title: "read chapter 31.13 notes !shiny",
      dueDate: null,
      priority: "none",
    });
    expect(parseQuickAdd("buy milk", context)).toEqual({
      title: "buy milk",
      dueDate: null,
      dueTime: null,
      priority: "none",
      tags: [],
      projectHint: null,
    });
  });

  it("never returns an empty title", () => {
    expect(parseQuickAdd("tomorrow", context).title).toBe("tomorrow");
  });
});
