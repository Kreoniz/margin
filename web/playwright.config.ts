import { defineConfig, devices } from "@playwright/test";

if (process.env.E2E_TEST_INSTANCE !== "1")
  throw new Error(
    "Browser tests require an isolated disposable instance. Set E2E_TEST_INSTANCE=1 and BASE_URL to that instance; never use your personal database.",
  );

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: process.env.BASE_URL || "http://127.0.0.1:5178",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 1000 },
      },
    },
    {
      name: "mobile",
      use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" },
    },
  ],
});
