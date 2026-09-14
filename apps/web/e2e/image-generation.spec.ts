import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test } from "@playwright/test";
import { openE2eDatabase, resetE2eDatabase } from "./helpers/database";

const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=";
let provider: Server;
let baseUrl: string;
let failure = false;
let hold = false;
let chatFailure = false;
const requests: Array<{ url: string; body: string; contentType: string }> = [];
const chatRequests: Array<Record<string, unknown>> = [];

test.beforeAll(async () => {
  provider = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks).toString();
    if (req.url?.includes("/images/")) {
      requests.push({
        url: req.url,
        body,
        contentType: String(req.headers["content-type"]),
      });
      if (hold) return; // The client must abort this operation when Stop is pressed.
      res.writeHead(failure ? 503 : 200, {
        "Content-Type": "application/json",
      });
      res.end(
        JSON.stringify(
          failure
            ? {
                error: {
                  message: "Image provider is unavailable",
                  type: "server_error",
                },
              }
            : {
                data: [{ b64_json: png }],
                usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 },
              },
        ),
      );
      return;
    }
    if (req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: "gpt-image-1" }] }));
      return;
    }
    if (req.url?.includes(":generateContent")) {
      requests.push({
        url: req.url,
        body,
        contentType: String(req.headers["content-type"]),
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          candidates: [
            {
              content: {
                role: "model",
                parts: [{ inlineData: { mimeType: "image/png", data: png } }],
              },
              finishReason: "STOP",
            },
          ],
          usageMetadata: {
            promptTokenCount: 1,
            candidatesTokenCount: 2,
            totalTokenCount: 3,
          },
        }),
      );
      return;
    }
    const payload = JSON.parse(body);
    if (!payload.stream) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          id: "title",
          object: "chat.completion",
          created: 1,
          model: "image-test-chat",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "Kite images" },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      );
      return;
    }
    chatRequests.push(payload);
    const lastUser = payload.messages
      .filter((message: { role: string }) => message.role === "user")
      .at(-1);
    const userText =
      typeof lastUser.content === "string"
        ? lastUser.content
        : lastUser.content
            .filter((part: { type: string }) => part.type === "text")
            .map((part: { text: string }) => part.text)
            .join("\n");
    const afterTool = payload.messages.at(-1).role === "tool";
    const edit = /make.*blue/i.test(userText);
    const referenceText: string = payload.messages
      .filter((message: { role: string }) => message.role === "tool")
      .map((message: { content: string }) => message.content)
      .join("\n");
    const reference =
      /"id":"([a-zA-Z0-9_-]+)"/.exec(userText)?.[1] ??
      Array.from(referenceText.matchAll(/"id":"([a-zA-Z0-9_-]+)"/g)).at(
        -1,
      )?.[1];
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const event = (delta: unknown, finish: string | null) =>
      res.write(
        `data: ${JSON.stringify({ id: "image-test", object: "chat.completion.chunk", created: 1, model: "image-test-chat", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`,
      );
    if (afterTool && chatFailure) {
      res.end(
        `data: ${JSON.stringify({ error: { message: "Chat model failed after image creation", type: "server_error" } })}\n\ndata: [DONE]\n\n`,
      );
      return;
    }
    if (
      afterTool ||
      !payload.tools?.some(
        (tool: { function?: { name?: string } }) =>
          tool.function?.name === "generate_image",
      )
    ) {
      event({ role: "assistant", content: "Done." }, null);
      event({}, "stop");
    } else {
      event(
        {
          role: "assistant",
          tool_calls: [
            {
              index: 0,
              id: `image-${chatRequests.length}`,
              type: "function",
              function: {
                name: edit ? "edit_image" : "generate_image",
                arguments: JSON.stringify({
                  prompt: edit ? "Make the kite blue" : "A red kite",
                  ...(edit ? { image_ids: [reference] } : {}),
                }),
              },
            },
          ],
        },
        null,
      );
      event({}, "tool_calls");
    }
    res.end("data: [DONE]\n\n");
  });
  await new Promise<void>((resolve) =>
    provider.listen(0, "127.0.0.1", resolve),
  );
  baseUrl = `http://127.0.0.1:${(provider.address() as AddressInfo).port}/v1`;
});

test.afterAll(async () => {
  provider.closeAllConnections();
  await new Promise<void>((resolve) => provider.close(() => resolve()));
});

test.beforeEach(async ({ page }) => {
  resetE2eDatabase();
  requests.length = 0;
  chatRequests.length = 0;
  failure = false;
  hold = false;
  chatFailure = false;
  await page.goto("/signup");
  await page.locator("#name").fill("Image Admin");
  await page.locator("#email").fill("image@overtchat-test.local");
  await page.locator("#password").fill("test-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/");
  const model = await page.request.post("/api/model-configs", {
    data: {
      label: "Image test chat",
      providerId: "custom",
      apiFormat: "openai-chat",
      baseUrl,
      model: "image-test-chat",
      toolCallingEnabled: true,
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
  await page.goto("/settings/models/new");
  await page.locator("#p-model-type").click();
  await page.getByRole("option", { name: "Image", exact: true }).click();
  await page.locator("#p-base-url").fill(baseUrl);
  await page.locator("#p-model").fill("gpt-image-1");
  await page.locator("#p-api-key").fill("private-image-key");
  await page.locator("#p-label").fill("OpenAI pictures");
  const save = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/model-configs") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Add model", exact: true }).click();
  expect((await save).ok()).toBeTruthy();
  await page.goto("/");
});

test("creates, persists, downloads and edits images with a text-only chat model", async ({
  page,
  playwright,
}) => {
  const publicConfig = await (
    await page.request.get("/api/capabilities")
  ).json();
  expect(publicConfig.capabilities.images).toEqual({
    available: true,
    model: "gpt-image-1",
    supportsQuality: true,
  });
  expect(JSON.stringify(publicConfig)).not.toContain("private-image-key");
  await page
    .getByRole("button", { name: "Add to message", exact: true })
    .click();
  await page.getByRole("menuitem", { name: /Create image/ }).click();
  await page
    .getByLabel("Image size", { exact: true })
    .selectOption("1536x1024");
  await page.getByLabel("Image quality", { exact: true }).selectOption("low");
  await page.locator("textarea").fill("A red kite");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.locator("[data-image-generation] img")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Edit / Use as reference" }),
  ).toBeEnabled();
  expect(requests).toHaveLength(1);
  expect(JSON.parse(requests[0].body)).toMatchObject({
    model: "gpt-image-1",
    size: "1536x1024",
    quality: "low",
    n: 1,
  });
  expect(chatRequests[0].tool_choice).toBe("auto");
  expect(JSON.stringify(chatRequests[0].messages)).toContain(
    "The user selected Create image for this turn.",
  );
  await expect(
    page
      .locator("[data-image-generation]")
      .getByRole("button", { name: /Retry|Try again/ }),
  ).toHaveCount(0);
  const imageUrl = (await page
    .locator("[data-image-generation] img")
    .getAttribute("src"))!;
  expect(await (await page.request.get(imageUrl)).body()).toEqual(
    Buffer.from(png, "base64"),
  );
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download", exact: true }).click();
  expect((await download).suggestedFilename()).toBe("generated-image.png");
  await page.reload();
  await expect(page.locator("[data-image-generation] img")).toHaveAttribute(
    "src",
    imageUrl,
  );
  const library = await (await page.request.get("/api/library")).json();
  expect(JSON.stringify(library)).toContain(imageUrl);
  await page.getByRole("button", { name: "Edit / Use as reference" }).click();
  await page.locator("textarea").fill("Make it blue");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.locator("[data-image-generation] img")).toHaveCount(2);
  expect(requests).toHaveLength(2);
  expect(requests[1].url).toBe("/v1/images/edits");
  expect(requests[1].contentType).toContain("multipart/form-data");
  expect(requests[1].body).toContain("Make the kite blue");
  expect(JSON.stringify(chatRequests)).not.toContain("data:image/");
  expect(JSON.stringify(chatRequests)).not.toContain("private-image-key");
  await expect(
    page.getByRole("button", { name: "Edit / Use as reference" }).last(),
  ).toBeEnabled();
  // References from tool history remain usable without attaching the image again.
  await page.locator("textarea").fill("Make it blue again");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect.poll(() => requests.length).toBe(3);
  await expect(
    page.getByRole("button", { name: "Edit / Use as reference" }).last(),
  ).toBeEnabled();
  expect(requests[2].url).toBe("/v1/images/edits");
  await page.screenshot({
    path: "/tmp/overtchat-images-chat.png",
    fullPage: true,
  });

  const anonymous = await playwright.request.newContext();
  try {
    expect(
      (await anonymous.get(new URL(imageUrl, page.url()).href)).status(),
    ).toBe(401);
  } finally {
    await anonymous.dispose();
  }
  const db = openE2eDatabase();
  let owner: string;
  try {
    owner = (
      db
        .prepare("SELECT user_id FROM uploads WHERE id = ?")
        .get(imageUrl.split("/").at(-1)) as { user_id: string }
    ).user_id;
    // An authenticated user still cannot read another owner's image.
    db.pragma("foreign_keys = OFF");
    db.prepare("UPDATE uploads SET user_id = 'another-user' WHERE id = ?").run(
      imageUrl.split("/").at(-1),
    );
  } finally {
    db.close();
  }
  expect((await page.request.get(imageUrl)).status()).toBe(404);
  const restore = openE2eDatabase();
  try {
    restore
      .prepare("UPDATE uploads SET user_id = ? WHERE id = ?")
      .run(owner, imageUrl.split("/").at(-1));
  } finally {
    restore.close();
  }
});

test("shows provider failure without automatic retries and preserves settings on reply regeneration", async ({
  page,
}) => {
  failure = true;
  await page
    .getByRole("button", { name: "Add to message", exact: true })
    .click();
  await page.getByRole("menuitem", { name: /Create image/ }).click();
  await page.getByLabel("Image quality", { exact: true }).selectOption("low");
  await page.locator("textarea").fill("A red kite");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(
    page.getByText("Image provider is unavailable", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Regenerate", exact: true }),
  ).toBeEnabled();
  await expect(
    page
      .locator("[data-image-generation]")
      .getByRole("button", { name: /Retry|Try again/ }),
  ).toHaveCount(0);
  expect(requests).toHaveLength(1);
  failure = false;
  await page.reload();
  await page.getByRole("button", { name: "Regenerate", exact: true }).click();
  await expect(page.locator("[data-image-generation] img")).toBeVisible();
  expect(requests).toHaveLength(2);
  expect(JSON.parse(requests[1].body).quality).toBe("low");
  expect(chatRequests.at(-1)?.tool_choice).toBe("auto");
});

test("stops an image operation without generating another image", async ({
  page,
}) => {
  hold = true;
  await page.locator("textarea").fill("Generate an image of a red kite");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect.poll(() => requests.length).toBe(1);
  await expect(
    page.getByText("Creating image…", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Stop generating", exact: true })
    .click();
  await expect(
    page.getByText(/Image generation stopped/).first(),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText(/Image generation stopped/).first(),
  ).toBeVisible();
  expect(requests).toHaveLength(1);
});

test("retains a completed image when the subsequent chat model step fails", async ({
  page,
}) => {
  chatFailure = true;
  await page.locator("textarea").fill("Generate an image of a red kite");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.locator("[data-image-generation] img")).toBeVisible();
  await expect(
    page.getByText(/Chat model failed after image creation/).first(),
  ).toBeVisible();
  await page.reload();
  await expect(page.locator("[data-image-generation] img")).toBeVisible();
  expect(requests).toHaveLength(1);
});

test("deduplicates a repeated chat start and keeps temporary images out of saved chats", async ({
  page,
}) => {
  const configs = await (await page.request.get("/api/model-configs")).json();
  const request = {
    chatId: "image-idempotency",
    clientRequestId: "image-intent",
    modelConfigId: configs.modelConfigs[0].id,
    messages: [
      {
        id: "image-user",
        role: "user",
        parts: [{ type: "text", text: "Generate a kite" }],
      },
    ],
    action: { type: "submit" },
    imageGeneration: { size: "auto", quality: "auto" },
  };
  expect((await page.request.post("/api/chat", { data: request })).ok()).toBe(
    true,
  );
  expect(requests).toHaveLength(1);
  const repeated = await page.request.post("/api/chat", { data: request });
  expect(repeated.status()).toBe(409);
  expect(await repeated.text()).toBe(
    "Generation request was already completed",
  );
  expect(requests).toHaveLength(1);
  const temporary = await page.request.post("/api/chat", {
    data: {
      ...request,
      chatId: "image-temporary",
      clientRequestId: "temporary-intent",
      temporary: true,
    },
  });
  expect(temporary.ok()).toBe(true);
  expect(await temporary.text()).toContain("tool-output-available");
  expect(requests).toHaveLength(2);
  const db = openE2eDatabase();
  try {
    expect(
      db.prepare("SELECT id FROM chats WHERE id = 'image-temporary'").get(),
    ).toBeUndefined();
    expect(
      db
        .prepare(
          "SELECT id FROM chat_generations WHERE chat_id = 'image-temporary'",
        )
        .get(),
    ).toBeUndefined();
  } finally {
    db.close();
  }
});

test("switches OpenAI to Gemini in Models, edits images, and removes tools when disabled", async ({
  page,
}) => {
  const publicModels = (
    await (await page.request.get("/api/model-configs")).json()
  ).modelConfigs;
  expect(publicModels).toHaveLength(1);
  expect(publicModels[0].label).toBe("Image test chat");
  await page.goto("/settings/services");
  await expect(
    page.getByRole("heading", { name: "Images", exact: true }),
  ).toHaveCount(0);
  await page.goto("/settings/models/new");
  await page.locator("#p-model-type").click();
  await page.getByRole("option", { name: "Image", exact: true }).click();
  await page.locator("#p-provider").click();
  await expect(
    page.getByRole("option", { name: "Anthropic", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("option", { name: "Google Gemini", exact: true })
    .click();
  await expect(page.locator("#p-base-url")).toHaveValue(
    "https://generativelanguage.googleapis.com/v1beta",
  );
  await page.locator("#p-base-url").fill(baseUrl);
  await page.locator("#p-model").fill("studio-art");
  await page.locator("#p-api-key").fill("google-image-key");
  await page.locator("#p-label").fill("Gemini pictures");
  await expect(page.getByText("Tool calling", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Test connection", { exact: true })).toHaveCount(
    0,
  );
  await page.screenshot({
    path: "/tmp/overtchat-image-model-editor.png",
    fullPage: true,
  });
  const saveGoogle = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/model-configs") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Add model", exact: true }).click();
  const created = await saveGoogle;
  expect(created.ok()).toBe(true);
  const google = (await created.json()).modelConfig;
  const adminModels = (
    await (await page.request.get("/api/model-configs?admin=1")).json()
  ).modelConfigs;
  expect(
    adminModels
      .filter(
        (model: { modelType: string; enabled: boolean }) =>
          model.modelType === "image" && model.enabled,
      )
      .map((model: { id: string }) => model.id),
  ).toEqual([google.id]);
  expect(
    (
      await page.request.put("/api/model-configs/task-model", {
        data: { modelConfigId: google.id },
      })
    ).status(),
  ).toBe(404);
  expect(
    (
      await page.request.post(`/api/model-configs/${google.id}/health`)
    ).status(),
  ).toBe(400);
  expect(
    (
      await page.request.post("/api/chat", {
        data: {
          modelConfigId: google.id,
          chatId: "invalid-image-chat",
          clientRequestId: "invalid-image-intent",
          action: { type: "submit" },
          messages: [
            {
              id: "user",
              role: "user",
              parts: [{ type: "text", text: "Hello" }],
            },
          ],
        },
      })
    ).status(),
  ).toBe(404);
  await page.goto("/settings/models");
  await expect(
    page.getByRole("switch", { name: "Enable OpenAI pictures", exact: true }),
  ).not.toBeChecked();
  await page.getByRole("combobox", { name: "Task model" }).click();
  await expect(
    page.getByRole("option", { name: "Gemini pictures" }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.goto("/");
  await page
    .getByRole("button", { name: "Add to message", exact: true })
    .click();
  await page.getByRole("menuitem", { name: /Create image/ }).click();
  await expect(page.getByLabel("Image quality", { exact: true })).toHaveCount(
    0,
  );
  await page
    .getByLabel("Image size", { exact: true })
    .selectOption("1536x1024");
  await page.locator("textarea").fill("A red kite");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.locator("[data-image-generation] img")).toBeVisible();
  expect(requests[0].url).toBe("/v1/models/studio-art:generateContent");
  await page.locator("[data-image-generation] summary").click();
  await expect(page.locator("[data-image-generation]")).toContainText(
    "Requested format: Landscape (3:2)",
  );
  await expect(page.locator("[data-image-generation]")).not.toContainText(
    "1536x1024",
  );
  expect(
    JSON.parse(requests[0].body).generationConfig.imageConfig.aspectRatio,
  ).toBe("3:2");
  await expect(
    page.getByRole("button", { name: "Stop generating", exact: true }),
  ).toHaveCount(0);
  await page.locator("textarea").fill("Make it blue");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.locator("[data-image-generation] img")).toHaveCount(2);
  expect(JSON.parse(requests[1].body).contents[0].parts).toContainEqual({
    inlineData: { mimeType: "image/png", data: png },
  });
  await expect(
    page.getByRole("button", { name: "Stop generating", exact: true }),
  ).toHaveCount(0);
  const chatUrl = page.url();
  await page.goto("/settings/models");
  const disabled = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/model-configs/${google.id}`) &&
      response.request().method() === "PATCH",
  );
  await page
    .getByRole("switch", { name: "Disable Gemini pictures", exact: true })
    .click();
  expect((await disabled).ok()).toBe(true);
  await page.goto(chatUrl);
  await expect(page.locator("[data-image-generation] img")).toHaveCount(2);
  await page
    .getByRole("button", { name: "Add to message", exact: true })
    .click();
  await expect(
    page.getByRole("menuitem", { name: /Create image/ }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  const requestCount = chatRequests.length;
  await page.locator("textarea").fill("Hello again");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Stop generating", exact: true }),
  ).toHaveCount(0);
  await expect.poll(() => chatRequests.length).toBeGreaterThan(requestCount);
  await expect
    .poll(() => chatRequests.at(-1)?.tools ?? [])
    .not.toContainEqual(
      expect.objectContaining({
        function: expect.objectContaining({ name: "generate_image" }),
      }),
    );
  expect(requests).toHaveLength(2);
});
