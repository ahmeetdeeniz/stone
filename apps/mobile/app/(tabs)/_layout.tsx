import { Tabs } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../../src/design/theme";
import { hairline, spacing, typography } from "../../src/design/tokens";
import { useI18n } from "../../src/i18n/provider";

type TabIcon = { active: keyof typeof Ionicons.glyphMap; idle: keyof typeof Ionicons.glyphMap };

const icons: Readonly<Record<string, TabIcon>> = {
  notes: { active: "document-text", idle: "document-text-outline" },
  projects: { active: "layers", idle: "layers-outline" },
  today: { active: "sunny", idle: "sunny-outline" },
  calendar: { active: "calendar", idle: "calendar-outline" },
  focus: { active: "timer", idle: "timer-outline" },
  settings: { active: "settings", idle: "settings-outline" },
};

export default function TabsLayout() {
  const { colors } = useTheme();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const barHeight = 58 + insets.bottom;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          borderTopWidth: hairline,
          height: barHeight,
          paddingBottom: insets.bottom > 0 ? insets.bottom - 4 : spacing.sm,
          paddingTop: spacing.sm,
          elevation: 0,
        },
        tabBarLabelStyle: {
          ...typography.overline,
          textTransform: "none",
          letterSpacing: 0.1,
          marginTop: 2,
        },
        tabBarItemStyle: { paddingVertical: 2 },
        tabBarHideOnKeyboard: Platform.OS === "android",
      }}
    >
      {(["notes", "projects", "today", "calendar", "focus", "settings"] as const).map((name) => (
        <Tabs.Screen
          key={name}
          name={name}
          options={{
            title: t(`tabs.${name}`),
            tabBarIcon: ({ color, size, focused }) => (
              <Ionicons
                name={focused ? icons[name]!.active : icons[name]!.idle}
                color={color}
                size={size - 2}
              />
            ),
          }}
        />
      ))}
    </Tabs>
  );
}
