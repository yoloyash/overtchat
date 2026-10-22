import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test, type Page } from "@playwright/test";
import { resetE2eDatabase, setupUrl } from "./helpers/database";

let server: Server;
let baseUrl: string;
let unavailable = false;
let requests: Record<string, unknown>[] = [];

test.beforeAll(async () => {
  server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/v1/models")
      return res.end(JSON.stringify({ data: [{ id: "local-model" }] }));
    if (
      req.url === "/v1/chat/completions/render" ||
      (unavailable && req.url === "/tokenize")
    ) {
      res.statusCode = 404;
      return res.end(JSON.stringify({ detail: "Not Found" }));
    }
    if (req.url === "/tokenize")
      return res.end(
        JSON.stringify({
          tokens:
            body.chat_template_kwargs?.enable_thinking === false
              ? [1, 2, 3]
              : [1, 2],
        }),
      );
    if (req.url === "/detokenize")
      return res.end(JSON.stringify({ prompt: "<assistant>" }));
    if (!body.stream)
      return res.end(
        JSON.stringify({
          id: "title",
          object: "chat.completion",
          created: 1,
          model: "local-model",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "Thinking test" },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
        }),
      );
    requests.push(body);
    res.setHeader("Content-Type", "text/event-stream");
    res.end(
      `data: ${JSON.stringify({ id: "reply", object: "chat.completion.chunk", created: 1, model: "local-model", choices: [{ index: 0, delta: { role: "assistant", content: "Thinking setting received." }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })}\n\ndata: [DONE]\n\n`,
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});

test.afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test.beforeEach(async ({ page }) => {
  resetE2eDatabase();
  requests = [];
  unavailable = false;
  await page.goto(await setupUrl());
  await page.locator("#name").fill("Thinking Tester");
  await page.locator("#email").fill("thinking@overtchat-test.local");
  await page.locator("#password").fill("test-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/");
});

async function createModel(page: Page) {
  const response = await page.request.post("/api/model-configs", {
    data: {
      label: "Local thinking",
      providerId: "vllm",
      apiFormat: "auto",
      baseUrl,
      model: "local-model",
      toolCallingEnabled: false,
    },
  });
  expect(response.ok()).toBe(true);
  return (await response.json()).modelConfig.id as string;
}

async function send(page: Page, level: string) {
  await page.goto("/");
  await page.getByRole("button", { name: /Local thinking, thinking/ }).click();
  await page.getByRole("menuitem", { name: level, exact: true }).click();
  const previous = requests.length;
  await page.getByPlaceholder("Message… or / for commands").fill("Hello");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(
    page.getByText("Thinking setting received.", { exact: true }),
  ).toBeVisible();
  // Title generation can also hit the provider. Inspect the actual chat turn.
  return requests
    .slice(previous)
    .find((body) => JSON.stringify(body.messages).includes('"Hello"'))!;
}

test("detects a toggle through tokenize, saves it, and sends off and server default from the composer", async ({
  page,
}, testInfo) => {
  const id = await createModel(page);
  await page.goto(`/settings/models/${id}`);
  await page.getByRole("button", { name: "Detect again" }).click();
  await expect(
    page.getByText(
      "Thinking controls detected using the server's tokenize endpoint.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: "On / Off", exact: true }),
  ).toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: "Thinking effort high", exact: true }),
  ).not.toBeChecked();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBe(390);
  await page
    .getByLabel("Configuration", { exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: testInfo.outputPath("thinking-settings.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.waitForURL("**/settings/models");
  const off = await send(page, "off");
  expect(off.chat_template_kwargs).toEqual({ enable_thinking: false });
  expect(off).not.toHaveProperty("reasoning_effort");
  const defaults = await send(page, "Server default");
  expect(defaults).not.toHaveProperty("chat_template_kwargs");
  expect(defaults).not.toHaveProperty("reasoning_effort");
});

test("manual effort controls survive detection and reload, reach chat, and can reset to automatic", async ({
  page,
}) => {
  unavailable = true;
  const id = await createModel(page);
  await page.goto(`/settings/models/${id}`);
  await page.getByRole("button", { name: "Detect again" }).click();
  await expect(
    page.getByText(/Couldn't detect thinking controls:/),
  ).toBeVisible();
  await page
    .getByLabel("Configuration", { exact: true })
    .selectOption("custom");
  await page.getByRole("checkbox", { name: "On / Off", exact: true }).check();
  await page
    .getByRole("checkbox", { name: "Thinking effort high", exact: true })
    .check();
  await page
    .getByLabel("Thinking toggle parameter", { exact: true })
    .selectOption("thinking");
  await page
    .getByLabel("Thinking effort parameter", { exact: true })
    .selectOption("chat_template_kwargs.reasoning_effort");
  unavailable = false;
  await page.getByRole("button", { name: "Detect again" }).click();
  await expect(
    page.getByText(
      "Thinking controls detected using the server's tokenize endpoint.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: "Thinking effort high", exact: true }),
  ).toBeChecked();
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.waitForURL("**/settings/models");
  await page.goto(`/settings/models/${id}`);
  await expect(page.getByLabel("Configuration", { exact: true })).toHaveValue(
    "custom",
  );
  await expect(
    page.getByLabel("Thinking effort parameter", { exact: true }),
  ).toHaveValue("chat_template_kwargs.reasoning_effort");
  const saved = (
    await (await page.request.get("/api/model-configs?admin=1")).json()
  ).modelConfigs[0];
  const legacy = { ...saved };
  delete legacy.reasoningOverride;
  expect(
    (
      await page.request.patch(`/api/model-configs/${id}`, { data: legacy })
    ).ok(),
  ).toBe(true);
  const afterLegacy = (
    await (await page.request.get("/api/model-configs?admin=1")).json()
  ).modelConfigs[0];
  expect(afterLegacy.reasoningOverride).toEqual(saved.reasoningOverride);
  const high = await send(page, "high");
  expect(high.chat_template_kwargs).toEqual({
    thinking: true,
    reasoning_effort: "high",
  });
  expect(high).not.toHaveProperty("reasoning_effort");
  await page.goto(`/settings/models/${id}`);
  await page
    .getByLabel("Configuration", { exact: true })
    .selectOption("automatic");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.waitForURL("**/settings/models");
  const models = await (await page.request.get("/api/model-configs")).json();
  expect(models.modelConfigs[0].capabilities.reasoningControls).toMatchObject({
    toggle: true,
    requestMapping: { toggleParameter: "enable_thinking" },
  });
  expect(
    models.modelConfigs[0].capabilities.reasoningControls.efforts,
  ).toBeUndefined();
});

 test("new model setup prefills detected thinking controls before saving", async ({ page }) => {
   await page.goto("/settings/models/new");
   await page.locator("#p-provider").click();
   await page.getByRole("option", { name: "vLLM", exact: true }).click();
   await page.locator("#p-base-url").fill(baseUrl);
   await expect(page.getByText("Thinking controls detected using the server's tokenize endpoint.")).toBeVisible();
   await expect(page.getByRole("checkbox", { name: "On / Off", exact: true })).toBeChecked();
   await page.getByRole("button", { name: "Add model", exact: true }).click();
   await page.waitForURL("**/settings/models");
   const models = (await (await page.request.get("/api/model-configs?admin=1")).json()).modelConfigs;
   expect(models).toHaveLength(1);
   expect(models[0].model).toBe("local-model");
   expect(models[0].reasoningOverride).toBeNull();
   expect(models[0].discoveredCapabilities.reasoningControls.toggle).toBe(true);
 });
