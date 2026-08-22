import { Tabs } from "expo-router";
import { Icon, Label, NativeTabs } from "expo-router/unstable-native-tabs";
import Ionicons from "@expo/vector-icons/Ionicons";
import { DynamicColorIOS, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../../src/design/theme";
import { hairline, spacing, typography } from "../../src/design/tokens";
import { useI18n } from "../../src/i18n/provider";

type TabIcon = { active: keyof typeof Ionicons.glyphMap; idle: keyof typeof Ionicons.glyphMap };
type NativeTabIcon = { selected: string; idle: string };
type TabName = "notes" | "projects" | "today" | "calendar" | "focus" | "settings";

const tabNames: readonly TabName[] = ["notes", "projects", "today", "calendar", "focus", "settings"];

const icons: Readonly<Record<TabName, TabIcon>> = {
  notes: { active: "document-text", idle: "document-text-outline" },
  projects: { active: "layers", idle: "layers-outline" },
  today: { active: "sunny", idle: "sunny-outline" },
  calendar: { active: "calendar", idle: "calendar-outline" },
  focus: { active: "timer", idle: "timer-outline" },
  settings: { active: "settings", idle: "settings-outline" },
};

const nativeIcons: Readonly<Record<TabName, NativeTabIcon>> = {
  notes: { selected: "doc.text.fill", idle: "doc.text" },
  projects: { selected: "folder.fill", idle: "folder" },
  today: { selected: "sun.max.fill", idle: "sun.max" },
  calendar: { selected: "calendar", idle: "calendar" },
  focus: { selected: "timer", idle: "timer" },
  settings: { selected: "gearshape.fill", idle: "gearshape" },
};

export default function TabsLayout() {
  if (Platform.OS === "ios") return <IOSNativeTabs />;
  return <FallbackTabs />;
}

function IOSNativeTabs() {
  const { t } = useI18n();
  const selected = DynamicColorIOS({ light: "#2E0702", dark: "#F0B3A6" });
  const idle = DynamicColorIOS({ light: "#745F59", dark: "#D8C0BA" });

  return (
    <NativeTabs
      tintColor={selected}
      iconColor={{ default: idle, selected }}
      labelStyle={{
        default: { color: idle },
        selected: { color: selected, fontWeight: "600" },
      }}
      minimizeBehavior="onScrollDown"
      disableTransparentOnScrollEdge
    >
      {tabNames.map((name) => (
        <NativeTabs.Trigger key={name} name={name}>
          <Icon sf={{ default: nativeIcons[name].idle, selected: nativeIcons[name].selected }} />
          <Label>{t(`tabs.${name}`)}</Label>
        </NativeTabs.Trigger>
      ))}
    </NativeTabs>
  );
}

function FallbackTabs() {
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
      {tabNames.map((name) => (
        <Tabs.Screen
          key={name}
          name={name}
          options={{
            title: t(`tabs.${name}`),
            tabBarIcon: ({ color, size, focused }) => (
              <Ionicons
                name={focused ? icons[name].active : icons[name].idle}
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
