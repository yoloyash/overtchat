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
const longReport = `${filler.repeat(1_500)}${secret}\n${filler.repeat(50)}`;
const shortNote = "Short note: the launch moved to Thursday.";

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
          model: "reader-test",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "Long report" },
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
        `data: ${JSON.stringify({ id: "reader", object: "chat.completion.chunk", created: 1, model: "reader-test", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`,
      );
    const call = (id: string, name: string, args: unknown) => {
      event(
        {
          role: "assistant",
          tool_calls: [
            {
              index: 0,
              id,
              type: "function",
              function: { name, arguments: JSON.stringify(args) },
            },
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
    if (last.role === "tool" && last.tool_call_id === "search-1") {
      const offset = Number(/at offset (\d+)/.exec(text(last))?.[1] ?? -1);
      call("read-1", "read_file", { file: "long-report.txt", offset });
    } else if (last.role === "tool" && last.tool_call_id === "read-1") {
      reply(text(last).includes(secret) ? "The code is ZX-41." : "I could not find it.");
    } else if (/zebra protocol/i.test(text(last)) && toolNames(payload).includes("search_files")) {
      call("search-1", "search_files", { query: "zebra protocol" });
    } else if (/launch/i.test(text(last))) {
      reply(text(last).includes(shortNote) ? "Thursday." : "Unknown.");
    } else {
      reply("You're welcome.");
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
  await page.locator("#name").fill("Reader Admin");
  await page.locator("#email").fill("reader@overtchat-test.local");
  await page.locator("#password").fill("test-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/");
  const model = await page.request.post("/api/model-configs", {
    data: {
      label: "Reader test",
      providerId: "custom",
      apiFormat: "openai-chat",
      baseUrl,
      model: "reader-test",
      toolCallingEnabled: true,
      contextWindow: 8_192,
    },
  });
  expect(model.ok()).toBeTruthy();
  const db = openE2eDatabase();
  try {
    db.prepare("UPDATE model_configs SET discovered_capabilities = ?").run(
      JSON.stringify({ inputModalities: ["text"], toolCall: true }),
    );
    db.prepare(
      "UPDATE server_capabilities SET provider = 'disabled' WHERE id = 'search'",
    ).run();
  } finally {
    db.close();
  }
  await page.goto("/");
});

async function send(page: Page, message: string, file?: { name: string; body: string }) {
  if (file) {
    await page.locator('input[type="file"]').setInputFiles({
      name: file.name,
      mimeType: "text/plain",
      buffer: Buffer.from(file.body),
    });
    await expect(page.getByLabel(`Remove ${file.name}`, { exact: true })).toBeVisible();
  }
  await page.locator("textarea").fill(message);
  await page.getByRole("button", { name: "Send message" }).click();
}

test("reads past a long attachment's budget with search and paged reads", async ({ page }, testInfo) => {
  await send(page, "Find the zebra protocol code", {
    name: "long-report.txt",
    body: longReport,
  });
  await expect(page.getByText("The code is ZX-41.", { exact: true })).toBeVisible();

  // The first request carries a budgeted prefix and says where reading resumes.
  const first = chatRequests[0];
  expect(toolNames(first).slice(0, 2)).toEqual(["read_file", "search_files"]);
  const firstUser = text(first.messages.find((message) => message.role === "user"));
  const included = Number(/Included the first (\d+) of (\d+) characters/.exec(firstUser)?.[1]);
  expect(included).toBeGreaterThan(5_000);
  expect(included).toBeLessThan(15_000);
  // Extraction trims the trailing newline.
  expect(firstUser).toContain(`of ${longReport.trimEnd().length} characters.`);
  expect(firstUser).toContain(
    `Use read_file with file "long-report.txt" and offset ${included} to read further`,
  );
  expect(firstUser).not.toContain(secret);

  // The search result points at the passage, and the read returns its text.
  const searchResult = text(chatRequests[1].messages.at(-1));
  expect(searchResult).toMatch(/^1 match for "zebra protocol" in "long-report\.txt":/);
  const readResult = text(chatRequests[2].messages.at(-1));
  expect(readResult).toContain(secret);
  expect(readResult).toMatch(/^long-report\.txt: characters \d+ to \d+ of \d+\.\n<content>\n/);

  await page.waitForURL("**/chat/**");
  const activity = page.getByRole("button", { name: "Read long-report.txt" });
  await expect(activity).toBeVisible();
  await activity.click();
  await expect(activity).toHaveAttribute("aria-expanded", "true");
  // Collapsed steps stay in the DOM at opacity 0; wait for the open timeline.
  await expect(activity.locator("xpath=following-sibling::div[1]")).toHaveCSS("opacity", "1");
  await expect(page.getByText("zebra protocol", { exact: true })).toBeVisible();
  await expect(page.getByText(/zebra protocol access code is ZX-41/)).toBeVisible();
  await expect(page.getByText(/of 122k chars$/)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("file-reading-activity.png") });

  // Reads persist as ranges; the document text is not copied into messages.
  const db = openE2eDatabase();
  try {
    const rows = db
      .prepare("SELECT parts FROM messages WHERE role = 'assistant'")
      .all() as Array<{ parts: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].parts).toContain('"type":"tool-read_file"');
    expect(rows[0].parts.length).toBeLessThan(6_000);
    expect(rows[0].parts).not.toContain(filler.repeat(3));
  } finally {
    db.close();
  }

  await page.reload();
  await expect(page.getByText("The code is ZX-41.", { exact: true })).toBeVisible();
  const reloaded = page.getByRole("button", { name: "Read long-report.txt" });
  await reloaded.click();
  await expect(reloaded.locator("xpath=following-sibling::div[1]")).toHaveCSS("opacity", "1");
  await expect(page.getByText(/of 122k chars$/)).toBeVisible();

  // The next turn replays the saved read from the upload and renders the
  // attachment prefix byte-for-byte as before, so prompt caches still match.
  await send(page, "Thanks");
  await expect(page.getByText("You're welcome.", { exact: true })).toBeVisible();
  const followUp = chatRequests.at(-1)!;
  expect(text(followUp.messages.find((message) => message.role === "user"))).toBe(firstUser);
  const replayed = followUp.messages.filter((message) => message.role === "tool");
  expect(replayed.map(text)).toEqual([searchResult, readResult]);
});

test("includes a short attachment whole without offering file tools", async ({ page }) => {
  await send(page, "When is the launch?", { name: "note.txt", body: shortNote });
  await expect(page.getByText("Thursday.", { exact: true })).toBeVisible();
  const request = chatRequests[0];
  expect(toolNames(request)).not.toContain("read_file");
  const user = text(request.messages.find((message) => message.role === "user"));
  expect(user).toContain(`<document_content>\n${shortNote}\n</document_content>\n</document>`);
  expect(user).not.toContain("<document_status>");
});

test("a live tool-calling model answers from beyond the included budget", async ({ page }) => {
  const endpoint = process.env.ATTACHMENT_READING_LIVE_URL;
  test.skip(
    !endpoint,
    "Set ATTACHMENT_READING_LIVE_URL to an OpenAI-compatible /v1 endpoint with tool calling",
  );
  test.setTimeout(600_000);
  const models = await (await page.request.get(`${endpoint}/models`)).json();
  const db = openE2eDatabase();
  try {
    // A 16k window includes about 4k tokens of the manual up front.
    db.prepare(
      "UPDATE model_configs SET base_url = ?, model = ?, context_window = 16384",
    ).run(endpoint, models.data[0].id);
  } finally {
    db.close();
  }
  const offices = ["Oslo", "Porto", "Lyon", "Turin", "Ghent", "Basel", "Cork", "Brno"];
  const sections = Array.from({ length: 240 }, (_, i) => {
    const office = offices[i % offices.length];
    return `Section ${i + 1}: The ${office} office reviewed shipping schedules, badge renewals and supplier invoices for week ${i + 1}. Floor ${(i % 9) + 1} hosted the weekly planning meeting.`;
  });
  sections.splice(
    200,
    0,
    "Section 201a: The vault combination for the Lisbon office is 7-3-9-1. Only the facilities lead may change it.",
  );
  const manual = sections.join("\n\n");
  await send(
    page,
    "What is the vault combination for the Lisbon office? Reply with only the combination.",
    { name: "operations-manual.txt", body: manual },
  );
  await page.waitForURL("**/chat/**");
  const chatId = new URL(page.url()).pathname.split("/").at(-1)!;
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`/api/chat/${chatId}/stream/status`)).json()).active,
      { timeout: 540_000 },
    )
    .toBe(false);
  const saved = (await (await page.request.get(`/api/chat/${chatId}/messages`)).json()).messages;
  const answer = saved.at(-1);
  const parts = answer.parts as Array<{ type: string; text?: string }>;
  expect(parts.some((part) => part.type === "tool-search_files" || part.type === "tool-read_file")).toBe(true);
  expect(parts.filter((part) => part.type === "text").map((part) => part.text).join("")).toContain("7-3-9-1");
});
