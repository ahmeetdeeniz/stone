# Operations: backup, updates, and troubleshooting

## Backup and restore

Mobile can export:

- individual portable Markdown notes;
- project Markdown files;
- a versioned `.stone-workspace.json` container with relative paths, UTF-8/base64 encoding, MIME
  types, Markdown, `.stoneink`, and PNG data.

Keep exports outside the device and test that they open before destructive actions. The workspace
container parser validates schema, duplicate/traversal paths, and base64, but the app does not yet
provide a full-workspace restore UI. Individual Markdown import is available and copies into the
Stone library without modifying the source file.

GitHub restore is for linked code repositories, not a substitute for Stone note/database backups.
Firebase is a sync backend, not the only backup.

## Updating

1. Export important data and record the installed commit/version.
2. Review `CHANGELOG.md`, known limitations, and migration notes.
3. Pull the desired source revision without rewriting local history.
4. Run `pnpm install --frozen-lockfile` and the validation matrix.
5. Rebuild clients; Vite/Expo configuration is compiled into artifacts.
6. Deploy updated Firebase rules/indexes to the correct owner project.
7. Smoke-test sign-in, an offline edit, sync, export, and restart before removing the old build.

Never reuse another maintainer's Firebase or signing credentials.

## Troubleshooting

- **Desktop says Firebase is not configured:** create `apps/desktop/.env.local`, fill the three
  `VITE_FIREBASE_*` client values, and rebuild/restart.
- **Mobile Firebase startup error:** fill every `EXPO_PUBLIC_FIREBASE_*` value, add matching native
  config files, and use a Development Build.
- **Permission denied:** confirm authentication, deployed owner-scoped rules, project ID, and
  application identifiers. Do not open the rules globally.
- **GitHub connection unavailable:** set `VITE_GITHUB_CLIENT_ID`, enable Device Flow, rebuild, and
  ensure local Git is installed.
- **MCP refuses startup:** use `services/mcp/.env.example` and provide server-only keys through the
  private deployment environment.
- **Rules tests fail to start:** install Java and allow Firebase Emulator Suite downloads.
- **Windows native build fails:** verify stable Rust MSVC, Visual C++ Build Tools, WebView2, and
  local application-control policy.

For public support boundaries, see `SUPPORT.md`.
