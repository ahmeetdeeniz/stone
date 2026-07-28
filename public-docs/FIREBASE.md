# Firebase setup

Each Stone installation uses a Firebase project controlled by its self-hoster.

## Project and clients

1. Create a Firebase project.
2. Enable Email/Password in Authentication.
3. Create Firestore and Firebase Storage.
4. Register Web, Android, and iOS clients.
5. Keep Android/iOS identifiers aligned with `apps/mobile/app.json`.
6. Copy `.env.example` to `.env` and fill every `EXPO_PUBLIC_FIREBASE_*` public client value.
7. Download `google-services.json` and `GoogleService-Info.plist` into `apps/mobile/`. Do not track
   either file.

The mobile variables are required public client identifiers:

```text
EXPO_PUBLIC_FIREBASE_API_KEY
EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN
EXPO_PUBLIC_FIREBASE_PROJECT_ID
EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET
EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
EXPO_PUBLIC_FIREBASE_APP_ID
```

For desktop, copy `apps/desktop/.env.example` to `apps/desktop/.env.local` and set:

```text
VITE_FIREBASE_API_KEY
VITE_FIREBASE_PROJECT_ID
VITE_FIREBASE_AUTH_DOMAIN
```

Vite embeds these public client values at build time. Changing local or GitHub repository
Variables does not alter an existing installer; rebuild it.

## Rules and indexes

Authenticate the Firebase CLI to your own project, review the target project ID, then deploy:

```sh
firebase use --add
firebase deploy --only firestore:rules,firestore:indexes,storage
```

The committed rules owner-scope paths and validate document/storage shape. Test them locally:

```sh
pnpm test:rules
pnpm test:storage-rules
```

Do not loosen rules to work around configuration errors. Emulator tests use the isolated
`demo-stone` project and do not need production credentials.

## Storage

Drawing sources and previews are uploaded to immutable revision paths under the authenticated
owner. Storage rules restrict names, MIME types, ownership, and a 10 MiB file limit. Firestore
stores metadata; Storage stores `.stoneink` and PNG objects.

## Credentials that never belong in clients or Git

- Firebase service-account JSON or private keys
- `GOOGLE_APPLICATION_CREDENTIALS` contents
- GitHub OAuth client secrets or access tokens
- Apple/EAS/signing credentials

Web API keys and OAuth client IDs are public identifiers, but authorization still depends on Auth
and security rules.

## Data deletion

The mobile account deletion flow attempts owner Storage cleanup before Firestore, Auth, and local
data removal. If remote cleanup fails, the account remains active so the user can retry. Before
deletion, export important data and verify the export independently. Firebase project owners may
also delete the entire self-hosted project through Firebase Console.
