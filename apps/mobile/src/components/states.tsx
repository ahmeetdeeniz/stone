import { ActivityIndicator, StyleSheet, View } from "react-native";
import { StoneButton, StoneText } from "./ui";
import { spacing } from "../design/tokens";
import { useTheme } from "../design/theme";

export function LoadingState({ label = "Yükleniyor" }: { label?: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.center}>
      <ActivityIndicator color={colors.primary} accessibilityLabel={label} />
      <StoneText variant="bodySmall" style={{ color: colors.textSecondary }}>
        {label}
      </StoneText>
    </View>
  );
}

export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <View style={styles.center}>
      <StoneText variant="display" style={styles.centerText}>
        {title}
      </StoneText>
      <StoneText variant="body" style={styles.centerText}>
        {description}
      </StoneText>
    </View>
  );
}

export function OfflineState() {
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.banner,
        { backgroundColor: colors.backgroundSecondary, borderColor: colors.border },
      ]}
    >
      <StoneText variant="bodySmall">Çevrimdışı — yerel veriler korunuyor.</StoneText>
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View style={styles.center}>
      <StoneText variant="title3" style={styles.centerText}>
        Bir sorun oluştu
      </StoneText>
      <StoneText variant="body" style={styles.centerText}>
        {message}
      </StoneText>
      {onRetry ? <StoneButton label="Tekrar dene" onPress={onRetry} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    padding: spacing.xxl,
  },
  centerText: { textAlign: "center" },
  banner: { borderWidth: 1, borderRadius: 10, padding: spacing.md },
});
