import { defineConfig, devices } from "@playwright/test";
import dotenv from "dotenv";
import path from "node:path";

dotenv.config({ path: path.resolve(__dirname, ".env.local") });

const isCI = !!process.env.CI;
const port = process.env.E2E_PORT ?? "4717";
const baseURL = `http://localhost:${port}`;
const redisUrl = process.env.REDIS_URL?.trim();

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: 1,
  reporter: "line",
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Run the standalone server so CI exercises the same artifact the Docker image ships.
    // Static assets aren't bundled into the standalone tree, so copy them in first.
    command: isCI
      ? "mkdir -p .next/standalone/apps/web/.next && cp -r .next/static .next/standalone/apps/web/.next/static && node .next/standalone/apps/web/server.js"
      : "npm run build && mkdir -p .next/standalone/apps/web/.next && cp -r .next/static .next/standalone/apps/web/.next/static && node .next/standalone/apps/web/server.js",
    url: baseURL,
    reuseExistingServer: !isCI,
    timeout: 180 * 1000,
    env: {
      PORT: port,
      DATABASE_URL: path.resolve(__dirname, "data/test.db"),
      MIGRATIONS_FOLDER: path.resolve(__dirname, "drizzle"),
      BETTER_AUTH_SECRET: "testsecret1234567890123456789012",
      BETTER_AUTH_URL: baseURL,
      ...(redisUrl ? { REDIS_URL: redisUrl } : {}),
    },
  },
});
