import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mobileRoot = path.join(repositoryRoot, "apps", "mobile");
const appRoot = path.join(mobileRoot, "app");
const outputDirectory = path.join(mobileRoot, ".expo", "types");
const requireFromMobile = createRequire(path.join(mobileRoot, "package.json"));
const { EXPO_ROUTER_CTX_IGNORE } = requireFromMobile("expo-router/_ctx-shared");
const requireContext = requireFromMobile(
  "expo-router/build/testing-library/require-context-ponyfill.js",
).default;
const { getTypedRoutesDeclarationFile } = requireFromMobile(
  "expo-router/build/typed-routes/generate.js",
);

const context = requireContext(appRoot, true, EXPO_ROUTER_CTX_IGNORE);
const declaration = getTypedRoutesDeclarationFile(context);

fs.mkdirSync(outputDirectory, { recursive: true });
fs.writeFileSync(path.join(outputDirectory, "router.d.ts"), declaration);
console.log("Generated current Expo Router declarations.");
