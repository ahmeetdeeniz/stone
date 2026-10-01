import { describe, expect, it } from "vitest";
import { McpRateLimitError, McpUnauthorizedError } from "./contracts.js";
import { clientKey, FixedWindowLimiter, toSafeHttpError } from "./server.js";

describe("MCP HTTP error boundary", () => {
  it("does not expose unexpected exception details", () => {
    const result = toSafeHttpError(
      new Error("database password and internal collection path must stay private"),
    );

    expect(result).toEqual({ status: 400, message: "request_failed" });
  });

  it("preserves stable authentication and rate-limit messages", () => {
    expect(toSafeHttpError(new McpUnauthorizedError("Invalid access token."))).toEqual({
      status: 401,
      message: "Invalid access token.",
    });
    expect(toSafeHttpError(new McpRateLimitError(30))).toEqual({
      status: 429,
      message: "Rate limit exceeded.",
    });
  });
});

describe("MCP rate limiting", () => {
  it("blocks after the window budget and resets when the window ends", () => {
    let now = 0;
    const limiter = new FixedWindowLimiter(2, 1_000, () => now);
    expect(limiter.allow("ip")).toBe(true);
    expect(limiter.allow("ip")).toBe(true);
    expect(limiter.allow("ip")).toBe(false);
    expect(limiter.allow("other")).toBe(true);
    now = 1_000;
    expect(limiter.allow("ip")).toBe(true);
  });

  it("uses X-Forwarded-For only when a trusted proxy is configured", () => {
    const request = {
      headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.1" },
      socket: { remoteAddress: "10.0.0.1" },
    } as unknown as Parameters<typeof clientKey>[0];
    expect(clientKey(request, true)).toBe("203.0.113.7");
    expect(clientKey(request, false)).toBe("10.0.0.1");
  });
});
