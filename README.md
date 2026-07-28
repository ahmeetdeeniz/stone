# Stone

**A calm, personal Markdown workspace for notes, tasks, projects, ink, and recovery across your own devices.**

> **Public preview.** Automated source and clean-clone gates pass. Physical Android/iPhone/tablet,
> final accessibility, and live credential-restart checks remain pending; binary distribution
> requires its own candidate-specific validation.

Stone keeps canonical text as portable Markdown while adding local project tracking, Today
summaries, revision/conflict recovery, and editable `.stoneink` drawings. It is designed for one
person—not teams, shared databases, or real-time collaboration—and uses infrastructure controlled
by the self-hoster.

Stone does **not** provide a shared public backend. Every installation connects to its owner's
Firebase project and, optionally, GitHub OAuth App and separately deployed MCP service.

## Why Stone

- **Markdown stays Markdown.** Notes and project metadata remain exportable instead of becoming a
  proprietary rich-text document.
- **Local work comes first on mobile.** SQLite, durable drafts, an outbox, revisions, soft delete,
  and explicit conflict handling protect edits when the network is unavailable.
- **Projects live beside notes.** Portable frontmatter and task metadata drive project, version,
  blocker, Kanban, and Today views.
- **Planning works offline.** Standalone and Markdown-backed tasks coexist with due dates, priority,
  subtasks, recurrence and project relationships.
- **Calendar planning stays local-first.** Standalone events and task time blocks remain distinct
  from due dates, with timezone-aware storage and bounded recurrence.
- **Ink remains editable.** Hybrid notes use a normal PNG reference plus an ignorable link to the
  vector `.stoneink` source.
- **You own the services.** Firebase, GitHub access, signing accounts, and MCP deployment belong to
  the self-hoster.

## Product tour

No screenshots are committed yet because this environment did not complete the final
privacy/accessibility capture pass. The exact owner capture list is in
[the release checklist](public-docs/RELEASE-CHECKLIST.md#product-screenshots); mock images are not
presented as product evidence.

## Current capabilities

### Markdown workspace

- CodeMirror 6 Live Preview editing, search, formatting, tables, code, callouts, task lists, and
  source-preserving frontmatter
- Local note creation, rename, pin, full-text search, import/export, trash, drafts, and revisions
- Turkish/Unicode content and valid `.md` / `.markdown` round trips

### Projects and Today

- Markdown-backed projects, versions, release checklists, decisions, blockers, priorities, dates,
  progress, Kanban, and Today ranking on mobile
- Read-only project/version/blocker summaries and Today navigation on Windows

### Tasks and planning

- Standalone tasks on mobile and Windows with offline creation, editing, completion/reopen,
  soft-delete, priority, due date/time, tags, estimates, project links, search and planning filters
- Ordered mobile subtasks plus deterministic daily, weekday, weekly and monthly recurrence;
  completed occurrences are preserved and the next occurrence is a separate idempotent record
- Portable Markdown task lists are indexed after note saves; fenced code is excluded, and a linked
  completion updates only the source checkbox
- Today combines due, overdue and project work; Upcoming, Overdue, Completed and project-filtered
  views use indexed local data

### Ink, sync, and recovery

- Pressure-aware pen/highlighter strokes and vector shapes in `.stoneink`, with PNG previews
- Firebase Auth, Firestore, and Storage sync using owner-scoped rules
- Durable local-first mobile writes, revision history, soft delete, and explicit conflict handling
- Versioned full-workspace export container; full-workspace restore UI is not implemented

### Calendar and Agenda

- Mobile day Agenda and quick event creation; Windows calendar workspace with day navigation,
  Agenda, date jump and task scheduling
- One task can have multiple scheduled work blocks without changing its due date or completion;
  removing a block does not delete the task
- UTC instants plus intended IANA timezone for timed events; date-only inclusive boundaries for
  all-day events; deterministic DST gap/repeated-hour handling
- Bounded daily, weekday, weekly, monthly and custom recurrence with stable occurrence identities
  and exceptions in the shared domain
- Workspace JSON and standards-conscious `.ics` import/export subset for basic VEVENT, all-day,
  supported recurrence and cancellation dates
- No native reminders, external calendar accounts, invitations, focus timer or widgets

### Desktop, GitHub, and MCP

- Windows/Tauri Markdown editing, linked local files, external-change detection, and credential
  storage through Windows Credential Manager
- GitHub Device Flow, repository listing/linking, clone, pull, status, reviewed commit/push, and
  restore; destructive Git operations are intentionally excluded
- Provider-neutral remote MCP service with OAuth, scoped tools, revisions, idempotency, audit
  records and bounded task CRUD/Today/Overdue tools; deployment/provider publication is
  operator-owned

## Platform and parity

| Surface       | Implemented                                                 | Automated evidence                                       | Manual status / limits                                                      |
| ------------- | ----------------------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------- |
| Windows 10/11 | Editor, local files, sync, project summaries, Today, GitHub | Tests, web build, Rust checks, prior NSIS install/launch | Final visual/accessibility pass and live credential restart recheck pending |
| Android       | Full mobile workspace, projects, sync, ink                  | Expo Doctor/export and unit/integration/rules tests      | Signed APK on a physical device pending                                     |
| iOS           | Same React Native mobile implementation                     | Expo Doctor/iOS export                                   | Native private TestFlight and physical iPhone validation pending            |
| Tablet/stylus | Responsive ink implementation                               | Schema, gesture, persistence, and large-fixture tests    | Physical Android tablet/iPad stylus validation pending                      |
| MCP           | Provider-neutral server contract                            | Typecheck, tests, verifier, build                        | Hosting, credentials, and provider connection are operator tasks            |

“Implemented” does not mean production-certified. Windows lacks mobile project editing/Kanban,
drawing, trash, revision, and conflict UI parity. macOS/Linux desktop apps are not supported.

## Quick start

Requirements: Node.js 22+, pnpm 11.17.0, Git, and platform toolchains only for native builds.

```sh
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
```

Unconfigured client builds are supported: desktop sign-in shows a clear configuration error, while
mobile native Firebase use requires your own public client config and native Firebase files.

- [Development and self-hosting setup](public-docs/SELF-HOSTING.md)
- [Firebase, Firestore, Storage, rules, and deletion](public-docs/FIREBASE.md)
- [Windows, Android, and private iOS builds](public-docs/BUILDS.md)
- [GitHub Device Flow](public-docs/GITHUB.md)
- [MCP setup](services/mcp/README.md)
- [Backup, export, restore, updates, and troubleshooting](public-docs/OPERATIONS.md)

## Bring your own Firebase

Stone uses Firebase Email/Password Auth, Firestore, and Storage. Copy the mobile
[`.env.example`](.env.example), use public Web client identifiers from **your** Firebase project,
and supply ignored native config files for Development Builds. Deploy this repository's rules and
indexes before using real data.

Firebase Web API keys and app/client IDs are public identifiers embedded in client applications;
they are not authorization. Never commit a service-account JSON, OAuth client secret, access or
refresh token, signing key, provisioning profile, Apple credential, or EAS credential.

## GitHub

Windows GitHub support uses an owner-created OAuth App with Device Flow enabled and only its public
`VITE_GITHUB_CLIENT_ID`. Stone does not use a client secret or ask for a personal access token. It
requests `repo` access (needed for private repositories and push), stores the resulting token in
the OS credential store, and deletes it on disconnect. See [GitHub setup](public-docs/GITHUB.md).

## Architecture

This pnpm workspace contains:

- `apps/mobile`: React Native, Expo Development Build, Expo Router, SQLite, and React Native
  Firebase
- `apps/desktop`: Tauri 2/Rust with a Vite/React editor surface, SQLite, local Git, and Windows
  credential storage
- `packages`: platform-independent TypeScript domain, Markdown, editor, sync, and ink contracts
- `services/mcp`: separately deployed TypeScript MCP/OAuth service backed by the self-hoster's
  Firebase project

Mobile SQLite is the local source of truth. Firebase provides authenticated cross-device sync; it
is not required to edit already-local mobile data. Desktop has a distinct implementation and does
not claim complete mobile parity.

## Privacy and security

User content lives in local application storage and, when sync is configured, the owner's Firebase
project. GitHub tokens and desktop Firebase refresh tokens use the Windows credential store; mobile
device identity uses secure storage. Transport security and Firebase owner rules are enforced, but
Stone does not currently provide end-to-end encryption or encrypted exports. Firebase operators
can access data through their project administration surface.

Read [SECURITY.md](SECURITY.md) before deployment or vulnerability reporting. Do not put secrets or
private notes in public issues.

## Preview limitations

- Final visual/accessibility inspection, real Firebase/GitHub restart flows, signed Android
  physical-device use, private TestFlight/iPhone use, and tablet stylus validation remain open.
- Mobile full-workspace restore UI, public iOS binaries, macOS/Linux desktop, and a maintainer-hosted
  backend are not available.
- MCP hosting and provider publication are not automatic.
- Due times and calendar records do not schedule operating-system notifications.
- Calendar recurrence editing UI, polished overlap/resize/drag interactions, focus
  timers/analytics and native widgets remain incomplete.

## Roadmap

Possible post-preview directions include richer calendar interaction, reminder notifications, a
focus timer, Android/iOS widgets, improved tablet layouts, and richer revision restore. They are not
implemented commitments.

## Contributing, support, and license

Read [CONTRIBUTING.md](CONTRIBUTING.md), [SUPPORT.md](SUPPORT.md), and
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Security reports follow [SECURITY.md](SECURITY.md).

Stone source code is available under the [MIT License](LICENSE), copyright (c) 2026 ahmeetdeeniz.
Third-party dependencies and assets remain under their own licenses; see
[third-party notices](THIRD_PARTY_NOTICES.md).
