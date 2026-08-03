import { Link, router } from "expo-router";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { AuthNotice, AuthScaffold } from "../../src/components/auth-scaffold";
import { StoneButton, StoneInput, StoneText } from "../../src/components/ui";
import { spacing } from "../../src/design/tokens";
import { useTheme } from "../../src/design/theme";
import { useAuth } from "../../src/providers/auth-provider";
import { useI18n } from "../../src/i18n/provider";

export default function SignInScreen() {
  const { service } = useAuth();
  const { t } = useI18n();
  const { colors } = useTheme();
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
    <AuthScaffold title={t("auth.welcomeBack")} description={t("auth.welcomeDetail")}>
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
        autoComplete="password"
        icon="lock-closed-outline"
      />
      <StoneButton
        label={busy ? t("auth.signingIn") : t("auth.signIn")}
        onPress={() => void signIn()}
        disabled={busy}
      />
      <View style={styles.links}>
        <Link
          href="/(auth)/reset-password"
          accessibilityRole="button"
          style={[styles.link, { color: colors.primaryText }]}
        >
          {t("auth.forgotPassword")}
        </Link>
        <StoneText variant="bodySmall" tone="muted">
          ·
        </StoneText>
        <Link
          href="/(auth)/sign-up"
          accessibilityRole="button"
          style={[styles.link, { color: colors.primaryText }]}
        >
          {t("auth.createAccount")}
        </Link>
      </View>
    </AuthScaffold>
  );
}

const styles = StyleSheet.create({
  links: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  link: { padding: spacing.sm, fontSize: 14, fontFamily: "Inter_600SemiBold" },
});
