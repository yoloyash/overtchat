import { expect, test } from "@playwright/test";
import { openE2eDatabase, resetE2eDatabase } from "./helpers/database";

test.beforeEach(resetE2eDatabase);

function seedModels() {
  const db = openE2eDatabase();
  const now = Date.now();
  try {
    const insert = db.prepare(`
      INSERT INTO model_configs (
        id, label, provider_id, api_format, base_url, model,
        tool_calling_enabled, enabled, sort_order, created_at, updated_at
      ) VALUES (?, ?, 'custom', 'openai-chat', 'http://127.0.0.1:9999/v1', ?, 1, ?, ?, ?, ?)
    `);
    insert.run(
      "chat-model",
      "Chat Model",
      "chat-model",
      1,
      0,
      now,
      now,
    );
    insert.run(
      "hidden-task-model",
      "Hidden Task Model",
      "hidden-task-model",
      0,
      1,
      now,
      now,
    );
  } finally {
    db.close();
  }
}

test("assign and clear a task model hidden from chat", async ({ page }) => {
  await page.goto("/signup");
  await page.locator("#name").fill("Task Model Admin");
  await page.locator("#email").fill("task-model@overtchat-test.local");
  await page.locator("#password").fill("test-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/");

  seedModels();
  await page.goto("/settings/models");

  const taskModel = page.getByRole("combobox", {
    name: "Task model",
    exact: true,
  });
  await expect(taskModel).toContainText("Same as chat model");
  await taskModel.click();
  await page
    .getByRole("option", { name: /Hidden Task Model.*Not in chat/u })
    .click();

  await expect(taskModel).toContainText("Hidden Task Model");
  await expect(page.getByText("Task", { exact: true })).toBeVisible();

  let db = openE2eDatabase();
  try {
    expect(
      db
        .prepare("SELECT id FROM model_configs WHERE task_model = true")
        .get(),
    ).toEqual({ id: "hidden-task-model" });
  } finally {
    db.close();
  }

  await page.reload();
  await expect(
    page.getByRole("combobox", { name: "Task model", exact: true }),
  ).toContainText("Hidden Task Model");

  await page
    .getByRole("combobox", { name: "Task model", exact: true })
    .click();
  await page.getByRole("option", { name: "Same as chat model" }).click();
  await expect(
    page.getByRole("combobox", { name: "Task model", exact: true }),
  ).toContainText("Same as chat model");

  db = openE2eDatabase();
  try {
    expect(
      db
        .prepare("SELECT id FROM model_configs WHERE task_model = true")
        .get(),
    ).toBeUndefined();
  } finally {
    db.close();
  }
});
