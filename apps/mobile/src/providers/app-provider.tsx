import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type PropsWithChildren,
} from "react";
import { ThemeProvider } from "../design/theme";
import { LoadingState } from "../components/states";
import { ErrorState } from "../components/states";
import type { AuthUser } from "../infrastructure/firebase/auth";
import { getAppServices, type AppServices } from "../services/composition-root";
import { AuthProvider } from "./auth-provider";
import { registerBackgroundSync } from "../services/background-sync";
import { WidgetLifecycle } from "../widgets/widget-lifecycle";
import { NativeDeepLinkRouter } from "../widgets/native-deep-links";
import { useI18n } from "../i18n/provider";

export function AppProvider({ children }: PropsWithChildren) {
  const { t } = useI18n();
  const [services, setServices] = useState<AppServices | null>(null);
  const [error, setError] = useState<{ message: string | null } | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    void getAppServices()
      .then((nextServices) => {
        if (!active) return;
        setServices(nextServices);
        void registerBackgroundSync().catch(() => undefined);
      })
      .catch((reason: unknown) => {
        if (active) setError({ message: reason instanceof Error ? reason.message : null });
      });
    return () => {
      active = false;
    };
  }, [attempt]);
  const retry = useCallback(() => {
    setError(null);
    setAttempt((value) => value + 1);
  }, []);
  const bindDeviceOwner = useCallback(
    (user: AuthUser | null) =>
      services && user ? services.device.bindOwner(services.deviceId, user.uid) : undefined,
    [services],
  );
  const syncOwner = useCallback(
    (ownerId: string) => (services ? services.sync(ownerId).then(() => undefined) : undefined),
    [services],
  );
  return (
    <ThemeProvider>
      {services ? (
        <AppServicesContext.Provider value={services}>
          <AuthProvider onUserChanged={bindDeviceOwner} onSyncRequested={syncOwner}>
            <WidgetLifecycle />
            <NativeDeepLinkRouter />
            {children}
          </AuthProvider>
        </AppServicesContext.Provider>
      ) : error ? (
        <ErrorState message={error.message ?? t("app.unknownError")} onRetry={retry} />
      ) : (
        <LoadingState label={t("app.loading")} />
      )}
    </ThemeProvider>
  );
}

const AppServicesContext = createContext<AppServices | null>(null);

export function useAppServices(): AppServices {
  const value = useContext(AppServicesContext);
  if (!value) throw new Error("useAppServices must be used inside AppProvider");
  return value;
}
