export const EDITOR_BRIDGE_PROTOCOL_VERSION = 1 as const;

export interface EditorBridgeMessage {
  protocolVersion: typeof EDITOR_BRIDGE_PROTOCOL_VERSION;
  type: "ready" | "selectionChanged" | "requestFocus";
  payload?: Readonly<Record<string, string | number>>;
}

export function isEditorBridgeMessage(value: unknown): value is EditorBridgeMessage {
  if (typeof value !== "object" || value === null) return false;
  const message = value as Record<string, unknown>;
  return (
    message.protocolVersion === EDITOR_BRIDGE_PROTOCOL_VERSION &&
    (message.type === "ready" ||
      message.type === "selectionChanged" ||
      message.type === "requestFocus")
  );
}
