import { Link } from "expo-router";
import { useState } from "react";
import { ScrollView, StyleSheet } from "react-native";
import { StoneButton, StoneInput, StoneText } from "../../src/components/ui";
import { spacing } from "../../src/design/tokens";
import { useAuth } from "../../src/providers/auth-provider";
import { useI18n } from "../../src/i18n/provider";

export default function ResetPasswordScreen() {
  const { service } = useAuth();
  const { t } = useI18n();
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
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("auth.sendLinkFailed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <StoneText variant="display">Stone</StoneText>
      <StoneText variant="title1">{t("auth.resetPassword")}</StoneText>
      <StoneText variant="body">{t("auth.resetDetail")}</StoneText>
      {message ? <StoneText style={styles.success}>{message}</StoneText> : null}
      {error ? <StoneText style={styles.error}>{error}</StoneText> : null}
      <StoneInput
        label={t("auth.email")}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
      />
      <StoneButton
        label={busy ? t("auth.sendingLink") : t("auth.sendLink")}
        onPress={() => void reset()}
        disabled={busy}
      />
      <Link href="/(auth)/sign-in" style={styles.link}>
        {t("auth.backToSignIn")}
      </Link>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, justifyContent: "center", gap: spacing.lg, padding: spacing.xxxl },
  link: { textAlign: "center", color: "#6F63E7", padding: spacing.sm },
  error: { color: "#C95B67" },
  success: { color: "#2F9E68" },
});
