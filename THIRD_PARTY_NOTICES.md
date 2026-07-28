# Third-party notices

Stone's MIT License applies to Stone-authored source code, not to third-party dependencies or their
assets. Dependency license texts remain available in their distributed packages and lockfile
resolution.

## Public visual dependencies

- **Inter via `@expo-google-fonts/inter`** — the package metadata declares `MIT AND OFL-1.1`; its
  package code is MIT and the Inter font files are distributed under the SIL Open Font License
  1.1. Stone uses the four declared mobile weights. Desktop uses the installed Inter/system
  sans-serif stack and does not bundle a private font.
- **Ionicons via `@expo/vector-icons`** — the wrapper package declares MIT and supplies the mobile
  navigation glyphs through its documented Ionicons module.
- **Windows desktop navigation** — uses four text glyphs from the operating-system/system font
  stack with accessible text labels. No raw icon image is bundled.

The repository intentionally contains no private brand font or unproven raw icon directory.
