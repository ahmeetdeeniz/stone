# Security policy

## Supported versions

Stone has no supported production release yet. Only the latest reviewed public-preview commit is
eligible for best-effort security fixes; older snapshots and self-host modifications are not
supported.

## Reporting

Do not open a public issue containing a vulnerability, token, credential, private note, repository
name, Firebase project detail, or exploit instructions.

A safe private reporting route has not yet been enabled. **Before making the repository public,
the owner must enable GitHub Private Vulnerability Reporting and verify that “Report a
vulnerability” is visible in the Security tab.** Until then, there is no approved private intake
channel and public release remains gated.

Include affected commit/version, surface, reproduction steps using synthetic data, impact, and
suggested mitigation. Do not access other people's data, degrade services, persist after proof, or
publish details before coordinated resolution.

## Deployment responsibilities

Self-hosters control Firebase, OAuth apps, server credentials, signing accounts, and backups. They
must deploy the committed Firestore/Storage rules and indexes, restrict MCP redirect URIs/audience,
rotate exposed credentials, and keep service accounts out of clients.

Firebase Web API keys and OAuth client IDs are public identifiers, not authorization secrets.
Service-account keys, OAuth client secrets, access/refresh tokens, signing keys, Apple/EAS
credentials, and MCP private keys must never appear in Git, issues, logs, screenshots, or client
bundles.

Stone uses transport security and owner-scoped rules but does not provide end-to-end encryption or
encrypted exports. Firebase project administrators can access project data.
