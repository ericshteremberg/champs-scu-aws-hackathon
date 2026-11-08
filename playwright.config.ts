import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "workspace.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 35_000,
  expect: { timeout: 15_000 },
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:5173",
    channel: process.env.CI ? undefined : "chrome",
    viewport: { width: 1440, height: 1080 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    env: {
      INVESTIGATION_MODE: "demo",
      DATABASE_PATH: `.data/e2e-${process.pid}.sqlite`,
      DEMO_STEP_MS: "300",
      APP_ACCESS_TOKEN: "",
      MERCHANT_EVIDENCE_URL: "",
      MERCHANT_EVIDENCE_TOKEN: "",
      S3_EVIDENCE_BUCKET: "",
    },
  },
});
