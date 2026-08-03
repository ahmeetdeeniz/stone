import { Platform, StyleSheet, type ViewStyle } from "react-native";

export const colors = {
  brand: {
    navy950: "#11111D",
    navy900: "#18172A",
    navy800: "#24213F",
    purple600: "#6F63E7",
    purple500: "#8075F0",
    purple300: "#AAA3FF",
    purple100: "#E8E5FF",
  },
  light: {
    background: "#F7F6FC",
    backgroundSecondary: "#F0EEF8",
    surface: "#FFFFFF",
    surfaceRaised: "#FCFBFF",
    text: "#242231",
    textSecondary: "#747184",
    textMuted: "#9A96AA",
    border: "#E5E1EF",
    borderStrong: "#D4CEE3",
  },
  dark: {
    background: "#11111D",
    backgroundSecondary: "#161524",
    surface: "#1B1A2D",
    surfaceRaised: "#222039",
    text: "#F5F3FF",
    textSecondary: "#B6B1C7",
    textMuted: "#8E899F",
    border: "#2D2A45",
    borderStrong: "#3B3758",
  },
  status: {
    success: "#2F9E68",
    warning: "#C58A1D",
    danger: "#C95B67",
    info: "#4B86C5",
    neutral: "#8E899F",
  },
} as const;

/**
 * Roles derived from the locked palette above. They exist so screens never reach
 * for a raw hex value: every quiet fill, hairline and accent wash resolves per theme.
 */
export const derived = {
  light: {
    surfaceSunken: "#EDEBF6",
    surfacePressed: "#F2F0FA",
    accentSoft: "#EDEAFF",
    accentSoftBorder: "#D8D2FF",
    accentText: "#5A4FD0",
    overlay: "rgba(17, 17, 29, 0.42)",
    scrim: "rgba(36, 34, 49, 0.06)",
    shadow: "#241F45",
  },
  dark: {
    surfaceSunken: "#141322",
    surfacePressed: "#26243F",
    accentSoft: "#2A2748",
    accentSoftBorder: "#453F70",
    accentText: "#AAA3FF",
    overlay: "rgba(6, 6, 12, 0.58)",
    scrim: "rgba(245, 243, 255, 0.05)",
    shadow: "#000000",
  },
} as const;

export interface ToneColors {
  /** Foreground: text and icons. */
  fg: string;
  /** Wash behind the tone. */
  bg: string;
  /** Hairline that keeps the wash legible on any surface. */
  border: string;
}

export type StatusTone = "success" | "warning" | "danger" | "info" | "neutral" | "accent";

/** Status colours paired with a wash + hairline so state never relies on hue alone. */
export const statusTones: Record<"light" | "dark", Record<StatusTone, ToneColors>> = {
  light: {
    success: { fg: "#1F7A4D", bg: "#E4F4EB", border: "#BFE3CE" },
    warning: { fg: "#96650B", bg: "#FBF0DC", border: "#EBD6A8" },
    danger: { fg: "#B0424F", bg: "#FBE9EB", border: "#EFC7CD" },
    info: { fg: "#356B9F", bg: "#E6F0FA", border: "#C4DAEE" },
    neutral: { fg: "#6C687C", bg: "#EEECF5", border: "#DCD8E8" },
    accent: { fg: "#5A4FD0", bg: "#EDEAFF", border: "#D8D2FF" },
  },
  dark: {
    success: { fg: "#7FD6A6", bg: "#16301F", border: "#27543A" },
    warning: { fg: "#E5BE72", bg: "#332815", border: "#584426" },
    danger: { fg: "#F0A2AB", bg: "#341B21", border: "#5A2F38" },
    info: { fg: "#9CC5EC", bg: "#182838", border: "#2C4560" },
    neutral: { fg: "#A5A0B6", bg: "#221F33", border: "#3A3654" },
    accent: { fg: "#AAA3FF", bg: "#2A2748", border: "#453F70" },
  },
};

export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 40,
  giant: 48,
} as const;

export const radii = { xs: 6, sm: 8, md: 12, lg: 16, xl: 22, pill: 999 } as const;

export const hairline = StyleSheet.hairlineWidth;

/**
 * Elevation stays deliberately shallow: cards should read as paper on paper,
 * never as floating glass. Dark mode leans on borders instead of shadow.
 */
export type ElevationLevel = "none" | "sm" | "md";

export const elevation: Record<"light" | "dark", Record<ElevationLevel, ViewStyle>> = {
  light: {
    none: {},
    sm: {
      shadowColor: derived.light.shadow,
      shadowOpacity: 0.05,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 2 },
      elevation: 1,
    },
    md: {
      shadowColor: derived.light.shadow,
      shadowOpacity: 0.07,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 6 },
      elevation: 3,
    },
  },
  dark: {
    none: {},
    sm: {
      shadowColor: derived.dark.shadow,
      shadowOpacity: 0.24,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 3 },
      elevation: 1,
    },
    md: {
      shadowColor: derived.dark.shadow,
      shadowOpacity: 0.32,
      shadowRadius: 20,
      shadowOffset: { width: 0, height: 8 },
      elevation: 3,
    },
  },
};

/**
 * Optical tracking: large type is set tight, small caps-ish labels are set open.
 * This is most of what separates a considered screen from a default one.
 */
export const typography = {
  display: {
    fontSize: 30,
    lineHeight: 36,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.7,
  },
  title1: { fontSize: 24, lineHeight: 30, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
  title2: { fontSize: 20, lineHeight: 26, fontFamily: "Inter_700Bold", letterSpacing: -0.35 },
  title3: { fontSize: 17, lineHeight: 23, fontFamily: "Inter_600SemiBold", letterSpacing: -0.2 },
  body: { fontSize: 16, lineHeight: 24, fontFamily: "Inter_400Regular", letterSpacing: -0.1 },
  bodySmall: { fontSize: 14, lineHeight: 20, fontFamily: "Inter_400Regular", letterSpacing: -0.05 },
  label: { fontSize: 13, lineHeight: 18, fontFamily: "Inter_600SemiBold", letterSpacing: 0 },
  caption: { fontSize: 12, lineHeight: 16, fontFamily: "Inter_500Medium", letterSpacing: 0.1 },
  overline: { fontSize: 11, lineHeight: 14, fontFamily: "Inter_600SemiBold", letterSpacing: 0.9 },
  mono: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }),
    letterSpacing: 0,
  },
} as const;

/** Minimum comfortable hit area; never let an interactive element fall below this. */
export const touchTarget = 44;

/** Short, functional durations. Anything longer starts to feel like a toy. */
export const motion = { fast: 120, base: 180, slow: 240 } as const;
