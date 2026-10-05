import { useLocalSearchParams } from "expo-router";
import { NotebookEditor } from "../../src/drawings/NotebookEditor";

export default function NotebookScreen() {
  const { id, layout, paper } = useLocalSearchParams<{
    id?: string;
    layout?: string;
    paper?: string;
  }>();
  return <NotebookEditor id={id} layout={layout} paper={paper} />;
}
