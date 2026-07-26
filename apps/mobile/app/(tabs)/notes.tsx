import { ResponsiveContent } from "../../src/components/responsive";
import { EmptyState } from "../../src/components/states";
import { Screen, StoneText } from "../../src/components/ui";
import { spacing } from "../../src/design/tokens";

export default function NotesScreen() {
  return (
    <Screen>
      <ResponsiveContent>
        <StoneText variant="display" style={{ marginBottom: spacing.sm }}>
          Stone
        </StoneText>
        <StoneText variant="title1" style={{ marginBottom: spacing.xl }}>
          Notlar
        </StoneText>
        <EmptyState
          title="Not çalışma alanı hazır"
          description="Not oluşturma ve Markdown düzenleme bir sonraki milestone'da gelecek."
        />
      </ResponsiveContent>
    </Screen>
  );
}
