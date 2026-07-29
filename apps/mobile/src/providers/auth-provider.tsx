import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import { AppState } from "react-native";
import type { AuthService, AuthUser } from "../infrastructure/firebase/auth";
import { createFirebaseAuthService } from "../infrastructure/firebase/auth";
import { useI18n } from "../i18n/provider";

interface AuthContextValue {
  status: "loading" | "ready" | "error";
  user: AuthUser | null;
  error: string | null;
  service: AuthService | null;
}

interface AuthProviderProps extends PropsWithChildren {
  onUserChanged?: (user: AuthUser | null) => void | Promise<void>;
  onSyncRequested?: (ownerId: string) => void | Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children, onUserChanged, onSyncRequested }: AuthProviderProps) {
  const { t } = useI18n();
  const [service, setService] = useState<AuthService | null>(null);
  const [status, setStatus] = useState<AuthContextValue["status"]>("loading");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [error, setError] = useState<string | null>(null);
  const currentUserRef = useRef<AuthUser | null>(null);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    try {
      const nextService = createFirebaseAuthService();
      setService(nextService);
      unsubscribe = nextService.subscribe((nextUser) => {
        currentUserRef.current = nextUser;
        setUser(nextUser);
        setStatus("ready");
        void Promise.resolve(onUserChanged?.(nextUser))
          .then(() => (nextUser ? onSyncRequested?.(nextUser.uid) : undefined))
          .catch(() => setError(t("app.unknownError")));
      });
    } catch {
      setStatus("error");
      setError(t("auth.firebaseUnavailable"));
    }
    return () => unsubscribe?.();
  }, [onSyncRequested, onUserChanged, t]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active" && currentUserRef.current) {
        void Promise.resolve(onSyncRequested?.(currentUserRef.current.uid)).catch(() =>
          setError(t("app.unknownError")),
        );
      }
    });
    return () => subscription.remove();
  }, [onSyncRequested, t]);

  const value = useMemo(() => ({ status, user, error, service }), [error, service, status, user]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
