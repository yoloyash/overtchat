import { expect, type Page } from "@playwright/test";

export const E2E_ADMIN = {
  name: "E2E Tester",
  email: "test-admin@overtchat-test.local",
  password: "test-password-123",
};

export async function ensureAdminSession(page: Page) {
  await page.goto("/signup");

  if (page.url().endsWith("/")) return;

  if (page.url().includes("/signup")) {
    await expect(page.locator("h1")).toContainText("Create the first account");
    await page.locator("#name").fill(E2E_ADMIN.name);
    await page.locator("#email").fill(E2E_ADMIN.email);
    await page.locator("#password").fill(E2E_ADMIN.password);
    await page.getByRole("button", { name: "Create account" }).click();
    await page.waitForURL("**/", { timeout: 15000 });
    return;
  }

  await expect(page.locator("h1")).toContainText("Welcome back");
  await page.locator("#email").fill(E2E_ADMIN.email);
  await page.locator("#password").fill(E2E_ADMIN.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/", { timeout: 15000 });
}
