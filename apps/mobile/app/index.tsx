import { Redirect } from "expo-router";
import { ErrorState, LoadingState } from "../src/components/states";
import { useAuth } from "../src/providers/auth-provider";

export default function Index() {
  const { status, user, error } = useAuth();
  if (status === "loading") return <LoadingState label="Oturum kontrol ediliyor" />;
  if (status === "error")
    return <ErrorState message={error ?? "Firebase yapılandırmasını kontrol edin."} />;
  return user ? <Redirect href="/(tabs)/notes" /> : <Redirect href="/(auth)/sign-in" />;
}
