# Changelog

All notable public-preview changes will be documented here. Stone has not published a release or
tag, so no release date or semantic version is claimed.

## Unreleased

- Inter now ships with the app everywhere: the desktop app bundles it and the mobile note editor
  embeds it, so neither falls back to a system font (Segoe UI, Roboto) when Inter isn't
  installed. Screen headings read their face from one token, ready for a licensed display font.
- The mobile note editor's bundled script is regenerated from current sources; it had fallen
  behind the attachment helpers added to `@stone/markdown`.
- Added local reminders on mobile for tasks with a due date and upcoming calendar events, with a
  configurable lead time, an all-day reminder time, and Complete/Snooze notification actions.
- Desktop Rust now builds, lints (`clippy -D warnings`) and tests on Linux CI.
- Added full workspace restore on mobile: an export is re-imported into the signed-in account
  (notes, projects rebuilt from their frontmatter, versions, tasks, drawings, calendar and focus
  history), adding only what is missing and starting every record at revision 1 so it syncs.
- Added natural-language quick add (English/Turkish): relative days, weekdays, dates, times,
  `#tags`, `!priority` and `@project` are parsed with a live preview.
- Added `[[wiki links]]` with backlinks, note templates and a daily note, and a global search
  screen across notes, tasks, projects and calendar items.
- Added a weekly review screen and read-only iCalendar feed subscriptions on mobile.
- Added sharing into Stone from other apps (iOS share extension, Android share target): text and
  links are filed into an Inbox note as tasks.
- Windows can now create and edit projects (the synced project entity and its Project.md, like
  mobile), move notes to Trash and restore them, browse and restore earlier note versions, and
  resolve sync conflicts (keep mine, keep theirs, or a three-way Markdown merge) without a phone.
- Desktop builds for macOS (universal DMG) and Linux (.deb and AppImage) alongside Windows, with
  optional Developer ID signing/notarization and signed in-app auto-updates (Settings → Updates)
  published through draft GitHub releases.
- `pnpm setup:self-host` walks a self-hoster through connecting their own Firebase project
  (desktop env, `.firebaserc`, app identifiers, native config checks, next steps) and
  `pnpm doctor:self-host` re-checks it; Maestro smoke flows cover launch, sign-in and note creation.
- Drawings are now multi-page notebooks for handwritten lecture notes: A4 pages or one endless
  page, lined/grid/dotted/Cornell/blank paper, a page rail on tablets, pressure-sensitive strokes
  that render live while writing, pen-only mode where fingers scroll and pinch-zoom, lasso
  select/resize, a one-step eraser undo and a two-finger-tap undo. Existing drawings open as a
  one-page notebook. Notebooks get their own shelf on the Notes tab.
- Fixed the S Pen being ignored in pen-only mode (the stylus pointer type was compared against
  the mouse value) and pen pressure always reading as full, and fixed strokes landing in the
  wrong place after zooming or panning.
- On tablets in landscape (1000 dp and wider) the Notes tab is a split view: the list stays on
  the left and the open note or notebook fills the right. Switching items saves pending edits
  first, and rotating to portrait opens the current item full screen.
- Added note attachments on mobile and desktop: images (PNG, JPEG, GIF, WebP, HEIC) and PDFs up
  to 20 MB are stored under their SHA-256, linked from the note with portable Markdown, uploaded
  to the owner's Firebase Storage on sync and downloaded when a note is opened elsewhere. They are
  included in workspace export/restore and removed with the account.
- Optional, per-device Crashlytics crash reporting (off by default, Settings → Diagnostics &
  updates) and EAS over-the-air updates with per-profile channels and fingerprint runtime
  versions (`pnpm update:preview` / `pnpm update:production`).
- Added local-first Android Glance and iOS WidgetKit Today, Agenda, Focus, and Quick Capture
  widgets, an optional Android focus notification, and iOS Live Activity/Dynamic Island sources.
- Added bounded versioned snapshot/action bridges, validated deep links, revision-safe actions,
  counts-only default privacy, and native English/Turkish resources.

### Fixed

- Timezone conversions reuse one formatter per zone (about 25x faster on large task lists), and
  deep links/notification taps wait for the root navigator instead of navigating too early.
- Adding a finished focus session (manual entry or restored history) no longer fails while a
  timer is running, and calendar/focus restore no longer produces records the sync rules reject.
- Today uses the device's calendar day instead of UTC, which showed yesterday for several hours
  after midnight east of UTC.
- Tapping a Markdown link in the editor did nothing (the rendered label was not an anchor); links
  now open, and only `http(s)`, `mailto` and `tel` URLs are handed to the system.
- The widget config plugin no longer replaces the host app's App Group list or other plugins'
  EAS app-extension declarations.
- Editing a mobile project, version or pinned note on Windows no longer strips its `kind`,
  `projectId`, `isPinned` and other fields it does not edit, and remote changes no longer overwrite
  a note that has an open conflict. Synced notes with workspace paths are no longer treated as
  missing linked files.
- Mobile startup no longer races two database initialisations (which could leave the app on an
  error screen), shows the real error with a retry, builds workspace packages before
  start/export/EAS, relies on native Firebase config, and targets iOS 16.1 for the widget module.
- Windows edits now reach mobile: desktop sync writes the `syncEvents` log atomically with each
  entity, completes note payloads required by the rules, refreshes the Firebase ID token, follows
  Firestore pagination, and parks rule-rejected events instead of stopping sync.
- Mobile sync runs once at a time per account, drains the whole outbox in one run, writes device
  presence at most every six hours, and applies the saved theme at launch.
- Desktop builds keep the branded icons instead of overwriting them, and "Open in VS Code/Codex"
  works with the Windows `.cmd` launchers.
- Native widgets, the Android focus notification and the iOS Live Activity now receive data: the
  bridge looked the Expo module up in React Native's `NativeModules`, where it never exists.
  Unchanged widget snapshots are no longer rewritten (and iOS timelines no longer reloaded) every
  minute.
- Windows sync reads the `syncEvents` log incrementally from a stored cursor after the first full
  pull, applies permanent deletions and soft-deleted notes from other devices.
- Sign-in, sign-up, reset and account errors show a translated reason (wrong password, email in
  use, offline, ...) instead of a generic message or hardcoded Turkish.
- The MCP OAuth sign-in is rate limited per client and per account, cannot be framed, and limiter
  memory is bounded; `MCP_TRUST_PROXY` keys limits on the real client behind a proxy.

### Added

- Local-first stopwatch, countdown and Pomodoro focus tracking across mobile and Windows, durable
  pause/resume state, manual history, task/project/document/calendar links, offline goals,
  timezone-aware overlap-safe productivity analytics, Firestore sync/rules, workspace export, and
  twelve owner-scoped revision-safe MCP tools.

- English-default internationalization with bundled Turkish across mobile and Windows, pre-auth
  System/English/Türkçe preference, locale-aware date/number/duration/recurrence presentation, and
  CI verification for resource parity, interpolation parameters, duplicate keys, and selected UI
  hardcoded-copy boundaries.

- Local-first calendar records and scheduled task blocks, timezone/DST-safe domain logic, bounded
  recurrence/occurrence exceptions and explicit edit scopes, mobile Agenda/week navigation,
  Windows month/week/day/Agenda with drag/move/resize, Firebase rules, workspace-calendar and
  reviewed ICS import/export, and revision-safe provider-neutral MCP tools.

- Local-first Tasks & Planning Core across mobile and Windows: standalone and Markdown-backed
  tasks, recurrence, subtasks, project links, Today/Upcoming/Overdue/Completed views, Firebase sync,
  workspace export, owner-scoped MCP tools and security-rule coverage.

- React Native/Expo mobile Markdown workspace with SQLite local-first persistence, Firebase sync,
  projects/Today, revision/conflict recovery, and hybrid `.stoneink` drawings.
- Windows/Tauri Markdown workspace with local files, project/Today summaries, Firebase session
  storage, GitHub Device Flow, repository workflows, and restore.
- Provider-neutral MCP/OAuth service with scoped tools, revisions, idempotency, and audit records.
- Public self-hosting, security, support, contribution, build, operations, and release-readiness
  documentation.
- MPL-2.0 licensing and a redistribution-safe public visual asset boundary using Inter, mobile
  Ionicons, and desktop system-text glyphs.

### Known limitations

- Physical Android/iPhone/tablet, private TestFlight, final visual/accessibility, and live
  credential-restart acceptance remain pending.
- Desktop does not provide complete mobile project/drawing/recovery parity.
- Task due times and events do not schedule native reminder notifications. Full-workspace restore
  beyond supported workspace data and Agenda virtualization remain planned rather than implemented.
