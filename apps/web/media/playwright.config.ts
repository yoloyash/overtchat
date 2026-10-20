import { defineConfig } from "@playwright/test";
import path from "node:path";

if (!process.env.MEDIA_BASE_URL || !process.env.MEDIA_OUTPUT || !process.env.MEDIA_DATABASE) {
  throw new Error("Run this capture through npm run media:generate, which isolates the app and database.");
}

export default defineConfig({
  testDir: ".",
  testMatch: "capture.spec.ts",
  workers: 1,
  retries: 0,
  timeout: 120_000,
  reporter: "line",
  outputDir: path.join(process.env.MEDIA_OUTPUT, "test-results"),
  use: {
    baseURL: process.env.MEDIA_BASE_URL,
    browserName: "chromium",
    viewport: { width: 1280, height: 820 },
    deviceScaleFactor: 2,
    locale: "en-US",
    timezoneId: "UTC",
    contextOptions: { reducedMotion: "reduce" },
    serviceWorkers: "block",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: {
      args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
    },
  },
});
