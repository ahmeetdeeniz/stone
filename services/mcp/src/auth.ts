/* eslint-disable @typescript-eslint/require-await */
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import {
  McpForbiddenError,
  McpUnauthorizedError,
  SCOPES,
  type AuthContext,
  type StoneScope,
} from "./contracts.js";

export interface OAuthCode {
  code: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  resource: string;
  userId: string;
  scopes: readonly StoneScope[];
  expiresAt: number;
}

export interface OAuthCodeStore {
  save(code: OAuthCode): Promise<void>;
  consume(code: string): Promise<OAuthCode | null>;
}

export class MemoryOAuthCodeStore implements OAuthCodeStore {
  private readonly values = new Map<string, OAuthCode>();

  public async save(code: OAuthCode): Promise<void> {
    this.values.set(code.code, code);
  }

  public async consume(code: string): Promise<OAuthCode | null> {
    const value = this.values.get(code);
    this.values.delete(code);
    return value && value.expiresAt > Math.floor(Date.now() / 1000) ? value : null;
  }
}

export interface AccessTokenClaims extends JWTPayload {
  sub: string;
  scope: string;
  resource: string;
  client_id: string;
}

export class TokenAuthority {
  public constructor(
    private readonly issuer: string,
    private readonly resource: string,
    private readonly signingKey: Parameters<SignJWT["sign"]>[0],
    private readonly verificationKey: Parameters<SignJWT["sign"]>[0] = signingKey,
    private readonly keyId = "stone-mcp-1",
  ) {}

  public async issue(
    userId: string,
    clientId: string,
    scopes: readonly StoneScope[],
  ): Promise<string> {
    return new SignJWT({
      scope: scopes.join(" "),
      resource: this.resource,
      client_id: clientId,
    })
      .setProtectedHeader({ alg: "RS256", kid: this.keyId, typ: "at+jwt" })
      .setIssuer(this.issuer)
      .setSubject(userId)
      .setAudience(this.resource)
      .setIssuedAt()
      .setExpirationTime("1h")
      .setJti(randomUUID())
      .sign(this.signingKey);
  }

  public async verify(token: string): Promise<AccessTokenClaims> {
    try {
      const { payload } = await jwtVerify(
        token,
        this.verificationKey as Parameters<typeof jwtVerify>[1],
        {
          issuer: this.issuer,
          audience: this.resource,
        },
      );
      if (
        typeof payload.sub !== "string" ||
        typeof payload.scope !== "string" ||
        typeof payload.resource !== "string" ||
        payload.resource !== this.resource ||
        typeof payload.client_id !== "string"
      ) {
        throw new Error("claims");
      }
      return payload as AccessTokenClaims;
    } catch {
      throw new McpUnauthorizedError("Invalid or expired access token.");
    }
  }
}

export function parseScopes(value: string | undefined): readonly StoneScope[] {
  const scopes = (value ?? "").split(/[\s]+/u).filter(Boolean);
  const valid = scopes.filter((scope): scope is StoneScope =>
    (SCOPES as readonly string[]).includes(scope),
  );
  if (valid.length !== scopes.length || valid.length === 0) {
    throw new McpForbiddenError("Requested scopes are not supported.");
  }
  return [...new Set(valid)];
}

export function requireScope(context: AuthContext, scope: StoneScope): void {
  if (!context.scopes.includes(scope)) {
    throw new McpForbiddenError(`Missing scope: ${scope}.`);
  }
}

export function authContextFromClaims(claims: AccessTokenClaims): AuthContext {
  const scopes = parseScopes(claims.scope);
  return { userId: claims.sub, clientId: claims.client_id, scopes };
}

export function createPkceVerifier(): string {
  return randomBytes(32).toString("base64url");
}

export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function constantTimeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}
