import { type PropsWithChildren } from "react";
import { useWindowDimensions, View } from "react-native";
import { spacing } from "../design/tokens";
import { useTheme } from "../design/theme";

export function ResponsiveContent({ children }: PropsWithChildren) {
  const { width } = useWindowDimensions();
  const { colors } = useTheme();
  const tablet = width >= 768;
  return (
    <View
      style={{
        flex: 1,
        width: "100%",
        maxWidth: tablet ? 900 : undefined,
        alignSelf: "center",
        paddingHorizontal: tablet ? spacing.xxxl : 0,
        backgroundColor: colors.background,
      }}
    >
      {children}
    </View>
  );
}
