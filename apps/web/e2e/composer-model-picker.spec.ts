import { expect, test } from "@playwright/test";
import { openE2eDatabase, resetE2eDatabase } from "./helpers/database";

function seedModels() {
  const db = openE2eDatabase();
  const now = Date.now();
  try {
    const insert = db.prepare(
      `INSERT INTO model_configs
        (id, label, base_url, api_key, model, discovered_capabilities, enabled, sort_order, created_at, updated_at)
       VALUES
        (@id, @label, @baseUrl, @apiKey, @model, @capabilities, 1, @sortOrder, @now, @now)`,
    );
    insert.run({
      id: "reasoning-model",
      label: "Reasoning Model",
      baseUrl: "https://example.invalid/v1",
      apiKey: "test-key",
      model: "reasoning-model",
      capabilities: JSON.stringify({
        reasoning: true,
        reasoningControls: {
          toggle: true,
          defaultLevel: "medium",
          efforts: ["low", "medium", "high"],
        },
      }),
      sortOrder: 0,
      now,
    });
    insert.run({
      id: "fast-model",
      label: "Fast Model",
      baseUrl: "https://example.invalid/v1",
      apiKey: "test-key",
      model: "fast-model",
      capabilities: JSON.stringify({ reasoning: false }),
      sortOrder: 1,
      now,
    });
  } finally {
    db.close();
  }
}

test.beforeEach(resetE2eDatabase);

test("model and thinking controls live together in the composer", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/signup");
  await page.locator("#name").fill("Composer Admin");
  await page.locator("#email").fill("composer-admin@overtchat-test.local");
  await page.locator("#password").fill("test-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/", { timeout: 15_000 });
  seedModels();
  await page.reload();

  const textarea = page.getByPlaceholder("Message… or / for commands");
  const picker = page.getByRole("button", {
    name: /Reasoning Model, thinking medium/,
  });
  await expect(textarea).toBeVisible();
  await expect(picker).toBeVisible();

  const [textareaBox, pickerBox] = await Promise.all([
    textarea.boundingBox(),
    picker.boundingBox(),
  ]);
  expect(textareaBox).not.toBeNull();
  expect(pickerBox).not.toBeNull();
  expect(pickerBox!.y).toBeGreaterThan(textareaBox!.y);

  await picker.click();
  const menu = page.getByRole("menu");
  await expect(menu).toContainText("Thinking");
  await expect(menu).toContainText("Model");
  await menu.getByRole("menuitem", { name: "high", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /Reasoning Model, thinking high/ }),
  ).toBeVisible();

  await page.getByRole("button", { name: /Reasoning Model, thinking high/ }).click();
  await menu.getByText("Fast Model", { exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Fast Model", exact: true }),
  ).toBeVisible();
});
