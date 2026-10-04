import { describe, expect, it } from "vitest";
import { parseCrashReportingPreference, shortUpdateId } from "./preferences";

describe("diagnostics preferences", () => {
  it("keeps crash reporting off unless explicitly enabled", () => {
    expect(parseCrashReportingPreference(null)).toBe(false);
    expect(parseCrashReportingPreference("off")).toBe(false);
    expect(parseCrashReportingPreference("true")).toBe(false);
    expect(parseCrashReportingPreference("on")).toBe(true);
  });

  it("shortens update ids for display", () => {
    expect(shortUpdateId("0d1c2b3a-aaaa-bbbb-cccc-1234567890ab")).toBe("0d1c2b3a");
    expect(shortUpdateId(null)).toBeNull();
  });
});
