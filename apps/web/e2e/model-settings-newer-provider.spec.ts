import { expect, test } from "@playwright/test";
import { resetE2eDatabase, setupUrl } from "./helpers/database";

test.beforeEach(async ({ page }) => {
  resetE2eDatabase();
  await page.goto(await setupUrl());
  await page.locator("#name").fill("Model Admin");
  await page.locator("#email").fill("models@overtchat-test.local");
  await page.locator("#password").fill("test-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/");
});

// The desktop app bundles this UI, so a newer server can return provider IDs
// its catalog predates.
test("lists and opens models from providers the UI does not know", async ({
  page,
}) => {
  const created = await page.request.post("/api/model-configs", {
    data: {
      modelType: "chat",
      label: "Future model",
      providerId: "custom",
      apiFormat: "openai-chat",
      baseUrl: "http://127.0.0.1:9/v1",
      apiKey: null,
      model: "future-model",
      toolCallingEnabled: true,
      enabled: true,
    },
  });
  expect(created.status()).toBe(201);
  const { modelConfig } = (await created.json()) as {
    modelConfig: { id: string };
  };
  await page.route("**/api/model-configs?admin=1", async (route) => {
    const response = await route.fetch();
    const json = (await response.json()) as {
      modelConfigs: Record<string, unknown>[];
    };
    await route.fulfill({
      response,
      json: {
        modelConfigs: json.modelConfigs.map((config) => ({
          ...config,
          providerId: "future-provider",
          apiFormat: "auto",
          displayProvider: "Future AI",
        })),
      },
    });
  });

  await page.goto("/settings/models");
  await expect(
    page.getByText("Future AI", { exact: true }).filter({ visible: true }),
  ).toBeVisible();

  await page.goto(`/settings/models/${modelConfig.id}`);
  await expect(page.locator("#p-provider")).toContainText("Future AI");
  await expect(page.locator("#p-model")).toHaveAttribute(
    "placeholder",
    "model-id",
  );
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(
    page.getByText("Update the app to edit models that use Future AI."),
  ).toBeVisible();
});
