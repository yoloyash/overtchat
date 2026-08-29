import { expect, test } from "@playwright/test";
import { openE2eDatabase, resetE2eDatabase } from "./helpers/database";

test.beforeEach(resetE2eDatabase);

function seedLongChat(messageCount: number) {
  const db = openE2eDatabase();
  try {
    const user = db.prepare("SELECT id FROM user LIMIT 1").get() as
      | { id: string }
      | undefined;
    if (!user) throw new Error("Signup user was not created");

    db.prepare(
      `INSERT INTO chats (id, user_id, title, created_at, updated_at)
       VALUES ('long-chat', ?, 'Long chat', 1, 1)`,
    ).run(user.id);
    const insert = db.prepare(
      `INSERT INTO messages (id, chat_id, role, parts, created_at)
       VALUES (?, 'long-chat', ?, ?, ?)`,
    );
    db.transaction(() => {
      for (let index = 0; index < messageCount; index += 1) {
        const role = index % 2 === 0 ? "user" : "assistant";
        const text =
          role === "user"
            ? `Question ${index}: explain item ${index}.`
            : [
                `## Answer ${index}`,
                "",
                "- First point with **emphasis**",
                "- Second point with `inline code`",
                "",
                "```ts",
                `const answer = ${index};`,
                "```",
              ].join("\n");
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

test("long chats page history while keeping the mounted DOM bounded", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto("/signup");
  await page.locator("#name").fill("Long Chat Admin");
  await page
    .locator("#email")
    .fill("long-chat-admin@overtchat-test.local");
  await page.locator("#password").fill("test-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/");
  seedLongChat(320);

  await page.goto("/chat/long-chat");
  await expect(page.getByText("Answer 319", { exact: true })).toBeVisible();

  const transcript = page.locator("[data-chat-transcript-scroll]");
  const mountedItems = page.locator("[data-transcript-item]");
  expect(await mountedItems.count()).toBeLessThan(24);
  await expect(page.getByText("Question 0: explain item 0.")).toHaveCount(0);

  for (let pageNumber = 0; pageNumber < 3; pageNumber += 1) {
    const historyResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/messages?cursor=") &&
        response.request().method() === "GET" &&
        response.ok(),
    );
    await transcript.evaluate((element) => {
      element.scrollTop = 0;
      element.dispatchEvent(new Event("scroll"));
    });
    await historyResponse;
    await expect(page.getByText("Loading earlier messages")).toHaveCount(0);
  }

  expect(await mountedItems.count()).toBeLessThan(24);
  expect(
    await transcript.evaluate((element) => element.scrollTop),
  ).toBeGreaterThan(0);
});
