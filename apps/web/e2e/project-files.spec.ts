import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test, type Page } from "@playwright/test";
import { openE2eDatabase, resetE2eDatabase, setupUrl } from "./helpers/database";

type ChatMessage = {
  role: string;
  content?: string | Array<{ type: string; text?: string }>;
  tool_call_id?: string;
};
type ChatPayload = {
  stream?: boolean;
  messages: ChatMessage[];
  tools?: Array<{ function?: { name?: string } }>;
};

const secret = "The zebra protocol access code is ZX-41.";
const filler =
  "Routine operational notes about logistics, staffing, and quarterly scheduling.\n";
const handbook = `${filler.repeat(400)}${secret}\n${filler.repeat(20)}`;
const plan = "# Launch plan\n\n- Kickoff in May\n- Launch in September\n";

let provider: Server;
let baseUrl: string;
const chatRequests: ChatPayload[] = [];

function text(message: ChatMessage | undefined): string {
  if (!message?.content) return "";
  return typeof message.content === "string"
    ? message.content
    : message.content
        .filter((part) => part.type === "text")
        .map((part) => part.text ?? "")
        .join("\n");
}

function toolNames(payload: ChatPayload): string[] {
  return (payload.tools ?? []).map((tool) => tool.function?.name ?? "");
}

test.beforeAll(async () => {
  provider = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const payload = JSON.parse(Buffer.concat(chunks).toString()) as ChatPayload;
    if (!payload.stream) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          id: "title",
          object: "chat.completion",
          created: 1,
          model: "project-test",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "Handbook question" },
              finish_reason: "stop",
            },
          ],
        }),
      );
      return;
    }
    chatRequests.push(payload);
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const event = (delta: unknown, finish: string | null) =>
      res.write(
        `data: ${JSON.stringify({ id: "project", object: "chat.completion.chunk", created: 1, model: "project-test", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`,
      );
    const call = (id: string, name: string, args: unknown) => {
      event(
        {
          role: "assistant",
          tool_calls: [
            { index: 0, id, type: "function", function: { name, arguments: JSON.stringify(args) } },
          ],
        },
        null,
      );
      event({}, "tool_calls");
    };
    const reply = (content: string) => {
      event({ role: "assistant", content }, null);
      event({}, "stop");
    };

    const last = payload.messages.at(-1)!;
    const prompt = text(payload.messages.filter((message) => message.role === "user").at(-1)).toLowerCase();
    if (last.role === "tool" && last.tool_call_id === "document-1") {
      reply("I created the launch plan.");
    } else if (prompt.includes("launch plan") && toolNames(payload).includes("create_document")) {
      call("document-1", "create_document", { title: "Launch plan", type: "markdown", content: plan });
    } else if (last.role === "tool" && last.tool_call_id === "search-1") {
      const offset = Number(/at offset (\d+)/.exec(text(last))?.[1] ?? -1);
      call("read-1", "read_file", { file: "handbook.txt", offset });
    } else if (last.role === "tool" && last.tool_call_id === "read-1") {
      reply(text(last).includes(secret) ? "The code is ZX-41." : "I could not find it.");
    } else if (/zebra protocol/i.test(text(last)) && toolNames(payload).includes("search_files")) {
      call("search-1", "search_files", { query: "zebra protocol" });
    } else {
      reply("No project files here.");
    }
    res.end("data: [DONE]\n\n");
  });
  await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(provider.address() as AddressInfo).port}/v1`;
});

test.afterAll(async () => {
  provider.closeAllConnections();
  await new Promise<void>((resolve) => provider.close(() => resolve()));
});

test.beforeEach(async ({ page }) => {
  resetE2eDatabase();
  chatRequests.length = 0;
  await page.goto(await setupUrl());
  await page.locator("#name").fill("Project Admin");
  await page.locator("#email").fill("project-files@overtchat-test.local");
  await page.locator("#password").fill("test-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/");
  const model = await page.request.post("/api/model-configs", {
    data: {
      label: "Project test",
      providerId: "custom",
      apiFormat: "openai-chat",
      baseUrl,
      model: "project-test",
      toolCallingEnabled: true,
      contextWindow: 8_192,
    },
  });
  expect(model.ok()).toBeTruthy();
  const db = openE2eDatabase();
  const now = Date.now();
  try {
    db.prepare("UPDATE model_configs SET discovered_capabilities = ?").run(
      JSON.stringify({ inputModalities: ["text"], toolCall: true }),
    );
    db.prepare("UPDATE server_capabilities SET provider = 'disabled' WHERE id = 'search'").run();
    const user = db.prepare("SELECT id FROM user LIMIT 1").get() as { id: string };
    db.prepare(
      `INSERT INTO projects (id, user_id, name, instructions, created_at, updated_at)
       VALUES ('ops', ?, 'Operations', 'Answer from the handbook.', ?, ?)`,
    ).run(user.id, now, now);
  } finally {
    db.close();
  }
});

async function addProjectFile(page: Page, name: string, body: string) {
  await page.getByLabel("Project files to add").setInputFiles({
    name,
    mimeType: "text/plain",
    buffer: Buffer.from(body),
  });
}

test("project files are listed in the prompt and read through the file tools", async ({ page }) => {
  await page.goto("/projects/ops");
  const card = page.getByRole("region", { name: "Project files" });
  await expect(card.getByRole("button", { name: "Add files" })).toBeVisible();

  await addProjectFile(page, "handbook.txt", handbook);
  const row = card.getByRole("listitem").filter({ hasText: "handbook.txt" });
  await expect(row).toBeVisible();
  await expect(row).toContainText("PLAIN · ");
  await expect(card).toContainText("1 of 50 files");
  // The link survives the orphan sweep: it is a project row, not a message.
  const files = await (await page.request.get("/api/projects/ops/files")).json();
  expect(files.files).toHaveLength(1);
  expect(files.files[0]).toMatchObject({ filename: "handbook.txt", sourceChat: null });

  // A chat in the project is told about the file but does not carry its text.
  await page.getByPlaceholder("Message…").fill("Find the zebra protocol code");
  await page.getByLabel("Send message").click();
  await expect(page.getByText("The code is ZX-41.", { exact: true })).toBeVisible();

  const first = chatRequests[0];
  const system = text(first.messages.find((message) => message.role === "system"));
  expect(system).toContain("Answer from the handbook.");
  expect(system).toContain("Project files (reference material shared by every chat in this project, not included in the conversation):\n- handbook.txt");
  expect(toolNames(first)).toEqual(expect.arrayContaining(["read_file", "search_files"]));
  const firstUser = text(first.messages.find((message) => message.role === "user"));
  expect(firstUser).not.toContain("<documents>");
  expect(firstUser).not.toContain(secret);
  expect(text(chatRequests[1].messages.at(-1))).toMatch(/^1 match for "zebra protocol" in "handbook\.txt":/);
  expect(text(chatRequests[2].messages.at(-1))).toContain(secret);

  // The same file is available to a second chat in the project without re-uploading.
  await page.goto("/projects/ops");
  await page.getByPlaceholder("Message…").fill("Find the zebra protocol code");
  await page.getByLabel("Send message").click();
  await expect(page.getByText("The code is ZX-41.", { exact: true })).toBeVisible();

  // The file appears in the library for re-attaching, and only once.
  const library = await (await page.request.get("/api/library")).json();
  expect(library.items.map((item: { filename: string }) => item.filename)).toEqual(["handbook.txt"]);

  // Removing it leaves past chats intact and takes it out of new turns.
  await page.goto("/projects/ops");
  await card.getByRole("button", { name: "Remove handbook.txt" }).click();
  await expect(card.getByRole("button", { name: "Add files" })).toBeVisible();
  await page.getByPlaceholder("Message…").fill("Find the zebra protocol code");
  await page.getByLabel("Send message").click();
  await expect(page.getByText("No project files here.", { exact: true })).toBeVisible();
  const without = chatRequests.at(-1)!;
  expect(text(without.messages.find((message) => message.role === "system"))).not.toContain("Project files");
  expect(toolNames(without)).not.toContain("read_file");
  const db = openE2eDatabase();
  try {
    expect(db.prepare("SELECT count(*) AS n FROM uploads").get()).toEqual({ n: 1 });
    expect(db.prepare("SELECT count(*) AS n FROM messages WHERE role = 'assistant'").get()).toEqual({ n: 3 });
  } finally {
    db.close();
  }
});

test("project files refuse images and other users' uploads", async ({ page }) => {
  await page.goto("/projects/ops");
  const card = page.getByRole("region", { name: "Project files" });
  await page.getByLabel("Project files to add").setInputFiles({
    name: "photo.png",
    mimeType: "image/png",
    buffer: Buffer.from("not really a png"),
  });
  await expect(page.getByText("photo.png is not a supported attachment type.").first()).toBeVisible();
  await expect(card.getByRole("button", { name: "Add files" })).toBeVisible();

  const missing = await page.request.post("/api/projects/ops/files", { data: { uploadId: "nope" } });
  expect(missing.status()).toBe(400);
  expect(await missing.json()).toEqual({ error: "That file is not available." });
});

test("a chat saves its documents and files into the project", async ({ page }) => {
  await page.goto("/projects/ops");
  await page.getByPlaceholder("Message…").fill("Write a launch plan");
  await page.getByLabel("Send message").click();
  await expect(page.getByText("I created the launch plan.", { exact: true })).toBeVisible();
  await page.waitForURL("**/chat/**");
  const chatId = new URL(page.url()).pathname.split("/").at(-1)!;

  // The project page hands off to the chat route, so open the document from its card.
  await page.getByRole("button", { name: /Launch plan.*Created · Version 1/ }).click();
  const documentPanel = page.locator("aside[data-document-panel]");
  await expect(documentPanel.getByRole("heading", { name: "Launch plan", level: 2 })).toBeVisible();
  await documentPanel.getByRole("button", { name: "Save to project" }).click();
  await expect(page.getByText("Saved to Operations").first()).toBeVisible();
  let files = (await (await page.request.get("/api/projects/ops/files")).json()).files;
  expect(files).toHaveLength(1);
  expect(files[0]).toMatchObject({
    filename: "Launch plan.md",
    category: "text",
    sourceChat: { id: chatId, title: "Handbook question" },
  });
  const saved = await page.request.get(files[0].url);
  expect(await saved.text()).toBe(plan);

  // Saving the same name again asks whether to replace or keep both.
  await documentPanel.getByRole("button", { name: "Save to project" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Replace Launch plan.md?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Replace" }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(async () => {
    const replaced = (await (await page.request.get("/api/projects/ops/files")).json()).files;
    return replaced.length === 1 && replaced[0].uploadId !== files[0].uploadId;
  }).toBe(true);

  await documentPanel.getByRole("button", { name: "Save to project" }).click();
  await dialog.getByRole("button", { name: "Keep both" }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(async () =>
    (await (await page.request.get("/api/projects/ops/files")).json()).files.length,
  ).toBe(2);

  // A file attached to a project chat can be filed from the file panel too.
  await documentPanel.getByRole("button", { name: "Close document" }).click();
  await expect(documentPanel).toHaveCount(0);
  await page.locator('input[type="file"]').first().setInputFiles({
    name: "handbook.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(handbook),
  });
  await expect(page.getByLabel("Remove handbook.txt", { exact: true })).toBeVisible();
  await page.locator("textarea").fill("Keep this handy");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText("No project files here.", { exact: true })).toBeVisible();
  // A saved document can reopen by itself on the next reply (pre-existing);
  // the files toggle must start from no panel.
  if (await documentPanel.count()) {
    await documentPanel.getByRole("button", { name: "Close document" }).click();
    await expect(documentPanel).toHaveCount(0);
  }
  await page.getByRole("button", { name: "2 files" }).click();
  const filesPanel = page.locator("[data-files-panel]");
  await filesPanel.getByRole("button", { name: /handbook\.txt/ }).click();
  const filePanel = page.locator("aside[data-file-panel]");
  await filePanel.getByRole("button", { name: "Save to project" }).click();
  await expect.poll(async () =>
    (await (await page.request.get("/api/projects/ops/files")).json()).files.length,
  ).toBe(3);
  files = (await (await page.request.get("/api/projects/ops/files")).json()).files;
  expect(files.map((file: { filename: string }) => file.filename)).toEqual([
    "Launch plan.md",
    "Launch plan.md",
    "handbook.txt",
  ]);

  // The project page shows where each file came from.
  await page.goto("/projects/ops");
  const card = page.getByRole("region", { name: "Project files" });
  await expect(card).toContainText("3 of 50 files");
  await expect(card.getByRole("link", { name: "Handbook question" }).first()).toBeVisible();
});
