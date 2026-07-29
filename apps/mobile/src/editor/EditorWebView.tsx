/* eslint-disable @typescript-eslint/unbound-method */
import * as React from "react";
import { useImperativeHandle, useRef } from "react";
import { StyleSheet } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import {
  EDITOR_BRIDGE_PROTOCOL_VERSION,
  isEditorBridgeMessage,
  type EditorBridgeMessage,
} from "@stone/editor";
import { EDITOR_BUNDLE } from "./editor-bundle";

export interface EditorWebViewHandle {
  post(message: EditorBridgeMessage): void;
}

interface EditorWebViewProps {
  documentId: string;
  markdown: string;
  readOnly?: boolean;
  theme: "light" | "dark";
  onMessage(message: EditorBridgeMessage): void;
}

export const EditorWebView = React.forwardRef<EditorWebViewHandle, EditorWebViewProps>(
  ({ documentId, markdown, readOnly = false, theme, onMessage }, ref) => {
    const webViewRef = useRef<WebView>(null);
    useImperativeHandle(ref, () => ({
      post(message) {
        webViewRef.current?.postMessage(JSON.stringify(message));
      },
    }));

    const initialize = () => {
      webViewRef.current?.postMessage(
        JSON.stringify({
          protocolVersion: EDITOR_BRIDGE_PROTOCOL_VERSION,
          type: "initialize",
          payload: { documentId, markdown, readOnly },
        } satisfies EditorBridgeMessage),
      );
      webViewRef.current?.postMessage(
        JSON.stringify({
          protocolVersion: EDITOR_BRIDGE_PROTOCOL_VERSION,
          type: "setTheme",
          payload: { theme },
        } satisfies EditorBridgeMessage),
      );
    };

    const handleMessage = (event: WebViewMessageEvent) => {
      try {
        const message: unknown = JSON.parse(event.nativeEvent.data);
        if (isEditorBridgeMessage(message)) onMessage(message);
      } catch {
        onMessage({
          protocolVersion: 1,
          type: "editorError",
          payload: { message: "Editor bridge returned invalid JSON." },
        });
      }
    };

    return (
      <WebView
        ref={webViewRef}
        originWhitelist={["*"]}
        source={{ html: createEditorHtml(theme) }}
        onLoadEnd={initialize}
        onMessage={handleMessage}
        javaScriptEnabled
        domStorageEnabled={false}
        setSupportMultipleWindows={false}
        allowFileAccess={false}
        style={styles.webView}
        accessibilityLabel="Stone Markdown editor"
      />
    );
  },
);

function createEditorHtml(theme: "light" | "dark"): string {
  const colors =
    theme === "dark"
      ? { background: "#151515", text: "#F4F0E8", surface: "#23211E", accent: "#D8A15D" }
      : { background: "#F8F6F0", text: "#292721", surface: "#EEE9DF", accent: "#99642D" };
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"><style>:root{--stone-background:${colors.background};--stone-text:${colors.text};--stone-surface:${colors.surface};--stone-accent:${colors.accent}}html,body,#editor{height:100%;margin:0;background:var(--stone-background);color:var(--stone-text)}body{overflow:hidden}button,a{color:var(--stone-accent)}</style></head><body><main id="editor" role="textbox" aria-label="Markdown editor"></main><script>${EDITOR_BUNDLE}</script></body></html>`;
}

const styles = StyleSheet.create({ webView: { flex: 1, backgroundColor: "transparent" } });
