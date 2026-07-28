import { defaultKeymap, history, historyKeymap, redo, undo } from "@codemirror/commands";
import { findNext, SearchQuery, setSearchQuery } from "@codemirror/search";
import { highlightActiveLine, keymap } from "@codemirror/view";
import { extractTasks, toggleTask } from "@stone/markdown";
import { EditorView } from "@codemirror/view";
import {
  applyEditorCommand,
  createEditorState,
  editableCompartment,
  isEditorBridgeMessage,
  type EditorBridgeMessage,
} from "./index.js";

declare global {
  interface Window {
    ReactNativeWebView?: { postMessage(message: string): void };
  }
}

let documentId = "";
let view: EditorView | null = null;

function post(message: EditorBridgeMessage): void {
  window.ReactNativeWebView?.postMessage(JSON.stringify(message));
}

function initialize(markdownSource: string, readOnly: boolean): void {
  view?.destroy();
  const state = createEditorState(markdownSource, readOnly, [
    history(),
    highlightActiveLine(),
    keymap.of([...defaultKeymap, ...historyKeymap]),
    EditorView.domEventHandlers({
      change(event, currentView) {
        const target = event.target;
        if (
          !(target instanceof HTMLInputElement) ||
          !target.classList.contains("stone-task-checkbox")
        )
          return false;
        const from = Number(target.dataset.stoneTaskFrom);
        const to = Number(target.dataset.stoneTaskTo);
        const task = extractTasks(currentView.state.doc.toString()).find(
          (item) => item.markerFrom === from && item.markerTo === to,
        );
        if (!task) return false;
        currentView.dispatch({
          changes: {
            from: 0,
            to: currentView.state.doc.length,
            insert: toggleTask(currentView.state.doc.toString(), task, target.checked),
          },
          userEvent: "input",
        });
        post({
          protocolVersion: 1,
          type: "taskToggled",
          payload: { from, to, checked: target.checked },
        });
        return true;
      },
      click(event) {
        const target = event.target;
        if (!(target instanceof HTMLElement) || !target.matches("a[data-stone-url]")) return false;
        const url = target.getAttribute("data-stone-url");
        if (url) post({ protocolVersion: 1, type: "openLink", payload: { url } });
        return true;
      },
    }),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        post({
          protocolVersion: 1,
          type: "documentChanged",
          payload: {
            markdown: update.state.doc.toString(),
            from: update.state.selection.main.from,
            to: update.state.selection.main.to,
          },
        });
      }
      if (update.selectionSet || update.docChanged) {
        post({
          protocolVersion: 1,
          type: "selectionChanged",
          payload: { from: update.state.selection.main.from, to: update.state.selection.main.to },
        });
      }
    }),
    EditorView.contentAttributes.of({ autocapitalize: "sentences", spellcheck: "true" }),
    EditorView.theme({
      "&": {
        height: "100%",
        color: "var(--stone-text)",
        backgroundColor: "var(--stone-background)",
      },
      ".cm-scroller": { fontFamily: "Inter, sans-serif", lineHeight: "1.65", padding: "20px" },
      ".cm-content": { caretColor: "var(--stone-accent)", maxWidth: "760px", margin: "0 auto" },
      ".cm-cursor, .cm-dropCursor": {
        borderLeftColor: "var(--stone-accent)",
        borderLeftWidth: "2px",
      },
      ".cm-activeLine": {
        backgroundColor: "color-mix(in srgb, var(--stone-accent) 9%, transparent)",
      },
      "&.cm-focused": {
        outline: "2px solid color-mix(in srgb, var(--stone-accent) 70%, transparent)",
        outlineOffset: "-2px",
      },
      "&.cm-focused .cm-selectionBackground, ::selection": {
        backgroundColor: "color-mix(in srgb, var(--stone-accent) 35%, transparent) !important",
      },
      ".cm-gutters": { display: "none" },
      ".stone-live-strong": { fontWeight: "700" },
      ".stone-live-emphasis": { fontStyle: "italic" },
      ".stone-live-strike": { textDecoration: "line-through" },
      ".stone-live-inlineCode": {
        fontFamily: "monospace",
        backgroundColor: "var(--stone-surface)",
      },
      ".stone-live-link": { color: "var(--stone-accent)", textDecoration: "underline" },
      ".stone-live-code": { fontFamily: "monospace", backgroundColor: "var(--stone-surface)" },
      ".stone-live-callout": { borderLeft: "3px solid var(--stone-accent)", paddingLeft: "12px" },
      ".stone-live-table": { backgroundColor: "var(--stone-surface)" },
      ".stone-live-rule": { color: "var(--stone-accent)" },
      ".stone-task-checkbox": { accentColor: "var(--stone-accent)", marginRight: "8px" },
      ".stone-live-heading-1": { fontSize: "1.8em", fontWeight: "700" },
      ".stone-live-heading-2": { fontSize: "1.45em", fontWeight: "700" },
      ".stone-live-heading-3": { fontSize: "1.2em", fontWeight: "700" },
    }),
    EditorView.theme({ ".cm-content": { paddingBottom: "45vh" } }),
  ]);
  view = new EditorView({
    state,
    parent: document.getElementById("editor")!,
  });
  view.dispatch({ effects: EditorView.scrollIntoView(0) });
  post({ protocolVersion: 1, type: "ready", payload: { documentId } });
}

function executeCommand(command: Extract<EditorBridgeMessage, { type: "executeCommand" }>): void {
  if (!view) return;
  const selection = view.state.selection.main;
  if (command.payload.command === "undo") {
    undo(view);
    return;
  }
  if (command.payload.command === "redo") {
    redo(view);
    return;
  }
  if (command.payload.command === "find") {
    findNext(view);
    return;
  }
  const result = applyEditorCommand(
    view.state.doc.toString(),
    selection.from,
    selection.to,
    command.payload.command,
    command.payload.url,
  );
  if (result.source === view.state.doc.toString()) return;
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: result.source },
    selection: { anchor: result.from, head: result.to },
    userEvent: "input",
  });
}

window.addEventListener("message", (event) => {
  let value: unknown;
  try {
    value = JSON.parse(event.data as string);
  } catch {
    post({
      protocolVersion: 1,
      type: "editorError",
      payload: { message: "Invalid editor message." },
    });
    return;
  }
  if (!isEditorBridgeMessage(value)) {
    post({
      protocolVersion: 1,
      type: "editorError",
      payload: { message: "Unsupported editor message." },
    });
    return;
  }
  if (value.type === "initialize") {
    documentId = value.payload.documentId;
    initialize(value.payload.markdown, value.payload.readOnly ?? false);
  } else if (value.type === "setDocument" && view) {
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value.payload.markdown },
    });
  } else if (value.type === "executeCommand") {
    executeCommand(value);
  } else if (value.type === "setFindQuery" && view) {
    view.dispatch({
      effects: setSearchQuery.of(new SearchQuery({ search: value.payload.query })),
    });
  } else if (value.type === "requestState" && view) {
    post({
      protocolVersion: 1,
      type: "stateSnapshot",
      payload: {
        markdown: view.state.doc.toString(),
        from: view.state.selection.main.from,
        to: view.state.selection.main.to,
      },
    });
  } else if (value.type === "setReadOnly" && view) {
    view.dispatch({
      effects: editableCompartment.reconfigure(EditorView.editable.of(!value.payload.readOnly)),
    });
  }
});

post({
  protocolVersion: 1,
  type: "editorError",
  payload: { message: "Editor is waiting for initialization." },
});
