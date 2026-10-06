import { useLocalSearchParams } from "expo-router";
import { NotebookEditor } from "../../src/drawings/NotebookEditor";

export default function NotebookScreen() {
  const { id, layout, paper, from } = useLocalSearchParams<{
    id?: string;
    layout?: string;
    paper?: string;
    from?: string;
  }>();
  return <NotebookEditor id={id} layout={layout} paper={paper} from={from} />;
}
