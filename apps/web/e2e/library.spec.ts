import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test } from "@playwright/test";
import { openE2eDatabase, resetE2eDatabase } from "./helpers/database";

let modelServer: Server;
let modelBaseUrl: string;
const modelRequests: unknown[] = [];

test.beforeEach(resetE2eDatabase);
test.beforeAll(async () => {
  modelServer = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    modelRequests.push(body);
    if (!body.stream) {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({
        id: "library-title", object: "chat.completion", created: 1, model: "library-test",
        choices: [{ index: 0, message: { role: "assistant", content: "Reused library files" }, finish_reason: "stop" }],
      }));
      return;
    }
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    const event = {
      id: "library-response", object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000), model: "library-test",
      choices: [{ index: 0, delta: { role: "assistant", content: "Library files received" }, finish_reason: null }],
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

test("library pagination survives chat deletion and search matches Unicode filenames", async ({ page }) => {
  await page.goto("/signup");
  await page.locator("#name").fill("Library Pagination Admin");
  await page.locator("#email").fill("library-pages@overtchat-test.local");
  await page.locator("#password").fill("test-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/");
  const database = openE2eDatabase();
  try {
    const user = database.prepare("SELECT id FROM user LIMIT 1").get() as { id: string };
    for (const id of ["page-one", "page-two"]) {
      database.prepare("INSERT INTO chats (id, user_id, title) VALUES (?, ?, ?)").run(id, user.id, id);
    }
    // Listing needs metadata only; this fixture does not create or download bytes.
    for (let i = 0; i < 45; i++) {
      const id = `page-file-${String(i).padStart(2, "0")}`;
      const filename = i === 4 ? "RÉSUMÉ.pdf" : `${id}.txt`;
      database.prepare(`INSERT INTO uploads (id, user_id, filename, media_type, category, size, created_at)
        VALUES (?, ?, ?, 'text/plain', 'text', 12, 1000)`).run(id, user.id, filename);
      database.prepare("INSERT INTO messages (id, chat_id, role, parts) VALUES (?, ?, 'user', ?)").run(
        id, i >= 5 ? "page-one" : "page-two",
        JSON.stringify([{ type: "file", url: `/api/uploads/${id}`, filename, mediaType: "text/plain" }]),
      );
    }
  } finally {
    database.close();
  }
  await page.getByRole("link", { name: "Library", exact: true }).click();
  const files = page.getByRole("list", { name: "Library files" }).getByRole("link");
  await expect(files).toHaveCount(40);
  // Mimic a deletion in another client, without invalidating this tab's query.
  expect((await page.request.delete("/api/chats/page-one")).ok()).toBeTruthy();
  await page.getByRole("button", { name: "Load more" }).click();
  await expect(files).toHaveCount(45);
  await expect(page.getByRole("link", { name: "Open RÉSUMÉ.pdf", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Load more" })).toHaveCount(0);
  await page.getByRole("searchbox", { name: "Search library" }).fill("re\u0301sume\u0301");
  await expect(files).toHaveCount(1);
  await expect(page.getByRole("link", { name: "Open RÉSUMÉ.pdf", exact: true })).toBeVisible();
});

test("browse, select, reuse and delete library attachments across chats", async ({ page, playwright }, testInfo) => {
  test.setTimeout(90_000);
  await page.goto("/signup");
  await page.locator("#name").fill("Library Admin");
  await page.locator("#email").fill("library@overtchat-test.local");
  await page.locator("#password").fill("test-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/");
  await page.getByRole("link", { name: "Library", exact: true }).click();
  await expect(page.getByText("Your library is empty")).toBeVisible();

  const modelResponse = await page.request.post("/api/model-configs", { data: {
    label: "Library test", providerId: "custom", apiFormat: "openai-chat",
    baseUrl: modelBaseUrl, model: "library-test", toolCallingEnabled: false,
  } });
  expect(modelResponse.ok()).toBeTruthy();
  const { modelConfig } = await modelResponse.json();
  const files = [];
  for (const [name, content] of [
    ["Project brief.txt", "The library project codename is Pinecone."],
    ["Meeting notes.md", "The planning meeting is on Thursday."],
    ["Only in source.txt", "This file is not reused."],
    ["Unsent.txt", "This file has not been sent."],
  ]) {
    const response = await page.request.post("/api/uploads", { multipart: { file: {
      name, mimeType: "text/plain", buffer: Buffer.from(content),
    } } });
    expect(response.ok()).toBeTruthy();
    files.push(await response.json());
  }
  const imageResponse = await page.request.post("/api/uploads", { multipart: { file: {
    name: "pixel.png", mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=", "base64"),
  } } });
  expect(imageResponse.ok()).toBeTruthy();
  const image = await imageResponse.json();

  // Seed an existing saved conversation, including an image for thumbnail coverage.
  const database = openE2eDatabase();
  try {
    const user = database.prepare("SELECT id FROM user LIMIT 1").get() as { id: string };
    database.prepare("INSERT INTO chats (id, user_id, title) VALUES (?, ?, ?)").run("source-chat", user.id, "Source chat");
    database.prepare("INSERT INTO messages (id, chat_id, role, parts) VALUES (?, ?, 'user', ?)").run(
      "source-message", "source-chat", JSON.stringify([...files.slice(0, 3), image].map((file) => ({
        type: "file", url: file.url, filename: file.filename, mediaType: file.mediaType,
      }))),
    );
  } finally {
    database.close();
  }
  // A temporary turn can use an upload without making it a library entry.
  const temporary = await page.request.post("/api/chat", { data: {
    chatId: "temporary-chat", temporary: true, modelConfigId: modelConfig.id,
    messages: [{ id: "temporary-turn", role: "user", parts: [
      { type: "file", url: files[3].url, filename: files[3].filename, mediaType: files[3].mediaType },
      { type: "text", text: "Read this temporarily" },
    ] }],
  } });
  expect(temporary.ok()).toBeTruthy();
  await temporary.text();

  const anonymous = await playwright.request.newContext();
  try {
    expect((await anonymous.get(new URL("/api/library", page.url()).href)).status()).toBe(401);
  } finally {
    await anonymous.dispose();
  }
  await page.reload();
  await expect(page.getByRole("link", { name: "Open Project brief.txt", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open Unsent.txt", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Grid view" }).click();
  await expect(page.getByRole("button", { name: "Grid view" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('img[src="' + image.url + '"]')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("library-grid.png") });
  await page.getByRole("searchbox", { name: "Search library" }).fill("missing-file");
  await expect(page.getByText("No matching files")).toBeVisible();

  await page.getByRole("link", { name: "New chat" }).click();
  await page.getByRole("button", { name: "Add to message" }).click();
  await page.getByRole("menuitem", { name: "Add from library" }).click();
  const picker = page.getByRole("dialog", { name: "Add from library" });
  await expect(picker).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("library-picker.png") });
  await picker.getByRole("searchbox", { name: "Search library" }).fill("brief");
  await picker.getByRole("button", { name: "Project brief.txt", exact: true }).click();
  await picker.getByRole("searchbox", { name: "Search library" }).fill("notes");
  await picker.getByRole("button", { name: "Meeting notes.md", exact: true }).click();
  await picker.getByRole("button", { name: "Add 2 files", exact: true }).click();
  await expect(picker).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Remove Project brief.txt", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove Meeting notes.md", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Add to message" }).click();
  await page.getByRole("menuitem", { name: "Add from library" }).click();
  await expect(picker.getByRole("button", { name: "Project brief.txt", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await page.locator("textarea").fill("Use these library files");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText("Library files received", { exact: true }).first()).toBeVisible();
  await page.waitForURL("**/chat/**");
  const newChatId = new URL(page.url()).pathname.split("/").at(-1)!;
  expect(newChatId).not.toBe("source-chat");
  expect(JSON.stringify(modelRequests)).toContain("The library project codename is Pinecone.");
  expect(JSON.stringify(modelRequests)).toContain("The planning meeting is on Thursday.");

  // Stay on Library while deleting through the sidebar to exercise cache invalidation.
  await page.getByRole("link", { name: "Library", exact: true }).click();
  const sourceRow = page.locator("li").filter({ has: page.getByRole("link", { name: "Source chat", exact: true }) });
  await sourceRow.hover();
  await sourceRow.getByRole("button", { name: "Chat actions" }).click();
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  const deletion = page.getByRole("alertdialog", { name: "Delete chat?" });
  await expect(deletion).toContainText("Files used only in this chat will also be removed from your library.");
  await deletion.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByRole("link", { name: "Open Only in source.txt", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Open Project brief.txt", exact: true })).toBeVisible();
  expect((await page.request.get(files[0].url)).ok()).toBeTruthy();
  const library = await (await page.request.get("/api/library")).json();
  expect(library.items.map((item: { url: string }) => item.url).sort()).toEqual(files.slice(0, 2).map((file) => file.url).sort());

  // The same browser fits the mobile web layout and its navigation drawer.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("heading", { name: "Library", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Open sidebar" }).click();
  await page.getByRole("dialog", { name: "Navigation" }).getByRole("link", { name: "Library", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Navigation" })).toHaveCount(0);

  await page.goto("/");
  await page.getByRole("button", { name: "Add to message" }).click();
  await page.getByRole("menuitem", { name: "Add from library" }).click();
  await expect(picker.getByRole("button", { name: "Project brief.txt", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("library-picker-mobile.png") });
  expect(await picker.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await picker.getByRole("button", { name: "Close library" }).click();

  expect((await page.request.delete(`/api/chats/${newChatId}`)).ok()).toBeTruthy();
  await page.goto("/library");
  await expect(page.getByText("Your library is empty")).toBeVisible();
});
