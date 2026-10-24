import { expect, test, type Page } from "@playwright/test";
import { openE2eDatabase, resetE2eDatabase, setupUrl } from "./helpers/database";

test.beforeEach(resetE2eDatabase);

const MESSAGE_COUNT = 120;

// Older pages hold two matches; the loaded page holds one, rendered as code.
const NEEDLES: Record<number, string> = {
  5: "Question 5: where is the Needle?",
  11: "The answer hides a **needle** in bold.",
  101: "Look for `needle` in the code.",
};

function seedChat() {
  const db = openE2eDatabase();
  try {
    const user = db.prepare("SELECT id FROM user LIMIT 1").get() as
      | { id: string }
      | undefined;
    if (!user) throw new Error("Signup user was not created");

    db.prepare(
      `INSERT INTO chats (id, user_id, title, created_at, updated_at)
       VALUES ('find-chat', ?, 'Find chat', 1, 1)`,
    ).run(user.id);
    const insert = db.prepare(
      `INSERT INTO messages (id, chat_id, role, parts, created_at)
       VALUES (?, 'find-chat', ?, ?, ?)`,
    );
    db.transaction(() => {
      for (let index = 0; index < MESSAGE_COUNT; index += 1) {
        const role = index % 2 === 0 ? "user" : "assistant";
        const text =
          NEEDLES[index] ??
          (role === "user"
            ? `Question ${index}: explain item ${index}.`
            : `## Answer ${index}\n\nA paragraph about item ${index}.`);
        insert.run(
          `message-${String(index).padStart(3, "0")}`,
          role,
          JSON.stringify([{ type: "text", text }]),
          index + 1,
        );
      }
    })();
  } finally {
    db.close();
  }
}

function activeMatch(page: Page) {
  return page.evaluate(() => {
    const highlight = CSS.highlights.get("chat-find-active");
    const range = highlight ? ([...highlight][0] as Range | undefined) : undefined;
    if (!range) return null;
    const row = range.startContainer.parentElement?.closest("[data-message-id]");
    const box = document
      .querySelector("[data-chat-transcript-scroll]")!
      .getBoundingClientRect();
    const rect = range.getBoundingClientRect();
    return {
      text: range.toString(),
      messageId: row?.getAttribute("data-message-id"),
      visible: rect.top >= box.top && rect.bottom <= box.bottom,
    };
  });
}

test("find in chat searches the whole chat and steps through matches", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto(await setupUrl());
  await page.locator("#name").fill("Find Admin");
  await page.locator("#email").fill("find-admin@overtchat-test.local");
  await page.locator("#password").fill("test-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/");
  seedChat();

  await page.goto("/chat/find-chat");
  await expect(
    page.getByText(`Answer ${MESSAGE_COUNT - 1}`, { exact: true }),
  ).toBeVisible();

  await page.keyboard.press("ControlOrMeta+f");
  const input = page.getByLabel("Find in chat");
  await expect(input).toBeFocused();
  const findBar = page.getByRole("search");

  // Opening find loads the older pages, so every match counts. The nearest
  // match above the reader is selected first.
  await input.fill("needle");
  await expect(findBar.getByText("3/3")).toBeVisible();
  await expect.poll(() => activeMatch(page)).toEqual({
    text: "needle",
    messageId: "message-101",
    visible: true,
  });

  await input.press("Enter");
  await expect(findBar.getByText("1/3")).toBeVisible();
  await expect.poll(() => activeMatch(page)).toEqual({
    text: "Needle",
    messageId: "message-005",
    visible: true,
  });

  await page.keyboard.press("ControlOrMeta+g");
  await expect(findBar.getByText("2/3")).toBeVisible();
  await expect.poll(() => activeMatch(page)).toEqual({
    text: "needle",
    messageId: "message-011",
    visible: true,
  });

  await input.press("Shift+Enter");
  await expect(findBar.getByText("1/3")).toBeVisible();
  await expect.poll(() => activeMatch(page)).toMatchObject({
    messageId: "message-005",
    visible: true,
  });

  await input.fill("no such phrase");
  await expect(findBar.getByText("No results")).toBeVisible();
  await expect.poll(() => activeMatch(page)).toBeNull();

  await input.press("Escape");
  await expect(findBar).toHaveCount(0);
  expect(
    await page.evaluate(() => CSS.highlights.has("chat-find")),
  ).toBe(false);
});
