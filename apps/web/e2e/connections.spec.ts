import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { resetE2eDatabase } from "./helpers/database";

const workspacePath = path.resolve(process.cwd(), "../..");
const workspaceName = path.basename(workspacePath);

test.beforeEach(resetE2eDatabase);

test("connect local Pi, attach a workspace, and open a native session", async ({
  page,
}, testInfo) => {
  test.skip(
    process.env.RUN_PI_E2E !== "1",
    "Set RUN_PI_E2E=1 on a machine with Pi installed.",
  );

  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });

  await test.step("create the administrator", async () => {
    await page.goto("/signup");
    await page.locator("#name").fill("Pi E2E Admin");
    await page
      .locator("#email")
      .fill("pi-admin@overtchat-test.local");
    await page.locator("#password").fill("test-password-123");
    await page.getByRole("button", { name: "Create account" }).click();
    await page.waitForURL("**/", { timeout: 15_000 });
  });

  await test.step("connect the server's Pi installation", async () => {
    await page.goto("/settings/connections");
    await expect(
      page.getByRole("heading", { name: "Connections" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Add connection" }).click();
    await expect(
      page.getByRole("button", { name: /Claude Code.*Coming soon/ }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: /Codex.*Coming soon/ }),
    ).toBeDisabled();
    await page.getByRole("button", { name: "Pi", exact: true }).click();
    await expect(page.getByLabel("Connection location")).toContainText(
      "This server",
    );
    await page.getByRole("button", { name: "Test connection" }).click();
    await expect(page.getByText(/Pi \d+\.\d+\.\d+.*model/)).toBeVisible({
      timeout: 150_000,
    });
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    await expect(page.getByText("Pi connected")).toBeVisible({
      timeout: 150_000,
    });
    await expect(page.getByText("This server").first()).toBeVisible();
  });

  await test.step("browse and attach the worktree directory", async () => {
    await page.getByRole("button", { name: "Add workspace" }).click();
    const dialog = page.getByRole("dialog", { name: "Add workspace" });
    await expect(dialog).toBeVisible();
    const relativeWorkspacePath = path.relative(os.homedir(), workspacePath);
    expect(relativeWorkspacePath.startsWith("..")).toBe(false);
    for (const segment of relativeWorkspacePath.split(path.sep)) {
      await dialog
        .getByRole("button", { name: segment, exact: true })
        .click();
    }
    await dialog.getByRole("button", { name: "Select" }).click();
    await expect(dialog.locator("#agent-workspace-path")).toHaveValue(
      workspacePath,
    );
    await dialog.getByRole("button", { name: "Attach" }).click();
    await expect(page.getByText("Workspace attached")).toBeVisible({
      timeout: 90_000,
    });
    await expect(
      page.getByTitle(workspacePath),
    ).toBeVisible();
  });

  await test.step("open a native Pi session from the sidebar hierarchy", async () => {
    await page
      .getByRole("button", { name: "This server Pi", exact: true })
      .click();
    await page
      .getByRole("button", { name: workspaceName, exact: true })
      .click();
    await page
      .getByRole("button", { name: "New session", exact: true })
      .click();
    await page.waitForURL("**/agents/**", { timeout: 150_000 });
    await expect(page.getByText("New Pi session")).toBeVisible({
      timeout: 150_000,
    });
    await expect(
      page.getByPlaceholder("Message Pi or type / for commands"),
    ).toBeVisible();
    await expect(page.getByLabel("Session usage")).toBeVisible();
    await expect(page.getByLabel("Session actions")).toBeVisible();
  });

  await test.step("rename the native session and verify responsive layout", async () => {
    await page.getByLabel("Session actions").click();
    await page.getByRole("menuitem", { name: "Rename session" }).click();
    const rename = page.getByRole("dialog", { name: "Rename session" });
    await rename.getByLabel("Name").fill("Pi E2E Session");
    await rename.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Session renamed")).toBeVisible();

    await page.screenshot({
      path: testInfo.outputPath("pi-connections-desktop.png"),
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    ).toBe(true);

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(
      page.getByPlaceholder("Message Pi or type / for commands"),
    ).toBeVisible();
    await page.getByLabel("Open sidebar").click();
    await expect(
      page
        .getByText("Connections", { exact: true })
        .filter({ visible: true })
        .first(),
    ).toBeVisible();
    await expect(
      page
        .getByRole("link", { name: "Pi E2E Session", exact: true })
        .filter({ visible: true })
        .first(),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("pi-connections-mobile.png"),
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    ).toBe(true);
  });

  expect(browserErrors).toEqual([]);
});
