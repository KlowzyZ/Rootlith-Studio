import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/ui",
  use: {
    baseURL: process.env.BENCH_URL || "http://127.0.0.1:5173",
    channel: "chromium",
    viewport: { width: 1536, height: 960 },
  },
  webServer: process.env.BENCH_URL
    ? undefined
    : {
        command: "npm run dev -- --port 5173",
        url: "http://127.0.0.1:5173",
        reuseExistingServer: !process.env.CI,
      },
});
