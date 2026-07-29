import { Redirect } from "expo-router";
import { ErrorState, LoadingState } from "../src/components/states";
import { useAuth } from "../src/providers/auth-provider";
import { useI18n } from "../src/i18n/provider";

export default function Index() {
  const { status, user, error } = useAuth();
  const { t } = useI18n();
  if (status === "loading") return <LoadingState label={t("app.sessionChecking")} />;
  if (status === "error") return <ErrorState message={error ?? t("app.firebaseCheck")} />;
  return user ? <Redirect href="/(tabs)/notes" /> : <Redirect href="/(auth)/sign-in" />;
}
