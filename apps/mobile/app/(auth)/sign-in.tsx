import { Link, router } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet } from "react-native";
import { ErrorState } from "../../src/components/states";
import { StoneButton, StoneInput, StoneText } from "../../src/components/ui";
import { spacing } from "../../src/design/tokens";
import { useAuth } from "../../src/providers/auth-provider";
import { useI18n } from "../../src/i18n/provider";

export default function SignInScreen() {
  const { service } = useAuth();
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const signIn = async () => {
    if (!service) return setError(t("auth.firebaseUnavailable"));
    setBusy(true);
    setError(null);
    try {
      await service.signIn(email, password);
      router.replace("/(tabs)/notes");
    } catch {
      setError(t("auth.signInFailed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={styles.flex}
    >
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <StoneText variant="display" style={styles.brand}>
          Stone
        </StoneText>
        <StoneText variant="title1">{t("auth.welcomeBack")}</StoneText>
        <StoneText variant="body" style={styles.secondary}>
          {t("auth.welcomeDetail")}
        </StoneText>
        {error ? <ErrorState message={error} /> : null}
        <StoneInput
          label={t("auth.email")}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
        />
        <StoneInput
          label={t("auth.password")}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="password"
        />
        <StoneButton
          label={busy ? t("auth.signingIn") : t("auth.signIn")}
          onPress={() => void signIn()}
          disabled={busy}
        />
        <Link href="/(auth)/reset-password" accessibilityRole="button" style={styles.link}>
          {t("auth.forgotPassword")}
        </Link>
        <Link href="/(auth)/sign-up" accessibilityRole="button" style={styles.link}>
          {t("auth.createAccount")}
        </Link>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flexGrow: 1, justifyContent: "center", gap: spacing.lg, padding: spacing.xxxl },
  brand: { marginBottom: spacing.lg },
  secondary: { opacity: 0.75, marginBottom: spacing.lg },
  link: { textAlign: "center", padding: spacing.sm, color: "#6F63E7", fontSize: 14 },
});
