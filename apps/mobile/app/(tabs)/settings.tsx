import { useCallback, useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { Alert, StyleSheet, View } from "react-native";
import { ResponsiveContent } from "../../src/components/responsive";
import { Screen, StoneButton, StoneText } from "../../src/components/ui";
import { spacing } from "../../src/design/tokens";
import { useTheme } from "../../src/design/theme";
import { useAuth } from "../../src/providers/auth-provider";
import { useAppServices } from "../../src/providers/app-provider";
import { shareWorkspaceExport } from "../../src/notes/workspace-files";
import type { SyncState } from "../../src/infrastructure/storage/sync";

export default function SettingsScreen() {
  const router = useRouter();
  const { preference, setPreference, colors } = useTheme();
  const { user, service } = useAuth();
  const services = useAppServices();
  const [busy, setBusy] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [syncState, setSyncState] = useState<SyncState | null>(null);
  useEffect(() => {
    if (!user) return;
    setSettingsLoaded(false);
    void services.settingsUseCases
      .load(user.uid)
      .then((stored) => {
        setPreference(stored.theme);
        setSettingsLoaded(true);
      })
      .catch((error: unknown) => {
        setSettingsLoaded(true);
        Alert.alert(
          "Tema yüklenemedi",
          error instanceof Error ? error.message : "Ayarlar yerel olarak okunamadı.",
        );
      });
  }, [services.settingsUseCases, setPreference, user]);
  const loadSyncState = useCallback(async () => {
    if (!user) return;
    setSyncState(await services.syncStore.getState(user.uid));
  }, [services.syncStore, user]);
  useEffect(() => {
    void loadSyncState();
  }, [loadSyncState]);
  const updateTheme = async (option: "system" | "light" | "dark") => {
    setPreference(option);
    if (!user || !settingsLoaded) return;
    try {
      await services.settingsUseCases.setTheme(user.uid, option);
    } catch (error) {
      Alert.alert(
        "Tema kaydedilemedi",
        error instanceof Error ? error.message : "Ayar değişikliği yerel olarak kaydedilemedi.",
      );
    }
  };
  const runSync = async () => {
    if (!user) return;
    setBusy(true);
    try {
      await services.sync(user.uid);
      await loadSyncState();
    } catch (error) {
      Alert.alert(
        "Senkronizasyon başarısız",
        error instanceof Error ? error.message : "Tekrar deneyin.",
      );
    } finally {
      setBusy(false);
    }
  };
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
  const exportAll = async () => {
    if (!user) return;
    setBusy(true);
    try {
      await shareWorkspaceExport(await services.exportWorkspace(user.uid));
    } catch (error) {
      Alert.alert(
        "Workspace dışa aktarılamadı",
        error instanceof Error ? error.message : "Tekrar deneyin.",
      );
    } finally {
      setBusy(false);
    }
  };
  const deleteAccount = () => {
    if (!user || !service) return;
    Alert.alert(
      "Hesabı ve tüm verileri sil?",
      "Firebase verileri ve bu cihazdaki yerel veriler kalıcı olarak silinir.",
      [
        { text: "Vazgeç", style: "cancel" },
        {
          text: "Kalıcı olarak sil",
          style: "destructive",
          onPress: () => {
            void (async () => {
              setBusy(true);
              try {
                await services.deleteRemoteData(user.uid);
                await service.deleteAccount();
                await services.purgeLocalData(user.uid);
              } catch (error) {
                Alert.alert(
                  "Hesap silinemedi",
                  error instanceof Error ? error.message : "Tekrar deneyin.",
                );
              } finally {
                setBusy(false);
              }
            })();
          },
        },
      ],
    );
  };
  return (
    <Screen>
      <ResponsiveContent>
        <StoneText variant="title1" style={styles.title}>
          Ayarlar
        </StoneText>
        <View style={[styles.section, { borderColor: colors.border }]}>
          <StoneText variant="title3">Senkronizasyon</StoneText>
          <StoneText variant="bodySmall" style={{ color: colors.textSecondary }}>
            Durum: {syncState?.status ?? "saved"}
            {syncState?.lastError ? ` · ${syncState.lastError}` : ""}
          </StoneText>
          <View style={styles.options}>
            <StoneButton
              label="Şimdi eşitle"
              variant="secondary"
              onPress={() => void runSync()}
              disabled={busy || !user}
            />
            <StoneButton
              label="Conflict merkezi"
              variant="quiet"
              onPress={() => router.push("/conflicts")}
            />
          </View>
        </View>
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
                onPress={() => void updateTheme(option)}
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
          <StoneButton
            label="Workspace'i dışa aktar"
            variant="quiet"
            onPress={() => void exportAll()}
            disabled={busy || !user}
          />
          <StoneButton
            label="Hesabı ve verileri sil"
            variant="quiet"
            onPress={deleteAccount}
            disabled={busy || !user}
          />
        </View>
        <View style={[styles.section, { borderColor: colors.border }]}>
          <StoneText variant="title3">Not yönetimi</StoneText>
          <StoneButton
            label="Çöp kutusunu aç"
            variant="secondary"
            onPress={() => router.push("/trash")}
          />
        </View>
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
