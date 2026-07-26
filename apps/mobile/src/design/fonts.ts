import {
  useFonts as useInterFonts,
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from "@expo-google-fonts/inter";
import { useFonts as useExpoFonts } from "expo-font";
import bongitaFont from "../../assets/fonts/Bongita-Regular.otf";

export function useStoneFonts(): boolean {
  const [interLoaded] = useInterFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });
  const [bongitaLoaded] = useExpoFonts({ Bongita: bongitaFont });
  return interLoaded && bongitaLoaded;
}
