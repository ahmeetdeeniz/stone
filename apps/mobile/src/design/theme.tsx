import { createContext, useContext, useMemo, useState, type PropsWithChildren } from "react";
import { useColorScheme, type ViewStyle } from "react-native";
import type { ThemePreference } from "@stone/domain";
import {
  colors,
  derived,
  elevation,
  statusTones,
  type ElevationLevel,
  type StatusTone,
  type ToneColors,
} from "./tokens";

export interface ThemeColors {
  background: string;
  backgroundSecondary: string;
  surface: string;
  surfaceRaised: string;
  surfaceSunken: string;
  surfacePressed: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  border: string;
  borderStrong: string;
  primary: string;
  primaryPressed: string;
  primarySoft: string;
  primarySoftBorder: string;
  primaryText: string;
  onPrimary: string;
  overlay: string;
  scrim: string;
}

interface ThemeContextValue {
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
  mode: "light" | "dark";
  isDark: boolean;
  colors: ThemeColors;
  tones: Record<StatusTone, ToneColors>;
  elevation: Record<ElevationLevel, ViewStyle>;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({
  children,
  initialPreference = "system",
}: PropsWithChildren<{ initialPreference?: ThemePreference }>) {
  const systemScheme = useColorScheme();
  const [preference, setPreference] = useState<ThemePreference>(initialPreference);
  const mode = preference === "system" ? (systemScheme === "dark" ? "dark" : "light") : preference;
  const palette = mode === "dark" ? colors.dark : colors.light;
  const extras = mode === "dark" ? derived.dark : derived.light;
  const value = useMemo<ThemeContextValue>(
    () => ({
      preference,
      setPreference,
      mode,
      isDark: mode === "dark",
      colors: {
        ...palette,
        surfaceSunken: extras.surfaceSunken,
        surfacePressed: extras.surfacePressed,
        primary: colors.brand.purple600,
        primaryPressed: mode === "dark" ? colors.brand.purple500 : "#4A0C05",
        primarySoft: extras.accentSoft,
        primarySoftBorder: extras.accentSoftBorder,
        primaryText: extras.accentText,
        onPrimary: "#FFFFFF",
        overlay: extras.overlay,
        scrim: extras.scrim,
      },
      tones: mode === "dark" ? statusTones.dark : statusTones.light,
      elevation: mode === "dark" ? elevation.dark : elevation.light,
    }),
    [extras, mode, palette, preference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used inside ThemeProvider");
  return value;
}
