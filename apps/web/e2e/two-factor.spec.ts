import { base32 } from "@better-auth/utils/base32";
import { createOTP } from "@better-auth/utils/otp";
import { expect, test, type Page } from "@playwright/test";
import { resetE2eDatabase, setupUrl } from "./helpers/database";

test.beforeEach(resetE2eDatabase);

const email = "two-factor-admin@overtchat-test.local";
const password = "test-password-123";

function codeFor(manualKey: string) {
  const secret = base32.decode(manualKey.replace(/\s/g, ""));
  return createOTP(new TextDecoder().decode(secret)).totp();
}

async function signInWithPassword(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(
    page.getByRole("heading", { name: "Two-factor authentication" }),
  ).toBeVisible();
}

test("set up an authenticator, then sign in with a code or a backup code", async ({
  browser,
  page,
}, testInfo) => {
  await page.goto(await setupUrl());
  await page.getByLabel("Name").fill("Two-factor Admin");
  await page.getByLabel("Email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/");

  await page.goto("/settings/account");
  await page.getByRole("button", { name: "Set up" }).click();
  await page.getByLabel("Confirm your password").fill(password);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByLabel("Authenticator setup code")).toBeVisible();
  const manualKey = (await page.locator("code.select-all").textContent()) ?? "";
  await page.getByLabel("Enter the 6-digit code").fill("000000");
  await page.getByRole("button", { name: "Turn on two-factor" }).click();
  await expect(page.getByText("That code didn't work")).toBeVisible();
  await page.getByLabel("Enter the 6-digit code").fill(await codeFor(manualKey));
  await page.getByRole("button", { name: "Turn on two-factor" }).click();
  const codes = page.getByRole("list", { name: "Backup codes" }).getByRole("listitem");
  await expect(codes).toHaveCount(10);
  const backupCode = (await codes.first().textContent()) ?? "";
  await page.getByRole("button", { name: "I saved them" }).click();
  await expect(page.getByRole("button", { name: "New backup codes" })).toBeVisible();

  await page.goto("/settings/users");
  await expect(
    page.getByRole("row", { name: new RegExp(email) }).getByRole("cell", { name: "On", exact: true }),
  ).toBeVisible();

  const totpContext = await browser.newContext({ baseURL: testInfo.project.use.baseURL });
  try {
    const totpPage = await totpContext.newPage();
    await signInWithPassword(totpPage);
    await totpPage.getByLabel("Authentication code").fill(await codeFor(manualKey));
    await totpPage.getByRole("button", { name: "Verify" }).click();
    await totpPage.waitForURL((url) => url.pathname === "/");
  } finally {
    await totpContext.close();
  }

  const backupContext = await browser.newContext({ baseURL: testInfo.project.use.baseURL });
  try {
    const backupPage = await backupContext.newPage();
    await signInWithPassword(backupPage);
    await backupPage.getByRole("button", { name: "Use a backup code" }).click();
    await backupPage.getByLabel("Backup code").fill(backupCode);
    await backupPage.getByRole("button", { name: "Verify" }).click();
    await backupPage.waitForURL((url) => url.pathname === "/");
  } finally {
    await backupContext.close();
  }
});

test("suggests two-factor once after sign-in and opens setup", async ({
  browser,
}, testInfo) => {
  // A browser that hasn't seen the prompt yet.
  const context = await browser.newContext({
    baseURL: testInfo.project.use.baseURL,
    storageState: { cookies: [], origins: [] },
  });
  try {
    const page = await context.newPage();
    await page.goto(await setupUrl());
    await page.getByLabel("Name").fill("Prompted Admin");
    await page.getByLabel("Email").fill(email);
    await page.locator("#password").fill(password);
    await page.getByRole("button", { name: "Create account" }).click();
    const prompt = page.getByRole("dialog", { name: "Protect your account" });
    await expect(prompt).toBeVisible();
    await prompt.getByRole("button", { name: "Set up two-factor" }).click();
    await page.waitForURL("**/settings/account?setup=two-factor");
    await expect(page.getByLabel("Confirm your password")).toBeVisible();

    // Shown once: it stays away after the next load.
    await page.goto("/");
    await expect(page.getByRole("link", { name: /New chat/ })).toBeVisible();
    await expect(prompt).toBeHidden();
  } finally {
    await context.close();
  }
});
