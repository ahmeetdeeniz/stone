import { describe, expect, it, vi } from "vitest";

vi.mock("@react-native-firebase/auth", () => ({ default: () => ({}) }));
vi.mock("./config", () => ({ assertFirebaseConfigured: () => undefined }));

const { AuthFailure, authErrorKey, toAuthFailure } = await import("./auth");

describe("auth failure mapping", () => {
  it("maps Firebase error codes to translatable reasons", () => {
    expect(toAuthFailure({ code: "auth/wrong-password" }).reason).toBe("invalidCredential");
    expect(toAuthFailure({ code: "auth/email-already-in-use" }).reason).toBe("emailInUse");
    expect(toAuthFailure({ code: "auth/network-request-failed" }).reason).toBe("network");
    expect(toAuthFailure(new Error("boom")).reason).toBeNull();
  });

  it("keeps an existing failure and falls back to the screen's generic key", () => {
    const failure = new AuthFailure("noUser");
    expect(toAuthFailure(failure)).toBe(failure);
    expect(authErrorKey(failure, "auth.signInFailed")).toBe("auth.error.noUser");
    expect(authErrorKey(toAuthFailure({ code: "auth/unknown" }), "auth.signInFailed")).toBe(
      "auth.signInFailed",
    );
    expect(authErrorKey(new Error("x"), "auth.signInFailed")).toBe("auth.signInFailed");
  });
});
