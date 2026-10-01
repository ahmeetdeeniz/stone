import auth, { type FirebaseAuthTypes } from "@react-native-firebase/auth";
import { AuthError } from "@stone/domain";
import { assertFirebaseConfigured } from "./config";

export interface AuthUser {
  uid: string;
  email: string | null;
}

export interface AuthService {
  subscribe(listener: (user: AuthUser | null) => void): () => void;
  signIn(email: string, password: string): Promise<AuthUser>;
  signUp(email: string, password: string): Promise<AuthUser>;
  sendPasswordReset(email: string): Promise<void>;
  signOut(): Promise<void>;
  deleteAccount(): Promise<void>;
}

function mapUser(user: FirebaseAuthTypes.User): AuthUser {
  return { uid: user.uid, email: user.email };
}

export function createFirebaseAuthService(): AuthService {
  assertFirebaseConfigured();
  const instance = auth();
  return {
    subscribe(listener) {
      return instance.onAuthStateChanged((user) => listener(user ? mapUser(user) : null));
    },
    async signIn(email, password) {
      try {
        const result = await instance.signInWithEmailAndPassword(email.trim(), password);
        return mapUser(result.user);
      } catch (error) {
        throw toAuthFailure(error);
      }
    },
    async signUp(email, password) {
      try {
        const result = await instance.createUserWithEmailAndPassword(email.trim(), password);
        return mapUser(result.user);
      } catch (error) {
        throw toAuthFailure(error);
      }
    },
    async sendPasswordReset(email) {
      try {
        await instance.sendPasswordResetEmail(email.trim());
      } catch (error) {
        throw toAuthFailure(error);
      }
    },
    async signOut() {
      try {
        await instance.signOut();
      } catch (error) {
        throw toAuthFailure(error);
      }
    },
    async deleteAccount() {
      try {
        const currentUser = instance.currentUser;
        if (!currentUser) throw new AuthFailure("noUser");
        await currentUser.delete();
      } catch (error) {
        throw toAuthFailure(error);
      }
    },
  };
}

export type AuthFailureReason =
  | "invalidCredential"
  | "emailInUse"
  | "invalidEmail"
  | "weakPassword"
  | "tooManyRequests"
  | "requiresRecentLogin"
  | "network"
  | "noUser";

/** An auth failure with a stable reason the UI translates (see `auth.error.*` keys). */
export class AuthFailure extends AuthError {
  public constructor(public readonly reason: AuthFailureReason | null) {
    super(reason ? `Authentication failed: ${reason}.` : "Authentication failed.");
  }
}

const reasonsByFirebaseCode: Readonly<Record<string, AuthFailureReason>> = {
  "auth/invalid-credential": "invalidCredential",
  "auth/wrong-password": "invalidCredential",
  "auth/user-not-found": "invalidCredential",
  "auth/email-already-in-use": "emailInUse",
  "auth/invalid-email": "invalidEmail",
  "auth/weak-password": "weakPassword",
  "auth/too-many-requests": "tooManyRequests",
  "auth/requires-recent-login": "requiresRecentLogin",
  "auth/network-request-failed": "network",
};

export function toAuthFailure(error: unknown): AuthFailure {
  if (error instanceof AuthFailure) return error;
  const code =
    typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  return new AuthFailure(reasonsByFirebaseCode[code] ?? null);
}

/** Translation key for a caught auth error, or the screen's generic fallback key. */
export function authErrorKey<Fallback extends string>(
  error: unknown,
  fallback: Fallback,
): `auth.error.${AuthFailureReason}` | Fallback {
  return error instanceof AuthFailure && error.reason ? `auth.error.${error.reason}` : fallback;
}
