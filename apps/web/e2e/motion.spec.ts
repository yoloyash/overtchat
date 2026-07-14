import { expect, test } from "@playwright/test";
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

function seedModelConfig() {
  const db = new Database(TEST_DB_PATH);
  const now = Date.now();
  db.prepare(
    `INSERT INTO model_configs
      (id, label, base_url, api_key, model, system_prompt, extra_body, enabled, sort_order, created_at, updated_at)
     VALUES
      (@id, @label, @baseUrl, @apiKey, @model, NULL, NULL, 1, 0, @now, @now)`,
  ).run({
    id: "motion-model",
    label: "Local Motion Model",
    baseUrl: "https://example.invalid/v1",
    apiKey: "test-key",
    model: "motion-test-model",
    now,
  });
  db.close();
}

test.beforeEach(() => {
  resetE2eDatabase();
});

test("motion surfaces work without an upstream model", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });

  await test.step("admin signup", async () => {
    await page.goto("/signup");
    await page.locator("#name").fill("Motion Admin");
    await page.locator("#email").fill("motion-admin@overtchat-test.local");
    await page.locator("#password").fill("test-password-123");
    await page.getByRole("button", { name: "Create account" }).click();
    await page.waitForURL("**/", { timeout: 15000 });
    seedModelConfig();
    await page.reload();
  });

  await test.step("model picker and command palette", async () => {
    await page.getByRole("button", { name: /Local Motion Model/ }).click();
    await expect(page.getByRole("menu")).toContainText("Local Motion Model");
    await page.keyboard.press("Escape");

    await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K");
    await expect(page.getByRole("dialog", { name: "Search chats" })).toBeVisible();
    await page.getByRole("button", { name: "Close" }).click();
    await expect(page.getByRole("dialog", { name: "Search chats" })).toBeHidden();
  });

  await test.step("project dialog and motion router navigation", async () => {
    await page.getByRole("button", { name: "New project" }).click();
    await expect(page.getByRole("dialog", { name: "New project" })).toBeVisible();
    await page.locator("#project-name").fill("Motion Project");
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await page.waitForURL("**/projects/**");
    await expect(page.getByRole("heading", { name: "Instructions" })).toBeVisible();
  });

  await test.step("settings links, add-user dialog, and alert dialog", async () => {
    await page.goto("/");
    await page.getByText("Motion Admin").click();
    await page.getByRole("menuitem", { name: "Settings" }).click();
    await page.waitForURL("**/settings");

    await page.getByRole("link", { name: /Users/ }).click();
    await page.waitForURL("**/settings/users");
    await page.getByRole("button", { name: "Add user" }).click();
    await expect(page.getByRole("dialog", { name: "Add user" })).toBeVisible();
    await page.locator("#new-name").fill("Motion Guest");
    await page.locator("#new-email").fill("motion-guest@overtchat-test.local");
    await page.locator("#new-password").fill("test-password-123");
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expect(
      page.getByRole("cell", { name: "motion-guest@overtchat-test.local" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByRole("alertdialog", { name: "Delete user?" })).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("alertdialog", { name: "Delete user?" })).toBeHidden();
  });

  await test.step("mobile drawer opens under reduced motion", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await page.getByLabel("Open sidebar").click();
    await expect(page.getByRole("button", { name: "New project" })).toBeVisible();
  });

  await test.step("logout and auth redirect", async () => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/");
    await page.getByText("Motion Admin").click();
    await page.getByRole("menuitem", { name: "Log out" }).click();
    await page.waitForURL("**/login", { timeout: 15000 });
    await expect(page.locator("h1")).toContainText("Welcome back");

    await page.goto("/");
    await page.waitForURL("**/login", { timeout: 15000 });
  });
});
