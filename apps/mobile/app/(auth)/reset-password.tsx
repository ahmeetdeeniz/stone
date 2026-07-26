import { Link } from "expo-router";
import { useState } from "react";
import { ScrollView, StyleSheet } from "react-native";
import { StoneButton, StoneInput, StoneText } from "../../src/components/ui";
import { spacing } from "../../src/design/tokens";
import { useAuth } from "../../src/providers/auth-provider";

export default function ResetPasswordScreen() {
  const { service } = useAuth();
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const reset = async () => {
    if (!service) return setError("Firebase yapılandırması hazır değil.");
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await service.sendPasswordReset(email);
      setMessage("Şifre sıfırlama bağlantısı e-posta adresinize gönderildi.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Bağlantı gönderilemedi.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <StoneText variant="display">Stone</StoneText>
      <StoneText variant="title1">Şifre sıfırla</StoneText>
      <StoneText variant="body">Hesabınıza bağlı e-posta adresini girin.</StoneText>
      {message ? <StoneText style={styles.success}>{message}</StoneText> : null}
      {error ? <StoneText style={styles.error}>{error}</StoneText> : null}
      <StoneInput
        label="E-posta"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
      />
      <StoneButton
        label={busy ? "Gönderiliyor…" : "Bağlantı gönder"}
        onPress={() => void reset()}
        disabled={busy}
      />
      <Link href="/(auth)/sign-in" style={styles.link}>
        Giriş ekranına dön
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
