import { expect, test } from "@playwright/test";
import { openE2eDatabase, resetE2eDatabase } from "./helpers/database";

function seedModelConfig() {
  const db = openE2eDatabase();
  const now = Date.now();
  try {
    db.prepare(
      `INSERT INTO model_configs
        (id, label, base_url, api_key, model, system_prompt, extra_body, enabled, sort_order, created_at, updated_at)
       VALUES
        (@id, @label, @baseUrl, @apiKey, @model, NULL, NULL, 1, 0, @now, @now)`,
    ).run({
      id: "motion-model",
      label: "Local Motion Model",
      baseUrl: "https://example.invalid/v1",
      apiKey: "test-key",
      model: "motion-test-model",
      now,
    });
  } finally {
    db.close();
  }
}

test.beforeEach(resetE2eDatabase);

test("motion primitives respect the reduced-motion preference", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/signup");

  const submit = page.getByRole("button", { name: "Create account" });
  await expect(submit).toBeVisible();
  expect(
    await submit.evaluate((element) => getComputedStyle(element).transitionDuration),
  ).not.toBe("0s");

  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect
    .poll(() =>
      submit.evaluate((element) => getComputedStyle(element).transitionDuration),
    )
    .toBe("0s");
});

test("interactive surfaces remain usable with reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });

  await test.step("admin signup", async () => {
    await page.goto("/signup");
    await page.locator("#name").fill("Motion Admin");
    await page.locator("#email").fill("motion-admin@overtchat-test.local");
    await page.locator("#password").fill("test-password-123");
    await page.getByRole("button", { name: "Create account" }).click();
    await page.waitForURL("**/", { timeout: 15000 });
    seedModelConfig();
    await page.reload();
  });

  await test.step("model picker and command palette", async () => {
    await page.getByRole("button", { name: /Local Motion Model/ }).click();
    await expect(page.getByRole("menu")).toContainText("Local Motion Model");
    await page.keyboard.press("Escape");

    await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K");
    await expect(page.getByRole("dialog", { name: "Search chats" })).toBeVisible();
    await page.getByRole("button", { name: "Close" }).click();
    await expect(page.getByRole("dialog", { name: "Search chats" })).toBeHidden();
  });

  await test.step("project dialog and navigation", async () => {
    await page.getByRole("button", { name: "New project" }).click();
    await expect(page.getByRole("dialog", { name: "New project" })).toBeVisible();
    await page.locator("#project-name").fill("Motion Project");
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await page.waitForURL("**/projects/**");
    await expect(page.getByRole("heading", { name: "Instructions" })).toBeVisible();
  });

  await test.step("settings links, add-user dialog, and alert dialog", async () => {
    await page.goto("/");
    await page.getByText("Motion Admin").click();
    await page.getByRole("menuitem", { name: "Settings" }).click();
    await page.waitForURL("**/settings");

    await page.getByRole("link", { name: /Users/ }).click();
    await page.waitForURL("**/settings/users");
    await page.getByRole("button", { name: "Add user" }).click();
    await expect(page.getByRole("dialog", { name: "Add user" })).toBeVisible();
    await page.locator("#new-name").fill("Motion Guest");
    await page.locator("#new-email").fill("motion-guest@overtchat-test.local");
    await page.locator("#new-password").fill("test-password-123");
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expect(
      page.getByRole("cell", { name: "motion-guest@overtchat-test.local" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByRole("alertdialog", { name: "Delete user?" })).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("alertdialog", { name: "Delete user?" })).toBeHidden();
  });

  await test.step("mobile drawer opens under reduced motion", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await page.getByLabel("Open sidebar").click();
    await expect(page.getByRole("button", { name: "New project" })).toBeVisible();
  });

  await test.step("logout and auth redirect", async () => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/");
    await page.getByText("Motion Admin").click();
    await page.getByRole("menuitem", { name: "Log out" }).click();
    await page.waitForURL("**/login", { timeout: 15000 });
    await expect(page.locator("h1")).toContainText("Welcome back");

    await page.goto("/");
    await page.waitForURL("**/login", { timeout: 15000 });
  });
});
