import { expect, test } from "@playwright/test";
import { openE2eDatabase, resetE2eDatabase } from "./helpers/database";

test.beforeEach(resetE2eDatabase);

test("recover a forgotten password from Users and explain recovery on login", async ({
  browser,
  page,
}, testInfo) => {
  await page.goto("/signup");
  await page.getByLabel("Name").fill("Recovery Admin");
  await page.getByLabel("Email").fill("recovery-admin@overtchat-test.local");
  await page.locator("#password").fill("test-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/");
  const created = await page.request.post("/api/auth/admin/create-user", {
    headers: {
      Origin: String(testInfo.project.use.baseURL),
    },
    data: {
      email: "recovery-member@overtchat-test.local",
      name: "Recovery Member",
      password: "test-password-123",
      role: "user",
    },
  });
  expect(created.status(), await created.text()).toBe(200);

  const memberContext = await browser.newContext({
    baseURL: testInfo.project.use.baseURL,
  });
  try {
    const memberPage = await memberContext.newPage();
    await memberPage.goto("/login");
    await memberPage.getByRole("button", { name: "Forgot password?" }).click();
    await expect(memberPage.locator("#password-recovery-help")).toContainText(
      "overtchat reset-password",
    );
    await expect(memberPage.locator("#password-recovery-help")).toContainText(
      "Contact your server administrator",
    );
    await memberPage
      .getByLabel("Email")
      .fill("recovery-member@overtchat-test.local");
    await memberPage.locator("#password").fill("test-password-123");
    await memberPage.getByRole("button", { name: "Sign in" }).click();
    await memberPage.waitForURL("**/");

    await page.goto("/settings/users");
    const row = page
      .getByRole("row")
      .filter({ hasText: "recovery-member@overtchat-test.local" });
    await row.getByRole("button", { name: "Reset password" }).click();
    const dialog = page.getByRole("dialog", { name: "Reset password" });
    await dialog.getByLabel("Your current password").fill("wrong-password");
    await dialog
      .getByLabel("Replacement password", { exact: true })
      .fill("replacement-password-456");
    await dialog
      .getByLabel("Confirm replacement password")
      .fill("different-password-456");
    await dialog.getByRole("button", { name: "Reset password" }).click();
    await expect(dialog).toContainText(
      "The replacement passwords do not match.",
    );
    await dialog
      .getByLabel("Confirm replacement password")
      .fill("replacement-password-456");
    await dialog.getByRole("button", { name: "Reset password" }).click();
    await expect(dialog).toContainText("Your current password is incorrect.");
    expect(
      await (await memberContext.request.get("/api/auth/get-session")).json(),
    ).toMatchObject({
      user: { email: "recovery-member@overtchat-test.local" },
    });

    await dialog.getByLabel("Your current password").fill("test-password-123");
    await dialog.getByRole("button", { name: "Reset password" }).click();
    await expect(dialog).not.toBeVisible();
    await expect(
      page.getByText("Password reset", { exact: true }),
    ).toBeVisible();
    expect(
      await (await memberContext.request.get("/api/auth/get-session")).json(),
    ).toBeNull();
    await memberPage.goto("/login");
    await memberPage
      .getByLabel("Email")
      .fill("recovery-member@overtchat-test.local");
    await memberPage.locator("#password").fill("test-password-123");
    await memberPage.getByRole("button", { name: "Sign in" }).click();
    await expect(memberPage).toHaveURL(/\/login$/u);
    await expect(
      memberPage.getByText("Invalid email or password"),
    ).toBeVisible();
    await memberPage.locator("#password").fill("replacement-password-456");
    await memberPage.getByRole("button", { name: "Sign in" }).click();
    await memberPage.waitForURL("**/");
  } finally {
    await memberContext.close();
  }
});

test("change user roles and keep Agent Connections administrator-only", async ({
  browser,
  page,
}, testInfo) => {
  await page.goto("/signup");
  await page.getByLabel("Name").fill("Role Admin");
  await page.getByLabel("Email").fill("role-admin@overtchat-test.local");
  await page.locator("#password").fill("test-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/");

  await page.goto("/settings/users");
  await page.getByRole("button", { name: "Add user" }).click();
  const addDialog = page.getByRole("dialog", { name: "Add user" });
  await addDialog.getByLabel("Name").fill("Role Member");
  await addDialog.getByLabel("Email").fill("role-member@overtchat-test.local");
  await addDialog.locator("#new-password").fill("test-password-123");
  await addDialog.getByRole("button", { name: "Create" }).click();

  const role = page.getByRole("combobox", {
    name: "Role for role-member@overtchat-test.local",
  });
  await expect(role).toBeVisible();
  await role.click();
  await page.getByRole("option", { name: "Admin", exact: true }).click();
  const promoteDialog = page.getByRole("alertdialog", {
    name: "Grant administrator access?",
  });
  await expect(promoteDialog).toContainText("opening SSH connections");
  await promoteDialog.getByRole("button", { name: "Make admin" }).click();
  await expect(
    page.getByText("Administrator access granted", { exact: true }),
  ).toBeVisible();
  await expect(role).toContainText("Admin");

  await role.click();
  await page.getByRole("option", { name: "User", exact: true }).click();
  const demoteDialog = page.getByRole("alertdialog", {
    name: "Remove administrator access?",
  });
  await demoteDialog.getByRole("button", { name: "Make user" }).click();
  await expect(
    page.getByText("Administrator access removed", { exact: true }),
  ).toBeVisible();
  await expect(role).toContainText("User");

  const db = openE2eDatabase();
  try {
    expect(
      db
        .prepare("SELECT role FROM user WHERE email = ?")
        .get("role-member@overtchat-test.local"),
    ).toEqual({ role: "user" });
  } finally {
    db.close();
  }

  const memberContext = await browser.newContext({
    baseURL: testInfo.project.use.baseURL,
  });
  try {
    const memberPage = await memberContext.newPage();
    await memberPage.goto("/login");
    await memberPage
      .getByLabel("Email")
      .fill("role-member@overtchat-test.local");
    await memberPage.locator("#password").fill("test-password-123");
    await memberPage.getByRole("button", { name: "Sign in" }).click();
    await memberPage.waitForURL("**/");

    await memberPage.goto("/settings/connections");
    await expect(memberPage).toHaveURL(/\/settings\/general$/u);
    await expect(
      memberPage.getByRole("link", { name: "Connections" }),
    ).toHaveCount(0);

    const response = await memberContext.request.get("/api/agent-connections");
    expect(response.status()).toBe(403);
  } finally {
    await memberContext.close();
  }
});
