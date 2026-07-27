// Reports whether the desktop app's build-time VITE_* configuration was supplied, without
// ever printing the values themselves. Informational only: it always exits 0, because the
// workflow must remain usable by public self-hosters who have not configured any repository
// Variables — they still get a working (if unconfigured) installer that shows a clear
// runtime error instead of silently doing nothing (see apps/desktop/src/desktop-api.ts).
const requiredKeys = [
  "VITE_FIREBASE_API_KEY",
  "VITE_FIREBASE_PROJECT_ID",
  "VITE_FIREBASE_AUTH_DOMAIN",
  "VITE_GITHUB_CLIENT_ID",
];

console.log("Desktop build-time configuration status (values are never printed):");
let missing = 0;
for (const key of requiredKeys) {
  const configured = typeof process.env[key] === "string" && process.env[key].trim() !== "";
  console.log(`  ${key}: ${configured ? "configured" : "missing"}`);
  if (!configured) missing += 1;
}

if (missing > 0) {
  console.log(
    `\n${missing} of ${requiredKeys.length} desktop build variable(s) are not set. ` +
      "The installer will still build, but will show a runtime configuration error until " +
      "these repository Variables (or a local apps/desktop/.env.local) are provided.",
  );
} else {
  console.log("\nAll desktop build variables are configured.");
}
