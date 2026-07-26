import { createContext, useContext, useEffect, useState, type PropsWithChildren } from "react";
import { ThemeProvider } from "../design/theme";
import { LoadingState } from "../components/states";
import { ErrorState } from "../components/states";
import { createAppServices, type AppServices } from "../services/composition-root";
import { AuthProvider } from "./auth-provider";

export function AppProvider({ children }: PropsWithChildren) {
  const [services, setServices] = useState<AppServices | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void createAppServices()
      .then(setServices)
      .catch((caught: unknown) =>
        setError(caught instanceof Error ? caught.message : "Yerel altyapı başlatılamadı."),
      );
  }, []);
  return (
    <ThemeProvider>
      {services ? (
        <AppServicesContext.Provider value={services}>
          <AuthProvider>{children}</AuthProvider>
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
