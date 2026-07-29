import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const resourceFiles = {
  en: resolve(repositoryRoot, "packages/i18n/src/en.ts"),
  tr: resolve(repositoryRoot, "packages/i18n/src/tr.ts"),
};
const uiRoots = [
  resolve(repositoryRoot, "apps/desktop/src/App.tsx"),
  resolve(repositoryRoot, "apps/desktop/src/GithubPanel.tsx"),
  resolve(repositoryRoot, "apps/mobile/app"),
  resolve(repositoryRoot, "apps/mobile/src/components"),
  resolve(repositoryRoot, "apps/mobile/src/drawings"),
  resolve(repositoryRoot, "apps/mobile/src/editor/EditorWebView.tsx"),
];
const androidWidgetResources = {
  en: resolve(repositoryRoot, "packages/native-widgets/android/src/main/res/values/strings.xml"),
  tr: resolve(repositoryRoot, "packages/native-widgets/android/src/main/res/values-tr/strings.xml"),
};
const iosWidgetResources = resolve(
  repositoryRoot,
  "packages/native-widgets/ios/Extension/StoneWidgetStore.swift",
);

// Product/technology names and compact symbolic controls are intentionally not translated.
const staticUiAllowlist = new Set([
  "S",
  "G",
  "Stone",
  "STONE",
  "GitHub",
  "VS Code",
  "Codex",
  "Pull",
  "Stage + Commit + Push",
  "project-id",
  "Project.md frontmatter",
  "· Android:",
  "· iOS:",
  "v",
  "−15",
  "+15",
  "•",
  "·",
]);

function sourceFile(path) {
  return ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
}

function propertyName(node) {
  if (ts.isStringLiteral(node) || ts.isIdentifier(node)) return node.text;
  return null;
}

export function readResource(path, exportName) {
  const file = sourceFile(path);
  let object;
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === exportName &&
      node.initializer
    ) {
      let initializer = node.initializer;
      while (ts.isAsExpression(initializer) || ts.isSatisfiesExpression(initializer))
        initializer = initializer.expression;
      if (ts.isObjectLiteralExpression(initializer)) object = initializer;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (!object) throw new Error(`Could not find ${exportName} resource in ${path}`);

  const values = new Map();
  const duplicates = [];
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const key = propertyName(property.name);
    if (!key || !ts.isStringLiteralLike(property.initializer)) continue;
    if (values.has(key)) duplicates.push(key);
    values.set(key, property.initializer.text);
  }
  return { duplicates, values };
}

export function interpolationNames(value) {
  return [...value.matchAll(/\{\{([a-zA-Z][a-zA-Z0-9_]*)\}\}/gu)].map((match) => match[1]).sort();
}

function filesUnder(path) {
  if (statSync(path).isFile()) return [path];
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = join(path, entry.name);
    if (entry.isDirectory()) return filesUnder(child);
    return [".ts", ".tsx"].includes(extname(entry.name)) && !entry.name.endsWith(".test.tsx")
      ? [child]
      : [];
  });
}

function normalizedText(value) {
  return value.replace(/\s+/gu, " ").trim();
}

function looksUserFacing(value) {
  const text = normalizedText(value);
  if (!text || staticUiAllowlist.has(text)) return false;
  if (/^(?:[0-9:.%+\-–—→✓✎◦□▷⚙]+)$/u.test(text)) return false;
  return /[A-Za-zÇĞİÖŞÜçğıöşü]/u.test(text);
}

export function hardcodedUiStrings(path) {
  const file = sourceFile(path);
  const findings = [];
  const add = (node, value) => {
    if (!looksUserFacing(value)) return;
    const position = file.getLineAndCharacterOfPosition(node.getStart(file));
    findings.push({
      line: position.line + 1,
      path: relative(repositoryRoot, path).replaceAll("\\", "/"),
      value: normalizedText(value),
    });
  };
  const visit = (node) => {
    if (ts.isJsxText(node)) add(node, node.text);
    if (
      ts.isJsxAttribute(node) &&
      ["aria-label", "accessibilityLabel", "label", "placeholder", "title"].includes(
        node.name.getText(file),
      ) &&
      node.initializer &&
      ts.isStringLiteral(node.initializer)
    )
      add(node, node.initializer.text);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return findings;
}

export function verifyI18n() {
  const errors = [];
  const en = readResource(resourceFiles.en, "en");
  const tr = readResource(resourceFiles.tr, "tr");
  for (const [locale, resource] of Object.entries({ en, tr }))
    for (const key of resource.duplicates) errors.push(`${locale}: duplicate key ${key}`);

  for (const key of en.values.keys())
    if (!tr.values.has(key)) errors.push(`tr: missing key ${key}`);
  for (const key of tr.values.keys())
    if (!en.values.has(key)) errors.push(`tr: unexpected key ${key}`);
  for (const [key, english] of en.values) {
    const turkish = tr.values.get(key);
    if (
      turkish !== undefined &&
      interpolationNames(english).join(",") !== interpolationNames(turkish).join(",")
    )
      errors.push(`interpolation mismatch: ${key}`);
  }

  for (const root of uiRoots)
    for (const path of filesUnder(root))
      for (const finding of hardcodedUiStrings(path))
        errors.push(`${finding.path}:${finding.line}: hardcoded UI string "${finding.value}"`);
  const androidNames = (path) =>
    [...readFileSync(path, "utf8").matchAll(/<string name="([^"]+)"/gu)]
      .map((match) => match[1])
      .sort();
  if (
    androidNames(androidWidgetResources.en).join(",") !==
    androidNames(androidWidgetResources.tr).join(",")
  )
    errors.push("native Android widget resource mismatch");
  const swift = readFileSync(iosWidgetResources, "utf8");
  const iosNames = (name) => {
    const block = swift.match(
      new RegExp(`let ${name}: \\[String: String\\] = \\[([\\s\\S]*?)\\n    \\]`, "u"),
    )?.[1];
    return block ? [...block.matchAll(/"([^"]+)":/gu)].map((match) => match[1]).sort() : [];
  };
  if (iosNames("en").join(",") !== iosNames("tr").join(","))
    errors.push("native iOS widget resource mismatch");
  return errors;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const errors = verifyI18n();
  if (errors.length) {
    console.error(`i18n verification failed:\n${errors.map((error) => `- ${error}`).join("\n")}`);
    process.exitCode = 1;
  } else {
    console.log("i18n resources, native widget parity and selected UI boundaries verified.");
  }
}
