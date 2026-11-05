import { expect, test, type Download } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { openE2eDatabase, resetE2eDatabase, setupUrl } from "./helpers/database";

test.beforeEach(resetE2eDatabase);

// Chromium reports the zone it was started with, so pin one for the times.
test.use({ timezoneId: "America/New_York" });

const SENT_AT = Date.UTC(2026, 2, 4, 17, 3);

function seedChat() {
  const db = openE2eDatabase();
  try {
    const owner = db.prepare("SELECT id FROM user LIMIT 1").get() as { id: string };
    db.prepare(
      `INSERT INTO chats (id, user_id, title, created_at, updated_at)
       VALUES ('export-chat', ?, 'Trip plan', ?, ?)`,
    ).run(owner.id, SENT_AT, SENT_AT);
    const insert = db.prepare(
      `INSERT INTO messages (id, chat_id, role, parts, metadata, created_at)
       VALUES (?, 'export-chat', ?, ?, ?, ?)`,
    );
    insert.run(
      "question",
      "user",
      JSON.stringify([{ type: "text", text: "Where should I go?" }]),
      null,
      SENT_AT,
    );
    insert.run(
      "answer",
      "assistant",
      JSON.stringify([
        { type: "reasoning", text: "Thinking about beaches." },
        { type: "text", text: "## Options\n\n- Lisbon\n- Porto" },
      ]),
      JSON.stringify({ stats: { model: "export-test-model" } }),
      SENT_AT + 60_000,
    );
  } finally {
    db.close();
  }
}

async function text(download: Download) {
  return readFile(await download.path(), "utf8");
}

test("a chat exports as Markdown or JSON from the sidebar menu", async ({ page }) => {
  await page.goto(await setupUrl());
  await page.locator("#name").fill("Export Admin");
  await page.locator("#email").fill("export-admin@overtchat-test.local");
  await page.locator("#password").fill("test-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/");
  seedChat();
  await page.reload();

  const sidebar = page.locator("[data-desktop-sidebar]");
  const row = sidebar.getByRole("link", { name: "Trip plan", exact: true }).locator("..");
  await row.getByRole("button", { name: "Chat actions" }).click();
  await page.getByRole("menuitem", { name: "Export" }).click();

  const markdownDownload = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Markdown", exact: true }).click();
  const markdown = await markdownDownload;
  expect(markdown.suggestedFilename()).toBe("trip-plan.md");
  const exported = await text(markdown);
  expect(exported).toMatch(
    /^# Trip plan\n\n\*Exported on \d{4}-\d{2}-\d{2} \d{2}:\d{2}\. Times are in America\/New_York\.\*\n\n/,
  );
  expect(exported).toContain(
    [
      "## You",
      "*2026-03-04 12:03*",
      "Where should I go?",
      "## Assistant",
      "*2026-03-04 12:04 · export-test-model*",
      "## Options\n\n- Lisbon\n- Porto",
    ].join("\n\n") + "\n",
  );
  expect(exported).not.toContain("Thinking about beaches.");

  await row.getByRole("button", { name: "Chat actions" }).click();
  await page.getByRole("menuitem", { name: "Export" }).click();
  const jsonDownload = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "JSON", exact: true }).click();
  const json = await jsonDownload;
  expect(json.suggestedFilename()).toBe("trip-plan.json");
  expect(JSON.parse(await text(json))).toMatchObject({
    format: "overtchat",
    chats: [{ id: "export-chat", messages: [{ id: "question" }, { id: "answer" }] }],
  });
});

test("a server without Markdown export keeps the single JSON download", async ({ page }) => {
  await page.goto(await setupUrl());
  await page.locator("#name").fill("Legacy Export Admin");
  await page.locator("#email").fill("legacy-export@overtchat-test.local");
  await page.locator("#password").fill("test-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/");
  seedChat();
  await page.route("**/api/capabilities", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    delete body.capabilities.chatMarkdownExport;
    await route.fulfill({ response, json: body });
  });
  await page.reload();

  const sidebar = page.locator("[data-desktop-sidebar]");
  const row = sidebar.getByRole("link", { name: "Trip plan", exact: true }).locator("..");
  await row.getByRole("button", { name: "Chat actions" }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Export" }).click();
  expect((await download).suggestedFilename()).toBe("trip-plan.json");
  await expect(page.getByRole("menuitem", { name: "Markdown" })).toHaveCount(0);
  // A capabilities refetch may still be in flight when the test ends.
  await page.unrouteAll({ behavior: "ignoreErrors" });
});
