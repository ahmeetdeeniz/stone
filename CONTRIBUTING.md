# Contributing to Stone

Stone is a personal, local-first Markdown workspace and a public-preview candidate. Before opening
a pull request, read the README limitations and `PUBLIC-RELEASE-READINESS.md`.

## Development

Use Node.js 22+ and pnpm 11.17.0:

```sh
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm verify:public-boundary
```

Run affected platform checks from `public-docs/SELF-HOSTING.md`. Native Android work needs a
Development Build and Android tooling; iOS needs macOS/Xcode; native Windows packaging needs Rust
MSVC/Visual C++ Build Tools/WebView2. Never report an unavailable manual test as passed.

## Change boundaries

- Preserve canonical Markdown and unknown frontmatter. Do not replace it with HTML or proprietary
  editor JSON.
- Keep platform-independent domain/Markdown behavior in shared TypeScript packages.
- UI components must use use-case/repository boundaries rather than direct data access.
- Preserve durable local writes, soft delete, revision/conflict protection, and offline behavior.
- Keep changes focused, strict, and typed. Do not use `any`, `@ts-ignore`, disabled lint rules, test
  skips, production mocks, or swallowed errors.
- Do not add unplanned v1 features or team/collaboration behavior.

## Public boundary and secrets

`docs/`, `goals/`, `AGENTS.md`, `PLAN.md`, and `PROGRESS.md` are intentionally private. Put public
documentation in root files, `.github/`, or `public-docs/`. Run:

```sh
pnpm verify:public-boundary
```

Never commit `.env`, Firebase native config/service accounts, access or refresh tokens, OAuth
client secrets, signing/Apple/EAS credentials, real user content, or private repository data. Use
synthetic `.example.test` identities and unmistakable placeholders in tests.

## Pull requests

- Create a focused branch and descriptive English commit messages.
- Add tests for behavior changes and run the affected checkpoint after each coherent change.
- Update public docs and `CHANGELOG.md` for user-visible behavior.
- Complete the pull-request template, including manual gaps and data/migration risk.
- Do not force-push shared branches, rewrite history, publish tags/releases, or change repository
  settings as part of an ordinary contribution.

The repository does not yet have an owner-approved license; contributions cannot be accepted for a
public project until the owner establishes software and contribution licensing terms.
