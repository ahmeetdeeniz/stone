import { useEffect, useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
import { ResponsiveContent } from "../../src/components/responsive";
import { Screen, StoneButton, StoneText } from "../../src/components/ui";
import { spacing } from "../../src/design/tokens";
import { useTheme } from "../../src/design/theme";
import { useAuth } from "../../src/providers/auth-provider";
import { useAppServices } from "../../src/providers/app-provider";

export default function SettingsScreen() {
  const { preference, setPreference, colors } = useTheme();
  const { user, service } = useAuth();
  const { settingsUseCases } = useAppServices();
  const [busy, setBusy] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  useEffect(() => {
    if (!user) return;
    setSettingsLoaded(false);
    void settingsUseCases.load(user.uid).then((stored) => {
      setPreference(stored.theme);
      setSettingsLoaded(true);
    });
  }, [setPreference, settingsUseCases, user]);
  const signOut = async () => {
    if (!service) return;
    setBusy(true);
    try {
      await service.signOut();
    } catch (error) {
      Alert.alert(
        "Çıkış yapılamadı",
        error instanceof Error ? error.message : "Lütfen tekrar deneyin.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen>
      <ResponsiveContent>
        <StoneText variant="title1" style={styles.title}>
          Ayarlar
        </StoneText>
        <View style={[styles.section, { borderColor: colors.border }]}>
          <StoneText variant="title3">Tema</StoneText>
          <StoneText variant="bodySmall" style={{ color: colors.textSecondary }}>
            Seçim cihazda saklanır ve uygulama yeniden açıldığında korunur.
          </StoneText>
          <View style={styles.options}>
            {(["system", "light", "dark"] as const).map((option) => (
              <StoneButton
                key={option}
                label={option === "system" ? "Sistem" : option === "light" ? "Açık" : "Koyu"}
                variant={preference === option ? "primary" : "secondary"}
                onPress={() => {
                  setPreference(option);
                  if (user && settingsLoaded) {
                    void settingsUseCases.setTheme(user.uid, option);
                  }
                }}
              />
            ))}
          </View>
        </View>
        <View style={[styles.section, { borderColor: colors.border }]}>
          <StoneText variant="title3">Hesap</StoneText>
          <StoneText variant="bodySmall" style={{ color: colors.textSecondary }}>
            {user?.email ?? "Oturum bilgisi yok"}
          </StoneText>
          <StoneButton
            label={busy ? "Çıkış yapılıyor…" : "Oturumu kapat"}
            variant="secondary"
            onPress={() => void signOut()}
            disabled={busy}
          />
        </View>
        <StoneText variant="caption" style={{ color: colors.textMuted }}>
          Veri aktarımı, çöp kutusu ve conflict merkezi sonraki milestone'larda eklenecek.
        </StoneText>
      </ResponsiveContent>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { marginBottom: spacing.xxl },
  section: {
    borderWidth: 1,
    borderRadius: 16,
    padding: spacing.lg,
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  options: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" },
});
