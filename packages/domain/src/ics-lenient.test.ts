import { describe, expect, it } from "vitest";
import { importCalendarIcsLenient } from "./ics.js";

const context = {
  ownerId: "owner",
  deviceId: "device",
  now: "2026-03-01T00:00:00.000Z",
  timezone: "Europe/Istanbul",
};

describe("lenient iCalendar import", () => {
  it("keeps valid events and counts the ones it cannot represent", () => {
    const feed = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:good@example.com",
      "SUMMARY:Team sync",
      "DTSTART:20260305T090000Z",
      "DTEND:20260305T100000Z",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:bad@example.com",
      "SUMMARY:Odd date",
      "DTSTART;TZID=Mars/Olympus:20260305",
      "DTEND:garbage",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const result = importCalendarIcsLenient(feed, context);
    expect(result.items.map((item) => item.title)).toEqual(["Team sync"]);
    expect(result.items[0]?.externalUid).toBe("good@example.com");
    expect(result.skipped).toBe(1);
  });

  it("rejects responses that are not iCalendar", () => {
    expect(() => importCalendarIcsLenient("<html>login</html>", context)).toThrow(
      "not an iCalendar",
    );
  });
});
