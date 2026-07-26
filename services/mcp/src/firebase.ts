import { applicationDefault, cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { McpUnauthorizedError } from "./contracts.js";

export interface FirebaseRuntime {
  app: App;
  auth: Auth;
  firestore: Firestore;
}

export function createFirebaseRuntime(): FirebaseRuntime {
  const app = getApps()[0] ?? initializeApp(firebaseOptions());
  return { app, auth: getAuth(app), firestore: getFirestore(app) };
}

export class FirebasePasswordAuthenticator {
  public constructor(
    private readonly webApiKey: string,
    private readonly auth: Auth,
  ) {}

  public async authenticate(email: string, password: string): Promise<{ userId: string }> {
    const response = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(this.webApiKey)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password, returnSecureToken: true }),
      },
    );
    if (!response.ok) throw new McpUnauthorizedError("Email or password was rejected.");
    const payload = (await response.json()) as { idToken?: string };
    if (!payload.idToken) throw new McpUnauthorizedError("Firebase did not return an ID token.");
    const token = await this.auth.verifyIdToken(payload.idToken);
    return { userId: token.uid };
  }
}

function firebaseOptions(): Record<string, string> {
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (serviceAccountJson) {
    const account = JSON.parse(serviceAccountJson) as {
      project_id?: string;
      client_email?: string;
      private_key?: string;
    };
    if (!account.project_id || !account.client_email || !account.private_key)
      throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is incomplete.");
    return {
      credential: cert({
        projectId: account.project_id,
        clientEmail: account.client_email,
        privateKey: account.private_key.replace(/\\n/gu, "\n"),
      }),
    } as unknown as Record<string, string>;
  }
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.K_SERVICE)
    return { credential: applicationDefault() } as unknown as Record<string, string>;
  return { projectId: process.env.FIREBASE_PROJECT_ID ?? "stone-development" };
}
