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
import { colors as tokens } from "../design/tokens";
import { useI18n } from "../i18n/provider";

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
    const { locale, t } = useI18n();
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
          payload: { documentId, markdown, readOnly, locale },
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
          payload: { message: t("editor.invalidBridge") },
        });
      }
    };

    return (
      <WebView
        ref={webViewRef}
        originWhitelist={["*"]}
        source={{ html: createEditorHtml(theme, t("editor.markdownA11y")) }}
        onLoadEnd={initialize}
        onMessage={handleMessage}
        javaScriptEnabled
        domStorageEnabled={false}
        setSupportMultipleWindows={false}
        allowFileAccess={false}
        style={styles.webView}
        accessibilityLabel={t("editor.markdownA11y")}
      />
    );
  },
);

function createEditorHtml(theme: "light" | "dark", accessibilityLabel: string): string {
  // The editing surface must be the same material as the rest of Stone, so the
  // palette is read from the shared tokens rather than defined here.
  const palette = theme === "dark" ? tokens.dark : tokens.light;
  const editorColors = {
    background: palette.background,
    text: palette.text,
    surface: palette.surface,
    accent: theme === "dark" ? tokens.brand.purple300 : tokens.brand.purple600,
    muted: palette.textSecondary,
    border: palette.border,
  };
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"><style>:root{--stone-background:${editorColors.background};--stone-text:${editorColors.text};--stone-surface:${editorColors.surface};--stone-accent:${editorColors.accent};--stone-muted:${editorColors.muted};--stone-border:${editorColors.border}}html,body,#editor{height:100%;margin:0;background:var(--stone-background);color:var(--stone-text)}body{overflow:hidden;-webkit-font-smoothing:antialiased}button,a{color:var(--stone-accent)}</style></head><body><main id="editor" role="textbox" aria-label="${escapeHtmlAttribute(accessibilityLabel)}"></main><script>${EDITOR_BUNDLE}</script></body></html>`;
}

function escapeHtmlAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}

const styles = StyleSheet.create({ webView: { flex: 1, backgroundColor: "transparent" } });
