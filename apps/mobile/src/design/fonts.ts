import {
  useFonts as useInterFonts,
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from "@expo-google-fonts/inter";
import { useFonts as useExpoFonts } from "expo-font";
import { BONGITA_FONT_FAMILY, bongitaFont } from "./font-assets";
import { resolveStoneFontReadiness, type StoneFontReadiness } from "./font-readiness";

export function useStoneFonts(): StoneFontReadiness {
  const [interLoaded, interError] = useInterFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });
  const [bongitaLoaded, bongitaError] = useExpoFonts({
    [BONGITA_FONT_FAMILY]: bongitaFont,
  });
  return resolveStoneFontReadiness(
    interLoaded,
    bongitaLoaded,
    Boolean(interError),
    Boolean(bongitaError),
  );
}
