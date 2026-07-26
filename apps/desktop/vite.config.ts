import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // Desktop env files live in this directory (apps/desktop/.env, .env.local), not the
  // monorepo root, so the mobile app's EXPO_PUBLIC_* variables never leak into the desktop
  // bundle and vice versa.
  envDir: ".",
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
});
