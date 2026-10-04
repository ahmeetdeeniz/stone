# Self-hosted builds

## Desktop installers (Windows, macOS, Linux)

For local development:

```sh
pnpm desktop:dev
pnpm desktop:build
```

Native installers are built on their own platform:

```sh
pnpm desktop:tauri:build:nsis    # Windows: NSIS setup.exe
pnpm desktop:tauri:build:macos   # macOS: universal .app and .dmg (Apple Silicon + Intel)
pnpm desktop:tauri:build:linux   # Linux: .deb and .AppImage
```

Linux builds need the WebKitGTK 4.1 development packages (on Ubuntu/Debian:
`libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf`), and the signed-in session
is stored through the Secret Service (GNOME Keyring or KWallet).

The `Desktop Release` workflow builds all three on `workflow_dispatch` or a `v*.*.*` tag. It
accepts only public client identifiers through repository **Variables**, reports configured vs.
missing status without values, writes SHA-256 files and keeps the `stone-desktop-<platform>`
artifacts for 30 days. A tag must equal `v` + the version in
`apps/desktop/src-tauri/tauri.conf.json`; it then also creates a **draft** GitHub Release with
every installer. Publish the draft after a smoke test: installed apps update to the latest
published release.

### Auto-update (optional)

Updates are signed with a key only you hold. Generate it on your own machine (never in a shared
or cloud environment) and keep a backup; losing it means installed apps can no longer update:

```sh
pnpm --filter @stone/desktop exec tauri signer generate -w ~/.tauri/stone-updater.key
```

Then add, under **Settings → Secrets and variables → Actions**:

| Kind     | Name                                 | Value                                        |
| -------- | ------------------------------------ | -------------------------------------------- |
| Secret   | `TAURI_SIGNING_PRIVATE_KEY`          | contents of `~/.tauri/stone-updater.key`     |
| Secret   | `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | the password you chose (omit if none)        |
| Variable | `TAURI_UPDATER_PUBKEY`               | contents of `~/.tauri/stone-updater.key.pub` |

Release builds then include signed update packages and the draft release gets a `latest.json`.
The app checks it shortly after launch and from **Settings → Updates**. Builds without the key
(local builds, forks) simply show that automatic updates are not set up.

### macOS signing and notarization (optional)

Without a certificate the macOS app is ad-hoc signed: it runs, but Gatekeeper asks users to
open it from the context menu the first time. With an Apple Developer ID, add these secrets and
the workflow signs and notarizes the app and DMG:

| Secret                       | Value                                                    |
| ---------------------------- | -------------------------------------------------------- |
| `APPLE_CERTIFICATE`          | base64 of the exported "Developer ID Application" `.p12` |
| `APPLE_CERTIFICATE_PASSWORD` | the `.p12` export password                               |
| `APPLE_SIGNING_IDENTITY`     | e.g. `Developer ID Application: Your Name (TEAMID)`      |
| `APPLE_ID`                   | the Apple ID email used for notarization                 |
| `APPLE_PASSWORD`             | an app-specific password for that Apple ID               |
| `APPLE_TEAM_ID`              | your 10-character team ID                                |

Windows installers are not code-signed, so SmartScreen may warn until the installer builds
reputation. Each release candidate still needs checksum and smoke review on every platform.

## Android

Use a Development Build, not Expo Go:

```sh
pnpm verify:native-dependencies
pnpm verify:widgets
pnpm mobile:android
```

The native verifier runs the real React Native Firebase config plugin, Expo prebuild, and Android
autolinking with temporary demo-only Firebase files. It deletes those files and the generated
native project afterward. This static public-CI fixture is not application configuration and must
never be used for a Development or Release Build; those builds still require the genuine files
from your own Firebase project.

For EAS, configure ignored Firebase native files as sensitive file variables
`GOOGLE_SERVICES_JSON` and `GOOGLE_SERVICE_INFO_PLIST`, then:

```sh
pnpm eas:android:development
```

A public Android artifact is not currently approved. Generate a personally signed APK only after
reviewing package ID, Firebase project, signing key custody, and testing the exact APK on a physical
device. That physical signed-APK acceptance remains pending.

Glance widgets and the optional focus notification are included by the local Expo config plugin.
Android 13+ notification permission is requested from Stone Settings and is optional. A clean
prebuild needs the Android SDK and a supported JDK; widget receiver/resize/action behavior must be
checked on a physical launcher before release.

## iOS

iOS native work requires macOS/Xcode:

```sh
pnpm mobile:ios
```

Set `STONE_IOS_BUNDLE_IDENTIFIER` and, when needed, `STONE_IOS_APP_GROUP` before prebuild. The
plugin derives the `.widgets` extension identifier, App Group entitlements, Live Activity flag,
and EAS app-extension declaration. Confirm the host and extension signing teams, App Group
capability, WidgetKit families, Live Activity, and Dynamic Island in Xcode. This cannot be
compiled or archived on Windows.

iOS builds contain two app extensions, each with its own App Group, and EAS provisions both from
the generated `appExtensions` list:

| Target                  | Bundle identifier                          | App Group                                |
| ----------------------- | ------------------------------------------ | ---------------------------------------- |
| `StoneWidgetsExtension` | `<host bundle identifier>.widgets`         | `group.<host bundle identifier>.widgets` |
| `StoneShare`            | `<host bundle identifier>.share-extension` | `group.<host bundle identifier>`         |

The host app carries both groups; `apps/mobile/app.config.ts` merges them because the share plugin
otherwise replaces the list. The share extension also needs the pnpm patch in `patches/` for the
`xcode` package, which `pnpm install` applies automatically.

The supported distribution plan is the owner's private TestFlight build, not a public App Store
listing or public binary. Configure the owner's Apple Developer/EAS credentials outside Git.
Private TestFlight installation and physical-iPhone validation remain pending.

## Source and MCP

A source preview may be prepared independently of mobile binaries only after software and asset
licensing blockers are resolved. The MCP service is built with:

```sh
pnpm verify:mcp
pnpm mcp:build
```

It is a separately deployed server, not a client binary or a maintainer-hosted public endpoint.
