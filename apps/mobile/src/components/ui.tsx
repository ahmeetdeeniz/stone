import { type ComponentProps, type PropsWithChildren } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "../design/theme";
import { radii, spacing, typography } from "../design/tokens";

export function Screen({ children, padded = true }: PropsWithChildren<{ padded?: boolean }>) {
  const { colors } = useTheme();
  return (
    <SafeAreaView
      style={[styles.screen, { backgroundColor: colors.background }, padded && styles.screenPadded]}
      edges={["top", "right", "bottom", "left"]}
    >
      {children}
    </SafeAreaView>
  );
}

export function StoneText({
  variant = "body",
  style,
  ...props
}: ComponentProps<typeof Text> & { variant?: keyof typeof typography }) {
  const { colors } = useTheme();
  return <Text {...props} style={[typography[variant], { color: colors.text }, style]} />;
}

export function StoneButton({
  label,
  onPress,
  variant = "primary",
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "quiet";
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  const primary = variant === "primary";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: primary
            ? pressed
              ? colors.primaryPressed
              : colors.primary
            : colors.surface,
          borderColor: primary ? colors.primary : colors.border,
        },
        variant === "quiet" && styles.quietButton,
        disabled && styles.disabled,
      ]}
    >
      <StoneText variant="label" style={{ color: primary ? colors.onPrimary : colors.text }}>
        {label}
      </StoneText>
    </Pressable>
  );
}

export function StoneInput({
  label,
  error,
  ...props
}: ComponentProps<typeof TextInput> & { label: string; error?: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.inputGroup}>
      <StoneText variant="label" style={styles.inputLabel}>
        {label}
      </StoneText>
      <TextInput
        {...props}
        accessibilityLabel={label}
        placeholderTextColor={colors.textMuted}
        style={[
          styles.input,
          {
            backgroundColor: colors.surface,
            borderColor: error ? "#C95B67" : colors.border,
            color: colors.text,
          },
        ]}
      />
      {error ? (
        <StoneText variant="caption" style={{ color: "#C95B67" }}>
          {error}
        </StoneText>
      ) : null}
    </View>
  );
}

export function Surface({ children }: PropsWithChildren) {
  const { colors } = useTheme();
  return (
    <View style={[styles.surface, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  screenPadded: { paddingHorizontal: spacing.lg, paddingTop: spacing.xl },
  button: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: radii.md,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
  },
  quietButton: { borderColor: "transparent", backgroundColor: "transparent" },
  disabled: { opacity: 0.5 },
  inputGroup: { gap: spacing.xs },
  inputLabel: { marginLeft: spacing.xs },
  input: {
    minHeight: 52,
    borderWidth: 1,
    borderRadius: radii.md,
    paddingHorizontal: spacing.lg,
    ...typography.body,
  },
  surface: { borderWidth: 1, borderRadius: radii.lg, padding: spacing.lg },
});
