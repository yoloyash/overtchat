import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test } from "@playwright/test";
import { openE2eDatabase, resetE2eDatabase } from "./helpers/database";

test.beforeEach(resetE2eDatabase);

let modelServer: Server;
let modelBaseUrl: string;
const modelRequests: unknown[] = [];

test.beforeAll(async () => {
  modelServer = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    modelRequests.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    const event = {
      id: "attachment-response", object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000), model: "attachment-test",
      choices: [{ index: 0, delta: { role: "assistant", content: "Inline attachment accepted" }, finish_reason: null }],
    };
    response.write(`data: ${JSON.stringify(event)}\n\n`);
    response.write(`data: ${JSON.stringify({ ...event, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`);
    response.end("data: [DONE]\n\n");
  });
  await new Promise<void>((resolve) => modelServer.listen(0, "127.0.0.1", resolve));
  modelBaseUrl = `http://127.0.0.1:${(modelServer.address() as AddressInfo).port}/v1`;
});

test.afterAll(async () => {
  await new Promise<void>((resolve, reject) => modelServer.close((error) => error ? reject(error) : resolve()));
});

test("HTML uploads download safely, images display, and remote chat attachments are rejected", async ({ page, playwright }) => {
  await page.goto("/signup");
  await page.locator("#name").fill("Attachment Test Admin");
  await page.locator("#email").fill("attachments@overtchat-test.local");
  await page.locator("#password").fill("test-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/");

  const html = Buffer.from('<!doctype html><script>localStorage.setItem("upload-script-ran", "yes")</script>');
  const uploaded = await page.request.post("/api/uploads", {
    multipart: { file: { name: "résumé.html", mimeType: "text/html", buffer: html } },
  });
  expect(uploaded.ok()).toBeTruthy();
  const { url } = await uploaded.json();
  const response = await page.request.get(url);
  expect(response.headers()["content-disposition"]).toMatch(/^attachment;/);
  expect(await response.body()).toEqual(html);

  // Navigate via a link just as someone opening a stored attachment URL would.
  await page.evaluate((href) => {
    const link = document.createElement("a");
    link.href = href;
    link.textContent = "Open HTML attachment";
    document.body.append(link);
  }, url);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "Open HTML attachment" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("résumé.html");
  expect(await download.failure()).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem("upload-script-ran"))).toBeNull();

  const imageUpload = await page.request.post("/api/uploads", {
    multipart: { file: {
      name: "pixel.png", mimeType: "image/png",
      buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=", "base64"),
    } },
  });
  expect(imageUpload.ok()).toBeTruthy();
  const image = await imageUpload.json();
  await page.goto(image.url);
  await expect(page.locator("img")).toBeVisible();
  expect(await page.locator("img").evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBe(1);

  const anonymous = await playwright.request.newContext();
  try {
    expect((await anonymous.get(new URL(url, page.url()).href)).status()).toBe(401);
  } finally {
    await anonymous.dispose();
  }

  const model = await page.request.post("/api/model-configs", { data: {
    label: "Attachment test", providerId: "custom", apiFormat: "openai-chat",
    baseUrl: modelBaseUrl, model: "attachment-test", toolCallingEnabled: false,
  } });
  expect(model.ok()).toBeTruthy();
  const { modelConfig } = await model.json();
  const remoteFile = { type: "file", mediaType: "image/png", url: "http://internal/image.png" };
  const rejected = await page.request.post("/api/chat", { data: {
    chatId: "rejected-attachment", modelConfigId: modelConfig.id,
    messages: [{ id: "turn", role: "user", parts: [remoteFile, { type: "text", text: "Inspect this" }] }],
  } });
  expect(rejected.status()).toBe(400);
  expect(await rejected.text()).toContain("Edit the original message");

  // Imported history must pass the same boundary as a new attachment.
  const imported = await page.request.post("/api/import", { multipart: { file: {
    name: "chats.json", mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ format: "overtchat", chats: [{
      title: "Imported remote attachment",
      messages: [{ role: "user", parts: [remoteFile] }],
    }] })),
  } } });
  expect(imported.ok()).toBeTruthy();
  const database = openE2eDatabase();
  try {
    expect(database.prepare("SELECT id FROM chats WHERE id = ?").get("rejected-attachment")).toBeUndefined();
    const chat = database.prepare("SELECT id FROM chats LIMIT 1").get() as { id: string };
    const continued = await page.request.post("/api/chat", { data: {
      chatId: chat.id, modelConfigId: modelConfig.id,
      messages: [{ id: "continuation", role: "user", parts: [{ type: "text", text: "Continue" }] }],
    } });
    expect(continued.status()).toBe(400);
    expect(await continued.text()).toContain("Edit the original message");
    expect(database.prepare("SELECT COUNT(*) AS count FROM messages").get()).toEqual({ count: 1 });
    expect(modelRequests).toHaveLength(0);

    // Inline data in imported history is already local and needs no URL fetch.
    const inlineUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=";
    const inlineImport = await page.request.post("/api/import", { multipart: { file: {
      name: "inline.json", mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({ format: "overtchat", chats: [{
        title: "Imported inline attachment",
        messages: [{ role: "user", parts: [{ type: "file", mediaType: "image/png", url: inlineUrl }] }],
      }] })),
    } } });
    expect(inlineImport.ok()).toBeTruthy();
    const inlineChat = database.prepare("SELECT id FROM chats WHERE title = ?")
      .get("Imported inline attachment") as { id: string };
    const accepted = await page.request.post("/api/chat", { data: {
      chatId: inlineChat.id, modelConfigId: modelConfig.id,
      messages: [{ id: "inline-continuation", role: "user", parts: [{ type: "text", text: "Describe the image" }] }],
    } });
    expect(accepted.status()).toBe(200);
    expect(await accepted.text()).toContain("Inline attachment accepted");
    expect(modelRequests).toHaveLength(1);
    expect(JSON.stringify(modelRequests[0])).toContain(inlineUrl);
  } finally {
    database.close();
  }
});
