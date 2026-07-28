import { describe, expect, it } from "vitest";
import { resolveStoneFontReadiness } from "./font-readiness";

describe("resolveStoneFontReadiness", () => {
  it("waits while Inter is still loading", () => {
    expect(resolveStoneFontReadiness(false, false)).toEqual({
      ready: false,
      usingFallback: false,
    });
  });

  it("allows the app to launch with platform fallbacks after a font error", () => {
    expect(resolveStoneFontReadiness(false, true)).toEqual({
      ready: true,
      usingFallback: true,
    });
  });

  it("reports the normal loaded state without a fallback", () => {
    expect(resolveStoneFontReadiness(true, false)).toEqual({
      ready: true,
      usingFallback: false,
    });
  });
});
