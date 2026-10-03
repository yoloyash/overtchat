import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test, type Page } from "@playwright/test";
import { openE2eDatabase, resetE2eDatabase } from "./helpers/database";

let server: Server;
let baseUrl: string;
let requests: Record<string, unknown>[] = [];
let fail = false;
let slow = false;
const prefix = "```python\ndef answer():\n    return ";

async function setup(page: Page, endpoint: string, modelName = "continuation-fixture", parts = [{ type: "text", text: prefix }]) {
  resetE2eDatabase();
  await page.goto("/signup");
  await page.locator("#name").fill("Continuation Tester");
  await page.locator("#email").fill("continuation@overtchat-test.local");
  await page.locator("#password").fill("test-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/");
  const response = await page.request.post("/api/model-configs", { data: {
    label: "Continuation fixture", providerId: "vllm", apiFormat: "auto",
    baseUrl: endpoint, model: modelName, apiKey: "test", toolCallingEnabled: false,
    contextWindow: 8192, providerOptions: { max_tokens: 24, temperature: 0 }, enabled: true,
  } });
  expect(response.ok()).toBeTruthy();
  const model = (await response.json()).modelConfig;
  const imported = await page.request.post("/api/import", { multipart: { file: {
    name: "continuation.json", mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ format: "overtchat", chats: [{ title: "Continuation test", messages: [
      { role: "user", parts: [{ type: "text", text: modelName === "continuation-fixture" ? "Write a Python function returning 42." : "Output exactly one JSON array containing integers 1 through 40 in ascending order. No explanation or markdown." }] },
      { role: "assistant", parts },
    ] }] })),
  } } });
  expect(imported.ok()).toBeTruthy();
  const chat = (await (await page.request.get("/api/chats")).json()).chats[0];
  expect((await page.request.put("/api/model-preferences", { data: { defaultModelId: model.id } })).ok()).toBeTruthy();
  await page.goto(`/chat/${chat.id}`);
  return { chatId: chat.id as string, modelId: model.id as string };
}

async function savedMessages(page: Page, chatId: string) {
  return (await (await page.request.get(`/api/chat/${chatId}/messages`)).json()).messages;
}

const textOf = (message: { parts: { type: string; text?: string }[] }) =>
  message.parts.filter(p => p.type === "text").map(p => p.text).join("");

test.beforeAll(async () => {
  server = createServer(async (req, res) => {
    if (req.method !== "POST") { res.writeHead(405).end(); return; }
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString());
    requests.push(body);
    if (fail) { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: { message: "Fixture continuation failed" } })); return; }
    res.setHeader("Content-Type", "text/event-stream");
    const send = (delta: unknown, reason: string | null, usage?: unknown) => res.write(`data: ${JSON.stringify({
      id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixture",
      choices: [{ index: 0, delta, finish_reason: reason }], ...(usage ? { usage } : {}),
    })}\n\n`);
    send({ role: "assistant", content: body.continue_final_message ? "42" : prefix }, null);
    const finish = () => {
      if (body.continue_final_message) send({ content: "\n```" }, null);
      send({}, body.continue_final_message ? "stop" : "length", { prompt_tokens: 20, completion_tokens: 3, total_tokens: 23 });
      res.end("data: [DONE]\n\n");
    };
    if (slow) {
      const timeout = setTimeout(finish, 10000);
      res.on("close", () => clearTimeout(timeout));
    } else finish();
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});

test.afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
});

test("continues one saved answer, preserves code fences and history on failure, and saves a stopped prefix", async ({ page }) => {
  requests = []; fail = false; slow = false;
  const { chatId, modelId } = await setup(page, baseUrl);
  const original = (await savedMessages(page, chatId)).at(-1);
  await page.getByLabel("Continue response", { exact: true }).click();
  await expect(page.getByLabel("Stop generating")).not.toBeVisible();
  await expect.poll(async () => textOf((await savedMessages(page, chatId)).at(-1))).toBe(prefix + "42\n```");
  let saved = await savedMessages(page, chatId);
  expect(saved).toHaveLength(2);
  expect(saved.at(-1).id).toBe(original.id);
  expect(requests[0]).toMatchObject({ continue_final_message: true, add_generation_prompt: false });
  const prompt = requests[0].messages as { role: string; content: string }[];
  expect(prompt.at(-1)).toMatchObject({ role: "assistant", content: prefix });
  await page.reload();
  await expect(page.locator('pre')).toHaveCount(1);
  await expect(page.locator('pre')).toContainText("return 42");

  await page.getByPlaceholder("Message…").fill("Another function please.");
  await page.getByLabel("Send message").click();
  await expect.poll(async () => (await savedMessages(page, chatId)).length).toBe(4);
  expect(requests[1]).not.toHaveProperty("continue_final_message");
  expect(requests[1]).not.toHaveProperty("add_generation_prompt");
  await expect(page.getByLabel("Continue response", { exact: true })).toHaveCount(1);
  const current = (await savedMessages(page, chatId)).at(-1);
  const stale = await page.request.post("/api/chat", { data: {
    chatId, modelConfigId: modelId, messages: [original], action: { type: "continue", targetAssistantMessageId: original.id },
  } });
  expect(stale.status()).toBe(409);
  fail = true;
  await page.getByLabel("Continue response", { exact: true }).click();
  await expect.poll(async () => (await (await page.request.get(`/api/chat/${chatId}/stream/status`)).json()).status).toBe("error");
  expect((await savedMessages(page, chatId)).at(-1)).toEqual(current);
  fail = false; slow = true;
  await page.reload();
  await page.getByLabel("Continue response", { exact: true }).click();
  await expect(page.getByLabel("Stop generating")).toBeVisible();
  await expect(page.locator('pre').last()).toContainText("return 42");
  await page.getByLabel("Stop generating").click();
  await expect.poll(async () => textOf((await savedMessages(page, chatId)).at(-1))).toBe(prefix + "42");
  saved = await savedMessages(page, chatId);
  expect(saved).toHaveLength(4);
  expect(saved.at(-1).id).toBe(current.id);
  const db = openE2eDatabase();
  try {
    expect(db.prepare("SELECT COUNT(*) AS count FROM generation_usage").get()).toEqual({ count: 2 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM messages_fts WHERE message_id = ?").get(current.id)).toEqual({ count: 1 });
  } finally { db.close(); }
});

test("continues a temporary transcript without persisting it", async ({ page }) => {
  requests = []; fail = false; slow = false;
  const { modelId } = await setup(page, baseUrl);
  const response = await page.request.post("/api/chat", { data: {
    chatId: "temporary-continuation", modelConfigId: modelId, temporary: true,
    action: { type: "continue", targetAssistantMessageId: "partial" },
    messages: [
      { id: "user", role: "user", parts: [{ type: "text", text: "Write a function." }] },
      { id: "partial", role: "assistant", parts: [{ type: "text", text: prefix }] },
    ],
  } });
  expect(response.ok()).toBeTruthy();
  expect(await response.text()).toContain('"messageId":"partial"');
  expect(await response.text()).toContain('"delta":"42"');
  const db = openE2eDatabase();
  try {
    expect(db.prepare("SELECT COUNT(*) AS count FROM chat_generations WHERE chat_id = 'temporary-continuation'").get()).toEqual({ count: 0 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM chats WHERE id = 'temporary-continuation'").get()).toEqual({ count: 0 });
  } finally { db.close(); }
});

test("continues a local model through the product API across multiple output limits", async ({ page }) => {
  const endpoint = process.env.CONTINUATION_LIVE_URL;
  test.skip(!endpoint, "Set CONTINUATION_LIVE_URL to a local vLLM /v1 endpoint");
  const models = await (await page.request.get(`${endpoint}/models`)).json();
  const { chatId } = await setup(page, endpoint!, models.data[0].id, [{ type: "text", text: "[1,2,3," }]);
  const original = (await savedMessages(page, chatId)).at(-1);
  for (let round = 0; round < 6; round++) {
    const previousGeneration = (await (await page.request.get(`/api/chat/${chatId}/stream/status`)).json()).streamId;
    await page.getByLabel("Continue response", { exact: true }).click();
    await expect.poll(async () => {
      const state = await (await page.request.get(`/api/chat/${chatId}/stream/status`)).json();
      return state.streamId !== previousGeneration && state.status;
    }).toBe("complete");
    const saved = await savedMessages(page, chatId);
    expect(saved).toHaveLength(2);
    expect(saved.at(-1).id).toBe(original.id);
    if (saved.at(-1).metadata.stats.finishReason === "stop") break;
    expect(saved.at(-1).metadata.stats.finishReason).toBe("length");
    await expect(page.getByLabel("Continue response", { exact: true })).toBeVisible();
  }
  expect(JSON.parse(textOf((await savedMessages(page, chatId)).at(-1)))).toEqual(Array.from({ length: 40 }, (_, i) => i + 1));
  await page.reload();
    expect(JSON.parse(textOf((await savedMessages(page, chatId)).at(-1)))).toHaveLength(40);
});
