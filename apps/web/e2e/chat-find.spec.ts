import { expect, test, type Page } from "@playwright/test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { openE2eDatabase, resetE2eDatabase, setupUrl } from "./helpers/database";

test.beforeEach(resetE2eDatabase);

let modelServer: Server;
let modelBaseUrl: string;

// Streams a reply that mentions the find query in every chunk.
test.beforeAll(async () => {
  modelServer = createServer(async (req, res) => {
    for await (const chunk of req) void chunk;
    const created = Math.floor(Date.now() / 1_000);
    const chunk = (delta: object, finish: string | null = null) =>
      `data: ${JSON.stringify({
        id: "find-response",
        object: "chat.completion.chunk",
        created,
        model: "find-test-model",
        choices: [{ index: 0, delta, finish_reason: finish }],
      })}\n\n`;
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    for (let index = 0; index < 20; index += 1) {
      res.write(
        chunk({
          role: index === 0 ? "assistant" : undefined,
          content: `Zebra fact ${index}. `,
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    res.write(chunk({}, "stop"));
    res.end("data: [DONE]\n\n");
  });
  await new Promise<void>((resolve) => {
    modelServer.listen(0, "127.0.0.1", resolve);
  });
  const { port } = modelServer.address() as AddressInfo;
  modelBaseUrl = `http://127.0.0.1:${port}/v1`;
});

test.afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    modelServer.close((error) => (error ? reject(error) : resolve()));
  });
});

async function signUp(page: Page) {
  await page.goto(await setupUrl());
  await page.locator("#name").fill("Find Admin");
  await page.locator("#email").fill("find-admin@overtchat-test.local");
  await page.locator("#password").fill("test-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/");
}

/** Seeds a chat whose messages default to filler unless `texts` sets them. */
function seedChat(messageCount: number, texts: Record<number, string> = {}) {
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
      for (let index = 0; index < messageCount; index += 1) {
        const role = index % 2 === 0 ? "user" : "assistant";
        const text =
          texts[index] ??
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

function seedModel() {
  const db = openE2eDatabase();
  const now = Date.now();
  try {
    db.prepare(
      `INSERT INTO model_configs (
        id, label, provider_id, api_format, base_url, api_key, model,
        tool_calling_enabled, enabled, sort_order, created_at, updated_at
      ) VALUES (
        'find-model', 'Find Model', 'custom', 'openai-chat',
        ?, 'test-key', 'find-test-model', 1, 1, 0, ?, ?
      )`,
    ).run(modelBaseUrl, now, now);
  } finally {
    db.close();
  }
}

async function openChat(page: Page, lastMessage: string) {
  await page.goto("/chat/find-chat");
  await expect(page.getByText(lastMessage, { exact: true })).toBeVisible();
}

/**
 * The active match: its text, message, character offset within the message,
 * and whether it is fully visible, including inside sideways-scrolling blocks.
 */
function activeMatch(page: Page) {
  return page.evaluate(() => {
    const highlight = CSS.highlights.get("chat-find-active");
    const range = highlight ? ([...highlight][0] as Range | undefined) : undefined;
    if (!range) return null;
    const row = range.startContainer.parentElement?.closest("[data-message-id]");
    if (!row) return null;
    const before = document.createRange();
    before.setStart(row, 0);
    before.setEnd(range.startContainer, range.startOffset);
    const rect = range.getBoundingClientRect();
    let visible = rect.width > 0;
    for (
      let element = range.startContainer.parentElement;
      element && visible;
      element = element.parentElement
    ) {
      const clips =
        element.matches("[data-chat-transcript-scroll]") ||
        (getComputedStyle(element).overflowX !== "visible" &&
          element.scrollWidth > element.clientWidth);
      if (!clips) continue;
      const box = element.getBoundingClientRect();
      visible =
        rect.top >= box.top &&
        rect.bottom <= box.bottom &&
        rect.left >= box.left &&
        rect.right <= box.right;
    }
    return {
      text: range.toString(),
      messageId: row.getAttribute("data-message-id"),
      offset: before.toString().length,
      visible,
    };
  });
}

function distanceFromBottom(page: Page) {
  return page
    .locator("[data-chat-transcript-scroll]")
    .evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop);
}

test("find in chat searches the whole chat and steps through matches", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await signUp(page);
  // Older pages hold two matches; the loaded page holds one, rendered as code.
  seedChat(120, {
    5: "Question 5: where is the Needle?",
    11: "The answer hides a **needle** in bold.",
    101: "Look for `needle` in the code.",
  });
  await openChat(page, "Answer 119");

  await page.keyboard.press("ControlOrMeta+f");
  const input = page.getByRole("textbox", { name: "Find in chat" });
  await expect(input).toBeFocused();
  const findBar = page.getByRole("search");

  // Opening find loads the older pages, so every match counts. The nearest
  // match above the reader is selected first.
  await input.fill("needle");
  await expect(findBar.getByText("3/3")).toBeVisible();
  await expect.poll(() => activeMatch(page)).toMatchObject({
    text: "needle",
    messageId: "message-101",
    visible: true,
  });

  await input.press("Enter");
  await expect(findBar.getByText("1/3")).toBeVisible();
  await expect.poll(() => activeMatch(page)).toMatchObject({
    text: "Needle",
    messageId: "message-005",
    visible: true,
  });

  await page.keyboard.press("ControlOrMeta+g");
  await expect(findBar.getByText("2/3")).toBeVisible();
  await expect.poll(() => activeMatch(page)).toMatchObject({
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
  expect(await page.evaluate(() => CSS.highlights.has("chat-find"))).toBe(false);
});

test("every match in rich markdown is counted once and shown", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await signUp(page);
  seedChat(80, {
    1: [
      "| Name | Note |",
      "| --- | --- |",
      "| needle | a Needle here |",
    ].join("\n"),
    3: "Read [the needle docs](https://example.com/needle-path) now.",
    5: "Inline $$needle^2$$ math is not text.",
    7: ["```text", `${"x".repeat(400)} needle`, "```"].join("\n"),
    9: ["```mermaid", "graph TD; needle-->B", "```"].join("\n"),
    11: "中文needle测试",
    13: "Body text.[^1]\n\n[^1]: The needle note.",
    15: "Cited needle claim. turn0search0",
    16: "Where is the needle? NEEDLE!",
  });
  await openChat(page, "Answer 79");

  await page.keyboard.press("ControlOrMeta+f");
  const input = page.getByRole("textbox", { name: "Find in chat" });
  await input.fill("needle");
  const status = page.getByRole("search").locator("[aria-live]");
  await expect(status).toHaveText(/^\d+\/\d+$/);

  // Step through every match until the selection wraps around: each one must
  // be highlighted, visible, and distinct, and the counter must agree.
  const seen: string[] = [];
  for (let step = 0; step < 30; step += 1) {
    await expect.poll(() => activeMatch(page)).toMatchObject({ visible: true });
    const match = (await activeMatch(page))!;
    expect(match.text.toLowerCase()).toBe("needle");
    const key = `${match.messageId}:${match.offset}`;
    if (key === seen[0]) break;
    expect(seen).not.toContain(key);
    seen.push(key);
    await input.press("Enter");
  }
  const total = Number((await status.textContent())!.split("/")[1]);
  expect(seen.length).toBe(total);
  // Table cells (2), link text (1), wide code (1), CJK (1), the citation's
  // sentence (1), and the user's message (2). Math, the diagram source, and
  // the link URL are not shown as text, so they do not count.
  const footnote = seen.filter((key) => key.startsWith("message-013:"));
  expect(total - footnote.length).toBe(8);
});

test("scrolling during a jump leaves the reader where they scrolled", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await signUp(page);
  seedChat(120, { 5: "Question 5: where is the needle?", 101: "Find the needle." });
  await openChat(page, "Answer 119");

  await page.keyboard.press("ControlOrMeta+f");
  const input = page.getByRole("textbox", { name: "Find in chat" });
  await input.fill("needle");
  await expect(page.getByRole("search").getByText("2/2")).toBeVisible();
  const transcript = page.locator("[data-chat-transcript-scroll]");
  await expect.poll(() => activeMatch(page)).toMatchObject({ visible: true });
  const start = await transcript.evaluate((element) => element.scrollTop);

  // Jump to the oldest match, and scroll back down as soon as it starts.
  await input.press("Enter");
  await expect
    .poll(() => transcript.evaluate((element) => element.scrollTop))
    .not.toBe(start);
  await transcript.evaluate((element) => {
    element.dispatchEvent(new WheelEvent("wheel", { deltaY: 400 }));
    element.scrollTop = element.scrollHeight;
  });
  await page.waitForTimeout(1_000);
  expect(await distanceFromBottom(page)).toBeLessThanOrEqual(80);
});

test("a streaming reply joins the results when it completes, without moving the view", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await signUp(page);
  seedChat(6);
  seedModel();
  await openChat(page, "Answer 5");

  await page.keyboard.press("ControlOrMeta+f");
  const input = page.getByRole("textbox", { name: "Find in chat" });
  await input.fill("zebra");
  const findBar = page.getByRole("search");
  await expect(findBar.getByText("No results")).toBeVisible();

  await page.getByPlaceholder("Message…").fill("Tell me about animals.");
  await page.getByLabel("Send message").click();
  await expect(page.getByText(/Zebra fact 3\./)).toBeVisible();
  // While the reply streams, it is not searched and nothing is selected.
  await expect(findBar.getByText("No results")).toBeVisible();
  expect(await activeMatch(page)).toBeNull();

  // Once it completes its matches count, but none is selected or scrolled to.
  await expect(page.getByLabel("Send message")).toBeVisible();
  await expect(findBar.getByText("?/20")).toBeVisible();
  const transcript = page.locator("[data-chat-transcript-scroll]");
  const settled = await transcript.evaluate((element) => element.scrollTop);
  await page.waitForTimeout(500);
  expect(await transcript.evaluate((element) => element.scrollTop)).toBe(settled);
  expect(await activeMatch(page)).toBeNull();

  await input.press("Enter");
  await expect(findBar.getByText("1/20")).toBeVisible();
  await expect.poll(() => activeMatch(page)).toMatchObject({
    text: "Zebra",
    visible: true,
  });
});

test("selected text seeds find, and Escape closes it from the composer", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await signUp(page);
  seedChat(10);
  seedModel();
  await openChat(page, "Answer 9");

  await page.getByText("Question 8: explain item 8.").evaluate((element) => {
    const text = element.firstChild!;
    const range = document.createRange();
    range.setStart(text, "Question 8: ".length);
    range.setEnd(text, "Question 8: explain item".length);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await page.keyboard.press("ControlOrMeta+f");
  const input = page.getByRole("textbox", { name: "Find in chat" });
  await expect(input).toHaveValue("explain item");
  await expect(page.getByRole("search").getByText(/^\d\/5$/)).toBeVisible();

  await page.getByPlaceholder("Message…").click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("search")).toHaveCount(0);

  // Reopening keeps the query and selects it for replacement.
  await page.keyboard.press("ControlOrMeta+f");
  await expect(input).toHaveValue("explain item");
  await expect(input).toBeFocused();
});
