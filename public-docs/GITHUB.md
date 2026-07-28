# GitHub Device Flow setup

GitHub integration is currently a Windows desktop feature.

1. Create a GitHub OAuth App under Developer settings.
2. Enable **Device Flow**.
3. Copy the public Client ID—not the client secret.
4. Put it in the ignored `apps/desktop/.env.local`:

```text
VITE_GITHUB_CLIENT_ID=replace-with-your-oauth-app-client-id
```

Stone requests the `repo` scope because private repository access and push are supported. Access
therefore follows the connected account's GitHub permissions. Use a dedicated account or restrict
repository exposure operationally if this scope is broader than you want.

The token is stored in Windows Credential Manager, not SQLite, logs, command arguments, or temp
files. Disconnect removes it. Git commands use fixed argument arrays; force push, reset, clean,
branch deletion, rebase, merge, and automatic conflict resolution are not exposed.

Run credential-free wiring checks with:

```sh
pnpm verify:github
```

The opt-in live verifier mutates a disposable repository and must never target real work:

```sh
STONE_LIVE_E2E_REPO=owner/disposable-repo pnpm verify:github:live
```

It also requires `VITE_GITHUB_CLIENT_ID`. Without both values it skips network, credential-store,
and Git mutations. Do not paste a client secret or personal access token into Stone.
