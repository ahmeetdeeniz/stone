# Native widgets and live focus

Stone ships native surfaces through the local `@stone/native-widgets` Expo module. These surfaces
require an Expo development build or a release build; they do not run in Expo Go.

## Surfaces

- Android Glance: Today Tasks, Agenda, Focus, and Quick Capture widgets.
- Android: an optional low-importance ongoing focus notification. Android 13 and newer ask for
  notification permission in Settings; denying it does not stop a focus session.
- iOS WidgetKit: Today Tasks, Agenda, Focus, and Quick Capture families.
- iOS ActivityKit: a lock-screen Live Activity and Dynamic Island compact, expanded, and minimal
  focus presentations.

Quick actions and widget rows open validated `stone://` routes. Interactive task and focus actions
enter a bounded, versioned native queue and are applied by the same local domain use cases as
in-app actions. Revision and idempotency checks prevent a delayed action from silently overwriting
newer state.

## Local-first and privacy boundary

The widget bridge receives a small, versioned projection, never the SQLite database or note
Markdown. It contains at most eight tasks and eight agenda items. It contains no Firebase/GitHub
token, API key, encryption key, password, credential, or note body. Native code has no Firebase
dependency and does not poll the network.

The default `counts_only` setting keeps titles and project context off external surfaces.
`titles` and `titles_and_context` are explicit opt-ins. Logging out or deleting the account clears
the native snapshot, action queue, Android notification, and local Live Activity. Corrupt,
unsupported, logged-out, or stale snapshots render a safe unavailable/stale state instead of
displaying untrusted data.

Focus time is derived from persisted timestamps and pause accumulation. JavaScript does not write
the bridge every second. Widget refreshes are event-driven with a conservative foreground refresh.

## Identifiers and build configuration

Set these values when the defaults do not match the deployment:

```text
STONE_IOS_BUNDLE_IDENTIFIER=com.example.stone
STONE_ANDROID_PACKAGE=com.example.stone
STONE_IOS_APP_GROUP=group.com.example.stone.widgets
```

The iOS extension identifier is `<host bundle identifier>.widgets`. The config plugin adds the App
Group entitlement, Live Activity capability declaration, extension target sources, and the EAS
`appExtensions` declaration. It deliberately does not hard-code an Apple Team ID.

Run `pnpm verify:widgets` for contract, resource-parity, identifier, native-source, and export
boundary checks. Final release acceptance still requires the device checklist on physical Android
and iOS devices, plus an Xcode archive/signing check on macOS.
