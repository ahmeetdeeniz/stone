import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { useStoneFonts } from "../src/design/fonts";
import { LoadingState } from "../src/components/states";
import { AppProvider } from "../src/providers/app-provider";
import { useTheme } from "../src/design/theme";
import { I18nProvider, useI18n } from "../src/i18n/provider";

function RootNavigator() {
  const { ready } = useStoneFonts();
  const { mode } = useTheme();
  const { ready: localeReady, t } = useI18n();
  if (!ready || !localeReady) return <LoadingState label={t("app.loading")} />;
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
        <I18nProvider>
          <AppProvider>
            <RootNavigator />
          </AppProvider>
        </I18nProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
