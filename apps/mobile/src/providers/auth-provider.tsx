import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import type { AuthService, AuthUser } from "../infrastructure/firebase/auth";
import { createFirebaseAuthService } from "../infrastructure/firebase/auth";

interface AuthContextValue {
  status: "loading" | "ready" | "error";
  user: AuthUser | null;
  error: string | null;
  service: AuthService | null;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [service, setService] = useState<AuthService | null>(null);
  const [status, setStatus] = useState<AuthContextValue["status"]>("loading");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    try {
      const nextService = createFirebaseAuthService();
      setService(nextService);
      unsubscribe = nextService.subscribe((nextUser) => {
        setUser(nextUser);
        setStatus("ready");
      });
    } catch (caught) {
      setStatus("error");
      setError(caught instanceof Error ? caught.message : "Kimlik doğrulama başlatılamadı.");
    }
    return () => unsubscribe?.();
  }, []);

  const value = useMemo(() => ({ status, user, error, service }), [error, service, status, user]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
