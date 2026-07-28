# Self-hosted builds

## Windows preview installer

For local development:

```sh
pnpm desktop:dev
pnpm desktop:build
```

For a native NSIS installer on Windows:

```sh
pnpm desktop:tauri:build:nsis
```

The `Desktop Windows Release` workflow also builds NSIS on `workflow_dispatch` or a `v*.*.*` tag.
It accepts only public client identifiers through repository **Variables**, reports configured vs.
missing status without values, creates SHA-256 files, and retains the workflow artifact for 30
days. It does not publish a GitHub Release or sign the installer. The artifact name is
`stone-desktop-windows-nsis`.

The workflow has previously produced an installer that was downloaded, installed, and launched,
but each release candidate still needs checksum, reputation/signing, and smoke review.

## Android

Use a Development Build, not Expo Go:

```sh
pnpm verify:native-dependencies
pnpm mobile:android
```

For EAS, configure ignored Firebase native files as sensitive file variables
`GOOGLE_SERVICES_JSON` and `GOOGLE_SERVICE_INFO_PLIST`, then:

```sh
pnpm eas:android:development
```

A public Android artifact is not currently approved. Generate a personally signed APK only after
reviewing package ID, Firebase project, signing key custody, and testing the exact APK on a physical
device. That physical signed-APK acceptance remains pending.

## iOS

iOS native work requires macOS/Xcode:

```sh
pnpm mobile:ios
```

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
