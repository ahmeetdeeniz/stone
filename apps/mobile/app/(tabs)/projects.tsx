import { ResponsiveContent } from "../../src/components/responsive";
import { EmptyState } from "../../src/components/states";
import { Screen, StoneText } from "../../src/components/ui";
import { spacing } from "../../src/design/tokens";

export default function ProjectsScreen() {
  return (
    <Screen>
      <ResponsiveContent>
        <StoneText variant="title1" style={{ marginBottom: spacing.xl }}>
          Projeler
        </StoneText>
        <EmptyState
          title="Proje çalışma alanı hazır"
          description="Proje takibi ve Markdown-backed proje ekranları daha sonraki milestone'da gelecek."
        />
      </ResponsiveContent>
    </Screen>
  );
}
