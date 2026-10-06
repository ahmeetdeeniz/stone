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
  /**
   * Neutral "stone" greys carry the interface; colour is reserved for the one accent and for
   * status. Surfaces are white-on-near-white so lists read as paper, not as tinted cards.
   */
  light: {
    background: "#FAFAF9",
    backgroundSecondary: "#F5F5F4",
    surface: "#FFFFFF",
    surfaceRaised: "#FFFFFF",
    text: "#1C1917",
    textSecondary: "#57534E",
    textMuted: "#857F7A",
    border: "#E7E5E4",
    borderStrong: "#D6D3D1",
  },
  dark: {
    background: "#0C0A09",
    backgroundSecondary: "#141210",
    surface: "#1A1715",
    surfaceRaised: "#23201D",
    text: "#F5F5F4",
    textSecondary: "#C9C4C0",
    textMuted: "#948E89",
    border: "#2C2825",
    borderStrong: "#403A36",
  },
  /** The single accent: a brick red from the Stone mark, tuned for contrast in each mode. */
  accent: {
    light: {
      base: "#A13D27",
      pressed: "#86321F",
      soft: "#FBEFEC",
      softBorder: "#F1D2CA",
      text: "#8F3420",
      on: "#FFFFFF",
    },
    dark: {
      base: "#F08D74",
      pressed: "#E07A61",
      soft: "#33201B",
      softBorder: "#4D2E26",
      text: "#F5A895",
      on: "#1C1917",
    },
  },
  status: {
    success: "#2F9E68",
    warning: "#C58A1D",
    danger: "#C95B67",
    info: "#4B86C5",
    neutral: "#8E899F",
  },
} as const;

/** Supporting roles derived from the neutral palette. */
export const derived = {
  light: {
    surfaceSunken: "#F2F1EF",
    surfacePressed: "#F2F1EF",
    overlay: "rgba(28, 25, 23, 0.42)",
    scrim: "rgba(28, 25, 23, 0.04)",
    shadow: "#1C1917",
  },
  dark: {
    surfaceSunken: "#141210",
    surfacePressed: "#26221F",
    overlay: "rgba(0, 0, 0, 0.64)",
    scrim: "rgba(255, 255, 255, 0.04)",
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
    neutral: { fg: "#57534E", bg: "#F2F1EF", border: "#E2DFDC" },
    accent: { fg: "#8F3420", bg: "#FBEFEC", border: "#F1D2CA" },
  },
  dark: {
    success: { fg: "#7FD6A6", bg: "#16301F", border: "#27543A" },
    warning: { fg: "#E5BE72", bg: "#332815", border: "#584426" },
    danger: { fg: "#F0A2AB", bg: "#341B21", border: "#5A2F38" },
    info: { fg: "#9CC5EC", bg: "#182838", border: "#2C4560" },
    neutral: { fg: "#C9C4C0", bg: "#23201D", border: "#3A3531" },
    accent: { fg: "#F5A895", bg: "#33201B", border: "#4D2E26" },
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
      shadowOpacity: 0.035,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 1 },
      elevation: 1,
    },
    md: {
      shadowColor: derived.light.shadow,
      shadowOpacity: 0.06,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 4 },
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
/**
 * Face for screen and section headings (display, title1, title2). It is the one place a licensed
 * display font (e.g. Hanela Rusty) would go: load it in design/fonts.ts and name it here.
 * Everything else stays Inter.
 */
export const DISPLAY_FONT = "Inter_700Bold";

export const typography = {
  display: {
    fontSize: 30,
    lineHeight: 36,
    fontFamily: DISPLAY_FONT,
    letterSpacing: -0.7,
  },
  title1: { fontSize: 24, lineHeight: 30, fontFamily: DISPLAY_FONT, letterSpacing: -0.5 },
  title2: { fontSize: 20, lineHeight: 26, fontFamily: DISPLAY_FONT, letterSpacing: -0.35 },
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
