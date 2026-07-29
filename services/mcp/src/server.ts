import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createFirebaseRuntime, FirebasePasswordAuthenticator } from "./firebase.js";
import {
  createOAuthRuntime,
  exchangeAuthorizationCode,
  refreshAccessToken,
  validateRequestedScopes,
  type OAuthRuntime,
} from "./oauth.js";
import { FirestoreStoneStore, MemoryStoneStore } from "./store.js";
import { StoneMcpService } from "./core.js";
import { createMcpServer } from "./tools.js";
import { McpRateLimitError, McpUnauthorizedError } from "./contracts.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";

interface Session {
  transport: StreamableHTTPServerTransport;
  server: ReturnType<typeof createMcpServer>;
}
export interface McpHttpOptions {
  service?: StoneMcpService;
  oauth?: OAuthRuntime;
  authenticator?: FirebasePasswordAuthenticator;
  port?: number;
}

export async function createMcpHttpServer(options: McpHttpOptions = {}) {
  const firebase =
    options.service && options.oauth && options.authenticator ? null : createFirebaseRuntime();
  const resource = process.env.MCP_RESOURCE_URL ?? `http://localhost:${options.port ?? 8787}`;
  const issuer = process.env.MCP_OAUTH_ISSUER ?? `${resource}/oauth`;
  const oauthOptions = {
    issuer,
    resource,
    privateKey: requiredEnv("MCP_OAUTH_PRIVATE_KEY"),
    publicKey: requiredEnv("MCP_OAUTH_PUBLIC_KEY"),
    ...(process.env.MCP_OAUTH_KEY_ID ? { keyId: process.env.MCP_OAUTH_KEY_ID } : {}),
    ...(firebase?.firestore ? { firestore: firebase.firestore } : {}),
  };
  const oauth = options.oauth ?? (await createOAuthRuntime(oauthOptions));
  const service =
    options.service ??
    new StoneMcpService(
      process.env.MCP_USE_MEMORY_STORE === "true"
        ? new MemoryStoneStore()
        : new FirestoreStoneStore(firebase!.firestore),
    );
  const authenticator =
    options.authenticator ??
    new FirebasePasswordAuthenticator(requiredEnv("FIREBASE_WEB_API_KEY"), firebase!.auth);
  const sessions = new Map<string, Session>();
  const limiter = new FixedWindowLimiter(120, 60_000);
  const server = createServer(async (request, response) => {
    try {
      await handle(request, response, { oauth, service, authenticator, sessions, limiter });
    } catch (error) {
      sendError(response, error);
    }
  });
  return server;
}

export async function start(): Promise<void> {
  const port = Number(process.env.PORT ?? 8787);
  const server = await createMcpHttpServer({ port });
  server.listen(port, "0.0.0.0", () => console.log(`Stone MCP listening on ${port}`));
}

if (process.argv[1]?.endsWith("server.ts") || process.argv[1]?.endsWith("server.js")) void start();

async function handle(
  request: IncomingMessage,
  response: ServerResponse,
  context: {
    oauth: OAuthRuntime;
    service: StoneMcpService;
    authenticator: FirebasePasswordAuthenticator;
    sessions: Map<string, Session>;
    limiter: FixedWindowLimiter;
  },
): Promise<void> {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  if (url.pathname === "/healthz") return json(response, 200, { ok: true });
  if (url.pathname === "/.well-known/oauth-protected-resource")
    return json(response, 200, protectedResource(context.oauth));
  if (url.pathname === "/.well-known/oauth-authorization-server")
    return json(response, 200, authorizationMetadata(context.oauth));
  if (url.pathname === "/oauth/jwks.json")
    return json(response, 200, { keys: [context.oauth.publicJwk] });
  if (url.pathname === "/oauth/authorize") return authorize(request, response, url, context);
  if (url.pathname === "/oauth/token") return token(request, response, context);
  if (url.pathname === "/mcp") return mcp(request, response, context);
  json(response, 404, { error: "not_found" });
}

async function authorize(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  context: { oauth: OAuthRuntime; authenticator: FirebasePasswordAuthenticator },
): Promise<void> {
  const values =
    request.method === "POST"
      ? await readForm(request)
      : Object.fromEntries(url.searchParams.entries());
  const clientId = requiredValue(values.client_id, "client_id");
  const redirectUri = requiredValue(values.redirect_uri, "redirect_uri");
  if (!allowedRedirect(redirectUri))
    throw new McpUnauthorizedError("Redirect URI is not allowlisted.");
  if (values.response_type !== "code" || values.code_challenge_method !== "S256")
    throw new McpUnauthorizedError("Authorization code with PKCE S256 is required.");
  if (values.resource !== context.oauth.resource)
    throw new McpUnauthorizedError("The OAuth resource does not match this server.");
  const scopes = validateRequestedScopes(values.scope);
  if (request.method !== "POST")
    return html(response, 200, loginPage({ ...values, scope: scopes.join(" ") }));
  const email = requiredValue(values.email, "email");
  const password = requiredValue(values.password, "password");
  const user = await context.authenticator.authenticate(email, password);
  const code = randomBytes(48).toString("base64url");
  await context.oauth.codeStore.save({
    code,
    clientId,
    redirectUri,
    codeChallenge: requiredValue(values.code_challenge, "code_challenge"),
    resource: context.oauth.resource,
    userId: user.userId,
    scopes,
    expiresAt: epoch() + 300,
  });
  const redirect = new URL(redirectUri);
  redirect.searchParams.set("code", code);
  if (values.state) redirect.searchParams.set("state", values.state);
  response.writeHead(302, { location: redirect.toString(), "cache-control": "no-store" });
  response.end();
}

async function token(
  request: IncomingMessage,
  response: ServerResponse,
  context: { oauth: OAuthRuntime },
): Promise<void> {
  if (request.method !== "POST") return json(response, 405, { error: "method_not_allowed" });
  const values = await readForm(request);
  const clientId = requiredValue(values.client_id, "client_id");
  const resource = requiredValue(values.resource, "resource");
  if (resource !== context.oauth.resource)
    throw new McpUnauthorizedError("The OAuth resource does not match this server.");
  if (values.grant_type === "authorization_code") {
    const code = await context.oauth.codeStore.consume(requiredValue(values.code, "code"));
    if (
      !code ||
      code.clientId !== clientId ||
      code.redirectUri !== requiredValue(values.redirect_uri, "redirect_uri")
    )
      throw new McpUnauthorizedError("Invalid authorization code.");
    return json(
      response,
      200,
      await exchangeAuthorizationCode(
        context.oauth,
        code,
        requiredValue(values.code_verifier, "code_verifier"),
      ),
    );
  }
  if (values.grant_type === "refresh_token")
    return json(
      response,
      200,
      await refreshAccessToken(
        context.oauth,
        requiredValue(values.refresh_token, "refresh_token"),
        clientId,
        resource,
      ),
    );
  throw new McpUnauthorizedError("Only authorization_code and refresh_token grants are supported.");
}

async function mcp(
  request: IncomingMessage,
  response: ServerResponse,
  context: {
    oauth: OAuthRuntime;
    service: StoneMcpService;
    sessions: Map<string, Session>;
    limiter: FixedWindowLimiter;
  },
): Promise<void> {
  if (!context.limiter.allow(request.socket.remoteAddress ?? "unknown"))
    throw new McpRateLimitError(60);
  const token = bearer(request.headers.authorization);
  if (!token) {
    response.setHeader(
      "www-authenticate",
      `Bearer resource_metadata="${context.oauth.resource}/.well-known/oauth-protected-resource"`,
    );
    return json(response, 401, { error: "unauthorized" });
  }
  const claims = await context.oauth.authority.verify(token);
  const authInfo: AuthInfo = {
    token,
    clientId: claims.client_id,
    scopes: claims.scope.split(" "),
    ...(claims.exp ? { expiresAt: claims.exp } : {}),
    resource: new URL(context.oauth.resource),
    extra: { userId: claims.sub },
  };
  const sessionId = header(request, "mcp-session-id");
  if (request.method === "DELETE" && sessionId) {
    const session = context.sessions.get(sessionId);
    if (session) await session.transport.close();
    context.sessions.delete(sessionId);
    return json(response, 204, {});
  }
  let session = sessionId ? context.sessions.get(sessionId) : undefined;
  if (sessionId && !session) return json(response, 404, { error: "unknown_session" });
  if (!session) {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() });
    const mcpServer = createMcpServer(context.service);
    session = { transport, server: mcpServer };
    transport.onclose = () => {
      if (transport.sessionId) context.sessions.delete(transport.sessionId);
    };
    await mcpServer.connect(transport as unknown as Parameters<typeof mcpServer.connect>[0]);
    const requestWithAuth = request as IncomingMessage & { auth?: AuthInfo };
    requestWithAuth.auth = authInfo;
    await transport.handleRequest(
      requestWithAuth,
      response,
      request.method === "POST" ? await readJson(request) : undefined,
    );
    if (transport.sessionId) context.sessions.set(transport.sessionId, session);
    return;
  }
  const requestWithAuth = request as IncomingMessage & { auth?: AuthInfo };
  requestWithAuth.auth = authInfo;
  await session.transport.handleRequest(
    requestWithAuth,
    response,
    request.method === "POST" ? await readJson(request) : undefined,
  );
}

function protectedResource(oauth: OAuthRuntime) {
  return {
    resource: oauth.resource,
    authorization_servers: [oauth.issuer],
    scopes_supported: [
      "stone.read.notes",
      "stone.read.projects",
      "stone.read.tasks",
      "stone.write.notes",
      "stone.write.projects",
      "stone.write.tasks",
    ],
  };
}
function authorizationMetadata(oauth: OAuthRuntime) {
  return {
    issuer: oauth.issuer,
    authorization_endpoint: `${oauth.issuer}/authorize`,
    token_endpoint: `${oauth.issuer}/token`,
    jwks_uri: `${oauth.issuer}/jwks.json`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: protectedResource(oauth).scopes_supported,
    client_id_metadata_document_supported: true,
  };
}
function loginPage(values: Record<string, string>) {
  return `<!doctype html><meta charset="utf-8"><title>Connect Stone</title><h1>Connect Stone</h1><p>Sign in to authorize this MCP client.</p><form method="post">${Object.entries(
    values,
  )
    .filter(([key]) => !["email", "password"].includes(key))
    .map(
      ([key, value]) =>
        `<input type="hidden" name="${escapeHtml(key)}" value="${escapeHtml(value)}">`,
    )
    .join(
      "",
    )}<label>Email <input name="email" type="email" autocomplete="username" required></label><label>Password <input name="password" type="password" autocomplete="current-password" required></label><button type="submit">Authorize</button></form>`;
}
function allowedRedirect(value: string): boolean {
  if (
    process.env.MCP_ALLOWED_REDIRECT_URIS?.split(",")
      .map((item) => item.trim())
      .includes(value)
  )
    return true;
  return /^https:\/\/(?:chatgpt\.com|chat\.openai\.com)\/connector\/oauth\/[A-Za-z0-9_-]+$/u.test(
    value,
  );
}
function bearer(value: string | undefined): string | null {
  const match = value?.match(/^Bearer\s+(.+)$/iu);
  return match?.[1] ?? null;
}
function header(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}
function requiredValue(value: string | undefined, name: string): string {
  if (!value) throw new McpUnauthorizedError(`Missing ${name}.`);
  return value;
}
function requiredEnv(name: string): string {
  return requiredValue(process.env[name], name);
}
async function readForm(request: IncomingMessage): Promise<Record<string, string>> {
  const body = await readBody(request, 64_000);
  return Object.fromEntries(new URLSearchParams(body).entries());
}
async function readJson(request: IncomingMessage): Promise<unknown> {
  const body = await readBody(request, 1_100_000);
  return body ? (JSON.parse(body) as unknown) : undefined;
}
async function readBody(request: IncomingMessage, maxBytes: number): Promise<string> {
  const chunks: Buffer<ArrayBufferLike>[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk) as Buffer<ArrayBufferLike>;
    total += buffer.byteLength;
    if (total > maxBytes) throw new Error("Request body too large.");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}
function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  if (status !== 204) response.end(JSON.stringify(value));
  else response.end();
}
function html(response: ServerResponse, status: number, value: string): void {
  response.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
  });
  response.end(value);
}
function sendError(response: ServerResponse, error: unknown): void {
  const safeError = toSafeHttpError(error);
  json(response, safeError.status, { error: safeError.message });
}
export function toSafeHttpError(error: unknown): { status: number; message: string } {
  if (error instanceof McpUnauthorizedError) {
    return { status: 401, message: error.message };
  }
  if (error instanceof McpRateLimitError) {
    return { status: 429, message: error.message };
  }
  return { status: 400, message: "request_failed" };
}
function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/gu,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ??
      character,
  );
}
function epoch(): number {
  return Math.floor(Date.now() / 1000);
}

class FixedWindowLimiter {
  private readonly values = new Map<string, { count: number; startedAt: number }>();
  public constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}
  public allow(key: string): boolean {
    const now = Date.now();
    const current = this.values.get(key);
    if (!current || now - current.startedAt >= this.windowMs) {
      this.values.set(key, { count: 1, startedAt: now });
      return true;
    }
    if (current.count >= this.max) return false;
    current.count += 1;
    return true;
  }
}
