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

test("search and a single synced default stay independent of existing chats and manual selection", async ({
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
  const setDefault = menu.getByRole("menuitem", {
    name: "Set as default",
    exact: true,
  });
  await expect(setDefault).toHaveText("Set as default");
  await setDefault.focus();
  await page.keyboard.press("Enter");
  await expect(
    menu.getByRole("menuitem", {
      name: "Clear default",
      exact: true,
    }),
  ).toBeEnabled();
  await menu
    .getByRole("menuitem", {
      name: "deepseek-v4-flash-preview-long-name",
      exact: true,
    })
    .click();
  await expect(reasoning).toBeVisible();
  await page.goto("/");
  await expect(fast).toBeVisible();
  // The old device-local preference must not override the saved default.
  await page.evaluate(() =>
    localStorage.setItem(
      "overtchat_selected_model",
      JSON.stringify("reasoning-model"),
    ),
  );
  await page.reload();
  await expect(fast).toBeVisible();
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
      otherPage.getByRole("button", { name: "Fast Model", exact: true }),
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
});

test("the header saves the selected model even when filtered out, replaces and clears the default", async ({
  page,
}) => {
  await preparePicker(page);
  const picker = page.getByRole("button", {
    name: /deepseek-v4-flash-preview-long-name, thinking medium/,
  });
  const fast = page.getByRole("button", { name: "Fast Model", exact: true });
  const menu = page.getByRole("menu");
  await picker.click();
  await menu.getByRole("menuitem", { name: "Fast Model", exact: true }).click();
  await fast.click();
  await menu
    .getByRole("menuitem", { name: "Search models", exact: true })
    .click();
  await menu.getByRole("textbox", { name: "Search models" }).fill("deepseek");
  await expect(
    menu.getByRole("menuitem", { name: "Fast Model", exact: true }),
  ).toHaveCount(0);
  await menu
    .getByRole("menuitem", {
      name: "Set as default",
      exact: true,
    })
    .click();
  await expect(
    menu.getByRole("menuitem", { name: "Clear default", exact: true }),
  ).toBeEnabled();
  expect(
    await (await page.request.get("/api/model-preferences")).json(),
  ).toEqual({ defaultModelId: "fast-model" });
  await menu
    .getByRole("menuitem", { name: "Close model search", exact: true })
    .click();
  await expect(fast).toBeVisible();
  await expect(
    menu.getByRole("menuitem", {
      name: /^(deepseek-v4-flash-preview-long-name|Fast Model)$/,
    }),
  ).toHaveText(["deepseek-v4-flash-preview-long-name", "Fast ModelDefault"]);
  await menu
    .getByRole("menuitem", {
      name: "deepseek-v4-flash-preview-long-name",
      exact: true,
    })
    .click();
  await picker.click();
  const action = menu.getByRole("menuitem", {
    name: "Set as default",
    exact: true,
  });
  await action.focus();
  await page.keyboard.press("Enter");
  await expect(menu.getByText("Default", { exact: true })).toHaveCount(1);
  await expect(
    menu.getByRole("menuitem", {
      name: "deepseek-v4-flash-preview-long-name",
      exact: true,
    }),
  ).toContainText("Default");
  const clear = menu.getByRole("menuitem", {
    name: "Clear default",
    exact: true,
  });
  await expect(clear).toBeEnabled();
  expect(
    await (await page.request.get("/api/model-preferences")).json(),
  ).toEqual({ defaultModelId: "reasoning-model" });
  await clear.click();
  await expect(menu.getByText("Default", { exact: true })).toHaveCount(0);
  await expect(action).toBeEnabled();
  expect(
    await (await page.request.get("/api/model-preferences")).json(),
  ).toEqual({ defaultModelId: null });
  await expect(picker).toBeVisible();
});

test("failed default saves leave the saved preference unchanged", async ({
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
    .getByRole("menuitem", {
      name: "Set as default",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Couldn't save default model" }),
  ).toBeVisible();
  expect(
    await (await page.request.get("/api/model-preferences")).json(),
  ).toEqual({ defaultModelId: null });
});

test("reopening the picker refreshes a default changed elsewhere without switching the active model", async ({
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
      name: "Set as default",
      exact: true,
    }),
  ).toBeEnabled();
  await page.keyboard.press("Escape");
  expect(
    (
      await page.request.put("/api/model-preferences", {
        data: { defaultModelId: "fast-model" },
      })
    ).ok(),
  ).toBe(true);
  await picker.click();
  await expect(
    page.getByRole("menuitem", { name: "Fast Model", exact: true }),
  ).toContainText("Default");
  await expect(
    page.getByRole("menuitem", {
      name: "Set as default",
      exact: true,
    }),
  ).toBeEnabled();
  await expect(picker).toBeVisible();
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Fast Model", exact: true }),
  ).toBeVisible();
});

test("admin ordering persists, applies to other users, and supplies the fallback for unavailable defaults", async ({
  page,
  browser,
}) => {
  await preparePicker(page);
  await page.goto("/settings/models");
  await expect(
    page.getByRole("button", {
      name: "Move deepseek-v4-flash-preview-long-name up",
      exact: true,
    }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Move Fast Model up", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Move Fast Model up", exact: true }),
  ).toBeDisabled();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Move Fast Model up", exact: true }),
  ).toBeDisabled();
  const ordered = await (await page.request.get("/api/model-configs")).json();
  expect(ordered.modelConfigs.map((model: { id: string }) => model.id)).toEqual(
    ["fast-model", "reasoning-model"],
  );
  // A distinct signed-in user's public catalog uses the same server order.
  const other = await browser.newContext();
  try {
    // Better Auth signs session cookies; use the supported admin API to create
    // a regular account and sign it in through the login page.
    const response = await page.request.post("/api/auth/admin/create-user", {
      headers: { Origin: new URL(page.url()).origin },
      data: {
        name: "Other user",
        email: "other@overtchat-test.local",
        password: "test-password-123",
        role: "user",
      },
    });
    expect(response.ok()).toBe(true);
    const otherPage = await other.newPage();
    await otherPage.goto("/login");
    await otherPage.locator("#email").fill("other@overtchat-test.local");
    await otherPage.locator("#password").fill("test-password-123");
    await otherPage
      .getByRole("button", { name: "Sign in", exact: true })
      .click();
    await otherPage.waitForURL("**/");
    await expect(
      otherPage.getByRole("button", { name: "Fast Model", exact: true }),
    ).toBeVisible();
    expect(
      (
        await otherPage.request.put("/api/model-configs/order", {
          data: { modelIds: ["reasoning-model", "fast-model"] },
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await otherPage.request.put("/api/model-preferences", {
          data: { defaultModelId: "reasoning-model" },
        })
      ).ok(),
    ).toBe(true);
    expect(
      await (await page.request.get("/api/model-preferences")).json(),
    ).toEqual({ defaultModelId: null });
  } finally {
    await other.close();
  }
  await page.request.put("/api/model-preferences", {
    data: { defaultModelId: "reasoning-model" },
  });
  const updatedDb = openE2eDatabase();
  try {
    updatedDb
      .prepare(
        "UPDATE model_configs SET enabled = 0 WHERE id = 'reasoning-model'",
      )
      .run();
  } finally {
    updatedDb.close();
  }
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Fast Model", exact: true }),
  ).toBeVisible();
  await page.goto("/settings/models");
  await page
    .getByRole("button", { name: "Move Fast Model down", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Move Fast Model down", exact: true }),
  ).toBeDisabled();
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

test("long model lists show search immediately", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
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
  const action = page.getByRole("menuitem", {
    name: "Set as default",
    exact: true,
  });
  await expect(action).toBeInViewport();
  await expect(
    page.getByRole("menu").getByText("Models", { exact: true }),
  ).toBeInViewport();
  await expect
    .poll(() =>
      page.getByRole("menu").evaluate((menu) => {
        const button = menu.querySelector('[aria-label="Set as default"]')!;
        const input = menu.querySelector('input[aria-label="Search models"]')!;
        return (
          button.getBoundingClientRect().bottom <=
          input.getBoundingClientRect().top
        );
      }),
    )
    .toBe(true);
});
