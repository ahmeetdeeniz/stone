import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useRef, useState, type ComponentProps, type PropsWithChildren } from "react";
import type { ReactNode } from "react";
import {
  AccessibilityInfo,
  Animated,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useI18n } from "../i18n/provider";
import { useTheme } from "../design/theme";
import {
  hairline,
  motion,
  radii,
  spacing,
  touchTarget,
  typography,
  type ElevationLevel,
  type StatusTone,
} from "../design/tokens";

export type IconName = ComponentProps<typeof Ionicons>["name"];

/** Reduced-motion aware press feedback. Falls back to a plain view when motion is off. */
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) setReduced(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduced);
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);
  return reduced;
}

function usePressScale(active: number) {
  const reduced = useReducedMotion();
  const scale = useRef(new Animated.Value(1)).current;
  const animate = (toValue: number) => {
    if (reduced) return;
    Animated.timing(scale, {
      toValue,
      duration: motion.fast,
      useNativeDriver: true,
    }).start();
  };
  return {
    style: { transform: [{ scale }] },
    onPressIn: () => animate(active),
    onPressOut: () => animate(1),
  };
}

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

export type TextTone = "default" | "secondary" | "muted" | "accent" | StatusTone;

export function StoneText({
  variant = "body",
  tone = "default",
  style,
  ...props
}: ComponentProps<typeof Text> & { variant?: keyof typeof typography; tone?: TextTone }) {
  const { colors, tones } = useTheme();
  const color =
    tone === "default"
      ? colors.text
      : tone === "secondary"
        ? colors.textSecondary
        : tone === "muted"
          ? colors.textMuted
          : tone === "accent"
            ? colors.primaryText
            : tones[tone].fg;
  return <Text {...props} style={[typography[variant], { color }, style]} />;
}

/** Small all-caps kicker. Used sparingly — one per screen region at most. */
export function Overline({ children, tone = "muted" }: PropsWithChildren<{ tone?: TextTone }>) {
  return (
    <StoneText variant="overline" tone={tone} style={styles.overline}>
      {children}
    </StoneText>
  );
}

export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";

export function StoneButton({
  label,
  onPress,
  variant = "primary",
  size = "md",
  icon,
  disabled = false,
  accessibilityLabel,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: "sm" | "md";
  icon?: IconName;
  disabled?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors, tones, elevation } = useTheme();
  const press = usePressScale(0.97);
  const small = size === "sm";

  const background = (pressed: boolean): string => {
    if (variant === "primary") return pressed ? colors.primaryPressed : colors.primary;
    if (variant === "danger") return pressed ? tones.danger.border : tones.danger.bg;
    if (variant === "quiet") return pressed ? colors.surfacePressed : "transparent";
    return pressed ? colors.surfacePressed : colors.surface;
  };
  const borderColor =
    variant === "primary"
      ? colors.primary
      : variant === "danger"
        ? tones.danger.border
        : variant === "quiet"
          ? "transparent"
          : colors.border;
  const foreground =
    variant === "primary"
      ? colors.onPrimary
      : variant === "danger"
        ? tones.danger.fg
        : variant === "quiet"
          ? colors.primaryText
          : colors.text;

  return (
    <Animated.View style={[press.style, style]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? label}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        style={({ pressed }) => [
          styles.button,
          small ? styles.buttonSmall : styles.buttonMedium,
          {
            backgroundColor: background(pressed),
            borderColor,
            borderWidth: variant === "quiet" ? 0 : hairline,
          },
          variant === "primary" && !disabled && elevation.sm,
          disabled && styles.disabled,
        ]}
      >
        {icon ? <Ionicons name={icon} size={small ? 15 : 17} color={foreground} /> : null}
        <StoneText variant="label" style={{ color: foreground }} numberOfLines={1}>
          {label}
        </StoneText>
      </Pressable>
    </Animated.View>
  );
}

/** Icon-only affordance for card-level actions, where a text button would shout. */
export function IconButton({
  icon,
  onPress,
  accessibilityLabel,
  tone = "secondary",
  active = false,
  disabled = false,
}: {
  icon: IconName;
  onPress: () => void;
  accessibilityLabel: string;
  tone?: TextTone;
  active?: boolean;
  disabled?: boolean;
}) {
  const { colors, tones } = useTheme();
  const color =
    tone === "default"
      ? colors.text
      : tone === "secondary"
        ? colors.textSecondary
        : tone === "muted"
          ? colors.textMuted
          : tone === "accent"
            ? colors.primaryText
            : tones[tone].fg;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled, selected: active }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [
        styles.iconButton,
        {
          backgroundColor: active
            ? colors.primarySoft
            : pressed
              ? colors.surfacePressed
              : "transparent",
        },
        disabled && styles.disabled,
      ]}
    >
      <Ionicons name={icon} size={19} color={active ? colors.primaryText : color} />
    </Pressable>
  );
}

export function StoneInput({
  label,
  error,
  hint,
  icon,
  containerStyle,
  onFocus,
  onBlur,
  ...props
}: ComponentProps<typeof TextInput> & {
  label: string;
  error?: string;
  hint?: string;
  icon?: IconName;
  containerStyle?: StyleProp<ViewStyle>;
}) {
  const { colors, tones } = useTheme();
  const [focused, setFocused] = useState(false);
  const activeBorder = error ? tones.danger.fg : focused ? colors.primary : colors.border;
  return (
    <View style={[styles.inputGroup, containerStyle]}>
      <StoneText variant="label" tone="secondary" style={styles.inputLabel}>
        {label}
      </StoneText>
      <View
        style={[
          styles.inputShell,
          {
            backgroundColor: colors.surface,
            borderColor: activeBorder,
            borderWidth: focused || error ? 1.5 : hairline,
          },
        ]}
      >
        {icon ? (
          <Ionicons
            name={icon}
            size={17}
            color={focused ? colors.primary : colors.textMuted}
            style={styles.inputIcon}
          />
        ) : null}
        <TextInput
          {...props}
          accessibilityLabel={label}
          placeholderTextColor={colors.textMuted}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          style={[styles.input, { color: colors.text }]}
        />
      </View>
      {error ? (
        <StoneText variant="caption" tone="danger" style={styles.inputFootnote}>
          {error}
        </StoneText>
      ) : hint ? (
        <StoneText variant="caption" tone="muted" style={styles.inputFootnote}>
          {hint}
        </StoneText>
      ) : null}
    </View>
  );
}

/** Label-less search field: the icon and placeholder already say what it is. */
export function SearchField({
  value,
  onChangeText,
  placeholder,
  accessibilityLabel,
  onClear,
  icon = "search",
  autoCapitalize,
}: {
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  accessibilityLabel: string;
  onClear?: () => void;
  icon?: IconName;
  autoCapitalize?: ComponentProps<typeof TextInput>["autoCapitalize"];
}) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const [focused, setFocused] = useState(false);
  return (
    <View
      style={[
        styles.searchShell,
        {
          backgroundColor: focused ? colors.surface : colors.surfaceSunken,
          borderColor: focused ? colors.primary : "transparent",
          borderWidth: focused ? 1.5 : hairline,
        },
      ]}
    >
      <Ionicons name={icon} size={17} color={focused ? colors.primary : colors.textMuted} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        accessibilityLabel={accessibilityLabel}
        returnKeyType="search"
        autoCapitalize={autoCapitalize}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={[styles.searchInput, { color: colors.text }]}
      />
      {value.length > 0 && onClear ? (
        <IconButton icon="close-circle" accessibilityLabel={t("common.clear")} onPress={onClear} />
      ) : null}
    </View>
  );
}

export function Surface({
  children,
  variant = "default",
  padded = true,
  elevated = "sm",
  style,
}: PropsWithChildren<{
  variant?: "default" | "raised" | "sunken" | "plain";
  padded?: boolean;
  elevated?: ElevationLevel;
  style?: StyleProp<ViewStyle>;
}>) {
  const { colors, elevation } = useTheme();
  const background =
    variant === "raised"
      ? colors.surfaceRaised
      : variant === "sunken"
        ? colors.surfaceSunken
        : variant === "plain"
          ? "transparent"
          : colors.surface;
  return (
    <View
      style={[
        styles.surface,
        { backgroundColor: background, borderColor: colors.border },
        padded && styles.surfacePadded,
        variant !== "plain" && variant !== "sunken" && elevation[elevated],
        style,
      ]}
    >
      {children}
    </View>
  );
}

/** Tappable card. Whole-surface press target with a restrained lift on press. */
export function Card({
  children,
  onPress,
  accessibilityLabel,
  padded = true,
  style,
}: PropsWithChildren<{
  onPress?: () => void;
  accessibilityLabel?: string;
  padded?: boolean;
  style?: StyleProp<ViewStyle>;
}>) {
  const { colors, elevation } = useTheme();
  const press = usePressScale(0.985);
  if (!onPress) {
    return (
      <Surface padded={padded} style={style}>
        {children}
      </Surface>
    );
  }
  return (
    <Animated.View style={press.style}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        onPress={onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        style={({ pressed }) => [
          styles.surface,
          {
            backgroundColor: pressed ? colors.surfacePressed : colors.surface,
            borderColor: pressed ? colors.borderStrong : colors.border,
          },
          padded && styles.surfacePadded,
          elevation.sm,
          style,
        ]}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}

/** Screen title block. Replaces the ad-hoc header views each screen used to build. */
export function ScreenHeader({
  title,
  eyebrow,
  subtitle,
  actions,
}: {
  title: string;
  eyebrow?: string | undefined;
  subtitle?: string | undefined;
  actions?: ReactNode;
}) {
  return (
    <View style={styles.header}>
      <View style={styles.headerText}>
        {eyebrow ? <Overline tone="accent">{eyebrow}</Overline> : null}
        <StoneText variant="title1" style={eyebrow ? styles.headerTitle : undefined}>
          {title}
        </StoneText>
        {subtitle ? (
          <StoneText variant="bodySmall" tone="secondary" style={styles.headerSubtitle}>
            {subtitle}
          </StoneText>
        ) : null}
      </View>
      {actions ? <View style={styles.headerActions}>{actions}</View> : null}
    </View>
  );
}

export function SectionHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.headerText}>
        <StoneText variant="title3">{title}</StoneText>
        {description ? (
          <StoneText variant="bodySmall" tone="secondary" style={styles.headerSubtitle}>
            {description}
          </StoneText>
        ) : null}
      </View>
      {action}
    </View>
  );
}

/** Grouped settings-style block: title, supporting copy, then its controls. */
export function SectionCard({
  title,
  description,
  icon,
  children,
}: PropsWithChildren<{ title: string; description?: string; icon?: IconName }>) {
  const { colors } = useTheme();
  return (
    <Surface style={styles.sectionCard}>
      <View style={styles.sectionCardHead}>
        {icon ? (
          <View style={[styles.sectionIcon, { backgroundColor: colors.primarySoft }]}>
            <Ionicons name={icon} size={17} color={colors.primaryText} />
          </View>
        ) : null}
        <View style={styles.headerText}>
          <StoneText variant="title3">{title}</StoneText>
          {description ? (
            <StoneText variant="bodySmall" tone="secondary" style={styles.headerSubtitle}>
              {description}
            </StoneText>
          ) : null}
        </View>
      </View>
      <View style={styles.sectionCardBody}>{children}</View>
    </Surface>
  );
}

/** Selectable pill. Used for filters and single-choice option rows. */
export function Chip({
  label,
  selected = false,
  onPress,
  icon,
  accessibilityLabel,
}: {
  label: string;
  selected?: boolean;
  onPress: () => void;
  icon?: IconName;
  accessibilityLabel?: string;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: selected
            ? colors.primarySoft
            : pressed
              ? colors.surfacePressed
              : colors.surface,
          borderColor: selected ? colors.primarySoftBorder : colors.border,
        },
      ]}
    >
      {icon ? (
        <Ionicons
          name={icon}
          size={14}
          color={selected ? colors.primaryText : colors.textSecondary}
        />
      ) : null}
      <StoneText
        variant="label"
        style={{ color: selected ? colors.primaryText : colors.textSecondary }}
      >
        {label}
      </StoneText>
    </Pressable>
  );
}

/** Read-only status pill. Always pairs colour with a word, never colour alone. */
export function Badge({
  label,
  tone = "neutral",
  icon,
}: {
  label: string;
  tone?: StatusTone;
  icon?: IconName;
}) {
  const { tones } = useTheme();
  const palette = tones[tone];
  return (
    <View style={[styles.badge, { backgroundColor: palette.bg, borderColor: palette.border }]}>
      {icon ? <Ionicons name={icon} size={12} color={palette.fg} /> : null}
      <StoneText variant="caption" style={{ color: palette.fg }}>
        {label}
      </StoneText>
    </View>
  );
}

export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  return <View style={[styles.divider, { backgroundColor: colors.border }, style]} />;
}

export function ProgressBar({
  value,
  accessibilityLabel,
  tone = "accent",
}: {
  value: number;
  accessibilityLabel: string;
  tone?: StatusTone;
}) {
  const { colors, tones } = useTheme();
  const clamped = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }}
      style={[styles.progressTrack, { backgroundColor: colors.surfaceSunken }]}
    >
      <View
        style={[
          styles.progressFill,
          { width: `${clamped * 100}%`, backgroundColor: tones[tone].fg },
        ]}
      />
    </View>
  );
}

/** Compact metric used in summary rows: big number, quiet caption underneath. */
export function Metric({
  value,
  label,
  tone = "default",
  style,
}: {
  value: string;
  label: string;
  tone?: TextTone;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.metric, style]}>
      <StoneText variant="title2" tone={tone} style={styles.metricValue}>
        {value}
      </StoneText>
      <StoneText variant="caption" tone="muted" numberOfLines={2}>
        {label}
      </StoneText>
    </View>
  );
}

export const numeric: TextStyle = { fontVariant: ["tabular-nums"] };

const styles = StyleSheet.create({
  screen: { flex: 1 },
  screenPadded: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  overline: { textTransform: "uppercase" },

  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    borderRadius: radii.md,
  },
  buttonMedium: { minHeight: 48, paddingHorizontal: spacing.xl },
  buttonSmall: { minHeight: 36, paddingHorizontal: spacing.md, borderRadius: radii.sm },
  disabled: { opacity: 0.45 },

  iconButton: {
    width: touchTarget,
    height: touchTarget,
    borderRadius: radii.md,
    alignItems: "center",
    justifyContent: "center",
  },

  inputGroup: { gap: spacing.xs },
  inputLabel: { marginLeft: spacing.xxs },
  inputFootnote: { marginLeft: spacing.xxs },
  inputShell: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 52,
    borderRadius: radii.md,
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  inputIcon: { marginRight: spacing.xxs },
  input: { flex: 1, paddingVertical: spacing.md, ...typography.body },

  searchShell: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: 48,
    borderRadius: radii.md,
    paddingLeft: spacing.lg,
    paddingRight: spacing.xs,
  },
  searchInput: { flex: 1, paddingVertical: spacing.md, ...typography.body },

  surface: { borderWidth: hairline, borderRadius: radii.lg },
  surfacePadded: { padding: spacing.lg },

  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  headerText: { flex: 1, gap: spacing.xxs },
  headerTitle: { marginTop: spacing.xxs },
  headerSubtitle: { marginTop: spacing.xxs },
  headerActions: { flexDirection: "row", alignItems: "center", gap: spacing.xs },

  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  sectionCard: { gap: spacing.lg },
  sectionCardHead: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  sectionCardBody: { gap: spacing.md },
  sectionIcon: {
    width: 34,
    height: 34,
    borderRadius: radii.sm,
    alignItems: "center",
    justifyContent: "center",
  },

  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    minHeight: touchTarget,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.pill,
    borderWidth: hairline,
  },

  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    alignSelf: "flex-start",
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
    borderRadius: radii.pill,
    borderWidth: hairline,
  },

  divider: { height: hairline, width: "100%" },

  progressTrack: { height: 6, borderRadius: radii.pill, overflow: "hidden" },
  progressFill: { height: "100%", borderRadius: radii.pill },

  metric: { gap: spacing.xxs, minWidth: 92 },
  metricValue: { fontVariant: ["tabular-nums"] },
});
