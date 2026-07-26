import { Link, router } from "expo-router";
import { useState } from "react";
import { ScrollView, StyleSheet } from "react-native";
import { StoneButton, StoneInput, StoneText } from "../../src/components/ui";
import { spacing } from "../../src/design/tokens";
import { useAuth } from "../../src/providers/auth-provider";

export default function SignUpScreen() {
  const { service } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const signUp = async () => {
    if (!service) return setError("Firebase yapılandırması hazır değil.");
    setBusy(true);
    setError(null);
    try {
      await service.signUp(email, password);
      router.replace("/(tabs)/notes");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Hesap oluşturulamadı.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <StoneText variant="display">Stone</StoneText>
      <StoneText variant="title1">Hesap oluştur</StoneText>
      {error ? <StoneText style={styles.error}>{error}</StoneText> : null}
      <StoneInput
        label="E-posta"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
      />
      <StoneInput
        label="Şifre"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="new-password"
      />
      <StoneButton
        label={busy ? "Oluşturuluyor…" : "Hesap oluştur"}
        onPress={() => void signUp()}
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
});
