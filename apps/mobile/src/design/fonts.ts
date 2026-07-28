import { Inter_400Regular } from "@expo-google-fonts/inter/400Regular";
import { Inter_500Medium } from "@expo-google-fonts/inter/500Medium";
import { Inter_600SemiBold } from "@expo-google-fonts/inter/600SemiBold";
import { Inter_700Bold } from "@expo-google-fonts/inter/700Bold";
import { useFonts as useInterFonts } from "@expo-google-fonts/inter/useFonts";
import { resolveStoneFontReadiness, type StoneFontReadiness } from "./font-readiness";

export function useStoneFonts(): StoneFontReadiness {
  const [interLoaded, interError] = useInterFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });
  return resolveStoneFontReadiness(interLoaded, Boolean(interError));
}
