import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig(({ mode }) => ({
  // The browser harness uses only its explicit synthetic settings, never local files.
  envDir: mode === "e2e" ? false : ".",
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    strictPort: true,
    fs: { allow: [fileURLToPath(new URL(".", import.meta.url))] },
  },
  preview: { host: "127.0.0.1", strictPort: true },
  build: { sourcemap: false },
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "jsdom",
    // Bound concurrent DOM workers so short session tests are not starved by full-detail rendering.
    maxWorkers: 2,
    setupFiles: ["./src/test-setup.ts"],
    clearMocks: true,
    restoreMocks: true,
  },
}));
