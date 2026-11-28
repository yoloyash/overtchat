import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test, type Page } from "@playwright/test";
import {
  openE2eDatabase,
  resetE2eDatabase,
  setupUrl,
} from "./helpers/database";

let server: Server;
let baseUrl: string;

// A gateway's list in the OpenRouter /models shape. What each model accepts
// decides its own tool calling.
const models = [
  { id: "vendor/alpha", context_length: 128_000, supported_parameters: ["tools"] },
  { id: "vendor/beta", context_length: 32_768, supported_parameters: ["temperature"] },
  { id: "vendor/delta", context_length: 8_192 },
  { id: "vendor/gamma", context_length: 200_000, supported_parameters: ["tools"] },
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

/** Opens the add page on the gateway, typing its key or taking the saved one. */
async function openGateway(page: Page, key: "typed" | "saved" = "typed") {
  await page.goto("/settings/models/new");
  await page.locator("#p-provider").click();
  await page.getByRole("option", { name: "OpenRouter", exact: true }).click();
  await page.locator("#p-base-url").fill(baseUrl);
  if (key === "typed") await page.locator("#p-api-key").fill("router-key");
  else
    await page
      .getByRole("group", { name: "Previously used API keys" })
      .getByRole("button")
      .click();
  await expect(page.getByText("4 models fetched")).toBeVisible();
}

function savedModels() {
  const db = openE2eDatabase();
  try {
    return db
      .prepare(
        `SELECT label, model, base_url AS baseUrl, api_key AS apiKey,
                discovered_context_window AS contextWindow,
                tool_calling_enabled AS toolCalling, system_prompt AS systemPrompt
         FROM model_configs ORDER BY sort_order`,
      )
      .all() as {
      label: string;
      model: string;
      baseUrl: string;
      apiKey: string;
      contextWindow: number | null;
      toolCalling: number;
      systemPrompt: string | null;
    }[];
  } finally {
    db.close();
  }
}

test("adds several fetched models at once and marks them as added afterwards", async ({
  page,
}) => {
  await openGateway(page);

  // Nothing is picked for the administrator; one pick is an ordinary add.
  const trigger = page.locator("#p-model");
  await expect(trigger).toContainText("Choose models");
  await expect(page.getByRole("button", { name: "Add model", exact: true })).toBeDisabled();
  await trigger.click();
  await page.getByRole("option", { name: "vendor/gamma" }).click();
  await expect(trigger).toContainText("vendor/gamma");
  await expect(page.locator("#p-label")).toHaveAttribute("placeholder", "gamma");
  await expect(page.getByRole("button", { name: "Add model", exact: true })).toBeEnabled();

  // The list stays open for more picks. Search narrows it, and a pick clears
  // the search for the next one.
  const search = page.getByRole("combobox", { name: "Search models" });
  await search.fill("beta");
  await expect(page.getByRole("option")).toHaveCount(1);
  await search.press("Enter");
  await expect(search).toHaveValue("");
  await page.getByRole("option", { name: "vendor/alpha" }).click();
  await search.press("Escape");
  await expect(trigger).toContainText("3 models selected");

  // Settings that describe one model give way to a note; shared ones stay.
  await expect(page.getByText(/^Adding 3 models with their default name/)).toBeVisible();
  for (const id of ["#p-label", "#p-context-window"])
    await expect(page.locator(id)).toHaveCount(0);
  await expect(page.getByText("Tool calling", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Test connection", { exact: true })).toHaveCount(0);
  await expect(page.locator("#p-system-prompt")).toBeVisible();
  await expect(page.locator("#p-credential-scope")).toBeVisible();

  // A pick can be dropped from the list under the field.
  const picked = page.getByRole("list", { name: "Models to add" });
  await expect(picked.getByRole("listitem")).toHaveText([
    "vendor/gamma",
    "vendor/beta",
    "vendor/alpha",
  ]);
  await picked.getByRole("button", { name: "Remove vendor/gamma" }).click();
  await expect(trigger).toContainText("2 models selected");

  await page.locator("#p-system-prompt").fill("Answer briefly.");
  await page.getByRole("button", { name: "Add 2 models", exact: true }).click();
  await page.waitForURL("**/settings/models");
  await expect(page.getByText("2 models added")).toBeVisible();
  await expect(page.getByText("2 configured")).toBeVisible();

  // Saved in picking order, each with what the gateway reported for it.
  expect(savedModels()).toEqual([
    {
      label: "beta",
      model: "vendor/beta",
      baseUrl,
      apiKey: "router-key",
      contextWindow: 32_768,
      toolCalling: 0,
      systemPrompt: "Answer briefly.",
    },
    {
      label: "alpha",
      model: "vendor/alpha",
      baseUrl,
      apiKey: "router-key",
      contextWindow: 128_000,
      toolCalling: 1,
      systemPrompt: "Answer briefly.",
    },
  ]);

  // Adding more from the same endpoint: the key is offered, and the models
  // already here cannot be picked again.
  await openGateway(page, "saved");
  await trigger.click();
  for (const id of ["vendor/alpha", "vendor/beta"]) {
    const option = page.getByRole("option", { name: id });
    await expect(option).toContainText("Added");
    await expect(option).toBeDisabled();
  }
  await expect(page.getByRole("option", { name: "vendor/delta" })).toBeEnabled();
});

test("adds a typed or pasted list of model IDs", async ({ page }) => {
  await openGateway(page);
  await page.getByRole("button", { name: "Enter manually" }).click();

  const field = page.locator("#p-model");
  await field.fill("vendor/alpha, private/one,private/two , vendor/alpha");
  await expect(
    page.getByText(
      "The endpoint did not return these IDs, so they are kept as typed: private/one, private/two",
    ),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Add 3 models", exact: true })).toBeVisible();

  // The field wraps, and a pasted column of IDs reads the same way.
  await field.fill("private/one\nprivate/two\r\nvendor/delta\n");
  await expect(page.getByRole("button", { name: "Add 3 models", exact: true })).toBeVisible();
  await field.press("Enter");
  await page.waitForURL("**/settings/models");
  expect(
    savedModels().map(({ label, model, contextWindow }) => ({
      label,
      model,
      contextWindow,
    })),
  ).toEqual([
    { label: "one", model: "private/one", contextWindow: null },
    { label: "two", model: "private/two", contextWindow: null },
    { label: "delta", model: "vendor/delta", contextWindow: 8_192 },
  ]);

  // Typing an ID that is already here is allowed, and said.
  await openGateway(page);
  await page.getByRole("button", { name: "Enter manually" }).click();
  await field.fill("private/one");
  await expect(
    page.getByText("Already added: private/one. Adding again makes a second copy."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Add model", exact: true })).toBeEnabled();
});
