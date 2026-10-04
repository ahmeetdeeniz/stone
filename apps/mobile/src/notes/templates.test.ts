import { describe, expect, it, vi } from "vitest";

vi.mock("expo-crypto", () => ({ randomUUID: () => "uuid-1" }));

const { localIsoDate, noteFromTemplate } = await import("./templates");
const t = (key: string, parameters?: Record<string, unknown>) =>
  parameters ? `${key}(${Object.values(parameters).join(",")})` : key;

describe("note templates", () => {
  it("titles daily notes with the ISO date so they sort and can be found again", () => {
    expect(noteFromTemplate("daily", { t, today: "2026-03-02" })).toEqual({
      title: "2026-03-02",
      markdown: "# 2026-03-02\n\n## templates.daily.focus\n- [ ] \n\n## templates.daily.notes\n",
    });
  });

  it("uses translated defaults and honours an explicit title", () => {
    expect(noteFromTemplate("blank", { t, today: "2026-03-02" }).title).toBe("notes.untitled");
    expect(noteFromTemplate("blank", { t, today: "2026-03-02", title: "Plan" }).markdown).toBe(
      "# Plan\n\n",
    );
    expect(noteFromTemplate("meeting", { t, today: "2026-03-02" }).title).toBe(
      "templates.meeting.title(2026-03-02)",
    );
  });

  it("formats the local date as YYYY-MM-DD", () => {
    expect(localIsoDate(new Date(2026, 2, 2, 23, 30))).toBe("2026-03-02");
  });
});
