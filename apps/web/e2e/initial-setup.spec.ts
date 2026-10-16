import { expect, test } from "@playwright/test";
import { resetE2eDatabase, setupUrl } from "./helpers/database";

test.beforeEach(resetE2eDatabase);

test("private setup link prefills the code, removes it from the URL, and creates the admin", async ({ page }) => {
  const url = await setupUrl();
  const code = url.split("setup=")[1];
  await page.goto(url);
  await expect(page.getByLabel("Setup code")).toHaveValue(code);
  await expect(page).toHaveURL(/\/signup$/);
  await page.reload();
  await expect(page.getByLabel("Setup code")).toHaveValue("");
  await page.getByLabel("Setup code").fill("WRONG-CODE-0000");
  await page.getByLabel("Name").fill("Setup Owner");
  await page.getByLabel("Email").fill("setup-owner@example.com");
  await page.locator("#password").fill("setup-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Setup code is incorrect or setup is already complete.")).toBeVisible();
  await page.getByLabel("Setup code").fill(code.toLowerCase());
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/");
  const session = await page.request.get("/api/auth/get-session");
  expect((await session.json()).user.role).toBe("admin");
  expect(await (await page.request.get("/api/setup")).json()).toEqual({ required: false });
  await page.context().clearCookies();
  await page.goto(url);
  await expect(page).toHaveURL(/\/login$/);
});

test("regular entry opens setup with manual code instructions", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/signup$/);
  await expect(page.getByLabel("Setup code")).toHaveValue("");
  await expect(page.getByText(/run overtchat status on the server/)).toBeVisible();
});
