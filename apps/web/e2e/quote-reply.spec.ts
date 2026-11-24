import { expect, test, type Page } from "@playwright/test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { openE2eDatabase, resetE2eDatabase, setupUrl } from "./helpers/database";

test.beforeEach(resetE2eDatabase);

let modelServer: Server;
let modelBaseUrl: string;
let requests: { messages: { role: string; content: unknown }[] }[] = [];

test.beforeAll(async () => {
  modelServer = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw) as (typeof requests)[number] & {
      stream?: boolean;
    };
    if (body.stream) requests.push(body);
    const chunk = (delta: object, finishReason: string | null) =>
      `data: ${JSON.stringify({
        id: "quote-reply-response",
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1_000),
        model: "quote-reply-test-model",
        choices: [{ index: 0, delta, finish_reason: finishReason }],
      })}\n\n`;
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(chunk({ role: "assistant", content: "Because it scratches." }, null));
    res.write(chunk({}, "stop"));
    res.end("data: [DONE]\n\n");
  });
  await new Promise<void>((resolve) => {
    modelServer.listen(0, "127.0.0.1", resolve);
  });
  const { port } = modelServer.address() as AddressInfo;
  modelBaseUrl = `http://127.0.0.1:${port}/v1`;
});

test.beforeEach(() => {
  requests = [];
});

test.afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    modelServer.close((error) => (error ? reject(error) : resolve()));
  });
});

const QUESTION = "We are moving out and want the marks gone.";
const ADVICE = "Skip the pumice stone. It can scratch acrylic.";

function seedChat() {
  const db = openE2eDatabase();
  const now = Date.now();
  try {
    const user = db.prepare("SELECT id FROM user LIMIT 1").get() as
      | { id: string }
      | undefined;
    if (!user) throw new Error("Signup user was not created");

    db.prepare(
      `INSERT INTO model_configs (
        id, label, provider_id, api_format, base_url, api_key, model,
        tool_calling_enabled, enabled, sort_order, created_at, updated_at
      ) VALUES (
        'quote-reply-model', 'Quote Reply Model', 'custom', 'openai-chat',
        ?, 'test-key', 'quote-reply-test-model', 1, 1, 0, ?, ?
      )`,
    ).run(modelBaseUrl, now, now);
    db.prepare(
      `INSERT INTO chats (id, user_id, title, created_at, updated_at)
       VALUES ('quote-chat', ?, 'Quote chat', ?, ?)`,
    ).run(user.id, now, now);
    const insert = db.prepare(
      `INSERT INTO messages (id, chat_id, role, parts, created_at)
       VALUES (?, 'quote-chat', ?, ?, ?)`,
    );
    for (const [id, role, text] of [
      ["question-1", "user", QUESTION],
      ["answer-1", "assistant", `Try the wipes first.\n\n${ADVICE}`],
    ] as const) {
      insert.run(id, role, JSON.stringify([{ type: "text", text }]), now);
    }
  } finally {
    db.close();
  }
}

/** Selects the first occurrence of `needle` in the transcript, as a drag would. */
function selectTranscriptText(page: Page, needle: string) {
  return page.evaluate((text) => {
    const transcript = document.querySelector("[data-chat-transcript-scroll]");
    if (!transcript) throw new Error("No transcript");
    const walker = document.createTreeWalker(transcript, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const start = node.nodeValue?.indexOf(text) ?? -1;
      if (start === -1) continue;
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, start + text.length);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }
    throw new Error(`"${text}" is not in the transcript`);
  }, needle);
}

test("selected transcript text is quoted in the next message", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto(await setupUrl());
  await page.locator("#name").fill("Quote Admin");
  await page.locator("#email").fill("quote-admin@overtchat-test.local");
  await page.locator("#password").fill("test-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/");
  seedChat();

  await page.goto("/chat/quote-chat");
  const advice = page.getByText(ADVICE, { exact: true });
  await expect(advice).toBeVisible();

  const reply = page.getByRole("button", { name: "Reply", exact: true });
  const composer = page.getByRole("combobox");
  const quotes = page.getByRole("list", { name: "Quoted text" });
  await expect(reply).toHaveCount(0);

  // A paragraph of the reply, selected with the mouse.
  await advice.click({ clickCount: 3 });
  await expect(reply).toBeVisible();
  await reply.click();
  await expect(quotes.getByRole("listitem")).toHaveText([`“${ADVICE}”`]);
  await expect(reply).toHaveCount(0);
  expect(
    await page.evaluate(() => window.getSelection()?.isCollapsed),
  ).toBe(true);
  await expect(composer).toBeFocused();
  await expect(composer).toHaveAttribute("placeholder", "Reply…");

  // Part of a word from the user's own message, and a second from the reply.
  await selectTranscriptText(page, "out");
  await reply.click();
  await selectTranscriptText(page, "wipes");
  await reply.click();
  await expect(quotes.getByRole("listitem")).toHaveText([
    `“${ADVICE}”`,
    "“out”",
    "“wipes”",
  ]);

  // Quotes alone do not send.
  await composer.press("Enter");
  await expect(quotes.getByRole("listitem")).toHaveCount(3);
  expect(requests).toHaveLength(0);

  await quotes.getByRole("button", { name: "Remove quote" }).nth(1).click();
  await expect(quotes.getByRole("listitem")).toHaveCount(2);

  await composer.fill("Why not?");
  await composer.press("Enter");
  await expect(page.getByText("Because it scratches.")).toBeVisible();
  await expect(quotes).toHaveCount(0);
  await expect(composer).not.toHaveAttribute("placeholder", "Reply…");
  expect(requests).toHaveLength(1);
  expect(requests[0].messages.at(-1)).toEqual({
    role: "user",
    content: `> ${ADVICE}\n\n> wipes\n\nWhy not?`,
  });

  // The sent message shows its quotes apart from the reply, also after a reload.
  for (const reloaded of [false, true]) {
    if (reloaded) await page.reload();
    const sent = page
      .locator("[data-transcript-item]")
      .filter({ hasText: "Why not?" });
    await expect(sent.locator("blockquote")).toHaveText([ADVICE, "wipes"]);
    await expect(sent.getByText("> ")).toHaveCount(0);
  }
});
