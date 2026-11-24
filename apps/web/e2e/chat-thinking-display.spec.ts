import { expect, test, type Page } from "@playwright/test";
import { openE2eDatabase, resetE2eDatabase, setupUrl } from "./helpers/database";

test.beforeEach(resetE2eDatabase);

const PLAN = "Plan the search before running it.";
const CHECK = "The first result looks current, so read it.";
const ALONE = "Nothing to look up, answer from memory.";

function seedChat() {
  const db = openE2eDatabase();
  try {
    const owner = db.prepare("SELECT id FROM user LIMIT 1").get() as { id: string };
    db.prepare(
      "INSERT INTO chats (id, user_id, title) VALUES ('thinking-chat', ?, 'Thinking display')",
    ).run(owner.id);
    const insert = db.prepare(
      "INSERT INTO messages (id, chat_id, role, parts, metadata, created_at) VALUES (?, 'thinking-chat', ?, ?, NULL, ?)",
    );
    insert.run(
      "q1",
      "user",
      JSON.stringify([{ type: "text", text: "What changed in the release?" }]),
      1,
    );
    insert.run(
      "a1",
      "assistant",
      JSON.stringify([
        { type: "reasoning", text: `**Planning the search**\n\n${PLAN}`, state: "done" },
        {
          type: "tool-web_search",
          toolCallId: "search",
          state: "output-available",
          input: { query: "release notes" },
          output: [
            {
              title: "Release notes",
              link: "https://example.com/release",
              snippet: "What changed",
            },
          ],
        },
        { type: "reasoning", text: CHECK, state: "done" },
        { type: "reasoning", text: "", state: "done" },
        {
          type: "tool-fetch_url",
          toolCallId: "fetch",
          state: "output-available",
          input: { url: "https://example.com/release" },
          output: {
            title: "Release notes",
            url: "https://example.com/release",
            content: "Release body",
            wordCount: 2,
          },
        },
        { type: "text", text: "Searched answer." },
      ]),
      2,
    );
    insert.run(
      "q2",
      "user",
      JSON.stringify([{ type: "text", text: "And from memory?" }]),
      3,
    );
    insert.run(
      "a2",
      "assistant",
      JSON.stringify([
        { type: "reasoning", text: ALONE, state: "done" },
        { type: "text", text: "Remembered answer." },
      ]),
      4,
    );
  } finally {
    db.close();
  }
}

async function signUp(page: Page) {
  await page.goto(await setupUrl());
  await page.locator("#name").fill("Thinking Tester");
  await page.locator("#email").fill("thinking@overtchat-test.local");
  await page.locator("#password").fill("test-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/");
  seedChat();
}

test("thinking among tool steps stays one line until opened", async ({ page }) => {
  await signUp(page);
  await page.goto("/chat/thinking-chat");
  await expect(page.getByText("Searched answer.", { exact: true })).toBeVisible();

  const toolRun = page.getByRole("button", { name: "Read page", exact: true });
  await expect(toolRun).toHaveAttribute("aria-expanded", "false");
  await toolRun.click();

  // Tool steps show; each thought is a labelled row with its opening line.
  await expect(page.getByText("release notes", { exact: true })).toBeVisible();
  const plan = page.getByRole("button", {
    name: "Thought Planning the search",
    exact: true,
  });
  const check = page.getByRole("button", { name: `Thought ${CHECK}`, exact: true });
  await expect(plan).toHaveAttribute("aria-expanded", "false");
  await expect(check).toHaveAttribute("aria-expanded", "false");
  // The empty reasoning part gets no row.
  await expect(page.getByRole("button", { name: /^Thought( |$)/ })).toHaveCount(2);
  await expect(page.getByText(PLAN)).toHaveCount(0);

  await plan.click();
  await expect(page.getByText(PLAN, { exact: true })).toBeVisible();
  await expect(check).toHaveAttribute("aria-expanded", "false");

  // A run with only thinking shows it straight away when opened.
  await page.getByRole("button", { name: /^Thought for|^Thoughts$/ }).click();
  await expect(page.getByText(ALONE, { exact: true })).toBeVisible();
});

test("the device setting opens thinking and tool steps by default", async ({
  page,
}) => {
  await signUp(page);
  await page.goto("/settings/general");
  const toggle = page.getByRole("switch", {
    name: "Expand thinking and tools",
    exact: true,
  });
  await expect(toggle).not.toBeChecked();
  await toggle.click();
  await expect(toggle).toBeChecked();

  await page.goto("/chat/thinking-chat");
  await expect(page.getByText(PLAN, { exact: true })).toBeVisible();
  await expect(page.getByText(CHECK, { exact: true })).toBeVisible();
  await expect(page.getByText(ALONE, { exact: true })).toBeVisible();
  await expect(page.getByText("release notes", { exact: true })).toBeVisible();

  // A click still closes one run, and the choice survives a reload.
  const toolRun = page.getByRole("button", { name: "Read page", exact: true });
  await expect(toolRun).toHaveAttribute("aria-expanded", "true");
  await toolRun.click();
  await expect(toolRun).toHaveAttribute("aria-expanded", "false");
  await page.reload();
  await expect(page.getByText(ALONE, { exact: true })).toBeVisible();
  await expect(page.getByText(CHECK, { exact: true })).toBeVisible();
});
