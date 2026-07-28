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
export const radii = { sm: 8, md: 12, lg: 16, xl: 22, pill: 999 } as const;
export const typography = {
  display: { fontSize: 30, lineHeight: 36, fontFamily: "Inter_700Bold" },
  title1: { fontSize: 24, lineHeight: 30, fontFamily: "Inter_700Bold" },
  title2: { fontSize: 20, lineHeight: 26, fontFamily: "Inter_700Bold" },
  title3: { fontSize: 17, lineHeight: 23, fontFamily: "Inter_600SemiBold" },
  body: { fontSize: 16, lineHeight: 24, fontFamily: "Inter_400Regular" },
  bodySmall: { fontSize: 14, lineHeight: 20, fontFamily: "Inter_400Regular" },
  label: { fontSize: 13, lineHeight: 18, fontFamily: "Inter_600SemiBold" },
  caption: { fontSize: 12, lineHeight: 16, fontFamily: "Inter_500Medium" },
} as const;
