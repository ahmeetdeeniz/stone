import {
  useFonts as useInterFonts,
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from "@expo-google-fonts/inter";
import { useFonts as useExpoFonts } from "expo-font";
import { BONGITA_FONT_FAMILY, bongitaFont } from "./font-assets";

export function useStoneFonts(): boolean {
  const [interLoaded] = useInterFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });
  const [bongitaLoaded] = useExpoFonts({
    [BONGITA_FONT_FAMILY]: bongitaFont,
  });
  return interLoaded && bongitaLoaded;
}
