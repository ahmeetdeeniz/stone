# Changelog

All notable public-preview changes will be documented here. Stone has not published a release or
tag, so no release date or semantic version is claimed.

## Unreleased

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
- MIT licensing and a redistribution-safe public visual asset boundary using Inter, mobile
  Ionicons, and desktop system-text glyphs.

### Known limitations

- Physical Android/iPhone/tablet, private TestFlight, final visual/accessibility, and live
  credential-restart acceptance remain pending.
- Desktop does not provide complete mobile project/drawing/recovery parity.
- Task due times, events, and focus completion do not schedule native notifications.
  Full-workspace restore beyond supported workspace data, Agenda virtualization, and native
  widgets remain planned rather than implemented.
