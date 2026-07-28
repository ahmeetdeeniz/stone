import { describe, expect, it } from "vitest";
import { resolveStoneFontReadiness } from "./font-readiness";

describe("resolveStoneFontReadiness", () => {
  it("waits while either bundled font is still loading", () => {
    expect(resolveStoneFontReadiness(true, false, false, false)).toEqual({
      ready: false,
      usingFallback: false,
    });
  });

  it("allows the app to launch with platform fallbacks after a font error", () => {
    expect(resolveStoneFontReadiness(false, true, true, false)).toEqual({
      ready: true,
      usingFallback: true,
    });
    expect(resolveStoneFontReadiness(true, false, false, true)).toEqual({
      ready: true,
      usingFallback: true,
    });
  });

  it("reports the normal loaded state without a fallback", () => {
    expect(resolveStoneFontReadiness(true, true, false, false)).toEqual({
      ready: true,
      usingFallback: false,
    });
  });
});
