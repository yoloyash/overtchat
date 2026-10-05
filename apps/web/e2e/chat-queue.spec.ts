import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test, type Page } from "@playwright/test";
import { resetE2eDatabase } from "./helpers/database";

let server: Server;
let endpoint: string;
let requests: { messages: { role: string; content: unknown }[] }[] = [];
let pending: (() => void)[] = [];
let fail = false;

async function setup(page: Page, url = endpoint, model = "queue-fixture") {
  resetE2eDatabase();
  requests = [];
  pending = [];
  fail = false;
  await page.goto("/signup");
  await page.locator("#name").fill("Queue Tester");
  await page.locator("#email").fill("queue@overtchat-test.local");
  await page.locator("#password").fill("test-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/");
  const response = await page.request.post("/api/model-configs", {
    data: {
      label: "Queue fixture",
      providerId: "vllm",
      apiFormat: "auto",
      baseUrl: url,
      model,
      apiKey: "test",
      toolCallingEnabled: false,
      contextWindow: 8192,
      providerOptions: {
        max_tokens: model === "queue-fixture" ? 128 : 2048,
        temperature: 0,
      },
      enabled: true,
    },
  });
  expect(response.ok()).toBeTruthy();
  const { modelConfig } = await response.json();
  await page.request.put("/api/model-preferences", {
    data: { defaultModelId: modelConfig.id },
  });
  await page.reload();
}
async function submit(page: Page, text: string) {
  const input = page.getByRole("combobox");
  await input.fill(text);
  await input.press("Enter");
}
async function messages(page: Page) {
  const chatId = page.url().split("/").at(-1);
  const response = await page.request.get(`/api/chat/${chatId}/messages`);
  return (await response.json()).messages as {
    role: string;
    parts: { type: string; text?: string }[];
  }[];
}
const textOf = (message: { parts: { type: string; text?: string }[] }) =>
  message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
const queueRows = (page: Page) => page.getByTestId("queued-message");

function send(res: ServerResponse, content: string, finish = false) {
  res.write(
    `data: ${JSON.stringify({ id: "queue", object: "chat.completion.chunk", created: 1, model: "queue-fixture", choices: [{ index: 0, delta: { content }, finish_reason: finish ? "stop" : null }], ...(finish ? { usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 } } : {}) })}\n\n`,
  );
  if (finish) res.end("data: [DONE]\n\n");
}

test.beforeAll(async () => {
  server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString());
    if (body.stream !== true) {
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          id: "title",
          object: "chat.completion",
          created: 1,
          model: "queue-fixture",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "Queue test" },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      );
      return;
    }
    requests.push(body);
    if (fail) {
      res
        .writeHead(400, { "Content-Type": "application/json" })
        .end(JSON.stringify({ error: { message: "Fixture failure" } }));
      return;
    }
    res.setHeader("Content-Type", "text/event-stream");
    send(res, `Partial ${requests.length}. `);
    pending.push(() => send(res, "Finished.", true));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});
test.afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

for (const touch of [false, true]) {
  test(`queues by default, edits, deletes, and sends FIFO (${touch ? "touch" : "desktop"})`, async ({
    page,
  }, testInfo) => {
    if (touch) await page.setViewportSize({ width: 390, height: 844 });
    await setup(page);
    await submit(page, "First");
    await expect(page.getByLabel("Stop generating")).toBeVisible();
    await expect.poll(() => requests.length).toBe(1);
    await submit(page, "Second");
    await submit(page, "Third");
    await submit(page, "Delete me");
    await expect(queueRows(page)).toHaveCount(3);
    await page.screenshot({ path: testInfo.outputPath("chat-queue.png") });
    expect(requests).toHaveLength(1);
    await queueRows(page).last().getByLabel("Delete queued message").click();
    await page.getByRole("combobox").fill("Unsent draft");
    await queueRows(page)
      .first()
      .getByLabel("Edit queued message", { exact: true })
      .click();
    await page.getByLabel("Edit queued message text").fill("Edited second");
    pending[0]();
    await expect(page.getByLabel("Stop generating")).not.toBeVisible();
    expect(requests).toHaveLength(1); // Editing holds dispatch.
    await page.getByRole("button", { name: "Save queued message" }).click();
    await expect.poll(() => requests.length).toBe(2);
    await expect(page.getByRole("combobox")).toHaveValue("Unsent draft");
    expect(requests[1].messages.at(-1)?.content).toBe("Edited second");
    pending[1]();
    await expect.poll(() => requests.length).toBe(3);
    pending[2]();
    await expect(queueRows(page)).toHaveCount(0);
    await expect.poll(async () => (await messages(page)).length).toBe(6);
    expect(
      (await messages(page)).filter((item) => item.role === "user").map(textOf),
    ).toEqual(["First", "Edited second", "Third"]);
    await page.reload();
    await expect(
      page.getByText("Edited second", { exact: true }),
    ).toBeVisible();
  });
}

test("Send now cancels the active turn, keeps its partial answer, and promotes the selected message", async ({
  page,
}) => {
  await setup(page);
  await submit(page, "First");
  await expect(page.getByText("Partial 1.", { exact: false })).toBeVisible();
  await submit(page, "Later");
  await submit(page, "Now");
  await queueRows(page).last().getByLabel("Send now").click();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1].messages.at(-1)?.content).toBe("Now");
  expect(requests[1].messages).toContainEqual({
    role: "assistant",
    content: "Partial 1. ",
  });
  pending[1]();
  await expect.poll(() => requests.length).toBe(3);
  pending[2]();
  await expect.poll(async () => (await messages(page)).length).toBe(6);
  expect(
    (await messages(page)).filter((item) => item.role === "user").map(textOf),
  ).toEqual(["First", "Now", "Later"]);
});

test("Stop pauses pending messages and failed cancellation leaves them available to retry", async ({
  page,
}) => {
  await setup(page);
  await submit(page, "First");
  await expect.poll(() => requests.length).toBe(1);
  await submit(page, "Pending");
  await page.route("**/stream/cancel", (route) =>
    route.fulfill({ status: 503 }),
  );
  await queueRows(page).getByLabel("Send now").click();
  await expect(
    page.getByRole("region", { name: "Queued messages" }).getByRole("alert"),
  ).toContainText("Could not stop");
  await expect(queueRows(page)).toHaveCount(1);
  expect(requests).toHaveLength(1);
  await page.unroute("**/stream/cancel");
  await page.getByLabel("Stop generating").click();
  await expect(page.getByText("Queue paused", { exact: false })).toBeVisible();
  await expect(page.getByLabel("Stop generating")).not.toBeVisible();
  expect(requests).toHaveLength(1);
  await queueRows(page).getByLabel("Send now").click();
  await expect.poll(() => requests.length).toBe(2);
  pending[1]();
  await expect.poll(async () => (await messages(page)).length).toBe(4);
});

test("preserves attachments and pending messages across in-app navigation", async ({
  page,
}) => {
  await setup(page);
  await submit(page, "First");
  await expect.poll(() => requests.length).toBe(1);
  const chatUrl = new URL(page.url()).pathname;
  await page
    .locator('input[type="file"]')
    .setInputFiles({
      name: "queue-notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("QUEUE_ATTACHMENT_MARKER"),
    });
  await expect(
    page.getByLabel("Remove queue-notes.txt", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Queue message", { exact: true })).toBeEnabled();
  await submit(page, "Use the notes");
  await expect(queueRows(page)).toContainText("queue-notes.txt");
  await page.getByRole("link", { name: /^New chat/ }).click();
  await expect(queueRows(page)).toHaveCount(0);
  pending[0]();
  await expect
    .poll(
      async () =>
        (
          await (
            await page.request.get(
              `${chatUrl.replace("/chat/", "/api/chat/")}/stream/status`,
            )
          ).json()
        ).active,
    )
    .toBe(false);
  expect(requests).toHaveLength(1);
  await page.locator(`a[href="${chatUrl}"]`).first().click();
  await expect.poll(() => requests.length).toBe(2);
  expect(JSON.stringify(requests[1].messages)).toContain(
    "QUEUE_ATTACHMENT_MARKER",
  );
  pending[1]();
  await expect.poll(async () => (await messages(page)).length).toBe(4);
});

test("provider failure pauses the remaining queue until Send now", async ({
  page,
}) => {
  await setup(page);
  await submit(page, "First");
  await expect.poll(() => requests.length).toBe(1);
  await submit(page, "Will fail");
  await submit(page, "Keep pending");
  fail = true;
  pending[0]();
  await expect.poll(() => requests.length).toBe(2);
  await expect(page.getByText("Queue paused", { exact: false })).toBeVisible();
  await expect(queueRows(page)).toHaveCount(1);
  await expect(queueRows(page)).toContainText("Keep pending");
  fail = false;
  await queueRows(page).getByLabel("Send now").click();
  await expect.poll(() => requests.length).toBe(3);
  pending.at(-1)!();
  await expect(page.getByLabel("Stop generating")).not.toBeVisible();
});

test("temporary chat supports queue and Send now without saving a chat", async ({
  page,
}) => {
  await setup(page);
  await page.getByLabel("Enable temporary chat").click();
  await submit(page, "Temporary first");
  await expect.poll(() => requests.length).toBe(1);
  await submit(page, "Temporary next");
  await queueRows(page).getByLabel("Send now").click();
  await expect.poll(() => requests.length).toBe(2);
  pending[1]();
  await expect(page.getByLabel("Stop generating")).not.toBeVisible();
  expect(
    (await (await page.request.get("/api/chats")).json()).chats,
  ).toHaveLength(0);
});

test("local model completes queued follow-ups and accepts Send now", async ({
  page,
}) => {
  const live = process.env.CHAT_QUEUE_LIVE_URL;
  test.skip(!live, "Set CHAT_QUEUE_LIVE_URL to a local /v1 endpoint");
  test.setTimeout(120_000);
  const model = (await (await page.request.get(`${live}/models`)).json())
    .data[0].id;
  await setup(page, live!, model);
  await submit(
    page,
    "Write a long numbered list of 150 different animals with a sentence about each. Start immediately.",
  );
  await expect(page.getByLabel("Stop generating")).toBeVisible();
  await submit(page, "Reply with exactly QUEUE_COMPLETE.");
  await expect(queueRows(page)).toHaveCount(1);
  await expect
    .poll(async () => (await messages(page)).length, { timeout: 90_000 })
    .toBe(4);
  await submit(page, "Write another long numbered list of 150 animals.");
  await expect(page.getByLabel("Stop generating")).toBeVisible();
  await submit(page, "Stop listing. Reply with exactly SEND_NOW_COMPLETE.");
  await queueRows(page).getByLabel("Send now").click();
  await expect
    .poll(
      async () =>
        (await messages(page)).filter((item) => item.role === "user").length,
      { timeout: 40_000 },
    )
    .toBe(4);
  await expect(page.getByLabel("Stop generating")).not.toBeVisible({
    timeout: 40_000,
  });
  const saved = await messages(page);
  expect(textOf(saved.at(-1)!)).toContain("SEND_NOW_COMPLETE");
  await page.reload();
  await expect(
    page.getByText("SEND_NOW_COMPLETE", { exact: false }).last(),
  ).toBeVisible();
});

test("foreground recovery leaves the queue running and sends the follow-up once", async ({
  page,
}) => {
  await setup(page);
  await submit(page, "First");
  await expect(page.getByText("Partial 1.", { exact: false })).toBeVisible();
  await submit(page, "After recovery");
  const statusRead = page.waitForResponse("**/stream/status");
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await statusRead;
  await expect(
    page.getByText("Queue paused", { exact: false }),
  ).not.toBeVisible();
  pending[0]();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1].messages.at(-1)?.content).toBe("After recovery");
  pending[1]();
  await expect.poll(async () => (await messages(page)).length).toBe(4);
  expect(requests).toHaveLength(2);
});

test("Stop wins over Send now while server cancellation is pending", async ({
  page,
}) => {
  await setup(page);
  await submit(page, "First");
  await expect(page.getByText("Partial 1.", { exact: false })).toBeVisible();
  await submit(page, "Keep pending");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let cancelRequests = 0;
  await page.route("**/stream/cancel", async (route) => {
    cancelRequests++;
    await gate;
    await route.continue().catch(() => undefined);
  });
  await queueRows(page).getByLabel("Send now").click();
  await expect.poll(() => cancelRequests).toBe(1);
  await page.getByLabel("Stop generating").click();
  await expect(page.getByText("Queue paused", { exact: false })).toBeVisible();
  release();
  await expect(page.getByLabel("Stop generating")).not.toBeVisible();
  await expect(queueRows(page)).toHaveCount(1);
  expect(requests).toHaveLength(1);
  await page.unroute("**/stream/cancel");
  await queueRows(page).getByLabel("Send now").click();
  await expect.poll(() => requests.length).toBe(2);
  pending[1]();
  await expect.poll(async () => (await messages(page)).length).toBe(4);
});

test("logout clears pending messages before signing back into the same chat", async ({ page }) => {
  await setup(page);
  await submit(page, "First");
  await expect.poll(() => requests.length).toBe(1);
  const chatUrl = new URL(page.url()).pathname;
  await submit(page, "Discard on logout");
  await page.getByRole("link", { name: /^New chat/ }).click();
  await page.getByText("Queue Tester", { exact: true }).click();
  await page.getByRole("menuitem", { name: "Log out" }).click();
  await page.waitForURL("**/login");
  pending[0]();
  await page.locator("#email").fill("queue@overtchat-test.local");
  await page.locator("#password").fill("test-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/");
  await page.locator(`a[href="${chatUrl}"]`).first().click();
  await expect(page.getByText("Partial 1. Finished.", { exact: false })).toBeVisible();
  await expect(queueRows(page)).toHaveCount(0);
  expect(requests).toHaveLength(1);
});
