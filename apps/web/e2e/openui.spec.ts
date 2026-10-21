import { expect, test } from "@playwright/test";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import {
  openE2eDatabase,
  resetE2eDatabase,
  setupUrl,
} from "./helpers/database";

const code = `root = Card([CardHeader("Trip planner"), booking])
booking = Form("trip", Buttons([Button("Plan trip", @ToAssistant("Plan this trip", {ticket: "T-42"}))]), [FormControl("Destination", Input("destination", "City"))])`;

test("submits a saved form through the chat API, delivers context and restores it after reload", async ({
  page,
}) => {
  const modelRequests: Record<string, unknown>[] = [];
  const provider = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
    if (!body.stream) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          data: [{ id: "form-test" }],
          choices: [
            {
              message: { role: "assistant", content: "Trip" },
              finish_reason: "stop",
            },
          ],
        }),
      );
      return;
    }
    modelRequests.push(body);
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const delta = (content: string, finishReason: string | null) =>
      res.write(
        `data: ${JSON.stringify({
          id: "form-stream",
          object: "chat.completion.chunk",
          created: 1,
          model: "form-test",
          choices: [
            { index: 0, delta: { content }, finish_reason: finishReason },
          ],
        })}\n\n`,
      );
    delta("Your Kyoto trip is ready.", null);
    delta("", "stop");
    res.end("data: [DONE]\n\n");
  });
  await new Promise<void>((resolve) =>
    provider.listen(0, "127.0.0.1", resolve),
  );
  try {
    resetE2eDatabase();
    await page.goto(await setupUrl());
    await page.locator("#name").fill("Form Tester");
    await page.locator("#email").fill("forms@overtchat-test.local");
    await page.locator("#password").fill("test-password-123");
    await page.getByRole("button", { name: "Create account" }).click();
    await page.waitForURL("**/");
    const db = openE2eDatabase();
    try {
      const user = db.prepare("SELECT id FROM user LIMIT 1").get() as {
        id: string;
      };
      db.prepare(
        "INSERT INTO chats (id, user_id, title, created_at, updated_at) VALUES ('form-chat', ?, 'Trip', 1, 1)",
      ).run(user.id);
      db.prepare(
        "INSERT INTO messages (id, chat_id, role, parts, created_at) VALUES ('form-answer', 'form-chat', 'assistant', ?, 1)",
      ).run(
        JSON.stringify([
          {
            type: "tool-present_openui",
            toolCallId: "t",
            state: "output-available",
            input: { ui: code, text: "Choose a destination." },
            output: { displayed: true, text: "Choose a destination." },
          },
        ]),
      );
      db.prepare(
        `INSERT INTO model_configs (id, label, provider_id, api_format, base_url, api_key, model, enabled, sort_order, created_at, updated_at)
        VALUES ('form-model', 'Form Model', 'custom', 'openai-chat', ?, 'test-key', 'form-test', 1, 0, 1, 1)`,
      ).run(`http://127.0.0.1:${(provider.address() as AddressInfo).port}/v1`);
    } finally {
      db.close();
    }
    await page.goto("/chat/form-chat");
    await page.getByPlaceholder("City").fill("Kyoto");
    await page.getByRole("button", { name: "Plan trip" }).click();
    await expect(
      page.getByText("Your Kyoto trip is ready.", { exact: true }),
    ).toBeVisible();
    expect(modelRequests).toHaveLength(1);
    expect(JSON.stringify(modelRequests[0].messages)).toContain("T-42");
    expect(JSON.stringify(modelRequests[0].messages)).toContain("Kyoto");
    expect(JSON.stringify(modelRequests[0].tools)).not.toContain(
      "present_openui",
    );
    await expect
      .poll(async () => {
        const response = await page.request.get(
          "/api/chat/form-chat/messages?openui=1",
        );
        return response.text();
      })
      .toContain("openuiAction");
    await page.reload();
    await expect(page.getByPlaceholder("City")).toHaveValue("Kyoto");
  } finally {
    provider.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      provider.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test("mobile bundle renders forms, sends structured actions and restores submitted values", async ({
  page,
}) => {
  const externalRequests: string[] = [];
  page.on("request", (request) => {
    if (!new URL(request.url()).hostname.match(/^(localhost|127\.0\.0\.1)$/))
      externalRequests.push(request.url());
  });
  await page.addInitScript(() => {
    Object.assign(window, {
      bridgeMessages: [],
      ReactNativeWebView: {
        postMessage(value: string) {
          (
            window as unknown as { bridgeMessages: unknown[] }
          ).bridgeMessages.push(JSON.parse(value));
        },
      },
    });
  });
  await page.goto("/openui/index.html");
  const payload = {
    messageId: "a",
    toolCallId: "t",
    code,
    isStreaming: false,
    fallbackText: "Choose a destination.",
    mode: "light" as const,
    canAct: true,
  };
  await page.evaluate(
    (payload) => window.overtchatOpenUI!.render(payload),
    payload,
  );
  await expect(page.getByPlaceholder("City")).toBeVisible();
  await page.getByPlaceholder("City").fill("Kyoto");
  await page.getByRole("button", { name: "Plan trip" }).dblclick();
  const actions = await page.evaluate(() =>
    (
      window as unknown as {
        bridgeMessages: {
          type: string;
          action: { formState: Record<string, never> };
        }[];
      }
    ).bridgeMessages.filter((message) => message.type === "action"),
  );
  expect(actions).toHaveLength(1);
  expect(actions[0].action).toMatchObject({
    messageId: "a",
    toolCallId: "t",
    message: "Plan this trip",
    context: { ticket: "T-42" },
    formName: "trip",
  });
  expect(JSON.stringify(actions[0].action.formState)).toContain("Kyoto");
  await page.reload();
  await page.evaluate((payload) => window.overtchatOpenUI!.render(payload), {
    ...payload,
    initialState: actions[0].action.formState,
  });
  await expect(page.getByPlaceholder("City")).toHaveValue("Kyoto");
  await page.evaluate((payload) => window.overtchatOpenUI!.render(payload), {
    ...payload,
    canAct: false,
  });
  await expect(page.getByRole("button", { name: "Plan trip" })).toBeDisabled();
  expect(externalRequests).toEqual([]);
});

test("mobile bundle exposes readable fallback for invalid components", async ({
  page,
}) => {
  await page.goto("/openui/index.html");
  await page.evaluate(() =>
    window.overtchatOpenUI!.render({
      messageId: "a",
      toolCallId: "t",
      code: 'root = Card([ImaginaryWidget("broken")])',
      isStreaming: false,
      fallbackText: "Revenue was 42 dollars.",
      mode: "dark",
      canAct: false,
    }),
  );
  await expect(page.locator("[data-openui-fallback]")).toContainText(
    "Revenue was 42 dollars.",
  );
});

test("saved chat renders cards, tolerates malformed input and serves readable history to old clients", async ({
  page,
}) => {
  resetE2eDatabase();
  await page.goto(await setupUrl());
  await page.locator("#name").fill("UI Tester");
  await page.locator("#email").fill("openui@overtchat-test.local");
  await page.locator("#password").fill("test-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/");
  const db = openE2eDatabase();
  try {
    const user = db.prepare("SELECT id FROM user LIMIT 1").get() as {
      id: string;
    };
    db.prepare(
      "INSERT INTO chats (id, user_id, title, created_at, updated_at) VALUES ('openui-chat', ?, 'Interactive UI', 1, 1)",
    ).run(user.id);
    const insert = db.prepare(
      "INSERT INTO messages (id, chat_id, role, parts, created_at) VALUES (?, 'openui-chat', 'assistant', ?, ?)",
    );
    insert.run(
      "valid",
      JSON.stringify([
        {
          type: "tool-present_openui",
          toolCallId: "t",
          state: "output-available",
          input: { ui: code },
          output: { displayed: true, text: "Choose a destination." },
        },
      ]),
      1,
    );
    insert.run(
      "invalid",
      JSON.stringify([
        {
          type: "tool-present_openui",
          toolCallId: "bad",
          state: "output-error",
          input: { ui: 42, text: "A readable answer survives." },
          errorText: "Invalid program",
        },
      ]),
      2,
    );
  } finally {
    db.close();
  }
  await page.goto("/chat/openui-chat");
  await expect(page.getByText("Trip planner", { exact: true })).toBeVisible();
  await expect(
    page.getByText("A readable answer survives.", { exact: true }),
  ).toBeVisible();
  const legacy = await page.request.get("/api/chat/openui-chat/messages");
  const current = await page.request.get(
    "/api/chat/openui-chat/messages?openui=1",
  );
  expect(await legacy.text()).not.toContain("tool-present_openui");
  expect(await current.text()).toContain("tool-present_openui");
});
