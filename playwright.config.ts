import { defineConfig, devices } from "@playwright/test";
// Ovaj fajl podešava browser testove. Port 3100 odvaja testni sajt od pregleda na 3000.
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1, // Jedan browser radnik olakšava praćenje grešaka u početnoj verziji.
  timeout: 45000,
  expect: { timeout: 10000 },
  use: { baseURL: "http://127.0.0.1:3100", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `${process.platform === "win32" ? "npm.cmd" : "npm"} run start --workspace=@terapeut/web -- --port 3100`,
    url: "http://127.0.0.1:3100",
    reuseExistingServer: !process.env.CI,
    timeout: 60000,
  },
});
