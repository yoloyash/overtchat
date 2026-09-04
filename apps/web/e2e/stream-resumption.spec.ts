import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test } from "@playwright/test";
import { openE2eDatabase, resetE2eDatabase } from "./helpers/database";

type Deferred = {
  promise: Promise<void>;
  resolve: () => void;
};

function deferred(): Deferred {
  let resolve = () => {};
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

let modelServer: Server;
let modelBaseUrl: string;
let firstChunk = deferred();
let continueStream = deferred();
let streamingRequests = 0;

test.beforeEach(() => {
  resetE2eDatabase();
  firstChunk = deferred();
  continueStream = deferred();
  streamingRequests = 0;
});

test.beforeAll(async () => {
  modelServer = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
      stream?: boolean;
    };
    const created = Math.floor(Date.now() / 1_000);

    if (!body.stream) {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          id: "resumption-title",
          object: "chat.completion",
          created,
          model: "resumption-test-model",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "Resumed chat" },
              finish_reason: "stop",
            },
          ],
          usage: {
            prompt_tokens: 5,
            completion_tokens: 2,
            total_tokens: 7,
          },
        }),
      );
      return;
    }

    streamingRequests += 1;

    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    const event = (content: string, finishReason: string | null = null) => ({
      id: "resumption-response",
      object: "chat.completion.chunk",
      created,
      model: "resumption-test-model",
      choices: [
        {
          index: 0,
          delta: content
            ? { role: "assistant", content }
            : {},
          finish_reason: finishReason,
        },
      ],
    });

    response.write(`data: ${JSON.stringify(event("Before reload. "))}\n\n`);
    firstChunk.resolve();
    await continueStream.promise;
    response.write(`data: ${JSON.stringify(event("After reload."))}\n\n`);
    response.write(`data: ${JSON.stringify(event("", "stop"))}\n\n`);
    response.write(
      `data: ${JSON.stringify({
        id: "resumption-response",
        object: "chat.completion.chunk",
        created,
        model: "resumption-test-model",
        choices: [],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 4,
          total_tokens: 14,
        },
      })}\n\n`,
    );
    response.end("data: [DONE]\n\n");
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

function seedModel() {
  const database = openE2eDatabase();
  const now = Date.now();
  try {
    database
      .prepare(
        `INSERT INTO model_configs (
          id, label, provider_id, api_format, base_url, api_key, model,
          tool_calling_enabled, enabled, sort_order, created_at, updated_at
        ) VALUES (
          'resumption-model', 'Resumption Test Model', 'custom', 'openai-chat',
          ?, 'test-key', 'resumption-test-model', 1, 1, 0, ?, ?
        )`,
      )
      .run(modelBaseUrl, now, now);
  } finally {
    database.close();
  }
}

test("sidebar tracks generation after leaving the active chat", async ({
  page,
}) => {
  await page.goto("/signup");
  await page.locator("#name").fill("Sidebar Generation Tester");
  await page.locator("#email").fill("sidebar-generation@overtchat-test.local");
  await page.locator("#password").fill("test-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/", { timeout: 15_000 });
  seedModel();
  await page.reload();

  try {
    await page
      .getByPlaceholder("Message…")
      .fill("Keep generating in the background.");
    await page.getByLabel("Send message").click();
    await firstChunk.promise;

    const generating = page.getByRole("status", {
      name: /Generating response for/u,
    });
    await expect(generating).toBeVisible();

    const generatingRow = generating.locator("xpath=ancestor::li[1]");
    const chatActions = generatingRow.getByRole("button", {
      name: "Chat actions",
    });
    await expect(chatActions).toHaveCSS("opacity", "0");
    await generatingRow.hover();
    await expect(generating).toHaveCSS("opacity", "0");
    await expect(chatActions).toHaveCSS("opacity", "1");
    await page.getByRole("link", { name: /New chat/u }).hover();
    await expect(generating).toHaveCSS("opacity", "1");

    await page.getByRole("link", { name: /New chat/u }).click();
    await expect(page).toHaveURL(/\/$/u);
    await expect(generating).toBeVisible();

    continueStream.resolve();
    await expect(generating).toHaveCount(0, { timeout: 10_000 });
  } finally {
    continueStream.resolve();
  }
});

test("reload resumes an active chat stream through Redis", async ({ page }) => {
  test.skip(!process.env.REDIS_URL, "REDIS_URL is required for resumption.");

  await page.goto("/signup");
  await page.locator("#name").fill("Resumption Tester");
  await page
    .locator("#email")
    .fill("resumption-admin@overtchat-test.local");
  await page.locator("#password").fill("test-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/", { timeout: 15_000 });
  seedModel();
  await page.reload();

  const composer = page.getByPlaceholder("Message…");
  await composer.fill("Test stream resumption.");
  await page.getByLabel("Send message").click();
  await firstChunk.promise;
  await expect(page.getByText("Before reload.", { exact: false })).toBeVisible();
  await expect(page).toHaveURL(/\/chat\//u);

  const resumeResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      /\/api\/chat\/[^/]+\/stream$/u.test(new URL(response.url()).pathname),
  );
  await page.reload();
  const response = await resumeResponse;
  expect(response.status()).toBe(200);
  continueStream.resolve();

  await expect(
    page.getByText("Before reload. After reload.", { exact: false }),
  ).toBeVisible({ timeout: 15_000 });
  await page.getByLabel("Send message").waitFor({ state: "visible" });
});

test("network restoration reconciles the same generation without restarting it", async ({
  page,
  context,
}) => {
  test.skip(!process.env.REDIS_URL, "REDIS_URL is required for resumption.");

  await page.goto("/signup");
  await page.locator("#name").fill("Foreground Tester");
  await page.locator("#email").fill("foreground@overtchat-test.local");
  await page.locator("#password").fill("test-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/", { timeout: 15_000 });
  seedModel();
  await page.reload();

  await page.getByPlaceholder("Message…").fill("Finish while I am offline.");
  await page.getByLabel("Send message").click();
  await firstChunk.promise;
  await expect(page.getByText("Before reload.", { exact: false })).toBeVisible();

  await context.setOffline(true);
  continueStream.resolve();
  await expect
    .poll(() => {
      const database = openE2eDatabase();
      try {
        return (
          database
            .prepare(
              "SELECT status FROM chat_generations ORDER BY started_at DESC LIMIT 1",
            )
            .get() as { status?: string } | undefined
        )?.status;
      } finally {
        database.close();
      }
    })
    .toBe("complete");

  await context.setOffline(false);
  await expect(
    page.getByText("Before reload. After reload.", { exact: false }),
  ).toBeVisible({ timeout: 15_000 });
  expect(streamingRequests).toBe(1);
  await expect(page.getByRole("button", { name: "Reconnect" })).toHaveCount(0);
});
