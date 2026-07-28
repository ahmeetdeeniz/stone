import { describe, expect, it, vi } from "vitest";
import { restoreGitHubConnection } from "./github-restore";

describe("desktop GitHub connection restoration", () => {
  it("checks the stored connection once without starting Device Flow", async () => {
    const status = vi.fn().mockResolvedValue({
      id: 1,
      login: "stone-owner",
      name: null,
      avatarUrl: "https://avatars.example.test/1",
    });
    await expect(restoreGitHubConnection(status)).resolves.toMatchObject({
      status: "connected",
      account: { login: "stone-owner" },
    });
    expect(status).toHaveBeenCalledOnce();
  });

  it("distinguishes no credential from an invalid credential", async () => {
    await expect(restoreGitHubConnection(() => Promise.resolve(null))).resolves.toEqual({
      status: "disconnected",
    });
    await expect(
      restoreGitHubConnection(() => Promise.reject(new Error("GitHub credential is invalid"))),
    ).resolves.toEqual({
      status: "invalid",
      message: "GitHub credential is invalid",
    });
  });
});
