import { defineConfig } from "@playwright/test";

const baseURL =
  process.env.CAUSALITY_UI_TEST_BASEURL || "http://127.0.0.1:8788";
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(baseURL)) {
  throw new Error(
    "Browser tests require a local preview origin. Never run synthetic auth headers against a deployed site.",
  );
}

export default defineConfig({
  testDir: "./tests",
  testMatch: ["investigation-ui.spec.ts", "connector-setup.spec.ts"],
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 20_000 },
  reporter: "list",
  use: {
    baseURL,
    channel: process.env.CI ? undefined : "chrome",
    viewport: { width: 1440, height: 1000 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
});
