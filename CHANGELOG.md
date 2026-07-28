# Changelog

All notable public-preview changes will be documented here. Stone has not published a release or
tag, so no release date or semantic version is claimed.

## Unreleased

### Added

- Local-first calendar records and scheduled task blocks, timezone/DST-safe domain logic, bounded
  recurrence/occurrence exceptions, mobile Agenda, Windows planning workspace, Firebase rules,
  workspace/ICS export and revision-safe provider-neutral MCP tools.

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
- Task due times and events do not schedule native notifications. Advanced calendar interaction,
  focus analytics and native widgets remain planned rather than implemented.
