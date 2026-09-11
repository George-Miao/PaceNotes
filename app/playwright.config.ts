import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: process.env.PACENOTES_BASE_URL ?? "http://127.0.0.1:3000",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
      grep: /map and list toggles keep at least one panel visible|selected places are added directly|continuous days support transport|per-day add controls|resizing a 500-place split avoids itinerary recommits/,
    },
  ],
});
