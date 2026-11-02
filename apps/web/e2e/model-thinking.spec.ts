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
            body.chat_template_kwargs?.thinking === false
              ? [1, 2, 3]
              : [1, 2],
        }),
      );
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

async function chooseSelect(page: Page, trigger: string, option: string) {
  await page.locator(trigger).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

test("configures a preset, checks it through tokenize, and sends its fields from the composer", async ({
  page,
}, testInfo) => {
  const id = await createModel(page);
  await page.goto(`/settings/models/${id}`);
  await expect(
    page.getByText(
      "No thinking levels are known for this model. Choose Custom to configure them.",
    ),
  ).toBeVisible();
  await chooseSelect(page, "#p-thinking-mode", "Custom");
  await page.getByRole("button", { name: "thinking", exact: true }).click();
  await page.getByRole("button", { name: "Check with server" }).click();
  await expect(
    page.getByText(
      "Each level renders a distinct prompt. Without thinking fields, the server renders like On.",
    ),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBe(390);
  await page.locator("#p-thinking-requests").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: testInfo.outputPath("thinking-settings.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.waitForURL("**/settings/models");

  const off = await send(page, "off");
  expect(off.chat_template_kwargs).toEqual({ thinking: false });
  expect(off).not.toHaveProperty("reasoning_effort");
  const on = await send(page, "on (default)");
  expect(on.chat_template_kwargs).toEqual({ thinking: true });
});

test("custom effort levels validate, persist, reach chat, and reset to automatic", async ({
  page,
}) => {
  const id = await createModel(page);
  await page.goto(`/settings/models/${id}`);
  await chooseSelect(page, "#p-thinking-mode", "Custom");
  const requests = page.locator("#p-thinking-requests");
  const save = page.getByRole("button", { name: "Save changes" });
  await requests.fill("{");
  await expect(save).toBeDisabled();
  await requests.fill(
    JSON.stringify({
      off: { reasoning_effort: "none" },
      high: { reasoning_effort: "high" },
    }),
  );
  await expect(
    page.getByText("Choose the server's default thinking level."),
  ).toBeVisible();
  await chooseSelect(page, "#p-thinking-default", "High");
  await save.click();
  await page.waitForURL("**/settings/models");

  await page.goto(`/settings/models/${id}`);
  await expect(requests).toContainText('"high"');
  const off = await send(page, "off");
  expect(off.reasoning_effort).toBe("none");
  expect(off).not.toHaveProperty("chat_template_kwargs");

  await page.goto(`/settings/models/${id}`);
  await chooseSelect(page, "#p-thinking-mode", "Automatic");
  await save.click();
  await page.waitForURL("**/settings/models");
  const models = await (await page.request.get("/api/model-configs")).json();
  expect(models.modelConfigs[0].capabilities?.reasoningControls).toBeUndefined();
});

test("reports servers without a template render endpoint", async ({ page }) => {
  unavailable = true;
  const id = await createModel(page);
  await page.goto(`/settings/models/${id}`);
  await chooseSelect(page, "#p-thinking-mode", "Custom");
  await page.getByRole("button", { name: "Check with server" }).click();
  await expect(
    page.getByText(
      "This server has no template render endpoint, so the fields can't be checked without generating.",
    ),
  ).toBeVisible();
});
