import { defineConfig, devices } from "@playwright/test";

// Poseban razvojni server i testni API čuvaju stvarne naloge i postojeći sajt na portu 3000.
export default defineConfig({
  testDir: "./tests/auth-e2e",
  workers: 1,
  fullyParallel: false,
  timeout: 60000,
  expect: { timeout: 15000 },
  use: { baseURL: "http://127.0.0.1:3200", trace: "retain-on-failure" },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        ...(process.env.PLAYWRIGHT_CHANNEL
          ? { channel: process.env.PLAYWRIGHT_CHANNEL }
          : {}),
      },
    },
  ],
  webServer: {
    command: `${process.platform === "win32" ? "npm.cmd" : "npm"} run dev --workspace=@terapeut/web -- --port 3200`,
    url: "http://127.0.0.1:3200/login",
    reuseExistingServer: false,
    timeout: 60000,
    env: {
      API_ORIGIN: "http://127.0.0.1:4100",
      NEXT_DIST_DIR: ".next-auth-e2e",
    },
  },
});
