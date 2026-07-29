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
import { createAppServices, type AppServices } from "../services/composition-root";
import { AuthProvider } from "./auth-provider";
import { registerBackgroundSync } from "../services/background-sync";
import { WidgetLifecycle } from "../widgets/widget-lifecycle";
import { NativeDeepLinkRouter } from "../widgets/native-deep-links";

export function AppProvider({ children }: PropsWithChildren) {
  const [services, setServices] = useState<AppServices | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void createAppServices()
      .then((nextServices) => {
        setServices(nextServices);
        void registerBackgroundSync().catch(() => undefined);
      })
      .catch((caught: unknown) =>
        setError(caught instanceof Error ? caught.message : "Yerel altyapı başlatılamadı."),
      );
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
        <ErrorState message={error} />
      ) : (
        <LoadingState label="Stone hazırlanıyor" />
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
