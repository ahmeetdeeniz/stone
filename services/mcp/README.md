# Stone MCP service

`services/mcp` is a separately deployable, provider-neutral MCP server. It exposes one secure Stone contract to ChatGPT Work, Claude, Claude Cowork and future MCP-compatible clients. Provider-specific connection steps may differ, but ownership, OAuth, scopes, bounded reads and revision-safe writes stay in this service.

## Local setup

1. Copy the repository `.env.example` to a private local environment.
2. Create or choose your own Firebase project. Enable Email/Password Authentication and Firestore. Do not use the maintainer's Firebase project.
3. Provide Firebase Admin credentials through `GOOGLE_APPLICATION_CREDENTIALS` or `FIREBASE_SERVICE_ACCOUNT_JSON`. Provide the same project's Web API key as `FIREBASE_WEB_API_KEY` for the hosted email/password authorization screen.
4. Generate a dedicated RSA key pair for this service and set `MCP_OAUTH_PRIVATE_KEY` and `MCP_OAUTH_PUBLIC_KEY`. Set a random `MCP_CURSOR_SECRET`.
5. Set `MCP_RESOURCE_URL` to the public HTTPS `/mcp` origin and `MCP_OAUTH_ISSUER` to its `/oauth` issuer URL.

Never commit `.env`, service-account JSON, Firebase native configuration, private keys, signing credentials, real notes or real project data. The repository `.gitignore` protects the normal credential filenames; review the staged file list before every commit.

```text
pnpm install
pnpm mcp:typecheck
pnpm mcp:build
pnpm verify:mcp
pnpm mcp:dev
```

Production must use HTTPS, a durable Firestore-backed OAuth code/refresh store, a secret manager, restricted service-account permissions and a separate Firebase project owned by the operator. The server does not accept client-credentials grants, service-account tokens, shell commands, Git commands, permanent deletes or broad admin tools.

## OAuth and providers

The service publishes:

- `/.well-known/oauth-protected-resource`
- `/.well-known/oauth-authorization-server`
- `/oauth/authorize`
- `/oauth/token`
- `/oauth/jwks.json`
- `/mcp`

Authorization is OAuth 2.1 authorization-code with PKCE S256. A Firebase email/password sign-in is verified server-side and mapped to the Firebase UID in the access token. Every MCP request verifies issuer, audience, expiry and scopes before any tool can reach the owner-scoped store.

ChatGPT's current remote MCP flow uses the ChatGPT connector OAuth callback URI shown in the official OpenAI documentation. Add the exact callback URI for the connector instance to `MCP_ALLOWED_REDIRECT_URIS` when needed. Claude and Claude Cowork use the same public MCP endpoint and OAuth contract, but their connection UI, redirect registration and account entitlements can differ. No provider entitlement is assumed by this repository.

## Tool safety contract

Read tools are bounded and owner-scoped: note search/get, project/version reads, standalone task
list/get/Today/Overdue, Markdown tasks, blockers and release checklists. Writes include
revision-safe standalone task create/update/complete/reopen/soft-delete alongside the existing
note, project, version, release and decision operations. Every write requires `expectedRevision`
and an idempotency key, is audited, and is reversible at the data-model level. Project status
changes require explicit confirmation. No write accepts arbitrary collection paths or unbounded
Markdown.

The initial service intentionally has no custom provider UI. Structured results are usable by every MCP client and keep the business data on the server; a provider-specific UI can be added later without changing the core contract.

## Deployment checklist

- Public stable HTTPS endpoint serving `/mcp` and the OAuth metadata endpoints.
- Firebase project, Admin credential and Web API key owned by the self-hoster.
- RSA private key and cursor secret stored in the platform secret manager.
- Firestore indexes deployed from `firestore.indexes.json`.
- Exact provider redirect URIs allowlisted; arbitrary redirect URIs rejected.
- Request/rate-limit metrics enabled without logging passwords, access tokens or note contents.
- `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm verify:mcp` and `pnpm mcp:build` pass before release.
