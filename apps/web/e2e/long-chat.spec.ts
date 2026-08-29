import { expect, test } from "@playwright/test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { openE2eDatabase, resetE2eDatabase } from "./helpers/database";

test.beforeEach(resetE2eDatabase);

let modelServer: Server;
let modelBaseUrl: string;

test.beforeAll(async () => {
  modelServer = createServer(async (req, res) => {
    for await (const chunk of req) {
      // Consume the request before responding.
      void chunk;
    }
    const created = Math.floor(Date.now() / 1_000);
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    for (let index = 0; index < 24; index += 1) {
      res.write(
        `data: ${JSON.stringify({
          id: "long-chat-response",
          object: "chat.completion.chunk",
          created,
          model: "long-chat-test-model",
          choices: [
            {
              index: 0,
              delta: {
                role: index === 0 ? "assistant" : undefined,
                content: `Streaming response ${index}. `,
              },
              finish_reason: null,
            },
          ],
        })}\n\n`,
      );
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    res.write(
      `data: ${JSON.stringify({
        id: "long-chat-response",
        object: "chat.completion.chunk",
        created,
        model: "long-chat-test-model",
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      })}\n\n`,
    );
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

function seedModel() {
  const db = openE2eDatabase();
  const now = Date.now();
  try {
    db.prepare(
      `INSERT INTO model_configs (
        id, label, provider_id, api_format, base_url, api_key, model,
        tool_calling_enabled, enabled, sort_order, created_at, updated_at
      ) VALUES (
        'long-chat-model', 'Long Chat Model', 'custom', 'openai-chat',
        ?, 'test-key', 'long-chat-test-model', 1, 1, 0, ?, ?
      )`,
    ).run(modelBaseUrl, now, now);
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

test("sending returns to latest while manual scrolling stops stream following", async ({
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
  seedModel();

  await page.goto("/chat/long-chat");
  const transcript = page.locator("[data-chat-transcript-scroll]");
  await expect(page.getByText("Answer 319", { exact: true })).toBeVisible();
  await transcript.evaluate((element) => {
    element.scrollTop -= 600;
    element.dispatchEvent(new Event("scroll"));
  });
  await expect(
    page.getByRole("button", { name: "Scroll to bottom" }),
  ).toBeVisible();

  const composer = page.getByPlaceholder("Message…");
  await composer.fill("Take me back to the latest turn.");
  await page.getByLabel("Send message").click();
  await expect
    .poll(() =>
      transcript.evaluate(
        (element) =>
          element.scrollHeight - element.clientHeight - element.scrollTop,
      ),
    )
    .toBeLessThanOrEqual(80);

  await expect(page.getByText("Streaming response 0.")).toBeVisible();
  await transcript.evaluate((element) => {
    element.scrollTop -= 500;
    element.dispatchEvent(new Event("scroll"));
  });
  await expect(
    page.getByRole("button", { name: "Scroll to bottom" }),
  ).toBeVisible();
  await expect(page.getByLabel("Send message")).toBeVisible();
  await expect
    .poll(() =>
      transcript.evaluate(
        (element) =>
          element.scrollHeight - element.clientHeight - element.scrollTop,
      ),
    )
    .toBeGreaterThan(200);

  await page.getByRole("button", { name: "Scroll to bottom" }).click();
  await expect
    .poll(() =>
      transcript.evaluate(
        (element) =>
          element.scrollHeight - element.clientHeight - element.scrollTop,
      ),
    )
    .toBeLessThanOrEqual(80);
  await expect(
    page.getByRole("button", { name: "Scroll to bottom" }),
  ).toHaveCount(0);
});
