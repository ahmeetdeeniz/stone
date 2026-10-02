import { describe, expect, it } from "vitest";
import { downloadPercent, isUpdaterMissing } from "./updates";

describe("desktop updates", () => {
  it("treats a missing updater plugin as 'not set up', not as a failure", () => {
    expect(isUpdaterMissing("plugin updater not found")).toBe(true);
    expect(isUpdaterMissing("Updater not initialized")).toBe(true);
    expect(isUpdaterMissing("error sending request for url (https://github.com/...)")).toBe(false);
    expect(isUpdaterMissing("signature verification failed")).toBe(false);
  });

  it("reports progress only when the size is known", () => {
    expect(downloadPercent(512, 1024)).toBe(50);
    expect(downloadPercent(2048, 1024)).toBe(100);
    expect(downloadPercent(10, undefined)).toBeNull();
    expect(downloadPercent(10, 0)).toBeNull();
  });
});
