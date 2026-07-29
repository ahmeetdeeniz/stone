import { describe, expect, it } from "vitest";
import {
  en,
  formatDateOnly,
  formatDuration,
  formatFileSize,
  formatInstant,
  formatPercentage,
  formatRecurrence,
  formatRelativeDate,
  firstDayOfWeek,
  loadLocalePreference,
  parseLocalePreference,
  resolveLocale,
  resolveSystemLocale,
  saveLocalePreference,
  tr,
  translate,
  translatePlural,
} from "./index.js";

describe("locale resolution and translation", () => {
  it("resolves Turkish variants and falls back unsupported or malformed locales to English", () => {
    expect(["tr", "tr-TR", "tr-CY"].map(resolveSystemLocale)).toEqual(["tr", "tr", "tr"]);
    expect(resolveSystemLocale("de-DE")).toBe("en");
    expect(resolveSystemLocale("not_a_locale")).toBe("en");
  });

  it("honours manual overrides and safely parses persisted preferences", () => {
    expect(resolveLocale("en", "tr-TR")).toBe("en");
    expect(resolveLocale("tr", "en-US")).toBe("tr");
    expect(resolveLocale("system", "tr-CY")).toBe("tr");
    expect(parseLocalePreference("corrupt")).toBe("system");
  });

  it("keeps English and Turkish resources in parity", () => {
    expect(Object.keys(tr).sort()).toEqual(Object.keys(en).sort());
  });

  it("interpolates parameters and applies locale plural rules", () => {
    expect(translate("en", "validation.required", { field: "Title" })).toBe("Title is required.");
    expect(translatePlural("en", "count.items", 2)).toBe("2 items");
    expect(translatePlural("tr", "tasks.overdueBy", 3)).toBe("3 gün gecikti");
  });

  it("falls back to canonical English when a localized entry is unavailable", () => {
    expect(translate("tr", "desktop.save", {}, {})).toBe("Save");
  });

  it("degrades safely when preference storage reads or writes fail", async () => {
    await expect(
      loadLocalePreference(() => {
        throw new Error("unavailable");
      }),
    ).resolves.toBe("system");
    await expect(
      saveLocalePreference("tr", () => {
        throw new Error("quota");
      }),
    ).resolves.toBe(false);
  });
});

describe("locale-aware formatters", () => {
  it("formats date-only values without timezone drift and instants in explicit timezones", () => {
    expect(formatDateOnly("en", "2026-07-29")).toBe("Jul 29, 2026");
    expect(formatDateOnly("tr", "2026-07-29")).toBe("29 Tem 2026");
    expect(
      formatInstant("en", "2026-07-29T09:00:00.000Z", "Europe/Istanbul", {
        hour: "numeric",
        minute: "2-digit",
      }),
    ).toBe("12:00 PM");
  });

  it("formats durations and recurrence from structured values", () => {
    expect(formatDuration("en", 90)).toBe("1 hour 30 minutes");
    expect(formatDuration("tr", 90)).toBe("1 saat 30 dakika");
    expect(formatRecurrence("en", { frequency: "custom", interval: 2, unit: "week" })).toBe(
      "Every 2 weeks",
    );
    expect(formatRecurrence("tr", { frequency: "weekdays", interval: 1, unit: "day" })).toBe(
      "Hafta içi her gün",
    );
  });

  it("formats relative dates, percentages, file sizes, and uses Monday week starts", () => {
    expect(formatRelativeDate("en", "2026-07-30", "2026-07-29")).toBe("Tomorrow");
    expect(formatRelativeDate("tr", "2026-07-26", "2026-07-29")).toBe("3 gün önce");
    expect(formatPercentage("en", 0.125)).toBe("12.5%");
    expect(formatPercentage("tr", 0.125)).toBe("%12,5");
    expect(formatFileSize("en", 1_572_864)).toBe("1.5 MB");
    expect(formatFileSize("tr", 1_572_864)).toBe("1,5 MB");
    expect(firstDayOfWeek()).toBe(1);
  });

  it("never mutates user Markdown or structured data while changing locale", () => {
    const markdown = "# Başlık\n\n- [ ] kullanıcı içeriği\n";
    const entity = { title: "Kullanıcı başlığı", priority: "high", markdown };
    const before = JSON.stringify(entity);
    translate("en", "desktop.save");
    translate("tr", "desktop.save");
    formatDateOnly("tr", "2026-07-29");
    expect(JSON.stringify(entity)).toBe(before);
    expect(entity.markdown).toBe(markdown);
  });
});
