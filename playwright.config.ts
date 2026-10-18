import { defineConfig, devices } from "@playwright/test";

/**
 * Run locally by default. For AWS verification, set BASE_URL to the deployed
 * frontend URL without changing the tests:
 *   $env:BASE_URL = "https://your-deployment.example"
 *   pnpm e2e
 */
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1920, height: 1080 } },
    },
    { name: "mobile", use: { ...devices["iPhone 13"] } },
  ],
});
