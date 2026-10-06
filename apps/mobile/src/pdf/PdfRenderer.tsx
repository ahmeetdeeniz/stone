import { forwardRef, useImperativeHandle, useRef } from "react";
import { StyleSheet, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { PDF_RENDERER_HTML } from "./pdf-renderer-html";

export interface PdfPageSize {
  width: number;
  height: number;
}

export interface RenderedPdfPage extends PdfPageSize {
  /** Base64 WebP of the page. */
  data: string;
}

export interface PdfRendererHandle {
  /** Loads a PDF (base64) and reports every page's size in PDF points. */
  open(base64: string): Promise<readonly PdfPageSize[]>;
  /** Renders page `number` (1-based) `width` pixels wide. */
  render(number: number, width: number): Promise<RenderedPdfPage>;
  close(): void;
}

type RendererMessage =
  | { type: "ready" }
  | { type: "opened"; sizes: PdfPageSize[] }
  | { type: "page"; number: number; width: number; height: number; data: string }
  | { type: "error"; number?: number; message: string };

/** Base64 is sent in pieces so no single bridge message gets huge. */
const CHUNK = 256 * 1024;

/**
 * pdf.js in an invisible WebView: the app has no native PDF engine, and a WebView renders pages
 * with the system's Chromium. Mount it while importing; it is a 1×1 transparent view.
 */
export const PdfRenderer = forwardRef<PdfRendererHandle>(function PdfRenderer(_props, ref) {
  const webView = useRef<WebView>(null);
  const ready = useRef<Promise<void> | null>(null);
  const markReady = useRef<(() => void) | null>(null);
  const waiting = useRef<{
    resolve: (message: RendererMessage) => void;
    reject: (error: Error) => void;
  } | null>(null);
  if (!ready.current)
    ready.current = new Promise<void>((resolve) => {
      markReady.current = resolve;
    });

  const run = (script: string) => webView.current?.injectJavaScript(`${script}; true;`);
  const next = () =>
    new Promise<RendererMessage>((resolve, reject) => {
      waiting.current = { resolve, reject };
    });

  useImperativeHandle(ref, () => ({
    async open(base64) {
      await ready.current;
      for (let index = 0; index < base64.length; index += CHUNK)
        run(`window.stonePdf.append(${JSON.stringify(base64.slice(index, index + CHUNK))})`);
      const reply = next();
      run("window.stonePdf.open()");
      const message = await reply;
      if (message.type !== "opened") throw new Error("The PDF could not be opened.");
      return message.sizes;
    },
    async render(number, width) {
      await ready.current;
      const reply = next();
      run(`window.stonePdf.render(${Number(number)}, ${Number(width)})`);
      const message = await reply;
      if (message.type !== "page") throw new Error("The PDF page could not be rendered.");
      return { width: message.width, height: message.height, data: message.data };
    },
    close() {
      run("window.stonePdf.close()");
    },
  }));

  const onMessage = (event: WebViewMessageEvent) => {
    let message: RendererMessage;
    try {
      message = JSON.parse(event.nativeEvent.data) as RendererMessage;
    } catch {
      return;
    }
    if (message.type === "ready") {
      markReady.current?.();
      return;
    }
    const pending = waiting.current;
    waiting.current = null;
    if (!pending) return;
    if (message.type === "error")
      pending.reject(
        new PdfRenderError(
          message.message === "password" ? "password" : "invalid",
          message.message,
        ),
      );
    else pending.resolve(message);
  };

  return (
    <View style={styles.hidden} pointerEvents="none">
      <WebView
        ref={webView}
        source={{ html: PDF_RENDERER_HTML, baseUrl: "https://stone.invalid" }}
        originWhitelist={["*"]}
        onMessage={onMessage}
        javaScriptEnabled
        domStorageEnabled={false}
        setSupportMultipleWindows={false}
      />
    </View>
  );
});

export class PdfRenderError extends Error {
  public override readonly name = "PdfRenderError";
  public constructor(
    public readonly code: "password" | "invalid",
    message: string,
  ) {
    super(message);
  }
}

const styles = StyleSheet.create({
  hidden: { position: "absolute", width: 1, height: 1, opacity: 0, left: 0, top: 0 },
});
