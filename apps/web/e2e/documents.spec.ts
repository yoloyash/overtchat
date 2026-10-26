import { readFile } from "node:fs/promises";
import mammoth from "mammoth";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test, type Page } from "@playwright/test";
import {
  openE2eDatabase,
  resetE2eDatabase,
  setupUrl,
} from "./helpers/database";

type ChatMessage = {
  role: string;
  content?: string | Array<{ type: string; text?: string }> | null;
  tool_calls?: Array<{ function: { name: string; arguments: string } }>;
};
type ChatPayload = {
  stream?: boolean;
  messages: ChatMessage[];
  tools?: Array<{ function?: { name?: string } }>;
};

const plan = "# Launch plan\n\n- Kickoff in **May**\n- Beta in June\n- Launch in September\n";
const page_html =
  '<!doctype html><html><body><h1 id="title">Static</h1><script>let blocked = false; try { void parent.document.title; } catch { blocked = true; } document.getElementById("title").textContent = "Scripted " + blocked;</script></body></html>';
const diagram = "graph TD\n  Kickoff --> Beta\n  Beta --> Launch";
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="#4f46e5"/></svg>';

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

const requests: Record<string, { name: string; args: unknown; reply: string }> = {
  "launch plan": {
    name: "create_document",
    args: { title: "Launch plan", type: "markdown", content: plan },
    reply: "I created the launch plan.",
  },
  "beta to july": {
    name: "update_document",
    args: { id: "launch-plan", edits: [{ find: "Beta in June", replace: "Beta in July" }] },
    reply: "The beta now starts in July.",
  },
  "web page": {
    name: "create_document",
    args: { title: "Welcome page", type: "html", content: page_html },
    reply: "Here is the page.",
  },
  diagram: {
    name: "create_document",
    args: { title: "Timeline", type: "mermaid", content: diagram },
    reply: "Here is the diagram.",
  },
  logo: {
    name: "create_document",
    args: { title: "Logo", type: "svg", content: svg },
    reply: "Here is the logo.",
  },
  script: {
    name: "create_document",
    args: { title: "Fetch report", type: "code", language: "python", content: "print('report')\n" },
    reply: "Here is the script.",
  },
};

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
          model: "documents-test",
          choices: [
            { index: 0, message: { role: "assistant", content: "Launch planning" }, finish_reason: "stop" },
          ],
        }),
      );
      return;
    }
    chatRequests.push(payload);
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const event = (delta: unknown, finish: string | null) =>
      res.write(
        `data: ${JSON.stringify({ id: "documents", object: "chat.completion.chunk", created: 1, model: "documents-test", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`,
      );
    const users = payload.messages.filter((message) => message.role === "user");
    const prompt = text(users.at(-1)).toLowerCase();
    const scripted = Object.entries(requests).find(([key]) => prompt.includes(key))?.[1];
    if (payload.messages.at(-1)?.role === "tool" || !scripted || !toolNames(payload).includes(scripted.name)) {
      event({ role: "assistant", content: scripted?.reply ?? "No document tools." }, null);
      event({}, "stop");
    } else {
      // Stream the arguments in pieces, as models do.
      const args = JSON.stringify(scripted.args);
      const third = Math.ceil(args.length / 3);
      event(
        {
          role: "assistant",
          tool_calls: [
            {
              index: 0,
              id: `call-${chatRequests.length}`,
              type: "function",
              function: { name: scripted.name, arguments: args.slice(0, third) },
            },
          ],
        },
        null,
      );
      for (const piece of [args.slice(third, third * 2), args.slice(third * 2)]) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        event({ tool_calls: [{ index: 0, function: { arguments: piece } }] }, null);
      }
      event({}, "tool_calls");
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
  await page.locator("#name").fill("Documents Admin");
  await page.locator("#email").fill("documents@overtchat-test.local");
  await page.locator("#password").fill("test-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/");
  const model = await page.request.post("/api/model-configs", {
    data: {
      label: "Documents test",
      providerId: "custom",
      apiFormat: "openai-chat",
      baseUrl,
      model: "documents-test",
      toolCallingEnabled: true,
    },
  });
  expect(model.ok()).toBeTruthy();
  const db = openE2eDatabase();
  try {
    db.prepare("UPDATE model_configs SET discovered_capabilities = ?").run(
      JSON.stringify({ inputModalities: ["text"], toolCall: true }),
    );
    db.prepare("UPDATE server_capabilities SET provider = 'disabled' WHERE id = 'search'").run();
  } finally {
    db.close();
  }
  await page.goto("/");
});

async function send(page: Page, message: string) {
  await page.locator("textarea").fill(message);
  await page.getByRole("button", { name: "Send message" }).click();
}

function panel(page: Page) {
  return page.locator("aside[data-document-panel]");
}

test("creates, revises, versions, downloads and shares a document", async ({ page, browser }, testInfo) => {
  await send(page, "Write a launch plan");
  await expect(page.getByText("I created the launch plan.", { exact: true })).toBeVisible();

  // The new document opened beside the chat on its own.
  const documentPanel = panel(page);
  await expect(documentPanel).toBeVisible();
  await expect(documentPanel.getByRole("heading", { name: "Launch plan", level: 2 })).toBeVisible();
  await expect(documentPanel).toContainText("Version 1 of 1");
  await expect(documentPanel.locator("[data-streamdown=strong]", { hasText: "May" })).toBeVisible();
  const card = page.getByRole("button", { name: /Launch plan.*Created · Version 1/ });
  await expect(card).toHaveAttribute("aria-pressed", "true");

  // The model was offered the tools and told how to use them.
  expect(toolNames(chatRequests[0])).toEqual(expect.arrayContaining(["create_document", "update_document"]));
  expect(text(chatRequests[0].messages[0])).toContain("Use create_document for substantial standalone content");
  expect(text(chatRequests[1].messages.at(-1))).toBe(
    'Created document "launch-plan" ("Launch plan", version 1). It is shown beside the chat; use this id to update it.',
  );
  await page.screenshot({ path: testInfo.outputPath("document-created.png") });

  await documentPanel.getByRole("button", { name: "Download document" }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Markdown (.md)" }).click();
  expect((await download).suggestedFilename()).toBe("Launch plan.md");
  expect(await readFile((await (await download).path())!, "utf8")).toBe(plan);

  await send(page, "Move the beta to July");
  await expect(page.getByText("The beta now starts in July.", { exact: true })).toBeVisible();
  // The open panel follows the revision.
  await expect(documentPanel).toContainText("Version 2 of 2");
  await expect(documentPanel).toContainText("Beta in July");
  await expect(page.getByRole("button", { name: /Launch plan.*Updated · Version 2/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  // The next request replays the creation with its content and the update.
  const revision = chatRequests[2];
  const replayed = revision.messages.find((message) => message.tool_calls?.length);
  expect(JSON.parse(replayed!.tool_calls![0].function.arguments)).toMatchObject({ content: plan });

  await documentPanel.getByRole("button", { name: "Previous version" }).click();
  await expect(documentPanel).toContainText("Version 1 of 2");
  await expect(documentPanel).toContainText("Beta in June");
  await expect(card).toHaveAttribute("aria-pressed", "true");
  await documentPanel.getByRole("button", { name: "Show source" }).click();
  await expect(documentPanel).toContainText("**May**");
  await documentPanel.getByRole("button", { name: "Show preview" }).click();
  await expect(documentPanel.locator("[data-streamdown=strong]", { hasText: "May" })).toBeVisible();
  await documentPanel.getByRole("button", { name: "Next version" }).click();
  await expect(documentPanel).toContainText("Version 2 of 2");
  await documentPanel.getByRole("button", { name: "Close document" }).click();
  await expect(documentPanel).toHaveCount(0);

  // Saved versions reopen from their cards after a reload, without opening by themselves.
  await page.reload();
  await expect(page.getByText("The beta now starts in July.", { exact: true })).toBeVisible();
  await expect(panel(page)).toHaveCount(0);
  await page.getByRole("button", { name: /Launch plan.*Created · Version 1/ }).click();
  await expect(panel(page)).toContainText("Version 1 of 2");
  await page.keyboard.press("Escape");
  await expect(panel(page)).toHaveCount(0);
  // The header's file list shows the document once and opens its latest
  // version in the same panel, which leads back to the list.
  await page.getByRole("button", { name: "1 file" }).click();
  const files = page.locator("[data-files-panel]");
  await expect(files.getByRole("listitem")).toHaveText(["Launch planDocument"]);
  await files.getByRole("button", { name: /Launch plan/ }).click();
  await expect(panel(page)).toContainText("Version 2 of 2");
  await panel(page).getByRole("button", { name: "Back to files" }).click();
  await expect(panel(page)).toHaveCount(0);
  await expect(files).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(files).toHaveCount(0);

  // Narrow screens show the document full screen.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: /Launch plan.*Updated · Version 2/ }).click();
  const box = await panel(page).boundingBox();
  expect(box).toMatchObject({ x: 0, y: 0, width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath("document-narrow.png") });
  await panel(page).getByRole("button", { name: "Close document" }).click();
  await page.setViewportSize({ width: 1280, height: 720 });

  // A public share keeps both versions, read-only.
  const chatId = new URL(page.url()).pathname.split("/").at(-1)!;
  const { share } = await (await page.request.post(`/api/chat/${chatId}/share`)).json();
  const anonymous = await browser.newContext({ baseURL: new URL(page.url()).origin });
  try {
    const reader = await anonymous.newPage();
    await reader.goto(`/share/${share.id}`);
    await reader.getByRole("button", { name: /Launch plan.*Updated · Version 2/ }).click();
    await expect(panel(reader)).toContainText("Beta in July");
    await panel(reader).getByRole("button", { name: "Previous version" }).click();
    await expect(panel(reader)).toContainText("Beta in June");
    await reader.screenshot({ path: testInfo.outputPath("document-shared.png") });
  } finally {
    await anonymous.close();
  }
});

test("downloads Markdown documents as Markdown or Word", async ({ page, browser }) => {
  await send(page, "Write a launch plan");
  await expect(page.getByText("I created the launch plan.", { exact: true })).toBeVisible();
  const download = panel(page).getByRole("button", { name: "Download document" });

  await download.click();
  const markdown = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Markdown (.md)" }).click();
  expect((await markdown).suggestedFilename()).toBe("Launch plan.md");

  await download.click();
  const word = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Word (.docx)" }).click();
  expect((await word).suggestedFilename()).toBe("Launch plan.docx");
  const { value } = await mammoth.convertToHtml({ path: (await (await word).path())! });
  expect(value).toBe(
    "<h1>Launch plan</h1><ul><li>Kickoff in <strong>May</strong></li><li>Beta in June</li><li>Launch in September</li></ul>",
  );

  // Public readers download the Markdown directly; Word export needs a session.
  const chatId = new URL(page.url()).pathname.split("/").at(-1)!;
  const { share } = await (await page.request.post(`/api/chat/${chatId}/share`)).json();
  const anonymous = await browser.newContext({ baseURL: new URL(page.url()).origin });
  try {
    const reader = await anonymous.newPage();
    await reader.goto(`/share/${share.id}`);
    await reader.getByRole("button", { name: /Launch plan.*Created · Version 1/ }).click();
    const shared = reader.waitForEvent("download");
    await panel(reader).getByRole("button", { name: "Download document" }).click();
    expect((await shared).suggestedFilename()).toBe("Launch plan.md");
    await expect(reader.getByRole("menuitem")).toHaveCount(0);
    expect(
      (await anonymous.request.post("/api/documents/export", {
        data: { title: "x", type: "markdown", content: "x", format: "docx" },
      })).status(),
    ).toBe(401);
  } finally {
    await anonymous.close();
  }
});

test("previews web pages, diagrams, SVG and code in the panel", async ({ page }, testInfo) => {
  await send(page, "Make a web page");
  await expect(page.getByText("Here is the page.", { exact: true })).toBeVisible();
  // Scripts run in an isolated frame that cannot reach the app.
  const frame = panel(page).frameLocator("iframe");
  await expect(frame.locator("h1")).toHaveText("Scripted true");
  expect(await panel(page).locator("iframe").getAttribute("sandbox")).toBe("allow-scripts");

  await send(page, "Draw a diagram of the timeline");
  await expect(page.getByText("Here is the diagram.", { exact: true })).toBeVisible();
  await expect(panel(page).getByRole("heading", { name: "Timeline", level: 2 })).toBeVisible();
  await expect(panel(page).getByRole("img", { name: "Diagram preview" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("document-diagram.png") });

  await send(page, "Design a logo");
  await expect(page.getByText("Here is the logo.", { exact: true })).toBeVisible();
  await expect(panel(page).getByRole("img", { name: "SVG preview" })).toBeVisible();

  await send(page, "Write a script");
  await expect(page.getByText("Here is the script.", { exact: true })).toBeVisible();
  await expect(panel(page)).toContainText("Code · python");
  await expect(panel(page)).toContainText("print('report')");
  await expect(panel(page).getByRole("button", { name: "Show source" })).toHaveCount(0);
  const download = page.waitForEvent("download");
  await panel(page).getByRole("button", { name: "Download document" }).click();
  expect((await download).suggestedFilename()).toBe("Fetch report.py");

  // Every card reopens its own document.
  await page.getByRole("button", { name: /Welcome page.*Web page · Created/ }).click();
  await expect(panel(page).getByRole("heading", { name: "Welcome page", level: 2 })).toBeVisible();
});

test("does not offer documents to clients that cannot render them", async ({ page }) => {
  const models = await (await page.request.get("/api/model-configs")).json();
  const response = await page.request.post("/api/chat", {
    data: {
      chatId: "legacy-client",
      temporary: true,
      modelConfigId: models.modelConfigs[0].id,
      messages: [{ id: "legacy-turn", role: "user", parts: [{ type: "text", text: "Write a launch plan" }] }],
    },
  });
  expect(response.ok()).toBeTruthy();
  await response.text();
  expect(toolNames(chatRequests[0])).not.toContain("create_document");
  expect(text(chatRequests[0].messages[0])).not.toContain("create_document");
});

test("a live tool-calling model creates and revises a document", async ({ page }) => {
  const endpoint = process.env.DOCUMENTS_LIVE_URL;
  test.skip(!endpoint, "Set DOCUMENTS_LIVE_URL to an OpenAI-compatible /v1 endpoint with tool calling");
  test.setTimeout(600_000);
  const models = await (await page.request.get(`${endpoint}/models`)).json();
  const db = openE2eDatabase();
  try {
    db.prepare("UPDATE model_configs SET base_url = ?, model = ?").run(endpoint, models.data[0].id);
  } finally {
    db.close();
  }
  // The chat URL appears before the server saves the chat; wait through 404s.
  const settle = async (chatId: string) =>
    expect
      .poll(
        async () => {
          const status = await page.request.get(`/api/chat/${chatId}/stream/status`);
          return status.ok() ? (await status.json()).active : true;
        },
        { timeout: 300_000 },
      )
      .toBe(false);

  await send(
    page,
    "Write a short memo announcing that the team offsite is on Thursday in Lisbon. Put the memo in a document.",
  );
  await page.waitForURL("**/chat/**");
  const chatId = new URL(page.url()).pathname.split("/").at(-1)!;
  await settle(chatId);
  await send(page, "Change the offsite day in the memo to Friday.");
  await expect(page.getByRole("button", { name: /Updated · Version 2/ })).toBeVisible({ timeout: 300_000 });
  await settle(chatId);

  const saved = (await (await page.request.get(`/api/chat/${chatId}/messages`)).json()).messages as Array<{
    role: string;
    parts: Array<{ type: string; state?: string; output?: { id: string; version: number; content: string } }>;
  }>;
  const versions = saved
    .flatMap((message) => message.parts)
    .filter((part) => part.type.endsWith("_document") && part.state === "output-available")
    .map((part) => part.output!);
  expect(versions[0].version).toBe(1);
  const latest = versions.at(-1)!;
  expect(latest).toMatchObject({ id: versions[0].id, version: 2 });
  // Whether every mention changed depends on the model; the revision must
  // land in place as the document's next version.
  expect(latest.content).toContain("Friday");
  await expect(panel(page)).toContainText("Friday");
});
