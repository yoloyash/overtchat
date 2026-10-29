import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test } from "@playwright/test";
import { resetE2eDatabase, setupUrl } from "./helpers/database";

let server: Server;
let baseUrl: string;

// A gateway-sized list in the OpenRouter /models shape.
const models = [
  ...Array.from({ length: 60 }, (_, index) => ({
    id: `vendor/model-${String(index).padStart(2, "0")}`,
    context_length: 32_768,
  })),
  {
    id: "anthropic/claude-haiku-4.5",
    context_length: 200_000,
    architecture: { input_modalities: ["text", "image"] },
    top_provider: { max_completion_tokens: 64_000 },
    supported_parameters: ["tools", "reasoning"],
  },
];

test.beforeAll(async () => {
  server = createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/api/v1/models") return res.end(JSON.stringify({ data: models }));
    res.statusCode = 404;
    res.end(JSON.stringify({ error: { message: "Not found" } }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
});

test.afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test.beforeEach(async ({ page }) => {
  resetE2eDatabase();
  await page.goto(await setupUrl());
  await page.locator("#name").fill("Model Admin");
  await page.locator("#email").fill("models@overtchat-test.local");
  await page.locator("#password").fill("test-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/");
});

test("searches a long fetched model list and keeps OpenRouter away from older clients", async ({
  page,
}) => {
  await page.goto("/settings/models/new");
  await page.locator("#p-provider").click();
  await page.getByRole("option", { name: "OpenRouter", exact: true }).click();
  await expect(page.locator("#p-base-url")).toHaveValue(
    "https://openrouter.ai/api/v1",
  );
  await page.locator("#p-base-url").fill(baseUrl);
  await page.locator("#p-api-key").fill("router-key");

  // Discovery selects the first model; search narrows the long list.
  const trigger = page.locator("#p-model");
  await expect(trigger).toContainText("anthropic/claude-haiku-4.5");
  await trigger.click();
  const search = page.getByRole("combobox", { name: "Search models" });
  await expect(search).toBeFocused();
  await expect(page.getByRole("option")).toHaveCount(models.length);
  await search.fill("MODEL-42");
  await expect(page.getByRole("option")).toHaveCount(1);
  await search.press("Enter");
  await expect(trigger).toContainText("vendor/model-42");

  // Reopening right away starts a new search.
  await trigger.click();
  await expect(search).toHaveValue("");
  await expect(page.getByRole("option")).toHaveCount(models.length);
  await search.fill("no such model");
  await expect(page.getByText("No matching models.")).toBeVisible();
  await search.press("Escape");

  await page.getByRole("button", { name: "Add model" }).click();
  await page.waitForURL("**/settings/models");
  await expect(
    page.getByText("OpenRouter", { exact: true }).filter({ visible: true }),
  ).toBeVisible();

  // Released clients without the header get the compatible custom view.
  const legacy = await (
    await page.request.get("/api/model-configs?admin=1")
  ).json();
  expect(legacy.modelConfigs[0]).toMatchObject({
    providerId: "custom",
    apiFormat: "openai-chat",
    displayProvider: "OpenRouter",
    model: "vendor/model-42",
    discoveredContextWindow: 32_768,
  });
  const current = await (
    await page.request.get("/api/model-configs?admin=1", {
      headers: { "X-OvertChat-Client": "mobile/test" },
    })
  ).json();
  expect(current.modelConfigs[0]).toMatchObject({
    providerId: "openrouter",
    apiFormat: "auto",
  });
});
