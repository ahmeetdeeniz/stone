import { describe, expect, it } from "vitest";
import { McpRateLimitError, McpUnauthorizedError } from "./contracts.js";
import { toSafeHttpError } from "./server.js";

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
