import { createServer, type Server } from "node:http";
import { expect, test } from "@playwright/test";
import { openE2eDatabase, resetE2eDatabase } from "./helpers/database";

let provider: Server;
let baseUrl: string;
let healthy = false;

test.beforeAll(async () => {
  provider = createServer((request, response) => {
    request.resume();
    response.writeHead(healthy ? 200 : 503, {
      "content-type": healthy ? "application/json" : "text/html",
    });
    response.end(
      healthy
        ? JSON.stringify({ text: "transcribed words" })
        : "<html>internal provider diagnostic</html>",
    );
  });
  await new Promise<void>((resolve) =>
    provider.listen(0, "127.0.0.1", resolve),
  );
  const address = provider.address();
  if (!address || typeof address === "string")
    throw new Error("Missing test provider address");
  baseUrl = `http://127.0.0.1:${address.port}/v1`;
});

test.afterEach(() => {
  const db = openE2eDatabase();
  try {
    db.prepare("DELETE FROM server_capabilities WHERE id = 'stt'").run();
  } finally {
    db.close();
  }
});

test.afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    provider.close((error) => (error ? reject(error) : resolve())),
  );
});

test("configured speech outage stays actionable and recovers without losing the draft", async ({
  page,
}, testInfo) => {
  resetE2eDatabase();
  healthy = false;
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }),
      },
    });
    class Recorder {
      static isTypeSupported() {
        return true;
      }
      state = "inactive";
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      start() {
        this.state = "recording";
      }
      stop() {
        this.state = "inactive";
        this.ondataavailable?.({
          data: new Blob(["test audio"], { type: "audio/webm" }),
        });
        this.onstop?.();
      }
    }
    Object.defineProperty(window, "MediaRecorder", {
      configurable: true,
      value: Recorder,
    });
  });
  await page.goto("/signup");
  await page.locator("#name").fill("Error Tester");
  await page.locator("#email").fill("errors@overtchat-test.local");
  await page.locator("#password").fill("test-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/", { timeout: 15_000 });

  const db = openE2eDatabase();
  try {
    db.prepare(
      `INSERT INTO model_configs
      (id, label, base_url, api_key, model, enabled, sort_order, created_at, updated_at)
      VALUES ('error-model', 'Test Model', 'https://example.invalid/v1', '', 'test-model', 1, 0, @now, @now)`,
    ).run({ now: Date.now() });
  } finally {
    db.close();
  }

  const config = {
    provider: "openai-compatible",
    baseUrl,
    apiKey: null,
    model: "test-stt",
    voice: null,
    bundledInstalled: false,
  };
  expect(
    (
      await page.request.put("/api/server-capabilities/stt", { data: config })
    ).ok(),
  ).toBe(true);
  await page.reload();
  const draft = page.getByPlaceholder("Message… or / for commands");
  await draft.fill("Keep this draft");
  await page.getByRole("button", { name: "Dictate", exact: true }).click();
  await page
    .getByRole("button", { name: "Stop dictation", exact: true })
    .click();
  const notice = page
    .getByRole("alert")
    .filter({ hasText: "transcription service" });
  await expect(notice).toContainText("temporarily unavailable");
  await expect(notice).not.toContainText(
    /configured|setup|internal provider diagnostic|<html>/,
  );
  await expect(draft).toHaveValue("Keep this draft");
  await expect(
    notice.getByRole("link", { name: "Speech settings" }),
  ).toHaveAttribute("href", "/settings/services");

  await page.screenshot({
    path: testInfo.outputPath("speech-outage-desktop.png"),
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    notice.getByRole("button", { name: "Dismiss error" }),
  ).toBeInViewport();
  await expect(
    notice.getByRole("button", { name: "Record again" }),
  ).toBeInViewport();
  await page.screenshot({
    path: testInfo.outputPath("speech-outage-mobile.png"),
  });
  await page.setViewportSize({ width: 1280, height: 720 });

  healthy = true;
  await notice.getByRole("button", { name: "Record again" }).click();
  await expect(notice).toHaveCount(0);
  await page
    .getByRole("button", { name: "Stop dictation", exact: true })
    .click();
  await expect(draft).toHaveValue("Keep this draft transcribed words");

  // An unreachable endpoint has its own reason, with no setup instructions.
  expect(
    (
      await page.request.put("/api/server-capabilities/stt", {
        data: { ...config, baseUrl: "http://127.0.0.1:1/v1" },
      })
    ).ok(),
  ).toBe(true);
  await page.getByRole("button", { name: "Dictate", exact: true }).click();
  await page
    .getByRole("button", { name: "Stop dictation", exact: true })
    .click();
  await expect(notice).toContainText(
    "Couldn't reach the transcription service",
  );
  await notice.getByRole("button", { name: "Dismiss error" }).click();
  await expect(notice).toHaveCount(0);
  await expect(draft).toHaveValue("Keep this draft transcribed words");

  expect(
    (
      await page.request.put("/api/server-capabilities/stt", {
        data: { ...config, provider: "disabled" },
      })
    ).ok(),
  ).toBe(true);
  await page.getByRole("button", { name: "Dictate", exact: true }).click();
  await page
    .getByRole("button", { name: "Stop dictation", exact: true })
    .click();
  const disabledNotice = page
    .getByRole("alert")
    .filter({ hasText: "Dictation is turned off" });
  await expect(disabledNotice).toBeVisible();
  await expect(
    disabledNotice.getByRole("button", { name: "Record again" }),
  ).toHaveCount(0);
});
