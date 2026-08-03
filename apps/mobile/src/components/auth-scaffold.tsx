import Ionicons from "@expo/vector-icons/Ionicons";
import type { PropsWithChildren } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StoneText } from "./ui";
import { useTheme } from "../design/theme";
import { hairline, radii, spacing } from "../design/tokens";

/**
 * Shared shell for the signed-out screens: themed background, centred column,
 * and the Stone mark. Keeps the three auth routes visually identical.
 */
export function AuthScaffold({
  title,
  description,
  children,
}: PropsWithChildren<{ title: string; description?: string }>) {
  const { colors } = useTheme();
  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.safe}
      >
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.column}>
            <View style={styles.brand}>
              <View style={[styles.mark, { backgroundColor: colors.primary }]}>
                <Ionicons name="layers" size={22} color={colors.onPrimary} />
              </View>
              <StoneText variant="title2">Stone</StoneText>
            </View>
            <View style={styles.headings}>
              <StoneText variant="display">{title}</StoneText>
              {description ? (
                <StoneText variant="body" tone="secondary">
                  {description}
                </StoneText>
              ) : null}
            </View>
            <View
              style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
            >
              {children}
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/** Inline status line for auth feedback — success and failure share the shape. */
export function AuthNotice({ message, tone }: { message: string; tone: "success" | "danger" }) {
  const { tones } = useTheme();
  const palette = tones[tone];
  return (
    <View style={[styles.notice, { backgroundColor: palette.bg, borderColor: palette.border }]}>
      <Ionicons
        name={tone === "success" ? "checkmark-circle-outline" : "alert-circle-outline"}
        size={16}
        color={palette.fg}
      />
      <StoneText variant="bodySmall" style={[styles.noticeText, { color: palette.fg }]}>
        {message}
      </StoneText>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  container: { flexGrow: 1, justifyContent: "center", padding: spacing.xxl },
  column: { width: "100%", maxWidth: 420, alignSelf: "center", gap: spacing.xxl },
  brand: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  mark: {
    width: 40,
    height: 40,
    borderRadius: radii.md,
    alignItems: "center",
    justifyContent: "center",
  },
  headings: { gap: spacing.sm },
  card: {
    gap: spacing.lg,
    borderWidth: hairline,
    borderRadius: radii.xl,
    padding: spacing.xl,
  },
  notice: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    borderWidth: hairline,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  noticeText: { flex: 1 },
});
