import * as Crypto from "expo-crypto";
import type { Document } from "@stone/domain";
import type { TranslationKey, TranslationParameters } from "@stone/i18n";

type Translate = (key: TranslationKey, parameters?: TranslationParameters) => string;

export type NoteTemplate = "blank" | "daily" | "meeting";
export const NOTE_TEMPLATES: readonly NoteTemplate[] = ["blank", "daily", "meeting"];

/** Title and Markdown for a new note. Daily notes are titled with the ISO date so they sort. */
export function noteFromTemplate(
  template: NoteTemplate,
  context: { t: Translate; today: string; title?: string },
): { title: string; markdown: string } {
  const { t, today } = context;
  if (template === "daily") {
    const title = context.title ?? today;
    return {
      title,
      markdown: [
        `# ${title}`,
        "",
        `## ${t("templates.daily.focus")}`,
        "- [ ] ",
        "",
        `## ${t("templates.daily.notes")}`,
        "",
      ].join("\n"),
    };
  }
  if (template === "meeting") {
    const title = context.title ?? t("templates.meeting.title", { date: today });
    return {
      title,
      markdown: [
        `# ${title}`,
        "",
        `**${t("templates.meeting.attendees")}:** `,
        "",
        `## ${t("templates.meeting.agenda")}`,
        "- ",
        "",
        `## ${t("templates.meeting.notes")}`,
        "",
        `## ${t("templates.meeting.actions")}`,
        "- [ ] ",
        "",
      ].join("\n"),
    };
  }
  const title = context.title ?? t("notes.untitled");
  return { title, markdown: `# ${title}\n\n` };
}

export function newNoteDocument(input: {
  ownerId: string;
  deviceId: string;
  title: string;
  markdown: string;
}): Document {
  const now = new Date().toISOString();
  return {
    id: Crypto.randomUUID(),
    ownerId: input.ownerId,
    kind: "note",
    title: input.title,
    markdown: input.markdown,
    path: null,
    projectId: null,
    isPinned: false,
    revision: 1,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    updatedByDeviceId: input.deviceId,
  };
}

/** The device's calendar day as YYYY-MM-DD. */
export function localIsoDate(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
