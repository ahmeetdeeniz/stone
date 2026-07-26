import { ResponsiveContent } from "../../src/components/responsive";
import { EmptyState } from "../../src/components/states";
import { Screen, StoneText } from "../../src/components/ui";
import { spacing } from "../../src/design/tokens";

export default function TodayScreen() {
  return (
    <Screen>
      <ResponsiveContent>
        <StoneText variant="title1" style={{ marginBottom: spacing.xl }}>
          Bugün
        </StoneText>
        <EmptyState
          title="Bugün görünümü hazır"
          description="Görev ve proje özetleri proje tracking milestone'ında eklenecek."
        />
      </ResponsiveContent>
    </Screen>
  );
}
