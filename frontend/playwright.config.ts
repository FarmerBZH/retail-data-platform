import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: true,
  retries: 0,
  workers: 2,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4180",
    browserName: "chromium",
    serviceWorkers: "block",
    reducedMotion: "reduce",
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  projects: [360, 768, 1440].map((width) => ({
    name: `chromium-${width}`,
    use: { viewport: { width, height: 900 } },
  })),
  webServer: {
    command:
      "npm run build -- --mode e2e --outDir dist-e2e && npm run preview -- --outDir dist-e2e --port 4180",
    env: {
      VITE_API_BASE_URL: "https://api.example.test",
      VITE_OIDC_ISSUER: "https://identity.example.test",
      VITE_OIDC_CLIENT_ID: "synthetic-web",
      VITE_OIDC_REDIRECT_URI: "http://127.0.0.1:4180/oidc/callback",
    },
    url: "http://127.0.0.1:4180",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
