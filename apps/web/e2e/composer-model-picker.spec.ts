import { expect, test, type Page } from "@playwright/test";
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
      label: "deepseek-v4-flash-preview-long-name",
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

async function preparePicker(page: Page) {
  await page.goto("/signup");
  await page.locator("#name").fill("Picker Admin");
  await page.locator("#email").fill("picker-admin@overtchat-test.local");
  await page.locator("#password").fill("test-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/", { timeout: 15_000 });
  seedModels();
  await page.reload();
}

test("search and synced favorites stay independent of device and existing chat selection", async ({
  page,
  browser,
}) => {
  await preparePicker(page);
  const reasoning = page.getByRole("button", {
    name: /deepseek-v4-flash-preview-long-name, thinking medium/,
  });
  const fast = page.getByRole("button", { name: "Fast Model", exact: true });
  await reasoning.click();
  const menu = page.getByRole("menu");
  const search = menu.getByRole("textbox", { name: "Search models" });
  await expect(search).toHaveCount(0);
  await menu
    .getByRole("menuitem", { name: "Search models", exact: true })
    .click();
  await expect(search).toBeFocused();
  await search.fill(" no-such-model ");
  await expect(menu).toContainText("No models match");
  await search.press("Escape");
  await expect(search).toHaveCount(0);
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");
  await reasoning.click();
  await menu
    .getByRole("menuitem", { name: "Search models", exact: true })
    .click();
  await expect(search).toHaveValue("");
  await search.fill(" fast-model ");
  await menu.getByRole("menuitem", { name: "Fast Model", exact: true }).click();
  await fast.click();
  const fastStar = menu.getByRole("menuitem", {
    name: "Add Fast Model to favorites",
    exact: true,
  });
  await fastStar.focus();
  await page.keyboard.press("Enter");
  await expect(
    menu.getByRole("menuitem", {
      name: "Remove Fast Model from favorites",
      exact: true,
    }),
  ).toBeVisible();
  await expect(menu.getByRole("menuitem").nth(1)).toHaveText("Fast Model");
  await menu
    .getByRole("menuitem", {
      name: "deepseek-v4-flash-preview-long-name",
      exact: true,
    })
    .click();
  await expect(reasoning).toBeVisible();
  expect(
    await (await page.request.get("/api/model-preferences")).json(),
  ).toEqual({ favoriteModelIds: ["fast-model"] });
  await page.goto("/");
  await expect(reasoning).toBeVisible();

  const db = openE2eDatabase();
  try {
    db.prepare(
      "INSERT INTO chats (id, user_id, title, model_config_id) SELECT 'saved-chat', id, 'Saved chat', 'reasoning-model' FROM user LIMIT 1",
    ).run();
  } finally {
    db.close();
  }
  await page.goto("/chat/saved-chat");
  await expect(reasoning).toBeVisible();

  const otherDevice = await browser.newContext({
    storageState: { cookies: await page.context().cookies(), origins: [] },
  });
  try {
    const otherPage = await otherDevice.newPage();
    await otherPage.goto("/");
    await expect(
      otherPage.getByRole("button", {
        name: /deepseek-v4-flash-preview-long-name, thinking medium/,
      }),
    ).toBeVisible();
    await otherPage
      .getByRole("button", {
        name: /deepseek-v4-flash-preview-long-name, thinking medium/,
      })
      .click();
    await expect(
      otherPage.getByRole("menuitem", {
        name: "Remove Fast Model from favorites",
        exact: true,
      }),
    ).toBeVisible();
    await otherPage.goto("/chat/saved-chat");
    await expect(
      otherPage.getByRole("button", {
        name: /deepseek-v4-flash-preview-long-name, thinking medium/,
      }),
    ).toBeVisible();
  } finally {
    await otherDevice.close();
  }

  const updatedDb = openE2eDatabase();
  try {
    updatedDb
      .prepare("UPDATE model_configs SET enabled = 0 WHERE id = 'fast-model'")
      .run();
  } finally {
    updatedDb.close();
  }
  await page.goto("/");
  await expect(reasoning).toBeVisible();
});

test("a failed favorite save leaves the saved preference unchanged", async ({
  page,
}) => {
  await preparePicker(page);
  await page.route("**/api/model-preferences", async (route) => {
    if (route.request().method() === "PUT")
      await route.fulfill({ status: 500, body: "Failed" });
    else await route.continue();
  });
  await page
    .getByRole("button", {
      name: /deepseek-v4-flash-preview-long-name, thinking medium/,
    })
    .click();
  await page.getByRole("menuitem", { name: "Fast Model", exact: true }).hover();
  await page
    .getByRole("menuitem", { name: "Add Fast Model to favorites", exact: true })
    .click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Couldn't save model favorites" }),
  ).toHaveText("Couldn't save model favorites");
  expect(
    await (await page.request.get("/api/model-preferences")).json(),
  ).toEqual({ favoriteModelIds: [] });
});

test("reopening the picker refreshes favorites changed elsewhere without reloading the chat", async ({
  page,
}) => {
  await preparePicker(page);
  const picker = page.getByRole("button", {
    name: /deepseek-v4-flash-preview-long-name, thinking medium/,
  });
  await picker.click();
  await page.getByRole("menuitem", { name: "Fast Model", exact: true }).hover();
  await expect(
    page.getByRole("menuitem", {
      name: "Add Fast Model to favorites",
      exact: true,
    }),
  ).toBeEnabled();
  await page.keyboard.press("Escape");
  // Another client saves while this chat and its query cache remain mounted.
  const response = await page.request.put("/api/model-preferences", {
    data: { modelConfigId: "fast-model", favorite: true },
  });
  expect(response.ok()).toBe(true);
  await picker.click();
  await expect(
    page.getByRole("menuitem", {
      name: "Remove Fast Model from favorites",
      exact: true,
    }),
  ).toBeVisible();
  await expect(picker).toBeVisible();
});

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
    name: /deepseek-v4-flash-preview-long-name, thinking medium/,
  });
  await expect(textarea).toBeVisible();
  await expect(picker).toBeVisible();

  const dictate = page.getByRole("button", { name: "Dictate" });
  const [textareaBox, pickerBox, dictateBox] = await Promise.all([
    textarea.boundingBox(),
    picker.boundingBox(),
    dictate.boundingBox(),
  ]);
  expect(textareaBox).not.toBeNull();
  expect(pickerBox).not.toBeNull();
  expect(dictateBox).not.toBeNull();
  expect(pickerBox!.y).toBeGreaterThan(textareaBox!.y);
  expect(pickerBox!.x + pickerBox!.width).toBeLessThanOrEqual(dictateBox!.x);
  await expect(picker).toContainText("medium");

  await picker.click();
  const menu = page.getByRole("menu");
  await expect(menu).toContainText("Thinking");
  await expect(menu).toContainText("Model");
  await menu.getByRole("menuitem", { name: "high", exact: true }).click();
  await expect(
    page.getByRole("button", {
      name: /deepseek-v4-flash-preview-long-name, thinking high/,
    }),
  ).toBeVisible();

  await page
    .getByRole("button", {
      name: /deepseek-v4-flash-preview-long-name, thinking high/,
    })
    .click();
  await menu.getByText("Fast Model", { exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Fast Model", exact: true }),
  ).toBeVisible();
});

test("multiple stars persist and removing one preserves the others and current selection", async ({
  page,
}) => {
  await preparePicker(page);
  const picker = page.getByRole("button", {
    name: /deepseek-v4-flash-preview-long-name, thinking medium/,
  });
  await picker.click();
  const menu = page.getByRole("menu");
  await menu.getByRole("menuitem", { name: "Fast Model", exact: true }).hover();
  await menu
    .getByRole("menuitem", { name: "Add Fast Model to favorites", exact: true })
    .click();
  await expect(
    menu.getByRole("menuitem", {
      name: "Remove Fast Model from favorites",
      exact: true,
    }),
  ).toBeEnabled();
  const secondStar = menu.getByRole("menuitem", {
    name: "Add deepseek-v4-flash-preview-long-name to favorites",
    exact: true,
  });
  await secondStar.focus();
  await page.keyboard.press("Enter");
  await expect(
    menu.getByRole("menuitem", {
      name: "Remove deepseek-v4-flash-preview-long-name from favorites",
      exact: true,
    }),
  ).toBeEnabled();
  expect(
    await (await page.request.get("/api/model-preferences")).json(),
  ).toEqual({ favoriteModelIds: ["fast-model", "reasoning-model"] });
  await expect(picker).toBeVisible();
  await page.reload();
  await picker.click();
  await expect(
    menu.getByRole("menuitem", { name: /^Remove .* from favorites$/ }),
  ).toHaveCount(2);
  await menu
    .getByRole("menuitem", {
      name: "Remove Fast Model from favorites",
      exact: true,
    })
    .click();
  await expect(
    menu.getByRole("menuitem", {
      name: "Remove Fast Model from favorites",
      exact: true,
    }),
  ).toHaveCount(0);
  expect(
    await (await page.request.get("/api/model-preferences")).json(),
  ).toEqual({ favoriteModelIds: ["reasoning-model"] });
  await menu.getByRole("menuitem", { name: "Fast Model", exact: true }).click();
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Fast Model", exact: true }),
  ).toBeVisible();
});

test("long model lists show search immediately", async ({ page }) => {
  await preparePicker(page);
  const db = openE2eDatabase();
  try {
    for (let i = 0; i < 6; i++)
      db.prepare(
        "INSERT INTO model_configs (id, label, base_url, model) VALUES (?, ?, 'https://example.invalid/v1', ?)",
      ).run(`extra-${i}`, `Extra ${i}`, `extra-${i}`);
  } finally {
    db.close();
  }
  await page.reload();
  await page.getByRole("button", { name: /Extra 0/ }).click();
  await expect(
    page.getByRole("textbox", { name: "Search models" }),
  ).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "Search models", exact: true }),
  ).toHaveCount(0);
});
