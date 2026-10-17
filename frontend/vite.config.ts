import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { syntheticCsp } from "./test/support/security-policy.ts";

export default defineConfig(({ mode }) => ({
  // The browser harness uses only its explicit synthetic settings, never local files.
  envDir: mode === "e2e" ? false : ".",
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    strictPort: true,
    fs: { allow: [fileURLToPath(new URL(".", import.meta.url))] },
  },
  preview: {
    host: "127.0.0.1",
    strictPort: true,
    // Synthetic browser qualification only; real hosting headers require recipe validation.
    headers:
      mode === "e2e"
        ? {
            "Content-Security-Policy": syntheticCsp,
            "Cache-Control": "no-store",
          }
        : {},
  },
  build: { sourcemap: false },
  test: {
    include: ["test/**/*.test.{ts,tsx}"],
    environment: "jsdom",
    // Bound concurrent DOM workers so short session tests are not starved by full-detail rendering.
    maxWorkers: 2,
    setupFiles: ["./test/setup.ts"],
    clearMocks: true,
    restoreMocks: true,
  },
}));
