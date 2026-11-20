import { defineConfig, devices } from "@playwright/test";

const PORT = 4173;
export default defineConfig({
  testDir: "tests/smoke",
  reporter: [["list"]],
  preserveOutput: "always", // keep the screenshots of passing runs for the CI artifact
  use: { baseURL: `http://127.0.0.1:${PORT}`, screenshot: "off", trace: "off" },
  // static files only; data/ is replaced by tests/fixtures/data inside the test (page.route)
  webServer: { command: `python3 -m http.server ${PORT} --bind 127.0.0.1`, url: `http://127.0.0.1:${PORT}/index.html`, reuseExistingServer: !process.env.CI },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], launchOptions: { executablePath: process.env.CHROMIUM_PATH || undefined } } }],
});
