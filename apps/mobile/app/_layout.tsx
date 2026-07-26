import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useStoneFonts } from "../src/design/fonts";
import { LoadingState } from "../src/components/states";
import { AppProvider } from "../src/providers/app-provider";
import { useTheme } from "../src/design/theme";

function RootNavigator() {
  const loaded = useStoneFonts();
  const { mode } = useTheme();
  if (!loaded) return <LoadingState label="Stone yükleniyor" />;
  return (
    <>
      <StatusBar style={mode === "dark" ? "light" : "dark"} />
      <Stack screenOptions={{ headerShown: false }} />
    </>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AppProvider>
        <RootNavigator />
      </AppProvider>
    </SafeAreaProvider>
  );
}
