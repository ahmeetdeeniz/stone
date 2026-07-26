import { exportPKCS8, exportSPKI, generateKeyPair } from "jose";
import { describe, expect, it } from "vitest";
import { TokenAuthority, constantTimeEqual, createPkceVerifier, pkceChallenge } from "./auth.js";
import { createOAuthRuntime, exchangeAuthorizationCode, refreshAccessToken } from "./oauth.js";

describe("MCP OAuth primitives", () => {
  it("supports PKCE and rejects a token for a different resource", async () => {
    const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
    const authority = new TokenAuthority(
      "https://stone.test/oauth",
      "https://stone.test/mcp",
      privateKey,
      publicKey,
    );
    const token = await authority.issue("owner-a", "client-a", ["stone.read.notes"]);
    expect((await authority.verify(token)).sub).toBe("owner-a");
    const verifier = createPkceVerifier();
    expect(pkceChallenge(verifier)).toHaveLength(43);
    expect(constantTimeEqual("same", "same")).toBe(true);
    expect(constantTimeEqual("same", "different")).toBe(false);
    const wrongResource = new TokenAuthority(
      "https://stone.test/oauth",
      "https://other.test/mcp",
      privateKey,
      publicKey,
    );
    await expect(wrongResource.verify(token)).rejects.toThrow("Invalid or expired");
  });

  it("exchanges and rotates a user-bound refresh token", async () => {
    const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
    const runtime = await createOAuthRuntime({
      issuer: "https://stone.test/oauth",
      resource: "https://stone.test/mcp",
      privateKey: await exportPKCS8(privateKey),
      publicKey: await exportSPKI(publicKey),
    });
    const verifier = createPkceVerifier();
    const code = {
      code: "code-1",
      clientId: "client-a",
      redirectUri: "https://chatgpt.com/connector/oauth/test",
      codeChallenge: pkceChallenge(verifier),
      resource: "https://stone.test/mcp",
      userId: "owner-a",
      scopes: ["stone.read.notes"] as const,
      expiresAt: Math.floor(Date.now() / 1000) + 300,
    };
    const token = await exchangeAuthorizationCode(runtime, code, verifier);
    expect((await runtime.authority.verify(String(token.access_token))).sub).toBe("owner-a");
    const rotated = await refreshAccessToken(
      runtime,
      String(token.refresh_token),
      "client-a",
      "https://stone.test/mcp",
    );
    expect(rotated.refresh_token).toBeTruthy();
  });
});
