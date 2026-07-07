import { expect, test } from "@playwright/test";
import path from "node:path";
import { ensureAdminSession } from "./helpers";

test("admin can test, save, reopen, and toggle a stdio MCP server", async ({
  page,
}) => {
  const fixturePath = path.join(
    process.cwd(),
    "e2e/fixtures/mcp-stdio-fixture.mjs",
  );
  const workingDirectory = process.cwd();

  await test.step("admin session", async () => {
    await ensureAdminSession(page);
  });

  await test.step("test and save MCP server", async () => {
    await page.goto("/settings/tools/mcp/new");
    await expect(page.locator("h1")).toContainText("Connect to a custom MCP");

    await page.locator("#mcp-name").fill("E2E MCP");
    await page.locator("#mcp-command").fill("node");
    await page.locator("#mcp-args").fill(fixturePath);
    await page.locator("#mcp-cwd").fill(workingDirectory);

    await page.getByRole("button", { name: "Test", exact: true }).click();
    await expect(page.getByText(/Connected in \d+ms/)).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByText("1 tool: echo")).toBeVisible();

    await page.getByRole("button", { name: "Create", exact: true }).click();
    await page.waitForURL("**/settings/tools", { timeout: 15000 });
  });

  await test.step("server appears in tools list", async () => {
    const row = page.getByRole("link", { name: "Edit E2E MCP" });
    await expect(row).toContainText("E2E MCP");
    await expect(row).toContainText("node");
    await expect(row).toContainText("mcp-stdio-fixture.mjs");
  });

  await test.step("edit route is deep-linkable and persists fields", async () => {
    await page.getByRole("link", { name: "Edit E2E MCP" }).click();
    await expect(page).toHaveURL(/\/settings\/tools\/mcp\/[^/]+$/);
    await expect(page.locator("h1")).toContainText("Edit MCP server");

    await page.reload();
    await expect(page.locator("#mcp-name")).toHaveValue("E2E MCP");
    await expect(page.locator("#mcp-command")).toHaveValue("node");
    await expect(page.locator("#mcp-args")).toHaveValue(fixturePath);
    await expect(page.locator("#mcp-cwd")).toHaveValue(workingDirectory);
  });

  await test.step("toggle server from tools list", async () => {
    await page.getByLabel("Back to tools").click();
    await page.waitForURL("**/settings/tools", { timeout: 15000 });

    await page.getByLabel("Disable E2E MCP").click();
    await expect(page.getByLabel("Enable E2E MCP")).toBeVisible();

    await page.getByLabel("Enable E2E MCP").click();
    await expect(page.getByLabel("Disable E2E MCP")).toBeVisible();
  });
});
