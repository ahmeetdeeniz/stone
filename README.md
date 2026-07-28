# Stone

Stone; kişisel kullanım için tasarlanan, Markdown notlarını ve yazılım projelerini aynı yerde yöneten, cihazlar arasında eşitlenen sade bir çalışma alanıdır.

Stone'un deposu public ve self-host edilebilirdir. Maintainer'ın Firebase projesi veya kişisel build credential'ları ortak bir servis olarak sunulmaz; her kullanıcı kendi Firebase projesini ve kendi dağıtım hesaplarını bağlar.

Stone açık kaynaklı ve self-host edilebilir bir projedir. Kendi Firebase projenizi,
uygulama kimliklerinizi ve dağıtım hesaplarınızı kullanarak yerel olarak çalıştırabilirsiniz.

## İlk sürümün özeti

- Android ve iOS
- React Native + Expo Development Build
- TypeScript + Expo Router
- Obsidian benzeri Live Preview Markdown editörü
- Saf ve taşınabilir Markdown
- Firebase Auth + Firestore
- Cihazda SQLite tabanlı local-first veri
- Notlar, projeler, sürümler, release checklist'leri
- Kanban ve Bugün ekranı
- Markdown içe/dışa aktarma
- Açık/koyu tema
- Bongita + Inter
- Morumsu lacivert tasarım dili

## Uygulanmış mobil sonrası yüzeyler

- Provider-neutral Stone MCP bağlantısı (ChatGPT Work, Claude, Claude Cowork ve uyumlu client'lar)
- Windows/Tauri not editörü ve yerel Markdown klasörleri
- GitHub repo listeleme, clone, pull, reviewed commit/push ve yeni bilgisayar restore

Desktop proje Markdown'ından salt-okunur durum/ilerleme/sürüm/blocker özetleri ve gerçek bir Bugün
görünümü üretir; proje düzenleme/Kanban ile çizim/trash/revision/conflict akışlarında mobil ile tam
parity sağlamaz.
MCP için public deployment veya provider publication da repository tarafından otomatik olarak
sağlanmaz; ikisi de aşağıdaki self-hosted kurulum sınırlarına tabidir.

## Stone MCP

Stone MCP is a separately deployable, provider-neutral MCP service. The same authenticated tool contract is intended for ChatGPT Work, Claude, Claude Cowork and future standards-compatible MCP clients. It is not a maintainer-hosted backend: self-hosters connect their own Firebase project and supply their own server secrets.

See [services/mcp/README.md](services/mcp/README.md) for local setup, Firebase Admin configuration, OAuth metadata, provider connection notes and deployment checks.

## Windows desktop

Stone Windows desktop is a Tauri 2 development build. It is intended for direct installer or portable distribution, not a public app-store listing.

To use it locally:

1. Copy `apps/desktop/.env.example` to `apps/desktop/.env.local` and provide your own `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_PROJECT_ID`, and `VITE_FIREBASE_AUTH_DOMAIN`. Desktop env files live in `apps/desktop/` (not the monorepo root), so the mobile app's `EXPO_PUBLIC_*` variables never leak into the desktop bundle. `apps/desktop/.env.local` is ignored by Git; only `apps/desktop/.env.example` is committed as the public template.
2. Keep the approved `apps/mobile/assets/fonts/Bongita-Regular.otf` asset in the repository; do not rename or replace it.
3. Run `pnpm install`, then `pnpm desktop:dev`.
4. Install the Visual C++ build tools and WebView2 when creating a Windows Tauri installer locally with `pnpm desktop:tauri:build`. A production NSIS installer can also be built without any local Windows toolchain via the `Desktop Windows Release` GitHub Actions workflow — see below.

The desktop app stores local data in its Tauri application data directory, uses the Windows credential store for Firebase refresh tokens, waits for saved-session restoration before showing sign-in, and links only Markdown files selected by the user. Each self-hosted installation must use its own Firebase project and may configure its own mobile package and iOS bundle identifiers. The desktop app **compiles** without any Firebase configuration present (the values are simply empty at build time); signing in shows a clear "VITE_FIREBASE_API_KEY yapılandırılmamış" error at runtime instead of a confusing network failure if `apps/desktop/.env.local` was never configured.

### GitHub desktop setup

The desktop GitHub integration uses GitHub OAuth Device Flow and never asks for or accepts a client secret, personal access token, or `gh` CLI login. Each self-hosted contributor creates and owns a single GitHub OAuth App:

1. On GitHub, go to Settings → Developer settings → OAuth Apps → New OAuth App.
2. Give it any name and homepage URL; the callback URL is not used by Device Flow.
3. Open the app's settings and enable "Device Flow".
4. Copy the generated Client ID (not the client secret — Stone never uses it).

Set only that public client ID in `apps/desktop/.env.local` (never commit real values; `.env` and `.env.local` are ignored):

```text
VITE_GITHUB_CLIENT_ID=your-own-github-oauth-app-client-id
```

Do not add a GitHub client secret, access token, or personal credential to the repository. When you connect, Stone starts the real Device Flow, shows a verification URL and short code to enter at github.com, and polls until you authorize it. The resulting access token is stored only in the operating system credential store (Windows Credential Manager on desktop); disconnecting removes it. Each self-hosted user connects their own GitHub account, and repository access follows that account's GitHub permissions. Run `pnpm desktop:dev` from the repository root to test the flow locally.

Stone performs repository listing, cloning, pull, status, and reviewed stage/commit/push through the user's local Git installation. Force push, reset, clean, branch deletion, rebase, merge, and automatic conflict resolution are intentionally unavailable.

### Production Windows installer (GitHub Actions)

`.github/workflows/desktop-release.yml` builds the production Stone Windows installer (NSIS `setup.exe`) on a `windows-latest` GitHub-hosted runner. It:

- installs the repository's pinned Node and pnpm versions and runs `pnpm install --frozen-lockfile`;
- installs the stable Rust MSVC toolchain and restores pnpm/Cargo caches;
- runs `pnpm format:check`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm verify:desktop` before attempting the native build;
- reports (configured/missing only, never the values) which desktop build-time Variables are set, then runs `pnpm desktop:build`;
- builds only the NSIS bundle (`tauri build --bundles nsis`) and computes a SHA-256 checksum file next to the installer;
- uploads the installer and checksum as a workflow artifact named `stone-desktop-windows-nsis`.

No Firebase or GitHub OAuth **credentials** are configured in this workflow — no service-account JSON, client secret, access token, or signing credential is ever used. It compiles and produces a working installer with no configuration at all (see above). The workflow never commits generated installers back to the repository.

#### Configuring a personal installer build (repository Variables)

A public Firebase Web API key and GitHub OAuth App client ID are not secrets — they are client-side identifiers meant to ship inside the app itself — so they belong in **repository Variables**, not Secrets. If you maintain your own fork/release of Stone and want the GitHub Actions-built installer to come preconfigured (rather than shipping unconfigured and requiring end users to edit files by hand), set these under your repository's **Settings → Secrets and variables → Actions → Variables**:

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_GITHUB_CLIENT_ID`

`desktop-release.yml` maps these into one job-level `env:` block, so every step that builds the desktop frontend or the installer (`pnpm desktop:build` and `pnpm --filter @stone/desktop run tauri:build:nsis`, which runs the same frontend build via Tauri's `beforeBuildCommand`) sees identical values. **Vite embeds `VITE_*`-prefixed values directly into the built JavaScript bundle at build time** — that is the normal, intended place for a public client-side key to end up, the same as running a local build with `apps/desktop/.env.local` configured. This also means **changing a repository Variable only takes effect the next time the installer is built** — trigger a new `Desktop Windows Release` run (or push a new version tag) to bake in updated values; existing downloaded installers keep whatever was embedded when they were built.

A "Report desktop build-time configuration status" step logs which of the four variables are configured or missing on each run — it never prints the values themselves. If a Variable is left unset (e.g. a public self-hoster's own fork with no Variables configured at all), the build still succeeds and produces a working installer that shows Stone's existing clear runtime configuration error instead of failing to compile. Repository-root `EXPO_PUBLIC_*` mobile variables are never read by this workflow.

It runs on `workflow_dispatch` (manual trigger from the Actions tab) and on pushes of version tags matching `v*.*.*`. To download a build: open the repository's **Actions** tab on GitHub, select the **Desktop Windows Release** workflow, open the run you want, and download the `stone-desktop-windows-nsis` artifact from the run summary page.

#### Live end-to-end verification against a disposable repository

`pnpm verify:github` statically checks the GitHub integration's wiring (endpoints, safety boundaries, forbidden Git operations) and needs no credentials. It runs in CI.

`pnpm verify:github:live` is a separate, opt-in command that drives the same production GitHub/Git code against a real GitHub account and a disposable repository — Device Flow, keychain persistence, authenticated pagination, project linking, restore/clone, status/pull, and a reviewed stage/commit/push. It is intentionally **not** part of CI and never runs with real credentials automatically:

- It requires `VITE_GITHUB_CLIENT_ID` (from `apps/desktop/.env.local`) and an explicit `STONE_LIVE_E2E_REPO=<your-account>/<disposable-repo>` environment variable; without both it prints what is missing and exits successfully without making any network, keychain, or Git call.
- Use a throwaway private repository you don't mind Stone pushing a small verification commit to (a `STONE_GOAL7_E2E.md` file with a timestamp) — never point it at a real project repository.
- It prints a Device Flow verification URL and user code for you to authorize in a browser, then continues automatically; it never logs the resulting access token, device code, or keychain contents.
- Restores happen in a unique temporary directory outside the Stone source tree, which is removed automatically when the run finishes.

```text
STONE_LIVE_E2E_REPO=your-account/your-disposable-repo pnpm verify:github:live
```

## Dağıtım modeli

- Stone, Google Play Store'da veya public App Store listesinde dağıtılmaz.
- Android sürümü, kişisel olarak imzalanmış ve doğrudan kurulabilen bir APK'dır.
- iOS sürümü, proje sahibinin Apple Developer hesabıyla private TestFlight kurulumu olarak dağıtılır.
- Windows sürümü ileride doğrudan installer veya portable desktop build olarak dağıtılır.
- Stone içindeki projelerin `Store Süreci`, release checklist'i ve Android/iOS release durumları bu dağıtım kararından bağımsız olarak kullanılmaya devam eder.

## Paketi kullanma

### Tablet drawings

Stone Ink drawings are stored as editable `.stoneink` vector sources plus PNG previews.
Markdown notes use an ordinary image and an ignorable `stone-drawing` metadata comment, so
the note remains portable outside Stone. The current tablet milestone requires Firebase
Storage in your own Firebase project; no maintainer backend is used.

Full workspace export uses a versioned `.stone-workspace.json` container so Markdown, manifest
JSON, editable `.stoneink` sources and binary PNG previews retain their relative paths, encodings
and MIME types. The parser contract is tested for round-trip and unsafe-path rejection; the
mobile app does not yet expose a full-workspace restore UI.

1. Boş bir GitHub reposu oluştur ve bu paketin içeriğini repo köküne kopyala.
2. Onaylı `apps/mobile/assets/fonts/Bongita-Regular.otf` dosyasını koru; OTF uzantısını değiştirme.
3. Kendi Firebase projenizi oluşturup Email/Password ve Firestore'u etkinleştir; `.env.example` dosyasını `.env` olarak kopyala, kendi `EXPO_PUBLIC_FIREBASE_*` değerlerini doldur ve kendi `google-services.json` ile `GoogleService-Info.plist` dosyalarını `apps/mobile/` altına koy.
4. Kendi uygulama kimliklerini kullanacaksan `apps/mobile/app.json` içindeki `android.package` ve `ios.bundleIdentifier` değerlerini Firebase'de kaydettiğin benzersiz değerlerle değiştir. Resmi varsayılan kimlikler `com.imtempra.stone` değerleridir.
5. Android için kişisel imzalı APK, iOS için proje sahibinin hesabıyla private TestFlight build'i üret.

Kişisel `.env`, Firebase native config dosyaları, signing credential'ları, kullanıcı notları ve gerçek proje verileri Git'e eklenmemelidir. Bongita fontu repo içindeki `apps/mobile/assets/fonts/Bongita-Regular.otf` yolunda bulunmalıdır; indirilen veya sahte uzantılı bir font kullanılmaz.

## Beklenen depo yapısı

```text
stone/
├── apps/
│   ├── mobile/
│   └── desktop/
├── packages/
│   ├── domain/
│   ├── markdown/
│   ├── editor/
│   └── sync/
├── services/
│   └── mcp/
├── templates/
└── README.md
```

## Önemli not

Stone v1 bir Notion veya Obsidian klonu değildir. Ürün odağı:

> Markdown'ı çok iyi düzenlemek, projeleri sade biçimde takip etmek ve aynı verilere bütün kişisel cihazlardan güvenle ulaşmak.
