import { EmptyState } from "../src/components/states";
import { Screen } from "../src/components/ui";

export default function EditorPlaceholder() {
  return (
    <Screen>
      <EmptyState
        title="Editor henüz yok"
        description="Live Preview ve Markdown editor Milestone 2 kapsamındadır."
      />
    </Screen>
  );
}
