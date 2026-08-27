import { expect, test, type Page } from "@playwright/test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { openE2eDatabase, resetE2eDatabase } from "./helpers/database";

let modelServer: Server;
let modelBaseUrl: string;
let sawToolOutput = false;

test.beforeAll(async () => {
  modelServer = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const bodyText = Buffer.concat(chunks).toString("utf8");
    const body = JSON.parse(bodyText) as {
      stream?: boolean;
      messages?: Array<{ role?: string; content?: unknown }>;
    };
    const created = Math.floor(Date.now() / 1_000);

    if (!body.stream) {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          id: "code-title",
          object: "chat.completion",
          created,
          model: "code-execution-test-model",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "Python calculation" },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
        }),
      );
      return;
    }

    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    const toolMessage = body.messages?.find(
      (message) => message.role === "tool",
    );
    const toolResultRequest =
      toolMessage !== undefined && JSON.stringify(toolMessage).includes("45");
    sawToolOutput ||= toolResultRequest;
    const events = toolResultRequest
      ? [
          completionChunk(created, {
            role: "assistant",
            content: "Python says 45.",
          }),
          completionChunk(created, {}, "stop"),
        ]
      : [
          completionChunk(created, {
            role: "assistant",
            tool_calls: [
              {
                index: 0,
                id: "call_python_1",
                type: "function",
                function: {
                  name: "execute_code",
                  arguments: JSON.stringify({
                    language: "python",
                    code: "sum(range(10))",
                  }),
                },
              },
            ],
          }),
          completionChunk(created, {}, "tool_calls"),
        ];
    for (const event of events) {
      response.write(`data: ${JSON.stringify(event)}\n\n`);
    }
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

test.beforeEach(() => {
  resetE2eDatabase();
  sawToolOutput = false;
});

test("runs Python code blocks from the self-hosted opaque-origin runtime", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto("/signup");
  await page.locator("#name").fill("Code Execution Tester");
  await page
    .locator("#email")
    .fill("code-execution-admin@overtchat-test.local");
  await page.locator("#password").fill("test-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/", { timeout: 15_000 });

  seedCodeChat();
  await page.goto("/chat/code-execution-chat");

  const runButtons = page.getByRole("button", { name: "Run Python" });
  await expect(runButtons).toHaveCount(3);

  await runButtons.nth(0).click();
  await expect(page.getByText("6", { exact: true })).toBeVisible({
    timeout: 30_000,
  });

  await runButtons.nth(1).click();
  await expect(
    page.getByText(/ImportError.*cannot import name 'document'/u),
  ).toBeVisible();

  await page.evaluate(() => {
    window.setTimeout(() => {
      document.body.dataset.pythonWorkerTick = "ready";
    }, 100);
  });
  await runButtons.nth(2).click();
  await expect
    .poll(
      () => page.evaluate(() => document.body.dataset.pythonWorkerTick),
      { timeout: 1_000 },
    )
    .toBe("ready");
  await expect(page.getByText("worker finished", { exact: true })).toBeVisible({
    timeout: 5_000,
  });
});

test("returns browser Python results to the model and persists one assistant turn", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await signUp(page, "code-agent-admin@overtchat-test.local");
  seedModel();
  await page.reload();

  const composer = page.getByPlaceholder("Message…");
  await composer.fill("Calculate the sum of the integers from zero through nine.");
  await page.getByLabel("Send message").click();

  await expect(page.getByText("Python says 45.", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect.poll(() => sawToolOutput).toBe(true);

  const database = openE2eDatabase();
  try {
    const rows = database
      .prepare(
        "SELECT role, parts FROM messages ORDER BY rowid",
      )
      .all() as Array<{ role: string; parts: string }>;
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.role)).toEqual(["user", "assistant"]);
    expect(rows[1].parts).toContain('"type":"tool-execute_code"');
    expect(rows[1].parts).toContain('"result":45');
    expect(rows[1].parts).toContain("Python says 45.");
  } finally {
    database.close();
  }
});

function seedCodeChat() {
  const database = openE2eDatabase();
  const now = Date.now();
  try {
    const user = database
      .prepare("SELECT id FROM user WHERE email = ?")
      .get("code-execution-admin@overtchat-test.local") as { id: string };
    insertModel(database, now);
    database
      .prepare(
        `INSERT INTO chats (
          id, user_id, project_id, title, active_stream_id, created_at, updated_at
        ) VALUES (?, ?, NULL, ?, NULL, ?, ?)`,
      )
      .run(
        "code-execution-chat",
        user.id,
        "Python execution",
        now,
        now,
      );
    database
      .prepare(
        `INSERT INTO messages (id, chat_id, role, parts, created_at)
         VALUES (?, ?, 'assistant', ?, ?)`,
      )
      .run(
        "code-execution-message",
        "code-execution-chat",
        JSON.stringify([
          {
            type: "text",
            text: [
              "Package execution:\n\n```python",
              "import numpy as np",
              "int(np.arange(4).sum())",
              "```",
              "\n\nOrigin isolation:\n\n```python",
              "from js import document",
              "len(document.cookie)",
              "```",
              "\n\nWorker isolation:\n\n```python",
              "import time",
              "time.sleep(2)",
              '"worker finished"',
              "```",
            ].join("\n"),
          },
        ]),
        now,
      );
  } finally {
    database.close();
  }
}

async function signUp(page: Page, email: string) {
  await page.goto("/signup");
  await page.locator("#name").fill("Code Execution Tester");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill("test-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/", { timeout: 15_000 });
}

function seedModel() {
  const database = openE2eDatabase();
  try {
    insertModel(database, Date.now());
  } finally {
    database.close();
  }
}

function insertModel(database: ReturnType<typeof openE2eDatabase>, now: number) {
  database
    .prepare(
      `INSERT INTO model_configs (
        id, label, provider_id, api_format, base_url, api_key, model,
        tool_calling_enabled, enabled, sort_order, created_at, updated_at
      ) VALUES (
        'code-execution-model', 'Code Execution Model', 'custom',
        'openai-chat', ?, 'test-key', 'code-execution-test-model',
        1, 1, 0, ?, ?
      )`,
    )
    .run(modelBaseUrl, now, now);
}

function completionChunk(
  created: number,
  delta: Record<string, unknown>,
  finishReason: string | null = null,
) {
  return {
    id: "code-execution-response",
    object: "chat.completion.chunk",
    created,
    model: "code-execution-test-model",
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
}
