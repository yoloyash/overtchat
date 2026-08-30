import { expect, test, type Page } from "@playwright/test";
import { openE2eDatabase, resetE2eDatabase } from "./helpers/database";

test.beforeEach(resetE2eDatabase);

async function createAccountAndFixtures(page: Page) {
  await page.goto("/signup");
  await page.locator("#name").fill("Draft Test Admin");
  await page.locator("#email").fill("draft-admin@overtchat-test.local");
  await page.locator("#password").fill("test-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/");

  const db = openE2eDatabase();
  const now = Date.now();
  try {
    const user = db.prepare("SELECT id FROM user LIMIT 1").get() as
      { id: string } | undefined;
    if (!user) throw new Error("Signup user was not created");

    db.prepare(
      `INSERT INTO projects (id, user_id, name, created_at, updated_at)
       VALUES ('draft-project', ?, 'Draft project', ?, ?)`,
    ).run(user.id, now, now);
    const insertChat = db.prepare(
      `INSERT INTO chats (id, user_id, title, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    );
    insertChat.run("draft-chat-a", user.id, "Draft chat A", now, now);
    insertChat.run("draft-chat-b", user.id, "Draft chat B", now, now - 1);
    db.prepare(
      `INSERT INTO model_configs (
        id, label, provider_id, api_format, base_url, api_key, model,
        tool_calling_enabled, enabled, sort_order, created_at, updated_at
      ) VALUES (
        'draft-model', 'Draft Model', 'custom', 'openai-chat',
        'http://127.0.0.1:1/v1', 'test-key', 'draft-test-model',
        0, 1, 0, ?, ?
      )`,
    ).run(now, now);
    return user.id;
  } finally {
    db.close();
  }
}

function composer(page: Page) {
  return page.getByPlaceholder("Message…");
}

test("restores independent saved, root, and project drafts", async ({
  page,
}) => {
  await createAccountAndFixtures(page);

  await page.goto("/chat/draft-chat-a");
  await composer(page).fill("  Draft A 🌲\n\n  with indentation  ");

  await page.goto("/chat/draft-chat-b");
  await composer(page).fill("Draft B");
  await page.reload();
  await expect(composer(page)).toHaveValue("Draft B");

  await page.goto("/chat/draft-chat-a");
  await expect(composer(page)).toHaveValue(
    "  Draft A 🌲\n\n  with indentation  ",
  );

  await page.goto("/");
  await composer(page).fill("Root new-chat draft");
  await page.goto("/chat/draft-chat-a");
  await page.goto("/");
  await expect(composer(page)).toHaveValue("Root new-chat draft");

  await page.goto("/?projectId=draft-project");
  await expect(composer(page)).toHaveValue("");
  await composer(page).fill("Project new-chat draft");
  await page.goto("/");
  await expect(composer(page)).toHaveValue("Root new-chat draft");
  await page.goto("/?projectId=draft-project");
  await expect(composer(page)).toHaveValue("Project new-chat draft");
});

test("clears sent and temporary drafts without a delayed write restoring them", async ({
  page,
}) => {
  await createAccountAndFixtures(page);
  await page.route("**/api/chat", (route) => route.abort());

  await page.goto("/chat/draft-chat-a");
  await composer(page).fill("Send this only once");
  await page.getByLabel("Send message").click();
  await expect(composer(page)).toHaveValue("");
  await page.waitForTimeout(500);
  await page.reload();
  await expect(composer(page)).toHaveValue("");

  await page.goto("/");
  await composer(page).fill("Temporary secret");
  await page.getByLabel("Enable temporary chat").click();
  await page.reload();
  await expect(composer(page)).toHaveValue("");
});

test("moves the composer to the saved-chat scope after the first send", async ({
  page,
}) => {
  const userId = await createAccountAndFixtures(page);
  await page.route("**/api/chat", (route) => route.abort());

  await page.goto("/");
  await composer(page).fill("Create this chat");
  await page.getByLabel("Send message").click();
  await expect(page).toHaveURL(/\/chat\/[^/]+$/);
  await expect(composer(page)).toHaveValue("");

  const chatId = new URL(page.url()).pathname.split("/").at(-1);
  if (!chatId) throw new Error("New chat URL did not contain an id");
  const db = openE2eDatabase();
  try {
    db.prepare(
      `INSERT INTO chats (id, user_id, title, created_at, updated_at)
       VALUES (?, ?, 'New draft chat', ?, ?)`,
    ).run(chatId, userId, Date.now(), Date.now());
  } finally {
    db.close();
  }

  await composer(page).fill("Follow-up prepared after the first send");
  await page.waitForTimeout(500);
  await page.reload();
  await expect(composer(page)).toHaveValue(
    "Follow-up prepared after the first send",
  );
  await page.goto("/");
  await expect(composer(page)).toHaveValue("");
});

test("uses last-write-wins storage without replacing another tab's live input", async ({
  page,
  context,
}) => {
  await createAccountAndFixtures(page);
  await page.goto("/chat/draft-chat-a");
  await composer(page).fill("Draft from the first tab");
  await page.waitForTimeout(500);

  const secondPage = await context.newPage();
  await secondPage.goto("/chat/draft-chat-a");
  await expect(composer(secondPage)).toHaveValue("Draft from the first tab");
  await composer(secondPage).fill("Newer draft from the second tab");
  await secondPage.waitForTimeout(500);

  await expect(composer(page)).toHaveValue("Draft from the first tab");
  await page.close();
  await secondPage.reload();
  await expect(composer(secondPage)).toHaveValue(
    "Newer draft from the second tab",
  );
});
