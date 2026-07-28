import { describe, expect, it, vi } from "vitest";
import type { AuthSession } from "./desktop-api";
import { restoreDesktopSession } from "./session-restore";

const session: AuthSession = {
  uid: "owner",
  email: "owner@example.test",
  idToken: "not-a-real-token",
  expiresAt: 4_102_444_800,
};

describe("desktop Firebase session restoration", () => {
  it("returns a stored session before routing and does not mutate credentials", async () => {
    const restore = vi.fn().mockResolvedValue(session);
    await expect(restoreDesktopSession(restore)).resolves.toEqual({
      status: "authenticated",
      session,
    });
    expect(restore).toHaveBeenCalledOnce();
  });

  it("distinguishes an intentional signed-out state from a refresh failure", async () => {
    await expect(restoreDesktopSession(() => Promise.resolve(null))).resolves.toEqual({
      status: "signed_out",
    });
    await expect(
      restoreDesktopSession(() => Promise.reject(new Error("Refresh token revoked"))),
    ).resolves.toEqual({
      status: "error",
      message: "Refresh token revoked",
    });
  });
});
