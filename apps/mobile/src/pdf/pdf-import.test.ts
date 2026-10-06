import { describe, expect, it, vi } from "vitest";
import { importPdf, PdfImportCancelled, titleOf, type PdfImportDeps } from "./pdf-import";

function deps(pages: Array<{ width: number; height: number }>) {
  let counter = 0;
  const added: string[] = [];
  const close = vi.fn();
  const fake: PdfImportDeps = {
    renderer: {
      open: () => Promise.resolve(pages),
      render: (number, width) => Promise.resolve({ width, height: width, data: `page-${number}` }),
      close,
    },
    readBase64: () => Promise.resolve("JVBERi0="),
    addAttachment: (picked) => {
      added.push(picked.name);
      const ext = picked.name.endsWith(".pdf") ? "pdf" : "webp";
      return Promise.resolve(`${String(added.length).repeat(64).slice(0, 64)}.${ext}`);
    },
    writeTemp: (data, name) => Promise.resolve({ uri: `file:///tmp/${name}`, size: data.length }),
    newId: () => `id-${(counter += 1)}`,
  };
  return { fake, added, close };
}

describe("PDF import", () => {
  it("stores the PDF, renders each page and keeps each page's aspect", async () => {
    const { fake, added, close } = deps([
      { width: 595.28, height: 841.89 },
      { width: 960, height: 540 },
    ]);
    const progress: Array<[number, number]> = [];
    const result = await importPdf(
      { uri: "file:///Download/Fizik%20-%20Hafta%203.pdf", name: "Fizik - Hafta 3.pdf", size: 9 },
      fake,
      { pageWidth: 794, onProgress: (done, total) => progress.push([done, total]) },
    );
    expect(added).toEqual(["Fizik - Hafta 3.pdf", "page-1.webp", "page-2.webp"]);
    expect(result.title).toBe("Fizik - Hafta 3");
    expect(result.pages.map((page) => page.height)).toEqual([1123, 447]);
    expect(result.pages[1]!.background).toEqual({
      kind: "pdf",
      file: result.file,
      page: 2,
      image: `${"3".repeat(64)}.webp`,
    });
    expect(progress).toEqual([
      [0, 2],
      [1, 2],
      [2, 2],
    ]);
    expect(close).toHaveBeenCalled();
  });

  it("stops at the page limit and can be cancelled", async () => {
    const many = Array.from({ length: 5 }, () => ({ width: 100, height: 100 }));
    const limited = await importPdf({ uri: "a", name: "a.pdf" }, deps(many).fake, {
      pageWidth: 794,
      maxPages: 3,
    });
    expect(limited.pages).toHaveLength(3);
    expect(limited.skipped).toBe(2);
    const { fake, close } = deps(many);
    let calls = 0;
    await expect(
      importPdf({ uri: "a", name: "a.pdf" }, fake, {
        pageWidth: 794,
        isCancelled: () => (calls += 1) > 2,
      }),
    ).rejects.toBeInstanceOf(PdfImportCancelled);
    expect(close).toHaveBeenCalled();
    expect(titleOf("Ders.PDF")).toBe("Ders");
  });
});
