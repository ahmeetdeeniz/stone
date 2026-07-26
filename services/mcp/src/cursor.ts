import { createHmac, timingSafeEqual } from "node:crypto";
import { McpInputError } from "./contracts.js";

export interface CursorPayload {
  ownerId: string;
  kind: string;
  offset: number;
}

export class CursorCodec {
  public constructor(private readonly secret: string) {}

  public encode(payload: CursorPayload): string {
    const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    return `${body}.${this.signature(body)}`;
  }

  public decode(token: string, ownerId: string, kind: string): CursorPayload {
    const [body, signature] = token.split(".");
    if (!body || !signature) throw new McpInputError("Invalid pageToken.");
    const expected = this.signature(body);
    if (
      signature.length !== expected.length ||
      !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
    ) {
      throw new McpInputError("Invalid pageToken.");
    }
    try {
      const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as CursorPayload;
      if (
        parsed.ownerId !== ownerId ||
        parsed.kind !== kind ||
        !Number.isInteger(parsed.offset) ||
        parsed.offset < 0 ||
        parsed.offset > 10_000
      ) {
        throw new Error("scope");
      }
      return parsed;
    } catch {
      throw new McpInputError("Invalid pageToken.");
    }
  }

  private signature(value: string): string {
    return createHmac("sha256", this.secret).update(value).digest("base64url");
  }
}

export function boundedLimit(value: number | undefined, defaultValue = 20): number {
  if (value === undefined) return defaultValue;
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw new McpInputError("limit must be an integer between 1 and 100.");
  }
  return value;
}

export function boundedText(value: string, name: string, maxLength: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new McpInputError(`${name} must be between 1 and ${maxLength} characters.`);
  }
  return normalized;
}

export function validateIdempotencyKey(value: string): string {
  const normalized = boundedText(value, "idempotencyKey", 200);
  if (!/^[A-Za-z0-9._:-]+$/u.test(normalized)) {
    throw new McpInputError("idempotencyKey contains unsupported characters.");
  }
  return normalized;
}

export function validateExpectedRevision(value: number): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new McpInputError("expectedRevision must be a non-negative integer.");
  }
  return value;
}
