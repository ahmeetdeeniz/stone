# Stone — Codex Geliştirme Paketi

Stone; kişisel kullanım için tasarlanan, Markdown notlarını ve yazılım projelerini aynı yerde yöneten, cihazlar arasında eşitlenen sade bir çalışma alanıdır.

Stone'un deposu public ve self-host edilebilirdir. Maintainer'ın Firebase projesi veya kişisel build credential'ları ortak bir servis olarak sunulmaz; her kullanıcı kendi Firebase projesini ve kendi dağıtım hesaplarını bağlar.

Bu paketin amacı Stone'u mümkün olduğunca az Codex promptuyla, kararları tekrar tekrar anlatmadan geliştirmektir.

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

## Sonraki aşamalar

- Provider-neutral Stone MCP bağlantısı (ChatGPT Work, Claude, Claude Cowork ve uyumlu gelecek client'lar)
- Windows uygulaması
- Yerel proje klasörleri
- GitHub repo listeleme, clone, pull, commit ve push
- Yeni bilgisayarda bütün projeleri geri yükleme

## Stone MCP

Stone MCP is a separately deployable, provider-neutral MCP service. The same authenticated tool contract is intended for ChatGPT Work, Claude, Claude Cowork and future standards-compatible MCP clients. It is not a maintainer-hosted backend: self-hosters connect their own Firebase project and supply their own server secrets.

See [services/mcp/README.md](services/mcp/README.md) for local setup, Firebase Admin configuration, OAuth metadata, provider connection notes and deployment checks.

## Windows desktop

Stone Windows desktop is a Tauri 2 development build. It is intended for direct installer or portable distribution, not a public app-store listing.

To use it locally:

1. Copy `.env.example` to `.env` and provide your own `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_PROJECT_ID`, and `VITE_FIREBASE_AUTH_DOMAIN`.
2. Keep the approved `apps/mobile/assets/fonts/Bongita-Regular.otf` asset in the repository; do not rename or replace it.
3. Run `pnpm install`, then `pnpm desktop:dev`.
4. Install the Visual C++ build tools and WebView2 when creating a Windows Tauri installer with `pnpm desktop:tauri:build`.

The desktop app stores local data in its Tauri application data directory, uses the Windows credential store for Firebase refresh tokens, and links only Markdown files selected by the user. Each self-hosted installation must use its own Firebase project and may configure its own mobile package and iOS bundle identifiers.

### GitHub desktop setup

The desktop GitHub integration uses GitHub OAuth Device Flow. Create your own GitHub OAuth App, enable Device Flow, and set only its public client ID in the local root `.env` file:

```text
VITE_GITHUB_CLIENT_ID=your-own-github-oauth-app-client-id
```

Do not add a GitHub client secret, access token, or personal credential to the repository. The app stores the resulting access token only in the operating system credential store. Each self-hosted user connects their own GitHub account, and repository access follows that account's GitHub permissions. Run `pnpm desktop:dev` from the repository root to test the flow locally.

Stone performs repository listing, cloning, pull, status, and reviewed stage/commit/push through the user's local Git installation. Force push, reset, clean, branch deletion, rebase, merge, and automatic conflict resolution are intentionally unavailable.

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

1. Boş bir GitHub reposu oluştur.
2. Bu paketin içeriğini repo köküne kopyala.
3. Onaylı `apps/mobile/assets/fonts/Bongita-Regular.otf` dosyasını koru; OTF uzantısını değiştirme.
4. Kendi Firebase projenizi oluşturup Email/Password ve Firestore'u etkinleştir; `.env.example` dosyasını `.env` olarak kopyala, kendi `EXPO_PUBLIC_FIREBASE_*` değerlerini doldur ve kendi `google-services.json` ile `GoogleService-Info.plist` dosyalarını `apps/mobile/` altına koy.
5. Kendi uygulama kimliklerini kullanacaksan `apps/mobile/app.json` içindeki `android.package` ve `ios.bundleIdentifier` değerlerini Firebase'de kaydettiğin benzersiz değerlerle değiştir. Resmi varsayılan kimlikler `com.imtempra.stone` değerleridir.
6. Android için kişisel imzalı APK, iOS için proje sahibinin hesabıyla private TestFlight build'i üret. `docs/17-FIREBASE-SETUP.md` ve `docs/20-LOCAL-SETUP.md` ayrıntılı adımları içerir.
7. Codex'i repo kökünde aç.
8. Önce `goals/01-FOUNDATION.goal.md` içeriğini `/goal` olarak gönder.
9. Goal tamamlanıp doğrulandıktan sonra sırayla 02, 03 ve 04'e geç.
10. Mobil v1 tamamen bitmeden `goals/future` altındaki goal'ları çalıştırma.

Kişisel `.env`, Firebase native config dosyaları, signing credential'ları, kullanıcı notları ve gerçek proje verileri Git'e eklenmemelidir. Bongita fontu repo içindeki `apps/mobile/assets/fonts/Bongita-Regular.otf` yolunda bulunmalıdır; indirilen veya sahte uzantılı bir font kullanılmaz.

## Kaynakların öncelik sırası

Çelişki oluşursa aşağıdaki sıra geçerlidir:

1. `AGENTS.md`
2. `docs/16-LOCKED-DECISIONS.md`
3. `docs/12-ACCEPTANCE-CRITERIA.md`
4. İlgili teknik özellik dosyası
5. `PLAN.md`
6. `PROGRESS.md`

Codex bir çelişki bulursa tahmin yürütmemeli; çelişkiyi açıkça raporlamalıdır.

## Beklenen depo yapısı

```text
stone/
├── apps/
│   └── mobile/
├── packages/
│   ├── domain/
│   ├── markdown/
│   ├── editor/
│   └── sync/
├── services/
│   └── mcp/                 # v1 sonrasında
├── docs/
├── goals/
├── templates/
├── AGENTS.md
├── PLAN.md
└── PROGRESS.md
```

## Önemli not

Stone v1 bir Notion veya Obsidian klonu değildir. Ürün odağı:

> Markdown'ı çok iyi düzenlemek, projeleri sade biçimde takip etmek ve aynı verilere bütün kişisel cihazlardan güvenle ulaşmak.
