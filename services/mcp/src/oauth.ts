/* eslint-disable @typescript-eslint/require-await */
import { createHash, randomBytes } from "node:crypto";
import type { KeyObject } from "node:crypto";
import { importPKCS8, importSPKI } from "jose";
import type { Firestore } from "firebase-admin/firestore";
import {
  MemoryOAuthCodeStore,
  TokenAuthority,
  type OAuthCode,
  type OAuthCodeStore,
} from "./auth.js";
import { McpUnauthorizedError, SCOPES, type StoneScope } from "./contracts.js";

export interface RefreshTokenRecord {
  tokenHash: string;
  userId: string;
  clientId: string;
  resource: string;
  scopes: readonly StoneScope[];
  expiresAt: number;
}

export interface RefreshTokenStore {
  save(value: RefreshTokenRecord): Promise<void>;
  consume(tokenHash: string): Promise<RefreshTokenRecord | null>;
}

export class MemoryRefreshTokenStore implements RefreshTokenStore {
  private readonly values = new Map<string, RefreshTokenRecord>();
  public async save(value: RefreshTokenRecord): Promise<void> {
    this.values.set(value.tokenHash, value);
  }
  public async consume(tokenHash: string): Promise<RefreshTokenRecord | null> {
    const value = this.values.get(tokenHash);
    this.values.delete(tokenHash);
    return value && value.expiresAt > epoch() ? value : null;
  }
}

export class FirestoreOAuthCodeStore implements OAuthCodeStore {
  public constructor(private readonly firestore: Firestore) {}
  public async save(value: OAuthCode): Promise<void> {
    await this.firestore.doc(`mcpOAuthCodes/${hash(value.code)}`).set(value);
  }
  public async consume(code: string): Promise<OAuthCode | null> {
    const reference = this.firestore.doc(`mcpOAuthCodes/${hash(code)}`);
    return this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists) return null;
      transaction.delete(reference);
      const value = snapshot.data() as OAuthCode;
      return value.expiresAt > epoch() ? value : null;
    });
  }
}

export class FirestoreRefreshTokenStore implements RefreshTokenStore {
  public constructor(private readonly firestore: Firestore) {}
  public async save(value: RefreshTokenRecord): Promise<void> {
    await this.firestore.doc(`mcpOAuthRefreshTokens/${value.tokenHash}`).set(value);
  }
  public async consume(tokenHash: string): Promise<RefreshTokenRecord | null> {
    const reference = this.firestore.doc(`mcpOAuthRefreshTokens/${tokenHash}`);
    return this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists) return null;
      transaction.delete(reference);
      const value = snapshot.data() as RefreshTokenRecord;
      return value.expiresAt > epoch() ? value : null;
    });
  }
}

export interface OAuthRuntime {
  issuer: string;
  resource: string;
  authority: TokenAuthority;
  codeStore: OAuthCodeStore;
  refreshStore: RefreshTokenStore;
  publicJwk: Record<string, unknown>;
}

export async function createOAuthRuntime(options: {
  issuer: string;
  resource: string;
  privateKey: string;
  publicKey: string;
  keyId?: string;
  firestore?: Firestore;
}): Promise<OAuthRuntime> {
  const signingKey = await importPKCS8(options.privateKey.replace(/\\n/gu, "\n"), "RS256");
  const verificationKey = await importSPKI(options.publicKey.replace(/\\n/gu, "\n"), "RS256");
  const publicJwk = await publicJwkFor(verificationKey, options.keyId ?? "stone-mcp-1");
  return {
    issuer: options.issuer,
    resource: options.resource,
    authority: new TokenAuthority(
      options.issuer,
      options.resource,
      signingKey,
      verificationKey,
      options.keyId ?? "stone-mcp-1",
    ),
    codeStore: options.firestore
      ? new FirestoreOAuthCodeStore(options.firestore)
      : new MemoryOAuthCodeStore(),
    refreshStore: options.firestore
      ? new FirestoreRefreshTokenStore(options.firestore)
      : new MemoryRefreshTokenStore(),
    publicJwk,
  };
}

export async function exchangeAuthorizationCode(
  runtime: OAuthRuntime,
  code: OAuthCode,
  verifier: string,
): Promise<Record<string, unknown>> {
  const expected = createHash("sha256").update(verifier).digest("base64url");
  if (expected !== code.codeChallenge) throw new McpUnauthorizedError("PKCE verification failed.");
  const accessToken = await runtime.authority.issue(code.userId, code.clientId, code.scopes);
  const refreshToken = randomBytes(48).toString("base64url");
  await runtime.refreshStore.save({
    tokenHash: hash(refreshToken),
    userId: code.userId,
    clientId: code.clientId,
    resource: code.resource,
    scopes: code.scopes,
    expiresAt: epoch() + 60 * 60 * 24 * 30,
  });
  return {
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: 3600,
    refresh_token: refreshToken,
    scope: code.scopes.join(" "),
  };
}

export async function refreshAccessToken(
  runtime: OAuthRuntime,
  refreshToken: string,
  clientId: string,
  resource: string,
): Promise<Record<string, unknown>> {
  const value = await runtime.refreshStore.consume(hash(refreshToken));
  if (!value || value.clientId !== clientId || value.resource !== resource)
    throw new McpUnauthorizedError("Invalid refresh token.");
  const accessToken = await runtime.authority.issue(value.userId, value.clientId, value.scopes);
  const nextRefreshToken = randomBytes(48).toString("base64url");
  await runtime.refreshStore.save({
    ...value,
    tokenHash: hash(nextRefreshToken),
    expiresAt: epoch() + 60 * 60 * 24 * 30,
  });
  return {
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: 3600,
    refresh_token: nextRefreshToken,
    scope: value.scopes.join(" "),
  };
}

export function validateRequestedScopes(value: string | undefined): readonly StoneScope[] {
  const scopes = (value ?? "").split(/\s+/u).filter(Boolean);
  const invalid = scopes.filter((scope) => !(SCOPES as readonly string[]).includes(scope));
  if (invalid.length > 0)
    throw new McpUnauthorizedError("Requested OAuth scopes are not supported.");
  const selected = scopes.filter((scope): scope is StoneScope =>
    (SCOPES as readonly string[]).includes(scope),
  );
  return [
    ...new Set(
      selected.length > 0
        ? selected
        : (["stone.read.notes", "stone.read.projects", "stone.read.tasks"] as StoneScope[]),
    ),
  ];
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
function epoch(): number {
  return Math.floor(Date.now() / 1000);
}
async function publicJwkFor(
  key: CryptoKey | KeyObject | Uint8Array,
  kid: string,
): Promise<Record<string, unknown>> {
  const { exportJWK } = await import("jose");
  return { ...(await exportJWK(key)), use: "sig", alg: "RS256", kid };
}
