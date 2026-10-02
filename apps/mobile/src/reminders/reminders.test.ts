import { describe, expect, it, vi } from "vitest";

vi.mock("expo-notifications", () => ({}));
vi.mock("expo-secure-store", () => ({}));
vi.mock("react-native", () => ({ Platform: { OS: "android" } }));

const { isReminderData, reminderBody } = await import("./reminders");

const t = (key: string, parameters?: Record<string, unknown>) =>
  parameters ? `${key}:${JSON.stringify(parameters)}` : key;

describe("reminder presentation", () => {
  it("recognises only Stone reminder payloads", () => {
    expect(
      isReminderData({ stone: "reminder", kind: "planned", source: "task", targetId: "t" }),
    ).toBe(true);
    expect(isReminderData({ stone: "widget", targetId: "t" })).toBe(false);
    expect(isReminderData(null)).toBe(false);
  });

  it("describes all-day and timed reminders", () => {
    expect(
      reminderBody({ source: "task", dueAt: "2026-03-02T14:00:00.000Z", allDay: true }, t, "en"),
    ).toBe("reminders.taskDueToday");
    expect(
      reminderBody(
        { source: "calendar", dueAt: "2026-03-02T14:00:00.000Z", allDay: false },
        t,
        "en",
      ),
    ).toMatch(/^reminders\.eventStartsAt:\{"time":"/u);
  });
});
