# Development and self-hosting

Stone is a public-preview candidate for personal, self-hosted use. It has no shared maintainer
backend.

## Prerequisites

- Node.js 22 or newer
- pnpm 11.17.0
- Git
- Rust stable MSVC, Visual C++ Build Tools, and WebView2 for native Windows packaging
- Android Studio/JDK/SDK/NDK for Android native builds
- macOS, Xcode, and an Apple Developer account for iOS builds

## Install and evaluate

```sh
git clone <your-fork-url> stone
cd stone
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
```

Additional credential-free checks:

```sh
pnpm test:rules
pnpm test:storage-rules
pnpm verify:clean-workspace
pnpm verify:native-dependencies
pnpm verify:desktop
pnpm verify:github
pnpm verify:mcp
pnpm verify:public-boundary
pnpm desktop:build
pnpm mcp:build
pnpm expo:doctor
pnpm mobile:export
```

The rules tests require Java. Firebase Emulator Suite may download emulator binaries on first use.

## Configuration boundaries

- Mobile public client values: copy `.env.example` to `.env`.
- Mobile native files: `apps/mobile/google-services.json` and
  `apps/mobile/GoogleService-Info.plist`; both are ignored.
- Desktop public client values: copy `apps/desktop/.env.example` to
  `apps/desktop/.env.local`.
- MCP server secrets: copy `services/mcp/.env.example` to `services/mcp/.env` only in the private
  deployment environment.

Do not combine client configuration with service credentials. Never commit local env files,
Firebase native files, a service account, OAuth secret/token, signing material, or real user data.

## Start surfaces

```sh
pnpm expo
pnpm desktop:dev
pnpm mcp:dev
```

`pnpm expo` starts a Development Build server; Expo Go is not supported. Desktop can compile
without Firebase values, but sign-in explains that configuration is missing. MCP intentionally
fails without its required server configuration unless its explicit development memory-store mode
is used as documented in `services/mcp/README.md`.

## Application identifiers

The project defaults to `com.imtempra.stone` for Android/iOS and
`com.imtempra.stone.desktop` for Windows. A self-hoster should choose unique identifiers, edit
`apps/mobile/app.json`, and register exactly matching Android/iOS apps in Firebase before native
prebuild or signing.

## Public repository boundary

`docs/`, `goals/`, `AGENTS.md`, `PLAN.md`, and `PROGRESS.md` are private development material and
must not become tracked public files. Public guidance belongs in root files, `.github/`, or
`public-docs/`. Run `pnpm verify:public-boundary` before every public branch or release.
