import { expect, test } from "@playwright/test";
import { openE2eDatabase, resetE2eDatabase } from "./helpers/database";

test.beforeEach(resetE2eDatabase);

test("shows the current chat title in the header", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/signup");
  await page.locator("#name").fill("Header Test Admin");
  await page.locator("#email").fill("header-admin@overtchat-test.local");
  await page.locator("#password").fill("test-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/");

  const header = page.locator("header");
  await expect(header.getByRole("heading")).toHaveCount(0);

  await page.getByRole("button", { name: "Enable temporary chat" }).click();
  await expect(
    header.getByRole("heading", { name: "Temporary chat" }),
  ).toBeVisible();

  const title =
    "A deliberately long conversation title that must truncate safely";
  const db = openE2eDatabase();
  try {
    const user = db.prepare("SELECT id FROM user LIMIT 1").get() as
      | { id: string }
      | undefined;
    if (!user) throw new Error("Signup user was not created");
    db.prepare(
      `INSERT INTO chats (id, user_id, title, created_at, updated_at)
       VALUES ('header-title-chat', ?, ?, ?, ?)`,
    ).run(user.id, title, Date.now(), Date.now());
  } finally {
    db.close();
  }

  await page.goto("/chat/header-title-chat");
  const savedChatTitle = header.getByRole("heading", { name: title });
  await expect(savedChatTitle).toBeVisible();
  await expect(savedChatTitle).toHaveAttribute("title", title);
});
