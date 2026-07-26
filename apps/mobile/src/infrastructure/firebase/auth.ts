import auth, { type FirebaseAuthTypes } from "@react-native-firebase/auth";
import { AuthError } from "@stone/domain";
import { getFirebaseConfig } from "./config";

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
  getFirebaseConfig();
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
        throw new AuthError(toAuthMessage(error));
      }
    },
    async signUp(email, password) {
      try {
        const result = await instance.createUserWithEmailAndPassword(email.trim(), password);
        return mapUser(result.user);
      } catch (error) {
        throw new AuthError(toAuthMessage(error));
      }
    },
    async sendPasswordReset(email) {
      try {
        await instance.sendPasswordResetEmail(email.trim());
      } catch (error) {
        throw new AuthError(toAuthMessage(error));
      }
    },
    async signOut() {
      try {
        await instance.signOut();
      } catch (error) {
        throw new AuthError(toAuthMessage(error));
      }
    },
    async deleteAccount() {
      try {
        const currentUser = instance.currentUser;
        if (!currentUser) throw new AuthError("Aktif kullanıcı bulunamadı.");
        await currentUser.delete();
      } catch (error) {
        if (error instanceof AuthError) throw error;
        throw new AuthError(toAuthMessage(error));
      }
    },
  };
}

function toAuthMessage(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = String(error.code);
    const messages: Record<string, string> = {
      "auth/invalid-credential": "E-posta veya şifre hatalı.",
      "auth/email-already-in-use": "Bu e-posta zaten kullanılıyor.",
      "auth/invalid-email": "Geçerli bir e-posta adresi girin.",
      "auth/weak-password": "Şifre en az altı karakter olmalı.",
      "auth/too-many-requests": "Çok fazla deneme yapıldı. Daha sonra tekrar deneyin.",
      "auth/requires-recent-login": "Bu işlem için yeniden giriş yapmanız gerekiyor.",
    };
    return messages[code] ?? "Kimlik doğrulama tamamlanamadı.";
  }
  return "Kimlik doğrulama tamamlanamadı.";
}
