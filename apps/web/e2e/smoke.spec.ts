import { test, expect } from "@playwright/test";
import Database from "better-sqlite3";
import path from "node:path";

const TEST_DB_PATH = path.resolve(__dirname, "../data/test.db");

function resetE2eDatabase() {
  const db = new Database(TEST_DB_PATH);
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.transaction(() => {
    db.prepare("DELETE FROM messages").run();
    db.prepare("DELETE FROM messages_fts").run();
    db.prepare("DELETE FROM chats").run();
    db.prepare("DELETE FROM projects").run();
    db.prepare("DELETE FROM uploads").run();
    db.prepare("DELETE FROM account").run();
    db.prepare("DELETE FROM session").run();
    db.prepare("DELETE FROM verification").run();
    db.prepare("DELETE FROM user").run();
    db.prepare("DELETE FROM model_configs").run();
  })();
  db.close();
}

test.beforeEach(() => {
  resetE2eDatabase();
});

test("signup, configure Gemini, stream a response", async ({ page }) => {
  if (!process.env.GEMINI_API_KEY) {
    test.skip(true, "GEMINI_API_KEY not set (expected on fork PRs).");
    return;
  }

  await test.step("admin signup", async () => {
    await page.goto("/signup");
    await expect(page.locator("h1")).toContainText("Create the first account");
    await page.locator("#name").fill("E2E Tester");
    await page.locator("#email").fill("test-admin@overtchat-test.local");
    await page.locator("#password").fill("test-password-123");
    await page.getByRole("button", { name: "Create account" }).click();
    await page.waitForURL("**/", { timeout: 15000 });
  });

  await test.step("configure Gemini model", async () => {
    await page.goto("/settings/models/new");
    await page.locator("#p-preset").click();
    await page.getByRole("option", { name: "Google Gemini" }).click();
    await expect(page.locator("#p-base-url")).toHaveValue(
      "https://generativelanguage.googleapis.com/v1beta/openai"
    );
    await page.locator("#p-api-key").fill(process.env.GEMINI_API_KEY!);

    // #p-model renders as <select> when the probe succeeds, plain <input> on fallback.
    const modelField = page.locator("#p-model");
    await modelField.waitFor({ state: "visible", timeout: 15000 });
    if (await modelField.evaluate((el) => el.tagName.toLowerCase() === "input")) {
      await modelField.fill("gemini-2.5-flash-lite");
    } else {
      await modelField.click();
      await page.getByRole("option").filter({ hasText: /gemini-2\.5-flash-lite/i }).first().click();
    }

    await page.locator("#p-label").fill("Gemini Lite Smoke Test");
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await page.waitForURL("**/settings/models");
  });

  await test.step("stream chat response", async () => {
    await page.goto("/");
    const composer = page.getByPlaceholder("Message…");
    await composer.waitFor({ state: "visible", timeout: 10000 });
    await composer.fill("Reply with exactly 'Overtchat-E2E-Success' and nothing else.");
    await page.getByLabel("Send message").click();
    await page.getByLabel("Send message").waitFor({ state: "visible", timeout: 45000 });
    await expect(page.locator("body")).toContainText("Overtchat-E2E-Success", { timeout: 15000 });
  });

  await test.step("delete chat from mobile sidebar", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByLabel("Open sidebar").click();
    await page.getByRole("button", { name: "Chat actions" }).first().click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await expect(
      page.getByRole("alertdialog", { name: "Delete chat?" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await page.waitForURL("**/");
    await page.getByLabel("Open sidebar").click();
    await expect(
      page.getByText("No conversations yet").filter({ visible: true }),
    ).toBeVisible();
  });
});
