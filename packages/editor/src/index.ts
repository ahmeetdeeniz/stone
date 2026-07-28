import { markdown } from "@codemirror/lang-markdown";
import { highlightSelectionMatches, search } from "@codemirror/search";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import {
  applyFormatting,
  cycleHeading,
  parseSyntaxTree,
  sanitizeExternalUrl,
  toggleLinePrefix,
  type FormattingKind,
  type MarkdownBlock,
  type MarkdownInlineToken,
} from "@stone/markdown";

export const EDITOR_BRIDGE_PROTOCOL_VERSION = 1 as const;
export const editableCompartment = new Compartment();

export type EditorCommand =
  | "toggleBold"
  | "toggleItalic"
  | "toggleStrike"
  | "toggleInlineCode"
  | "toggleBulletList"
  | "toggleNumberedList"
  | "toggleTask"
  | "toggleQuote"
  | "cycleHeading"
  | "insertLink"
  | "undo"
  | "redo"
  | "find";

export type EditorBridgeMessage =
  | {
      protocolVersion: 1;
      type: "initialize";
      payload: { documentId: string; markdown: string; readOnly?: boolean };
    }
  | { protocolVersion: 1; type: "setDocument"; payload: { markdown: string; documentId?: string } }
  | { protocolVersion: 1; type: "setTheme"; payload: { theme: "light" | "dark" } }
  | { protocolVersion: 1; type: "setReadOnly"; payload: { readOnly: boolean } }
  | {
      protocolVersion: 1;
      type: "executeCommand";
      payload: { command: EditorCommand; url?: string };
    }
  | { protocolVersion: 1; type: "requestState" }
  | { protocolVersion: 1; type: "setFindQuery"; payload: { query: string } }
  | { protocolVersion: 1; type: "ready"; payload: { documentId: string } }
  | {
      protocolVersion: 1;
      type: "documentChanged";
      payload: { markdown: string; from: number; to: number };
    }
  | { protocolVersion: 1; type: "selectionChanged"; payload: { from: number; to: number } }
  | { protocolVersion: 1; type: "saveRequested"; payload: { markdown: string } }
  | { protocolVersion: 1; type: "openLink"; payload: { url: string } }
  | {
      protocolVersion: 1;
      type: "taskToggled";
      payload: { from: number; to: number; checked: boolean };
    }
  | {
      protocolVersion: 1;
      type: "stateSnapshot";
      payload: { markdown: string; from: number; to: number };
    }
  | { protocolVersion: 1; type: "editorError"; payload: { message: string } };

const commands = new Set<EditorCommand>([
  "toggleBold",
  "toggleItalic",
  "toggleStrike",
  "toggleInlineCode",
  "toggleBulletList",
  "toggleNumberedList",
  "toggleTask",
  "toggleQuote",
  "cycleHeading",
  "insertLink",
  "undo",
  "redo",
  "find",
]);

const messageTypes = new Set<EditorBridgeMessage["type"]>([
  "initialize",
  "setDocument",
  "setTheme",
  "setReadOnly",
  "executeCommand",
  "requestState",
  "setFindQuery",
  "ready",
  "documentChanged",
  "selectionChanged",
  "saveRequested",
  "openLink",
  "taskToggled",
  "stateSnapshot",
  "editorError",
]);

export function isEditorBridgeMessage(value: unknown): value is EditorBridgeMessage {
  if (typeof value !== "object" || value === null) return false;
  const message = value as Record<string, unknown>;
  if (
    message.protocolVersion !== EDITOR_BRIDGE_PROTOCOL_VERSION ||
    typeof message.type !== "string"
  ) {
    return false;
  }
  if (!messageTypes.has(message.type as EditorBridgeMessage["type"])) return false;
  if (message.type === "executeCommand") {
    const payload = message.payload;
    return (
      isRecord(payload) &&
      typeof payload.command === "string" &&
      commands.has(payload.command as EditorCommand)
    );
  }
  if (message.type === "initialize") {
    const payload = message.payload;
    return (
      isRecord(payload) &&
      typeof payload.documentId === "string" &&
      typeof payload.markdown === "string" &&
      (payload.readOnly === undefined || typeof payload.readOnly === "boolean")
    );
  }
  if (message.type === "setTheme") {
    return (
      isRecord(message.payload) &&
      (message.payload.theme === "light" || message.payload.theme === "dark")
    );
  }
  if (message.type === "setReadOnly")
    return isRecord(message.payload) && typeof message.payload.readOnly === "boolean";
  if (message.type === "setFindQuery")
    return isRecord(message.payload) && typeof message.payload.query === "string";
  if (message.type === "requestState") return message.payload === undefined;
  if (message.type === "setDocument") {
    return (
      isRecord(message.payload) &&
      typeof message.payload.markdown === "string" &&
      (message.payload.documentId === undefined || typeof message.payload.documentId === "string")
    );
  }
  if (message.type === "ready")
    return isRecord(message.payload) && typeof message.payload.documentId === "string";
  if (message.type === "selectionChanged" || message.type === "stateSnapshot") {
    return (
      isRecord(message.payload) &&
      typeof message.payload.from === "number" &&
      typeof message.payload.to === "number" &&
      (message.type === "selectionChanged" || typeof message.payload.markdown === "string")
    );
  }
  if (message.type === "documentChanged") {
    return (
      isRecord(message.payload) &&
      typeof message.payload.markdown === "string" &&
      typeof message.payload.from === "number" &&
      typeof message.payload.to === "number"
    );
  }
  if (message.type === "saveRequested")
    return isRecord(message.payload) && typeof message.payload.markdown === "string";
  if (message.type === "openLink")
    return isRecord(message.payload) && typeof message.payload.url === "string";
  if (message.type === "taskToggled") {
    return (
      isRecord(message.payload) &&
      typeof message.payload.from === "number" &&
      typeof message.payload.to === "number" &&
      typeof message.payload.checked === "boolean"
    );
  }
  if (message.type === "editorError")
    return isRecord(message.payload) && typeof message.payload.message === "string";
  return false;
}

export function createEditorState(
  source: string,
  readOnly = false,
  extraExtensions: readonly Extension[] = [],
): EditorState {
  return EditorState.create({
    doc: source,
    extensions: [
      markdown(),
      editableCompartment.of(EditorView.editable.of(!readOnly)),
      search(),
      highlightSelectionMatches(),
      livePreviewExtension(),
      ...extraExtensions,
    ],
  });
}

export function livePreviewExtension(): Extension {
  return ViewPlugin.fromClass(
    class {
      public decorations: DecorationSet;

      public constructor(public readonly view: EditorView) {
        this.decorations = buildLivePreviewDecorations(view.state);
      }

      public update(update: ViewUpdate): void {
        if (update.docChanged || update.selectionSet) {
          this.decorations = buildLivePreviewDecorations(update.state);
        }
      }
    },
    { decorations: (value) => value.decorations },
  );
}

export function buildLivePreviewDecorations(state: EditorState): DecorationSet {
  const syntax = parseSyntaxTree(state.doc.toString());
  const activeLine = state.doc.lineAt(state.selection.main.head).number - 1;
  const ranges: Array<{ from: number; to: number; decoration: Decoration }> = [];
  for (const block of syntax.blocks) {
    if (activeLine >= block.lineFrom && activeLine <= block.lineTo) continue;
    addBlockDecorations(ranges, state, block);
    for (const token of block.inline) addInlineDecorations(ranges, state, token);
  }
  ranges.sort((left, right) => left.from - right.from || left.to - right.to);
  return Decoration.set(
    ranges.map((range) => range.decoration.range(range.from, range.to)),
    true,
  );
}

export function applyEditorCommand(
  source: string,
  from: number,
  to: number,
  command: EditorCommand,
  url?: string,
): { source: string; from: number; to: number } {
  if (
    command === "toggleBold" ||
    command === "toggleItalic" ||
    command === "toggleStrike" ||
    command === "toggleInlineCode"
  ) {
    const kind: FormattingKind =
      command === "toggleBold"
        ? "bold"
        : command === "toggleItalic"
          ? "italic"
          : command === "toggleStrike"
            ? "strike"
            : "inlineCode";
    const next = applyFormatting(source, { from, to }, kind);
    return { source: next, from, to: to + (next.length - source.length) };
  }
  if (command === "toggleBulletList")
    return editLine(source, from, (line) => toggleLinePrefix(source, line, "- "));
  if (command === "toggleNumberedList")
    return editLine(source, from, (line) => toggleLinePrefix(source, line, "1. "));
  if (command === "toggleTask")
    return editLine(source, from, (line) => toggleLinePrefix(source, line, "- [ ] "));
  if (command === "toggleQuote")
    return editLine(source, from, (line) => toggleLinePrefix(source, line, "> "));
  if (command === "cycleHeading")
    return editLine(source, from, (line) => cycleHeading(source, line));
  if (command === "insertLink") {
    const safeUrl = sanitizeExternalUrl(url ?? "https://stone.local");
    if (!safeUrl) return { source, from, to };
    const selected = source.slice(from, to) || "link";
    const replacement = `[${selected}](${safeUrl})`;
    return {
      source: `${source.slice(0, from)}${replacement}${source.slice(to)}`,
      from: from + 1,
      to: from + 1 + selected.length,
    };
  }
  return { source, from, to };
}

class EmptyWidget extends WidgetType {
  public toDOM(): HTMLElement {
    return document.createElement("span");
  }
}

class TextWidget extends WidgetType {
  public constructor(private readonly text: string) {
    super();
  }

  public override eq(other: TextWidget): boolean {
    return this.text === other.text;
  }

  public override toDOM(): HTMLElement {
    const element = document.createElement("span");
    element.textContent = this.text;
    return element;
  }
}

class FrontmatterWidget extends WidgetType {
  public constructor(private readonly propertyCount: number) {
    super();
  }

  public override eq(other: FrontmatterWidget): boolean {
    return this.propertyCount === other.propertyCount;
  }

  public override toDOM(): HTMLElement {
    const element = document.createElement("div");
    element.className = "stone-frontmatter-summary";
    element.setAttribute("aria-label", "Belge özellikleri");
    element.textContent = `Belge özellikleri · ${this.propertyCount} alan`;
    return element;
  }
}

class TaskCheckboxWidget extends WidgetType {
  public constructor(
    private readonly checked: boolean,
    private readonly from: number,
    private readonly to: number,
  ) {
    super();
  }

  public override eq(other: TaskCheckboxWidget): boolean {
    return this.checked === other.checked && this.from === other.from && this.to === other.to;
  }

  public override toDOM(): HTMLElement {
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = this.checked;
    checkbox.dataset.stoneTaskFrom = String(this.from);
    checkbox.dataset.stoneTaskTo = String(this.to);
    checkbox.setAttribute(
      "aria-label",
      this.checked ? "Görevi tamamlandı olarak işaretle" : "Görevi tamamla",
    );
    checkbox.className = "stone-task-checkbox";
    return checkbox;
  }

  public override ignoreEvent(): boolean {
    return false;
  }
}

function addBlockDecorations(
  ranges: Array<{ from: number; to: number; decoration: Decoration }>,
  state: EditorState,
  block: MarkdownBlock,
): void {
  const line = state.doc.line(block.lineFrom + 1);
  const text = line.text;
  if (block.type === "frontmatter") {
    const propertyCount = block.text
      .split("\n")
      .filter((value) => /^\s*[\w-]+\s*:/u.test(value)).length;
    ranges.push({
      from: block.from,
      to: block.to,
      decoration: Decoration.replace({
        widget: new FrontmatterWidget(propertyCount),
        block: true,
      }),
    });
    return;
  }
  const heading = text.match(/^(\s{0,3})#{1,6}\s/u);
  if (heading) {
    ranges.push({
      from: line.from + heading[1]!.length,
      to: line.from + heading[0].length,
      decoration: Decoration.replace({ widget: new EmptyWidget() }),
    });
    ranges.push({
      from: block.from,
      to: block.to,
      decoration: Decoration.mark({
        class: `stone-live-heading stone-live-heading-${block.level ?? 1}`,
      }),
    });
  }
  const list = text.match(/^(\s*)(?:[-+*]|\d+[.)])\s+/u);
  if (list && block.type === "list") {
    const prefixTo = block.task?.markerFrom ?? line.from + list[0].length;
    const prefixWidget = /^\s*\d/u.test(list[0])
      ? `${list[0].trimStart().replace(/\s+$/u, "")} `
      : "• ";
    ranges.push({
      from: line.from + list[1]!.length,
      to: prefixTo,
      decoration: Decoration.replace({ widget: new TextWidget(prefixWidget) }),
    });
    if (block.task) {
      ranges.push({
        from: block.task.markerFrom,
        to: block.task.markerTo,
        decoration: Decoration.replace({
          widget: new TaskCheckboxWidget(
            block.task.checked,
            block.task.markerFrom,
            block.task.markerTo,
          ),
        }),
      });
    }
  }
  if (block.type === "code")
    ranges.push({
      from: block.from,
      to: block.to,
      decoration: Decoration.mark({ class: "stone-live-code" }),
    });
  if (block.type === "blockquote")
    ranges.push({
      from: block.from,
      to: block.to,
      decoration: Decoration.mark({ class: "stone-live-blockquote" }),
    });
  if (block.type === "callout")
    ranges.push({
      from: block.from,
      to: block.to,
      decoration: Decoration.mark({ class: "stone-live-callout" }),
    });
  if (block.type === "table")
    ranges.push({
      from: block.from,
      to: block.to,
      decoration: Decoration.mark({ class: "stone-live-table" }),
    });
  if (block.type === "horizontalRule")
    ranges.push({
      from: block.from,
      to: block.to,
      decoration: Decoration.mark({ class: "stone-live-rule" }),
    });
}

function addInlineDecorations(
  ranges: Array<{ from: number; to: number; decoration: Decoration }>,
  state: EditorState,
  token: MarkdownInlineToken,
): void {
  const text = state.doc.sliceString(token.from, token.to);
  const markerLength =
    token.type === "strike"
      ? 2
      : token.type === "inlineCode"
        ? 1
        : token.type === "link"
          ? 1
          : text.startsWith("__") || text.startsWith("**")
            ? 2
            : 1;
  if (token.type === "link") {
    const close = text.lastIndexOf(")");
    const labelEnd = text.indexOf("](");
    if (labelEnd > 0 && close > labelEnd) {
      ranges.push({
        from: token.from,
        to: token.from + 1,
        decoration: Decoration.replace({ widget: new EmptyWidget() }),
      });
      ranges.push({
        from: token.from + labelEnd,
        to: token.from + close + 1,
        decoration: Decoration.replace({ widget: new EmptyWidget() }),
      });
      ranges.push({
        from: token.from + 1,
        to: token.from + labelEnd,
        decoration: Decoration.mark({ class: "stone-live-link" }),
      });
    }
    return;
  }
  if (text.length > markerLength * 2) {
    ranges.push({
      from: token.from,
      to: token.from + markerLength,
      decoration: Decoration.replace({ widget: new EmptyWidget() }),
    });
    ranges.push({
      from: token.to - markerLength,
      to: token.to,
      decoration: Decoration.replace({ widget: new EmptyWidget() }),
    });
    ranges.push({
      from: token.from + markerLength,
      to: token.to - markerLength,
      decoration: Decoration.mark({ class: `stone-live-${token.type}` }),
    });
  }
}

function editLine(
  source: string,
  from: number,
  edit: (lineFrom: number) => string,
): { source: string; from: number; to: number } {
  const lineFrom = source.lastIndexOf("\n", Math.max(0, from - 1)) + 1;
  const next = edit(lineFrom);
  const nextLineEnd = next.indexOf("\n", lineFrom);
  return { source: next, from: lineFrom, to: nextLineEnd === -1 ? next.length : nextLineEnd };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
