# Third-party notices

Stone's MPL-2.0 License applies to Stone-authored source code, not to third-party dependencies or their
assets. Dependency license texts remain available in their distributed packages and lockfile
resolution.

## Public visual dependencies

- **Inter via `@expo-google-fonts/inter`** — the package metadata declares `MIT AND OFL-1.1`; its
  package code is MIT and the Inter font files are distributed under the SIL Open Font License
  1.1. Stone uses the four declared mobile weights.
- **Inter Variable via `@fontsource-variable/inter`** (OFL-1.1) — desktop bundles the variable
  font files from this package. The mobile Markdown editor page inlines its Latin and Latin
  Extended files (generated into `apps/mobile/src/editor/editor-fonts.ts` by
  `packages/editor/scripts/build-web.mjs`), because the editor WebView cannot use fonts the app
  loads natively.
- **Ionicons via `@expo/vector-icons`** — the wrapper package declares MIT and supplies the mobile
  navigation glyphs through its documented Ionicons module.
- **Windows desktop navigation** — uses four text glyphs from the operating-system/system font
  stack with accessible text labels. No raw icon image is bundled.

## Inlined code

- **pdf.js via `pdfjs-dist`** (Apache-2.0, Mozilla) — the legacy build's `pdf.min.mjs` and
  `pdf.worker.min.mjs` are inlined, with their license headers, into
  `apps/mobile/src/pdf/pdf-renderer-html.ts` by `apps/mobile/scripts/build-pdf-renderer.mjs`. The
  app loads that page in a hidden WebView to render imported PDF pages to images.

The repository intentionally contains no private brand font or unproven raw icon directory.
