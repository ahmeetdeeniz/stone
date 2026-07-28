import * as DocumentPicker from "expo-document-picker";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { exportCalendarIcs } from "@stone/domain";
import type { SQLiteCalendarRepository } from "../infrastructure/storage/calendar";

const MAX_ICS_BYTES = 2_000_000;

export async function pickCalendarIcs(): Promise<string | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ["text/calendar", "text/plain", "application/octet-stream"],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled) return null;
  const asset = result.assets[0];
  if (!asset) return null;
  if (asset.size != null && asset.size > MAX_ICS_BYTES)
    throw new Error("Calendar file is too large.");
  const bytes = await new File(asset.uri).bytes();
  if (bytes.byteLength > MAX_ICS_BYTES) throw new Error("Calendar file is too large.");
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export async function shareCalendarIcs(
  ownerId: string,
  repository: SQLiteCalendarRepository,
): Promise<void> {
  if (!(await Sharing.isAvailableAsync()))
    throw new Error("Sharing is not available on this device.");
  const items = await repository.listForExport(ownerId);
  const file = new File(Paths.cache, "stone-calendar.ics");
  file.write(exportCalendarIcs(items));
  await Sharing.shareAsync(file.uri, {
    mimeType: "text/calendar",
    dialogTitle: "Stone calendar export",
    UTI: "com.apple.ical.ics",
  });
}
