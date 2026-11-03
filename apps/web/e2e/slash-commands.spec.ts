import { expect, test, type Page } from "@playwright/test";
import { openE2eDatabase, resetE2eDatabase, setupUrl } from "./helpers/database";

test.beforeEach(resetE2eDatabase);

async function createAccountAndModel(page: Page) {
  await page.goto(await setupUrl());
  await page.locator("#name").fill("Slash Test Admin");
  await page.locator("#email").fill("slash-admin@overtchat-test.local");
  await page.locator("#password").fill("test-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/");

  const db = openE2eDatabase();
  const now = Date.now();
  try {
    // Tool calling makes web search available, so `/search` is runnable.
    db.prepare(
      `INSERT INTO model_configs (
        id, label, provider_id, api_format, base_url, api_key, model,
        tool_calling_enabled, enabled, sort_order, created_at, updated_at
      ) VALUES (
        'slash-model', 'Slash Model', 'custom', 'openai-chat',
        'http://127.0.0.1:1/v1', 'test-key', 'slash-test-model',
        1, 1, 0, ?, ?
      )`,
    ).run(now, now);
  } finally {
    db.close();
  }
  await page.reload();
}

function composer(page: Page) {
  return page.getByPlaceholder("Message…");
}

function commandMenu(page: Page) {
  return page.getByRole("listbox", { name: "Commands" });
}

function searchChip(page: Page) {
  return page.getByRole("button", { name: "Remove Web search from this message" });
}

test("slash commands run from inside a sentence and leave the rest of the draft", async ({
  page,
}) => {
  await createAccountAndModel(page);
  const input = composer(page);
  await expect(input).toBeEnabled();

  await test.step("a slash word mid-sentence opens the menu", async () => {
    await input.pressSequentially("find me /sea");
    await expect(commandMenu(page)).toBeVisible();
    await expect(page.getByRole("option", { name: /Web search/ })).toBeVisible();
    await expect(page.getByRole("option", { name: /Switch model/ })).toHaveCount(0);
  });

  await test.step("Tab completes the name in place", async () => {
    await input.press("Tab");
    await expect(input).toHaveValue("find me /search");
    await expect(commandMenu(page)).toBeVisible();
  });

  await test.step("Enter runs the command and splices the token out", async () => {
    await input.press("Enter");
    await expect(input).toHaveValue("find me ");
    await expect(searchChip(page)).toBeVisible();
    await expect(commandMenu(page)).toHaveCount(0);
  });

  await test.step("the caret lands where the token was", async () => {
    await input.pressSequentially("the weather");
    await expect(input).toHaveValue("find me the weather");
  });

  await test.step("a whole-draft command keeps its argument as the message", async () => {
    await searchChip(page).click();
    await input.fill("");
    await input.pressSequentially("/search what's new today");
    await expect(commandMenu(page)).toHaveCount(0);
    await input.press("Enter");
    await expect(input).toHaveValue("what's new today");
    await expect(searchChip(page)).toBeVisible();
  });

  await test.step("the model submenu works inline", async () => {
    await input.fill("");
    await input.pressSequentially("hi /model slash");
    await expect(
      page.getByRole("listbox", { name: "Select model" }),
    ).toBeVisible();
    await expect(page.getByRole("option", { name: /Slash Model/ })).toBeVisible();
    await input.press("Enter");
    await expect(input).toHaveValue("hi ");
  });
});

test("slashes inside prose never open the menu or run commands", async ({
  page,
}) => {
  await createAccountAndModel(page);
  const input = composer(page);
  await expect(input).toBeEnabled();

  for (const prose of [
    "check /etc/hosts for me",
    "the ratio is 5/3",
    "see https://example.com/new",
    "use /new to start a chat",
  ]) {
    await input.fill("");
    await input.pressSequentially(prose);
    await expect(input).toHaveValue(prose);
    await expect(commandMenu(page)).toHaveCount(0);
  }

  await test.step("a dismissed inline token stays as text on Enter", async () => {
    await input.fill("");
    await input.pressSequentially("see /temporary");
    await expect(commandMenu(page)).toBeVisible();
    await input.press("Escape");
    await expect(commandMenu(page)).toHaveCount(0);
    // Enter sends the sentence as a message instead of toggling temporary
    // chat; the model is unreachable, so only the user turn is asserted.
    await input.press("Enter");
    await expect(page.getByText("see /temporary", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Disable temporary chat" }),
    ).toHaveCount(0);
  });
});
