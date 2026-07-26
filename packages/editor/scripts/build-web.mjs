import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";

await build({
  entryPoints: ["src/web-entry.ts"],
  bundle: true,
  format: "iife",
  minify: true,
  outfile: "dist/editor-web.js",
  platform: "browser",
  sourcemap: false,
});

const bundle = await readFile("dist/editor-web.js", "utf8");
await mkdir("../../apps/mobile/src/editor", { recursive: true });
await writeFile(
  "../../apps/mobile/src/editor/editor-bundle.ts",
  `export const EDITOR_BUNDLE = ${JSON.stringify(bundle)} as const;\n`,
  "utf8",
);
