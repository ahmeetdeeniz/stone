import { Link } from "expo-router";
import { useState } from "react";
import { StyleSheet } from "react-native";
import { AuthNotice, AuthScaffold } from "../../src/components/auth-scaffold";
import { StoneButton, StoneInput } from "../../src/components/ui";
import { spacing } from "../../src/design/tokens";
import { useTheme } from "../../src/design/theme";
import { useAuth } from "../../src/providers/auth-provider";
import { useI18n } from "../../src/i18n/provider";

export default function ResetPasswordScreen() {
  const { service } = useAuth();
  const { t } = useI18n();
  const { colors } = useTheme();
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const reset = async () => {
    if (!service) return setError(t("auth.firebaseUnavailable"));
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await service.sendPasswordReset(email);
      setMessage(t("auth.resetSent"));
    } catch {
      setError(t("auth.sendLinkFailed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthScaffold title={t("auth.resetPassword")} description={t("auth.resetDetail")}>
      {message ? <AuthNotice message={message} tone="success" /> : null}
      {error ? <AuthNotice message={error} tone="danger" /> : null}
      <StoneInput
        label={t("auth.email")}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        icon="mail-outline"
      />
      <StoneButton
        label={busy ? t("auth.sendingLink") : t("auth.sendLink")}
        onPress={() => void reset()}
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
