import { Platform, StyleSheet, type ViewStyle } from "react-native";

export const colors = {
  brand: {
    navy950: "#160B09",
    navy900: "#1F100D",
    navy800: "#351A14",
    purple600: "#2E0702",
    purple500: "#5A1008",
    purple300: "#F0B3A6",
    purple100: "#F3E3DE",
  },
  light: {
    background: "#FBF7F5",
    backgroundSecondary: "#F4ECE8",
    surface: "#FFFDFC",
    surfaceRaised: "#FFFAF7",
    text: "#271B18",
    textSecondary: "#745F59",
    textMuted: "#9A8179",
    border: "#E8D8D2",
    borderStrong: "#D9C2BA",
  },
  dark: {
    background: "#160B09",
    backgroundSecondary: "#1F100D",
    surface: "#291510",
    surfaceRaised: "#351A14",
    text: "#FFF7F4",
    textSecondary: "#D8C0BA",
    textMuted: "#A98981",
    border: "#4A2821",
    borderStrong: "#62352B",
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
 * Roles derived from the Stone oxblood palette. Screens consume semantic roles
 * so the brand can stay coherent in both light and dark appearance modes.
 */
export const derived = {
  light: {
    surfaceSunken: "#F0E2DC",
    surfacePressed: "#F5EAE6",
    accentSoft: "#F3E3DE",
    accentSoftBorder: "#D9B9AF",
    accentText: "#2E0702",
    overlay: "rgba(46, 7, 2, 0.42)",
    scrim: "rgba(46, 7, 2, 0.06)",
    shadow: "#2E0702",
  },
  dark: {
    surfaceSunken: "#120706",
    surfacePressed: "#3A1C16",
    accentSoft: "#3B1712",
    accentSoftBorder: "#643026",
    accentText: "#F0B3A6",
    overlay: "rgba(8, 3, 2, 0.64)",
    scrim: "rgba(255, 247, 244, 0.05)",
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
    neutral: { fg: "#725E58", bg: "#F1E9E6", border: "#DECFC9" },
    accent: { fg: "#2E0702", bg: "#F3E3DE", border: "#D9B9AF" },
  },
  dark: {
    success: { fg: "#7FD6A6", bg: "#16301F", border: "#27543A" },
    warning: { fg: "#E5BE72", bg: "#332815", border: "#584426" },
    danger: { fg: "#F0A2AB", bg: "#341B21", border: "#5A2F38" },
    info: { fg: "#9CC5EC", bg: "#182838", border: "#2C4560" },
    neutral: { fg: "#C6AEA7", bg: "#2C1915", border: "#4D2A23" },
    accent: { fg: "#F0B3A6", bg: "#3B1712", border: "#643026" },
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
