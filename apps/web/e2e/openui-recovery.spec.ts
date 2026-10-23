import { expect, test, type Page } from "@playwright/test";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { resetE2eDatabase, setupUrl } from "./helpers/database";

const recoveredCode = `root = Card([CardHeader("Trip planner"), booking], [], 1, 2, 3, 4, 5)
booking = Form("trip", Buttons([Button("Plan trip", @ToAssistant("Plan this trip"))]), [FormControl("Destination", Input("destination", "City"))])`;

async function setup(page: Page, endpoint: string, model: string) {
  resetE2eDatabase();
  await page.goto(await setupUrl());
  await page.locator("#name").fill("Recovery Tester");
  await page.locator("#email").fill("recovery@overtchat-test.local");
  await page.locator("#password").fill("test-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/");
  const response = await page.request.post("/api/model-configs", {
    data: {
      label: "OpenUI recovery model",
      providerId: "vllm",
      apiFormat: "auto",
      baseUrl: endpoint,
      model,
      apiKey: "test",
      toolCallingEnabled: true,
      contextWindow: 32768,
      providerOptions: { max_tokens: 8192, temperature: 0 },
      enabled: true,
    },
  });
  expect(response.ok()).toBeTruthy();
  const { modelConfig } = await response.json();
  expect(
    (
      await page.request.put("/api/model-preferences", {
        data: { defaultModelId: modelConfig.id },
      })
    ).ok(),
  ).toBeTruthy();
  await page.reload();
}

async function submit(page: Page, prompt: string) {
  await page
    .getByRole("button", { name: "Add to message", exact: true })
    .click();
  await page.getByRole("menuitemcheckbox", { name: /Interactive UI/ }).click();
  await page.getByRole("combobox").fill(prompt);
  await page.getByRole("button", { name: "Send message", exact: true }).click();
}

async function savedParts(page: Page) {
  const chatId = new URL(page.url()).pathname.split("/").at(-1);
  const response = await page.request.get(
    `/api/chat/${chatId}/messages?openui=1`,
  );
  expect(response.ok()).toBeTruthy();
  const { messages } = await response.json();
  return messages.flatMap((message: { role: string; parts: unknown[] }) =>
    message.role === "assistant" ? message.parts : [],
  ) as {
    type: string;
    state?: string;
    input?: { ui?: string };
    output?: unknown;
  }[];
}

test("a recovered card survives tool completion and reload without a repair call", async ({
  page,
}) => {
  let finish: (() => void) | undefined;
  let modelCalls = 0;
  const provider = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
    if (!body.stream) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
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
    modelCalls += 1;
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const send = (delta: unknown, finishReason: string | null = null) =>
      res.write(
        `data: ${JSON.stringify({
          id: "recovery-stream",
          object: "chat.completion.chunk",
          created: 1,
          model: "recovery-fixture",
          choices: [{ index: 0, delta, finish_reason: finishReason }],
        })}\n\n`,
      );
    send({
      role: "assistant",
      tool_calls: [
        {
          index: 0,
          id: "recovered",
          type: "function",
          function: {
            name: "present_openui",
            arguments: JSON.stringify({
              ui: recoveredCode,
              text: "Choose a destination.",
            }),
          },
        },
      ],
    });
    finish = () => {
      send({}, "tool_calls");
      res.end("data: [DONE]\n\n");
    };
  });
  await new Promise<void>((resolve) =>
    provider.listen(0, "127.0.0.1", resolve),
  );
  try {
    await setup(
      page,
      `http://127.0.0.1:${(provider.address() as AddressInfo).port}/v1`,
      "recovery-fixture",
    );
    await submit(page, "Show a trip planner.");
    const rendered = page.locator("[data-openui-rendered]");
    await expect(rendered).toHaveAttribute("data-openui-streaming", "true");
    await expect(page.getByPlaceholder("City")).toBeVisible();
    await expect(page.getByPlaceholder("City")).toBeDisabled();
    // Keep the same DOM element across completion, not a replacement card.
    await page
      .getByPlaceholder("City")
      .evaluate((input) =>
        input.setAttribute("data-before-completion", "true"),
      );
    expect(finish).toBeDefined();
    finish!();
    await expect(rendered).toHaveAttribute("data-openui-streaming", "false");
    await expect(page.getByPlaceholder("City")).toBeEnabled();
    await expect(page.getByPlaceholder("City")).toHaveAttribute(
      "data-before-completion",
      "true",
    );
    await expect(page.locator("[data-openui-fallback]")).toHaveCount(0);
    await expect(
      page.locator("[data-openui-card]").getByRole("alert"),
    ).toHaveCount(0);
    await expect
      .poll(() => savedParts(page))
      .toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "tool-present_openui",
            state: "output-available",
            input: { ui: recoveredCode, text: "Choose a destination." },
          }),
        ]),
      );
    expect(modelCalls).toBe(1);
    await page.getByPlaceholder("City").fill("Kyoto");
    await page.reload();
    await expect(page.getByText("Trip planner", { exact: true })).toBeVisible();
    await expect(page.getByPlaceholder("City")).toBeEnabled();
    await expect(page.locator("[data-openui-fallback]")).toHaveCount(0);
  } finally {
    provider.closeAllConnections();
    await new Promise<void>((resolve) => provider.close(() => resolve()));
  }
});

test("mobile bundle keeps upstream recovery when streaming finishes", async ({
  page,
}) => {
  await page.goto("/openui/index.html");
  for (const code of [
    recoveredCode,
    'root = Card([TextContent("Kept content", "unsupported"), TextContent(null), ImaginaryWidget("bad"), missing])',
    'root = Card([TextContent("Kept content")',
  ]) {
    const payload = {
      messageId: "a",
      toolCallId: "t",
      code,
      isStreaming: true,
      fallbackText: "Readable fallback.",
      mode: "light" as const,
      canAct: true,
    };
    await page.evaluate(
      (payload) => window.overtchatOpenUI!.render(payload),
      payload,
    );
    const content = page.getByText(
      code === recoveredCode ? "Trip planner" : "Kept content",
      { exact: true },
    );
    await expect(content).toBeVisible();
    await page.evaluate((payload) => window.overtchatOpenUI!.render(payload), {
      ...payload,
      isStreaming: false,
    });
    await expect(page.locator("[data-openui-rendered]")).toHaveAttribute(
      "data-openui-streaming",
      "false",
    );
    await expect(content).toBeVisible();
    await expect(page.locator("[data-openui-fallback]")).toHaveCount(0);
  }
});
