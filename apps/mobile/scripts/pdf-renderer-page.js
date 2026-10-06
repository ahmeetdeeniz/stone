// Runs inside the hidden WebView that turns PDF pages into images (see src/pdf/PdfRenderer.tsx).
// PDFJS_MAIN and PDFJS_WORKER are pdf.js module sources inlined by build-pdf-renderer.mjs; they
// are loaded from blob URLs because the page has no files next to it.
const post = (message) => window.ReactNativeWebView.postMessage(JSON.stringify(message));
const blobUrl = (code) => URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
let pdfjs = null;
let documentProxy = null;
let chunks = [];

async function library() {
  if (pdfjs) return pdfjs;
  pdfjs = await import(blobUrl(PDFJS_MAIN));
  pdfjs.GlobalWorkerOptions.workerPort = new Worker(blobUrl(PDFJS_WORKER), { type: "module" });
  return pdfjs;
}

function failure(error) {
  return String(
    (error && (error.name === "PasswordException" ? "password" : error.message)) || error,
  );
}

window.stonePdf = {
  append(part) {
    chunks.push(part);
  },
  async open() {
    try {
      const lib = await library();
      const binary = atob(chunks.join(""));
      chunks = [];
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1)
        bytes[index] = binary.charCodeAt(index);
      // No eval and no XFA forms: the document is untrusted input.
      documentProxy = await lib.getDocument({
        data: bytes,
        isEvalSupported: false,
        enableXfa: false,
      }).promise;
      const sizes = [];
      for (let number = 1; number <= documentProxy.numPages; number += 1) {
        const page = await documentProxy.getPage(number);
        const viewport = page.getViewport({ scale: 1 });
        sizes.push({ width: viewport.width, height: viewport.height });
        page.cleanup();
      }
      post({ type: "opened", sizes });
    } catch (error) {
      post({ type: "error", message: failure(error) });
    }
  },
  async render(number, width) {
    try {
      const page = await documentProxy.getPage(number);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: width / base.width });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const context = canvas.getContext("2d");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      const data = canvas.toDataURL("image/webp", 0.9).split(",")[1];
      page.cleanup();
      canvas.width = 0;
      canvas.height = 0;
      post({ type: "page", number, width: viewport.width, height: viewport.height, data });
    } catch (error) {
      post({ type: "error", number, message: failure(error) });
    }
  },
  close() {
    if (documentProxy) void documentProxy.destroy();
    documentProxy = null;
  },
};
post({ type: "ready" });
