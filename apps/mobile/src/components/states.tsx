import type { ReactNode } from "react";
import Ionicons from "@expo/vector-icons/Ionicons";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { StoneButton, StoneText, type IconName } from "./ui";
import { hairline, radii, spacing } from "../design/tokens";
import { useTheme } from "../design/theme";
import { useI18n } from "../i18n/provider";

export function LoadingState({ label }: { label?: string }) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const visibleLabel = label ?? t("common.loading");
  return (
    <View style={styles.center}>
      <ActivityIndicator color={colors.primary} accessibilityLabel={visibleLabel} />
      <StoneText variant="bodySmall" tone="secondary">
        {visibleLabel}
      </StoneText>
    </View>
  );
}

export function EmptyState({
  title,
  description,
  icon = "sparkles-outline",
  action,
}: {
  title: string;
  description: string;
  icon?: IconName;
  action?: ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.center}>
      <View
        style={[styles.emptyIcon, { backgroundColor: colors.surface, borderColor: colors.border }]}
      >
        <Ionicons name={icon} size={26} color={colors.primaryText} />
      </View>
      <StoneText variant="title3" style={styles.centerText}>
        {title}
      </StoneText>
      <StoneText variant="bodySmall" tone="secondary" style={[styles.centerText, styles.emptyCopy]}>
        {description}
      </StoneText>
      {action}
    </View>
  );
}

export function OfflineState() {
  const { colors, tones } = useTheme();
  const { t } = useI18n();
  return (
    <View
      style={[styles.banner, { backgroundColor: tones.info.bg, borderColor: tones.info.border }]}
    >
      <Ionicons name="cloud-offline-outline" size={16} color={tones.info.fg} />
      <StoneText variant="bodySmall" style={{ color: colors.text }}>
        {t("app.offlinePreserved")}
      </StoneText>
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { tones } = useTheme();
  const { t } = useI18n();
  return (
    <View style={styles.center}>
      <View
        style={[
          styles.emptyIcon,
          { backgroundColor: tones.danger.bg, borderColor: tones.danger.border },
        ]}
      >
        <Ionicons name="alert-circle-outline" size={26} color={tones.danger.fg} />
      </View>
      <StoneText variant="title3" style={styles.centerText}>
        {t("app.errorTitle")}
      </StoneText>
      <StoneText variant="bodySmall" tone="secondary" style={[styles.centerText, styles.emptyCopy]}>
        {message}
      </StoneText>
      {onRetry ? (
        <StoneButton label={t("app.retry")} variant="secondary" icon="refresh" onPress={onRetry} />
      ) : null}
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
  emptyCopy: { maxWidth: 320 },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: radii.xl,
    borderWidth: hairline,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.xxs,
  },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderWidth: hairline,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
});
