import { useLocalSearchParams } from "expo-router";
import { NoteEditor } from "../src/notes/NoteEditor";

export default function EditorScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  return <NoteEditor id={id} />;
}
