import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { resetE2eDatabase } from "./helpers/database";

const section = (page: Page, title: string) =>
  page.locator("section").filter({
    has: page.getByRole("heading", { name: title, exact: true }),
  });

async function selectProvider(page: Page, title: string, provider: string) {
  await page.getByRole("combobox", { name: `${title} provider` }).click();
  await page.getByRole("option", { name: provider, exact: true }).click();
}

test.beforeEach(async ({ page }) => {
  resetE2eDatabase();
  await page.goto("/signup");
  await page.locator("#name").fill("Speech Tester");
  await page.locator("#email").fill("speech@overtchat-test.local");
  await page.locator("#password").fill("test-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/", { timeout: 15_000 });
  await page.goto("/settings/services");
});

for (const [id, title] of [
  ["tts", "Text-to-speech"],
  ["stt", "Speech-to-text"],
]) {
  test(`${title} tests unsaved values and clears feedback after edits`, async ({
    page,
  }) => {
    const service = section(page, title);
    const button = service.getByRole("button", { name: "Test connection" });
    await selectProvider(page, title, "Disabled");
    await expect(button).toHaveCount(0);
    await selectProvider(page, title, "OpenAI-compatible API");
    await expect(button).toBeDisabled();
    await service.locator(`#${id}-base-url`).fill("http://speech.internal/v1");
    await service.locator(`#${id}-model`).fill("test-model");

    let submitted: unknown;
    await page.route(`**/api/server-capabilities/${id}/test`, async (route) => {
      submitted = route.request().postDataJSON();
      await route.fulfill({ json: { message: "Connection successful." } });
    });
    await button.click();
    await expect(service.getByRole("status")).toHaveText(
      "Connection successful.",
    );
    expect(submitted).toMatchObject({
      provider: "openai-compatible",
      baseUrl: "http://speech.internal/v1",
      model: "test-model",
    });
    await service.locator(`#${id}-model`).fill("another-model");
    await expect(service.getByRole("status")).toHaveCount(0);

    await page.reload();
    await expect(service.locator(`#${id}-model`)).toHaveCount(0);
    await expect(
      section(page, "Web search").getByRole("button", {
        name: "Test connection",
      }),
    ).toHaveCount(0);
  });
}

test("shows failures and ignores results from a draft edited during a test", async ({
  page,
}) => {
  const service = section(page, "Text-to-speech");
  await selectProvider(page, "Text-to-speech", "OpenAI-compatible API");
  await service.locator("#tts-base-url").fill("http://speech.internal/v1");

  let release: () => void = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/server-capabilities/tts/test", async (route) => {
    await pending;
    await route.fulfill({
      status: 502,
      json: { error: "Could not reach the provider." },
    });
  });
  await service.getByRole("button", { name: "Test connection" }).click();
  await expect(
    service.getByRole("button", { name: "Testing…" }),
  ).toBeDisabled();
  await service.locator("#tts-base-url").fill("http://other.internal/v1");
  release();
  await expect(
    service.getByRole("button", { name: "Test connection" }),
  ).toBeEnabled();
  await expect(service.getByRole("alert")).toHaveCount(0);

  await service.getByRole("button", { name: "Test connection" }).click();
  await expect(service.getByRole("alert")).toHaveText(
    "Could not reach the provider.",
  );
  await selectProvider(page, "Text-to-speech", "Disabled");
  await expect(service.getByRole("alert")).toHaveCount(0);
});
