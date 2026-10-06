import { Skia, useTypeface, type SkImage } from "@shopify/react-native-skia";
import { Inter_400Regular } from "@expo-google-fonts/inter/400Regular";
import { notebookAttachments, type InkNotebook } from "@stone/ink";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PageAssets } from "./page-picture";

/**
 * Decodes the photos a notebook's pages show (downloading any this device doesn't have yet) and
 * loads Inter for text boxes. Pages re-record when an image arrives, so they show a placeholder
 * frame until then.
 */
export function usePageAssets(
  notebook: InkNotebook | null,
  resolve: (fileName: string) => Promise<string>,
): PageAssets {
  const typeface = useTypeface(Inter_400Regular);
  const [images, setImages] = useState<ReadonlyMap<string, SkImage>>(() => new Map());
  const requested = useRef(new Set<string>());
  const resolveRef = useRef(resolve);
  resolveRef.current = resolve;
  const files = useMemo(
    () =>
      notebook
        ? notebookAttachments(notebook)
            // The original PDFs are only needed for export; pages show their rendered images.
            .filter((file) => !file.endsWith(".pdf"))
            .join("|")
        : "",
    [notebook],
  );

  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  useEffect(() => {
    for (const file of files ? files.split("|") : []) {
      if (requested.current.has(file)) continue;
      requested.current.add(file);
      void resolveRef
        .current(file)
        .then((uri) => Skia.Data.fromURI(uri))
        .then((data) => Skia.Image.MakeImageFromEncoded(data))
        .then((image) => {
          if (!mounted.current || !image) return;
          setImages((current) => new Map(current).set(file, image));
        })
        .catch(() => {
          // Offline or missing: keep the placeholder and try again next time the page opens.
          requested.current.delete(file);
        });
    }
  }, [files]);

  return useMemo(() => ({ images, typeface }), [images, typeface]);
}
