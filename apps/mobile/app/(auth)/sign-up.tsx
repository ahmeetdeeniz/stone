import { Link, router } from "expo-router";
import { useState } from "react";
import { StyleSheet } from "react-native";
import { AuthNotice, AuthScaffold } from "../../src/components/auth-scaffold";
import { StoneButton, StoneInput } from "../../src/components/ui";
import { spacing } from "../../src/design/tokens";
import { useTheme } from "../../src/design/theme";
import { useAuth } from "../../src/providers/auth-provider";
import { useI18n } from "../../src/i18n/provider";

export default function SignUpScreen() {
  const { service } = useAuth();
  const { t } = useI18n();
  const { colors } = useTheme();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const signUp = async () => {
    if (!service) return setError(t("auth.firebaseUnavailable"));
    setBusy(true);
    setError(null);
    try {
      await service.signUp(email, password);
      router.replace("/(tabs)/notes");
    } catch {
      setError(t("auth.createFailed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthScaffold title={t("auth.createAccount")} description={t("auth.welcomeDetail")}>
      {error ? <AuthNotice message={error} tone="danger" /> : null}
      <StoneInput
        label={t("auth.email")}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        icon="mail-outline"
      />
      <StoneInput
        label={t("auth.password")}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="new-password"
        icon="lock-closed-outline"
      />
      <StoneButton
        label={busy ? t("auth.creatingAccount") : t("auth.createAccount")}
        onPress={() => void signUp()}
        disabled={busy}
      />
      <Link
        href="/(auth)/sign-in"
        accessibilityRole="button"
        style={[styles.link, { color: colors.primaryText }]}
      >
        {t("auth.backToSignIn")}
      </Link>
    </AuthScaffold>
  );
}

const styles = StyleSheet.create({
  link: {
    textAlign: "center",
    padding: spacing.sm,
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
});
