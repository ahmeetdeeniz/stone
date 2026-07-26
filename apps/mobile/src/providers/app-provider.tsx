import { useEffect, useState, type PropsWithChildren } from "react";
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
        <AuthProvider>{children}</AuthProvider>
      ) : error ? (
        <ErrorState message={error} />
      ) : (
        <LoadingState label="Stone hazırlanıyor" />
      )}
    </ThemeProvider>
  );
}
