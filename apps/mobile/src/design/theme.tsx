import { createContext, useContext, useMemo, useState, type PropsWithChildren } from "react";
import { useColorScheme } from "react-native";
import type { ThemePreference } from "@stone/domain";
import { colors } from "./tokens";

export interface ThemeColors {
  background: string;
  backgroundSecondary: string;
  surface: string;
  surfaceRaised: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  border: string;
  borderStrong: string;
  primary: string;
  primaryPressed: string;
  onPrimary: string;
}

interface ThemeContextValue {
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
  mode: "light" | "dark";
  colors: ThemeColors;
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
  const value = useMemo<ThemeContextValue>(
    () => ({
      preference,
      setPreference,
      mode,
      colors: {
        ...palette,
        primary: colors.brand.purple600,
        primaryPressed: colors.brand.purple500,
        onPrimary: "#FFFFFF",
      },
    }),
    [mode, palette, preference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used inside ThemeProvider");
  return value;
}
