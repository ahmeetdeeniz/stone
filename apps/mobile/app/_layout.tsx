import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { useStoneFonts } from "../src/design/fonts";
import { LoadingState } from "../src/components/states";
import { AppProvider } from "../src/providers/app-provider";
import { useTheme } from "../src/design/theme";

function RootNavigator() {
  const { ready } = useStoneFonts();
  const { mode } = useTheme();
  if (!ready) return <LoadingState label="Stone yükleniyor" />;
  return (
    <>
      <StatusBar style={mode === "dark" ? "light" : "dark"} />
      <Stack screenOptions={{ headerShown: false }} />
    </>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AppProvider>
          <RootNavigator />
        </AppProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
