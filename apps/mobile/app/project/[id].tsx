import { EmptyState } from "../../src/components/states";
import { Screen } from "../../src/components/ui";

export default function ProjectPlaceholder() {
  return (
    <Screen>
      <EmptyState
        title="Proje detayı henüz yok"
        description="Project tracking Milestone 3 kapsamındadır."
      />
    </Screen>
  );
}
