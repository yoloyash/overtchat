import { expect, test } from "@playwright/test";
import {
  openE2eDatabase,
  resetE2eDatabase,
} from "./helpers/database";

test.beforeEach(resetE2eDatabase);

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
  await addDialog
    .getByLabel("Email")
    .fill("role-member@overtchat-test.local");
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
      db.prepare("SELECT role FROM user WHERE email = ?").get(
        "role-member@overtchat-test.local",
      ),
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

    const response = await memberContext.request.get(
      "/api/agent-connections",
    );
    expect(response.status()).toBe(403);
  } finally {
    await memberContext.close();
  }
});
