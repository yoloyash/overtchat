import { expect, test } from "@playwright/test";
import { openE2eDatabase, resetE2eDatabase } from "./helpers/database";

test.beforeEach(resetE2eDatabase);

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
    baseUrl: "http://127.0.0.1:9999/v1", model: "attachment-test", toolCallingEnabled: false,
  } });
  expect(model.ok()).toBeTruthy();
  const { modelConfig } = await model.json();
  const remoteFile = { type: "file", mediaType: "image/png", url: "http://internal/image.png" };
  const rejected = await page.request.post("/api/chat", { data: {
    chatId: "rejected-attachment", modelConfigId: modelConfig.id,
    messages: [{ id: "turn", role: "user", parts: [remoteFile, { type: "text", text: "Inspect this" }] }],
  } });
  expect(rejected.status()).toBe(400);
  expect(await rejected.text()).toContain("Upload the file again");

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
    expect(await continued.text()).toContain("Upload the file again");
    expect(database.prepare("SELECT COUNT(*) AS count FROM messages").get()).toEqual({ count: 1 });
  } finally {
    database.close();
  }
});
