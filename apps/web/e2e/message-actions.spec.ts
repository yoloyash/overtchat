import { devices, expect, test, type Page } from "@playwright/test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { openE2eDatabase, resetE2eDatabase, setupUrl } from "./helpers/database";

test.beforeEach(resetE2eDatabase);

let modelServer: Server;
let modelBaseUrl: string;

test.beforeAll(async () => {
  modelServer = createServer(async (req, res) => {
    for await (const chunk of req) {
      // Consume the request before responding.
      void chunk;
    }
    const chunk = (delta: object, finishReason: string | null) =>
      `data: ${JSON.stringify({
        id: "message-actions-response",
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1_000),
        model: "message-actions-test-model",
        choices: [{ index: 0, delta, finish_reason: finishReason }],
      })}\n\n`;
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(chunk({ role: "assistant", content: "Third answer" }, null));
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

// Noon UTC falls on March 4 in every time zone a test machine might use.
const OLD_TURN_AT = Date.UTC(2024, 2, 4, 12);

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
        'message-actions-model', 'Message Actions Model', 'custom',
        'openai-chat', ?, 'test-key', 'message-actions-test-model', 1, 1, 0,
        ?, ?
      )`,
    ).run(modelBaseUrl, now, now);
    db.prepare(
      `INSERT INTO chats (id, user_id, title, created_at, updated_at)
       VALUES ('actions-chat', ?, 'Message actions', ?, ?)`,
    ).run(user.id, OLD_TURN_AT, now);
    const insert = db.prepare(
      `INSERT INTO messages (id, chat_id, role, parts, created_at)
       VALUES (?, 'actions-chat', ?, ?, ?)`,
    );
    const fiveMinutesAgo = now - 5 * 60_000;
    for (const [id, role, text, createdAt] of [
      ["question-1", "user", "First question", OLD_TURN_AT],
      ["answer-1", "assistant", "First answer", OLD_TURN_AT],
      ["question-2", "user", "Second question", fiveMinutesAgo],
      ["answer-2", "assistant", "Second answer", fiveMinutesAgo],
    ] as const) {
      insert.run(id, role, JSON.stringify([{ type: "text", text }]), createdAt);
    }
  } finally {
    db.close();
  }
}

function turn(page: Page, text: string) {
  const item = page.locator("[data-transcript-item]").filter({ hasText: text });
  return {
    item,
    actions: item.locator('[data-slot="message-actions"]'),
    time: item.locator('[data-slot="message-time"]'),
  };
}

test("the newest reply keeps its actions on screen and hovering shows when a message was sent", async ({
  page,
  browser,
  baseURL,
}) => {
  test.setTimeout(60_000);
  await page.goto(await setupUrl());
  await page.locator("#name").fill("Message Actions Admin");
  await page
    .locator("#email")
    .fill("message-actions-admin@overtchat-test.local");
  await page.locator("#password").fill("test-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/");
  seedChat();

  await page.goto("/chat/actions-chat");
  const firstAnswer = turn(page, "First answer");
  const secondQuestion = turn(page, "Second question");
  const secondAnswer = turn(page, "Second answer");
  await expect(secondAnswer.item).toBeVisible();
  // Keep the pointer off the transcript until a step hovers on purpose.
  await page.getByPlaceholder("Message…").hover();

  // Only the newest reply shows its actions without the pointer, and even
  // there the time waits for it.
  await expect(secondAnswer.actions).toHaveCSS("opacity", "1");
  await expect(secondAnswer.time).toHaveCSS("opacity", "0");
  await expect(firstAnswer.actions).toHaveCSS("opacity", "0");
  await expect(secondQuestion.actions).toHaveCSS("opacity", "0");

  await secondAnswer.item.hover();
  await expect(secondAnswer.time).toHaveCSS("opacity", "1");
  await expect(secondAnswer.time).toHaveText(/^[5-7]m ago$/);

  // An older reply reveals its actions and its time together. The label
  // turns into a date, and its tooltip adds the time of day.
  await firstAnswer.item.hover();
  await expect(firstAnswer.actions).toHaveCSS("opacity", "1");
  await expect(firstAnswer.time).toHaveText("Mar 4, 2024");
  await expect(firstAnswer.time).toHaveAttribute(
    "title",
    /^Mar 4, 2024, \d{1,2}:\d{2}/,
  );
  await expect(secondAnswer.time).toHaveCSS("opacity", "0");

  await secondQuestion.item.hover();
  await expect(secondQuestion.actions).toHaveCSS("opacity", "1");
  await expect(secondQuestion.time).toHaveText(/^[5-7]m ago$/);

  // A new turn moves the pinned actions to its reply. Both new messages get
  // a time without a reload.
  await page.getByPlaceholder("Message…").fill("Third question");
  await page.getByLabel("Send message").click();
  const thirdQuestion = turn(page, "Third question");
  const thirdAnswer = turn(page, "Third answer");
  await expect(thirdAnswer.actions).toHaveCSS("opacity", "1");
  await expect(secondAnswer.actions).toHaveCSS("opacity", "0");
  await thirdAnswer.item.hover();
  await expect(thirdAnswer.time).toHaveCSS("opacity", "1");
  await expect(thirdAnswer.time).toHaveText("Just now");
  await thirdQuestion.item.hover();
  await expect(thirdQuestion.time).toHaveText("Just now");

  // After a reload the saved times replace the local ones.
  await page.reload();
  await expect(thirdAnswer.actions).toHaveCSS("opacity", "1");
  await thirdAnswer.item.hover();
  await expect(thirdAnswer.time).toHaveText("Just now");

  // A touch screen has no hover: every message shows its actions, and the
  // time is left out.
  const phone = await browser.newContext({
    ...devices["Pixel 7"],
    baseURL,
    storageState: await page.context().storageState(),
  });
  try {
    const phonePage = await phone.newPage();
    await phonePage.goto("/chat/actions-chat");
    const phoneFirstAnswer = turn(phonePage, "First answer");
    await expect(phoneFirstAnswer.actions).toHaveCSS("opacity", "1");
    await expect(phoneFirstAnswer.time).toBeHidden();
    await expect(turn(phonePage, "Third answer").time).toBeHidden();
  } finally {
    await phone.close();
  }
});
