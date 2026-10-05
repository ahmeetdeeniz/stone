import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useTheme } from "../design/theme";
import { radii, spacing } from "../design/tokens";
import { useI18n } from "../i18n/provider";
import type { NotebookTool } from "./NotebookCanvas";

type IconName = keyof typeof MaterialCommunityIcons.glyphMap;

export const INK_COLORS = ["#1C1917", "#A13D27", "#2563EB", "#15803D", "#7C3AED", "#D97706"];
export const HIGHLIGHTER_COLORS = ["#FACC15", "#4ADE80", "#F472B6", "#60A5FA"];
export const PEN_WIDTHS = [2, 3.5, 6];

const tools: ReadonlyArray<{ tool: NotebookTool; icon: IconName }> = [
  { tool: "pen", icon: "fountain-pen-tip" },
  { tool: "highlighter", icon: "marker" },
  { tool: "eraser", icon: "eraser" },
  { tool: "lasso", icon: "lasso" },
  { tool: "line", icon: "vector-line" },
  { tool: "arrow", icon: "arrow-top-right" },
  { tool: "rectangle", icon: "rectangle-outline" },
  { tool: "ellipse", icon: "ellipse-outline" },
  { tool: "pan", icon: "hand-back-right-outline" },
];

/** One quiet row: tools, then colours and widths for the active tool. Wraps on phones. */
export function NotebookToolbar({
  tool,
  color,
  width,
  onTool,
  onColor,
  onWidth,
}: {
  tool: NotebookTool;
  color: string;
  width: number;
  onTool: (tool: NotebookTool) => void;
  onColor: (color: string) => void;
  onWidth: (width: number) => void;
}) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const palette = tool === "highlighter" ? HIGHLIGHTER_COLORS : INK_COLORS;
  const showsInk = tool !== "eraser" && tool !== "lasso" && tool !== "pan" && tool !== "select";
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      keyboardShouldPersistTaps="handled"
    >
      <View style={[styles.group, { backgroundColor: colors.backgroundSecondary }]}>
        {tools.map((item) => (
          <ToolButton
            key={item.tool}
            icon={item.icon}
            active={tool === item.tool}
            label={t(`drawing.tool.${item.tool}`)}
            onPress={() => onTool(item.tool)}
          />
        ))}
      </View>
      {showsInk ? (
        <>
          <View style={styles.group}>
            {palette.map((item) => (
              <Pressable
                key={item}
                accessibilityRole="button"
                accessibilityLabel={t("drawing.colorA11y", { color: item })}
                accessibilityState={{ selected: color === item }}
                onPress={() => onColor(item)}
                hitSlop={4}
                style={[
                  styles.swatch,
                  { backgroundColor: item },
                  color === item && { borderColor: colors.text, borderWidth: 2.5 },
                ]}
              />
            ))}
          </View>
          <View style={[styles.group, { backgroundColor: colors.backgroundSecondary }]}>
            {PEN_WIDTHS.map((item) => (
              <Pressable
                key={item}
                accessibilityRole="button"
                accessibilityLabel={t("drawing.widthA11y", { width: item })}
                accessibilityState={{ selected: width === item }}
                onPress={() => onWidth(item)}
                style={[styles.tool, width === item && { backgroundColor: colors.surface }]}
              >
                <View
                  style={{
                    width: 18,
                    height: item * 1.4,
                    borderRadius: 4,
                    backgroundColor: tool === "highlighter" ? color : colors.text,
                  }}
                />
              </Pressable>
            ))}
          </View>
        </>
      ) : null}
    </ScrollView>
  );
}

export function ToolButton({
  icon,
  label,
  active = false,
  disabled = false,
  onPress,
}: {
  icon: IconName;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.tool,
        active && { backgroundColor: colors.surface },
        { opacity: disabled ? 0.35 : pressed ? 0.6 : 1 },
      ]}
    >
      <MaterialCommunityIcons
        name={icon}
        size={22}
        color={active ? colors.primary : colors.textSecondary}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  group: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    padding: 3,
    borderRadius: radii.md,
  },
  tool: {
    width: 40,
    height: 40,
    borderRadius: radii.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  swatch: {
    width: 26,
    height: 26,
    marginHorizontal: 3,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: "#00000022",
  },
});
