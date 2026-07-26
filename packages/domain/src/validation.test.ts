import { describe, expect, it } from "vitest";
import { ValidationError, validateSettings, validateThemePreference } from "./index.js";

describe("domain validation", () => {
  it("accepts the three theme preferences", () => {
    expect(validateThemePreference("system")).toBe("system");
    expect(validateThemePreference("light")).toBe("light");
    expect(validateThemePreference("dark")).toBe("dark");
  });

  it("rejects invalid settings without coercing values", () => {
    expect(() => validateThemePreference("sepia")).toThrow(ValidationError);
    expect(() =>
      validateSettings({
        ownerId: "owner",
        theme: "system",
        reduceMotion: false,
        editorFontSize: 10,
        trashRetentionDays: 30,
      }),
    ).toThrow(ValidationError);
  });
});
