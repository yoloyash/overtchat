import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { crc32, deflateSync } from "node:zlib";
import mammoth from "mammoth";
import { expect, test, type Page } from "@playwright/test";
import {
  openE2eDatabase,
  resetE2eDatabase,
  setupUrl,
} from "./helpers/database";
import { e2eSandboxToken, e2eSandboxUrl, realSandbox } from "./helpers/sandbox";

type ContentPart = { type: string; text?: string; image_url?: { url: string } };
type ChatMessage = {
  role: string;
  content?: string | ContentPart[] | null;
  tool_calls?: Array<{ function: { name: string; arguments: string } }>;
};
type ChatPayload = {
  stream?: boolean;
  messages: ChatMessage[];
  tools?: Array<{ function?: { name?: string } }>;
};
type SandboxRun = { authorization?: string; code: string; files: Map<string, string> };
type SavedPart = {
  type: string;
  state?: string;
  output?: { files?: Array<{ name: string; url: string; mediaType: string }> };
};

/** An RGB PNG drawn pixel by pixel. */
function png(width: number, height: number, color: (x: number, y: number) => number[]): Buffer {
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 3);
    for (let x = 0; x < width; x++) row.set(color(x, y), 1 + x * 3);
    rows.push(row);
  }
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const sales = "region,total\nnorth,3\nsouth,5\nnorth,4\n";
const totalsCsv = "region,total\nnorth,7\nsouth,5\n";
const analyze = [
  "import pandas as pd",
  "import matplotlib.pyplot as plt",
  'df = pd.read_csv("/mnt/data/uploads/sales.csv")',
  'totals = df.groupby("region")["total"].sum()',
  "print(totals.to_string())",
  'totals.plot(kind="bar")',
  'plt.savefig("/mnt/data/outputs/totals.png")',
  'totals.to_csv("/mnt/data/outputs/totals.csv")',
].join("\n");
const addShare = [
  "import pandas as pd",
  'totals = pd.read_csv("/mnt/data/uploads/totals.csv")',
  'totals["share"] = (totals["total"] / totals["total"].sum()).round(2)',
  "print(totals.to_string(index=False))",
  'totals.to_csv("/mnt/data/outputs/totals.csv", index=False)',
].join("\n");
const divide = "print(1 / 0)";

const scripts: Record<string, { code: string; reply: string }> = {
  "total by region": { code: analyze, reply: "North leads with 7." },
  "share of the total": { code: addShare, reply: "North has 58% of the total." },
  "divide by zero": { code: divide, reply: "That calculation fails." },
};

let provider: Server;
let baseUrl: string;
let sandbox: Server | undefined;
let sandboxHealthy = true;
const chatRequests: ChatPayload[] = [];
const sandboxRuns: SandboxRun[] = [];

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

/** The stand-in sandbox answers the scripted programs as the real one does. */
function fakeRun(code: string) {
  const file = (name: string, data: Buffer) => ({
    path: `outputs/${name}`,
    name,
    size: data.byteLength,
    media_type: "application/octet-stream",
    data: data.toString("base64"),
  });
  const result = {
    exit_code: 0,
    signal: null,
    timed_out: false,
    duration_ms: 420,
    stdout: "",
    stdout_truncated: false,
    stderr: "",
    stderr_truncated: false,
    files: [] as ReturnType<typeof file>[],
    skipped_files: [],
  };
  if (code === analyze) {
    const chart = png(64, 48, (x) => (x < 32 ? [79, 70, 229] : [236, 72, 153]));
    return {
      ...result,
      stdout: "region\nnorth    7\nsouth    5\n",
      files: [file("totals.png", chart), file("totals.csv", Buffer.from(totalsCsv))],
    };
  }
  if (code === addShare) {
    return {
      ...result,
      stdout: "region  total  share\n north      7   0.58\n south      5   0.42\n",
      files: [file("totals.csv", Buffer.from("region,total,share\nnorth,7,0.58\nsouth,5,0.42\n"))],
    };
  }
  return {
    ...result,
    exit_code: 1,
    stderr:
      'Traceback (most recent call last):\n  File "/mnt/data/.main.py", line 1, in <module>\n    print(1 / 0)\nZeroDivisionError: division by zero\n',
  };
}

async function body(req: AsyncIterable<unknown>): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks).toString();
}

test.beforeAll(async () => {
  provider = createServer(async (req, res) => {
    const payload = JSON.parse(await body(req)) as ChatPayload;
    if (!payload.stream) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          id: "title",
          object: "chat.completion",
          created: 1,
          model: "code-test",
          choices: [{ index: 0, message: { role: "assistant", content: "Sales totals" }, finish_reason: "stop" }],
        }),
      );
      return;
    }
    chatRequests.push(payload);
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const event = (delta: unknown, finish: string | null) =>
      res.write(
        `data: ${JSON.stringify({ id: "code", object: "chat.completion.chunk", created: 1, model: "code-test", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`,
      );
    // Images a run returned arrive in a user message after its result.
    const turn = payload.messages.findLastIndex(
      (message) => message.role === "user" && !text(message).startsWith("Attached image(s) from tool result:"),
    );
    const prompt = text(payload.messages[turn]).toLowerCase();
    const scripted = Object.entries(scripts).find(([key]) => prompt.includes(key))?.[1];
    const answered = payload.messages.slice(turn).some((message) => message.role === "tool");
    if (answered || !scripted || !toolNames(payload).includes("run_python")) {
      event({ role: "assistant", content: scripted && answered ? scripted.reply : "No code tools." }, null);
      event({}, "stop");
    } else {
      event(
        {
          role: "assistant",
          tool_calls: [
            {
              index: 0,
              id: `call-${chatRequests.length}`,
              type: "function",
              function: { name: "run_python", arguments: JSON.stringify({ code: scripted.code }) },
            },
          ],
        },
        null,
      );
      event({}, "tool_calls");
    }
    res.end("data: [DONE]\n\n");
  });
  await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(provider.address() as AddressInfo).port}/v1`;

  if (realSandbox) return;
  sandbox = createServer(async (req, res) => {
    const json = (status: number, value: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(value));
    };
    if (req.url === "/healthz") {
      json(
        sandboxHealthy ? 200 : 503,
        sandboxHealthy
          ? {
              status: "ok",
              tier: "slim",
              version: "e2e",
              packages: { pandas: "2.2.3", matplotlib: "3.9.2" },
              tools: [],
              skills: [],
              limits: { timeout_seconds: 60, max_timeout_seconds: 300 },
            }
          : { status: "error", error: "Stopped by the test." },
      );
      return;
    }
    const request = JSON.parse(await body(req)) as { code: string; files: Array<{ name: string; data: string }> };
    sandboxRuns.push({
      authorization: req.headers.authorization,
      code: request.code,
      files: new Map(request.files.map((file) => [file.name, Buffer.from(file.data, "base64").toString()])),
    });
    if (req.headers.authorization !== `Bearer ${e2eSandboxToken}`) {
      json(401, { error: "Unauthorized." });
      return;
    }
    json(200, fakeRun(request.code));
  });
  const { hostname, port } = new URL(e2eSandboxUrl);
  await new Promise<void>((resolve) => sandbox!.listen(Number(port), hostname, resolve));
});

test.afterAll(async () => {
  for (const server of [provider, sandbox]) {
    if (!server) continue;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

async function codeExecution(page: Page) {
  const response = await page.request.get("/api/capabilities");
  return (await response.json()).capabilities.codeExecution as { available: boolean; unavailableReason: string | null };
}

test.beforeEach(async ({ page }) => {
  resetE2eDatabase();
  chatRequests.length = 0;
  sandboxRuns.length = 0;
  sandboxHealthy = true;
  await page.goto(await setupUrl());
  await page.locator("#name").fill("Code Admin");
  await page.locator("#email").fill("code@overtchat-test.local");
  await page.locator("#password").fill("test-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/");
  const model = await page.request.post("/api/model-configs", {
    data: {
      label: "Code test",
      providerId: "custom",
      apiFormat: "openai-chat",
      baseUrl,
      model: "code-test",
      toolCallingEnabled: true,
    },
  });
  expect(model.ok()).toBeTruthy();
  const db = openE2eDatabase();
  try {
    db.prepare("UPDATE model_configs SET discovered_capabilities = ?").run(
      JSON.stringify({ inputModalities: ["text", "image"], toolCall: true }),
    );
    db.prepare("UPDATE server_capabilities SET provider = 'disabled' WHERE id = 'search'").run();
  } finally {
    db.close();
  }
  // Capabilities probe the sandbox afresh, which also refreshes what chat sees.
  await expect.poll(async () => (await codeExecution(page)).available).toBe(true);
  await page.goto("/");
});

test.afterEach(async ({ page }) => {
  if (realSandbox) return;
  // Leave the server seeing no sandbox, so later test files are unaffected.
  sandboxHealthy = false;
  await expect.poll(async () => (await codeExecution(page)).available).toBe(false);
});

async function send(page: Page, message: string, file?: { name: string; body: Buffer | string; mimeType: string }) {
  if (file) {
    await page.locator('input[type="file"]').setInputFiles({
      name: file.name,
      mimeType: file.mimeType,
      buffer: Buffer.isBuffer(file.body) ? file.body : Buffer.from(file.body),
    });
    await expect(page.getByLabel(`Remove ${file.name}`, { exact: true })).toBeVisible();
  }
  await page.locator("textarea").fill(message);
  await page.getByRole("button", { name: "Send message" }).click();
}

function toolResult(payload: ChatPayload): string {
  return text(payload.messages.findLast((message) => message.role === "tool"));
}

async function expandRun(page: Page, label: string) {
  const activity = page.getByRole("button", { name: label }).last();
  await activity.click();
  await expect(activity).toHaveAttribute("aria-expanded", "true");
  // Collapsed steps stay in the DOM at opacity 0; wait for the open timeline.
  await expect(activity.locator("xpath=following-sibling::div[1]")).toHaveCSS("opacity", "1");
}

test("runs code on an attachment, returns its files, and reuses them in a later run", async ({ page, browser }, testInfo) => {
  await send(page, "Show the total by region with a chart", { name: "sales.csv", body: sales, mimeType: "text/csv" });
  await expect(page.getByText("North leads with 7.", { exact: true })).toBeVisible();

  // The model was offered run_python and told where the attachment is.
  const first = chatRequests[0];
  expect(toolNames(first)).toContain("run_python");
  expect(text(first.messages[0])).toContain("Use run_python to compute exact numbers");
  expect(first.messages.filter((message) => message.role === "user").map(text).join("\n")).toContain(
    "Files from this message are available to run_python at: /mnt/data/uploads/sales.csv",
  );
  if (!realSandbox) {
    expect(sandboxRuns).toHaveLength(1);
    expect(sandboxRuns[0]).toMatchObject({ authorization: `Bearer ${e2eSandboxToken}`, code: analyze });
    expect(Object.fromEntries(sandboxRuns[0].files)).toEqual({ "sales.csv": sales });
  }

  // The model read the run's output and was shown the chart.
  const afterRun = chatRequests[1];
  const result = toolResult(afterRun);
  expect(result).toMatch(/^Exit code 0 after \d+\.\ds\./);
  expect(result).toMatch(/stdout:\nregion\nnorth +7\nsouth +5/);
  expect(result).toContain("- totals.png (image/png, ");
  expect(result).toContain(`- totals.csv (text/csv, ${Buffer.byteLength(totalsCsv)} B)`);
  const toolIndex = afterRun.messages.findLastIndex((message) => message.role === "tool");
  const shown = afterRun.messages.slice(toolIndex + 1).find((message) => message.role === "user");
  expect(Array.isArray(shown?.content) && shown.content.some((part) => part.type === "image_url")).toBe(true);

  // The chart displays inline and the table downloads.
  const files = page.locator("[data-code-files]");
  const chart = files.getByRole("img", { name: "totals.png" });
  await expect(chart).toBeVisible();
  await expect.poll(() => chart.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  const table = page.locator("[data-code-file]", { hasText: "totals.csv" });
  await expect(table).toContainText(`CSV · ${Buffer.byteLength(totalsCsv)} B`);
  const download = page.waitForEvent("download");
  await table.click();
  expect((await download).suggestedFilename()).toBe("totals.csv");
  expect(await readFile((await (await download).path())!, "utf8")).toBe(totalsCsv);

  // The activity shows the code and what it printed.
  await expandRun(page, "Ran code");
  const run = page.locator("[data-code-run]");
  await expect(run).toContainText("Python");
  await expect(run).toContainText(/Done · \d+\.\ds/);
  await expect(run).toContainText('groupby("region")');
  await expect(run).toContainText(/north +7/);
  await page.screenshot({ path: testInfo.outputPath("code-run.png") });

  // A later run reads the files earlier runs saved, newest first, and a
  // returned file with a taken name gets a unique one.
  await send(page, "Add each region's share of the total");
  await expect(page.getByText("North has 58% of the total.", { exact: true })).toBeVisible();
  if (!realSandbox) {
    expect([...sandboxRuns[1].files.keys()]).toEqual(["totals.csv", "totals.png", "sales.csv"]);
    expect(sandboxRuns[1].files.get("totals.csv")).toBe(totalsCsv);
  }
  expect(toolResult(chatRequests.at(-1)!)).toContain("- totals (2).csv (text/csv, ");
  await expect(page.locator("[data-code-file]", { hasText: "totals (2).csv" })).toBeVisible();

  // Everything survives a reload, and the files are in the library.
  await page.reload();
  await expect(page.locator("[data-code-files]").getByRole("img", { name: "totals.png" })).toBeVisible();
  await expect(page.locator("[data-code-file]", { hasText: "totals (2).csv" })).toBeVisible();
  const library = await (await page.request.get("/api/library")).json();
  expect(library.items.map((item: { filename: string }) => item.filename).sort()).toEqual([
    "sales.csv",
    "totals (2).csv",
    "totals.csv",
    "totals.png",
  ]);

  // A public share shows the chart and serves the files from the snapshot.
  const chatId = new URL(page.url()).pathname.split("/").at(-1)!;
  const { share } = await (await page.request.post(`/api/chat/${chatId}/share`)).json();
  const anonymous = await browser.newContext({ baseURL: new URL(page.url()).origin });
  try {
    const reader = await anonymous.newPage();
    await reader.goto(`/share/${share.id}`);
    const sharedChart = reader.locator("[data-code-files]").getByRole("img", { name: "totals.png" });
    await expect(sharedChart).toBeVisible();
    await expect.poll(() => sharedChart.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
    expect(await sharedChart.getAttribute("src")).toMatch(/^\/api\/share\/[0-9a-f-]{36}\/files\/[\w-]+$/);
    const sharedDownload = reader.waitForEvent("download");
    await reader.locator("[data-code-file]", { hasText: "totals.csv" }).click();
    expect(await readFile((await (await sharedDownload).path())!, "utf8")).toBe(totalsCsv);
    await reader.screenshot({ path: testInfo.outputPath("code-run-shared.png") });
  } finally {
    await anonymous.close();
  }
});

test("shows a failed run with its error output", async ({ page }) => {
  await send(page, "Divide by zero for me");
  await expect(page.getByText("That calculation fails.", { exact: true })).toBeVisible();
  expect(toolResult(chatRequests[1])).toMatch(/^Exit code 1 after \d+\.\ds\.\n\nstderr:\n/);
  expect(toolResult(chatRequests[1])).toContain("ZeroDivisionError: division by zero");

  await expandRun(page, "Code ended with an error");
  const run = page.locator("[data-code-run]");
  await expect(run).toContainText("Exit code 1");
  await expect(run).toContainText("ZeroDivisionError: division by zero");
  await expect(page.locator("[data-code-files]")).toHaveCount(0);
});

test("offers code execution only to clients that render it while the sandbox is up", async ({ page }) => {
  test.skip(realSandbox, "Stops the stand-in sandbox");
  const models = await (await page.request.get("/api/model-configs")).json();
  const response = await page.request.post("/api/chat", {
    data: {
      chatId: "legacy-client",
      temporary: true,
      modelConfigId: models.modelConfigs[0].id,
      messages: [{ id: "legacy-turn", role: "user", parts: [{ type: "text", text: "Show the total by region" }] }],
    },
  });
  expect(response.ok()).toBeTruthy();
  await response.text();
  expect(toolNames(chatRequests[0])).not.toContain("run_python");
  expect(text(chatRequests[0].messages[0])).not.toContain("run_python");

  sandboxHealthy = false;
  await expect.poll(() => codeExecution(page)).toEqual({
    installed: true,
    available: false,
    unavailableReason: "unreachable",
  });
  await send(page, "Show the total by region");
  await expect(page.getByText("No code tools.", { exact: true })).toBeVisible();
  expect(toolNames(chatRequests.at(-1)!)).not.toContain("run_python");
  expect(sandboxRuns).toHaveLength(0);
});

test("a live tool-calling model analyzes data, edits an image and writes a Word file", async ({ page }, testInfo) => {
  const endpoint = process.env.CODE_EXECUTION_LIVE_URL;
  test.skip(
    !endpoint || !realSandbox,
    "Set CODE_EXECUTION_LIVE_URL to an OpenAI-compatible /v1 endpoint with tool calling and SANDBOX_URL to a running sandbox",
  );
  test.setTimeout(900_000);
  const models = await (await page.request.get(`${endpoint}/models`)).json();
  const db = openE2eDatabase();
  try {
    db.prepare("UPDATE model_configs SET base_url = ?, model = ?, discovered_capabilities = ?").run(
      endpoint,
      models.data[0].id,
      JSON.stringify({ inputModalities: ["text"], toolCall: true }),
    );
  } finally {
    db.close();
  }
  const saved = async (chatId: string) => {
    const response = await page.request.get(`/api/chat/${chatId}/messages`);
    return response.ok()
      ? ((await response.json()).messages as Array<{ role: string; parts: SavedPart[] }>)
      : [];
  };
  // Each turn is done once its answer is saved and the stream has ended.
  const turn = async (
    chatId: string | undefined,
    message: string,
    file?: { name: string; body: Buffer | string; mimeType: string },
  ) => {
    const answered = chatId ? (await saved(chatId)).filter((entry) => entry.role === "assistant").length : 0;
    await send(page, message, file);
    await page.waitForURL("**/chat/**");
    const id = chatId ?? new URL(page.url()).pathname.split("/").at(-1)!;
    await expect
      .poll(
        async () => {
          const status = await page.request.get(`/api/chat/${id}/stream/status`);
          const active = status.ok() ? (await status.json()).active : true;
          const assistants = (await saved(id)).filter((entry) => entry.role === "assistant").length;
          return !active && assistants > answered;
        },
        { timeout: 300_000 },
      )
      .toBe(true);
    const latest = (await saved(id)).at(-1)!;
    const files = latest.parts.flatMap((part) =>
      part.type === "tool-run_python" && part.state === "output-available" ? (part.output?.files ?? []) : [],
    );
    return { chatId: id, files };
  };

  const regions = ["north", "south", "east", "west"];
  const rows = Array.from({ length: 120 }, (_, index) => ({
    region: regions[index % 4],
    revenue: ((index * 37) % 500) + 100,
  }));
  const northTotal = rows.filter((row) => row.region === "north").reduce((sum, row) => sum + row.revenue, 0);
  const analysis = await turn(
    undefined,
    "Compute the total revenue for the north region in the attached file, and make a bar chart of total revenue by region.",
    {
      name: "revenue.csv",
      body: `region,revenue\n${rows.map((row) => `${row.region},${row.revenue}`).join("\n")}\n`,
      mimeType: "text/csv",
    },
  );
  const chatId = analysis.chatId;
  const answer = (await page.locator("[data-chat-find-text]").last().innerText()).replace(/[,\s]/g, "");
  expect(answer).toContain(String(northTotal));
  expect(analysis.files.some((file) => file.mediaType === "image/png")).toBe(true);
  await expect(page.locator("[data-code-files] img").first()).toBeVisible();

  const photo = png(64, 64, (x, y) => (x < 32 ? ((x + y) % 2 ? [255, 255, 255] : [0, 0, 0]) : [200, 40, 40]));
  const edit = await turn(chatId, "Blur the left half of the attached image and give me the result as a PNG file.", {
    name: "photo.png",
    body: photo,
    mimeType: "image/png",
  });
  const blurred = edit.files.find((file) => file.mediaType === "image/png");
  expect(blurred).toBeTruthy();
  const blurredBytes = await (await page.request.get(blurred!.url)).body();
  expect(blurredBytes.subarray(0, 8)).toEqual(photo.subarray(0, 8));
  expect(blurredBytes.equals(photo)).toBe(false);

  const writing = await turn(
    chatId,
    "Write a short Word document (.docx) summarizing total revenue by region from the CSV file, and return the file.",
  );
  const word = writing.files.find((file) => file.name.endsWith(".docx"));
  expect(word).toBeTruthy();
  await expect(page.locator("[data-code-file]", { hasText: word!.name })).toBeVisible();
  const { value } = await mammoth.extractRawText({
    buffer: Buffer.from(await (await page.request.get(word!.url)).body()),
  });
  expect(value.toLowerCase()).toContain("north");
  await page.screenshot({ path: testInfo.outputPath("code-live.png"), fullPage: true });
});
