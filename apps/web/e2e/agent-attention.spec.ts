import { expect, test, type Page } from "@playwright/test";
import { setupAgentAttention } from "./helpers/agent-attention";
import { resetE2eDatabase, setupUrl } from "./helpers/database";

test.beforeEach(resetE2eDatabase);

function sidebarView(page: Page) {
  return page.getByRole("group", { name: "Sidebar view" }).filter({ visible: true });
}

function section(page: Page, name: string) {
  return page.getByRole("region", { name, exact: true });
}

test("agents mode shows what each agent needs and tracks what was seen", async ({
  page,
}) => {
  const { reads } = await setupAgentAttention(page);

  // Chat mode keeps agents out of the chat list, but flags what needs you.
  await expect(sidebarView(page).getByRole("button", { name: "Chat" })).toHaveAttribute("aria-pressed", "true");
  const agentsToggle = sidebarView(page).getByRole("button", { name: "Agents, 2 need you" });
  await expect(agentsToggle).toBeVisible();
  await expect(page.getByRole("list", { name: "Agent workspaces", exact: true })).toHaveCount(0);

  // The Agents home starts a session with the most recently used setup.
  await agentsToggle.click();
  await page.waitForURL("**/agents/new?workspaceId=codex-app&provider=codex");
  await expect(sidebarView(page).getByRole("button", { name: "Agents" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("heading", { name: "New Codex session" })).toBeVisible();
  const recent = page.getByRole("navigation", { name: "Recent setups" });
  await expect(recent.getByRole("link")).toHaveCount(1);
  await expect(recent.getByRole("link", { name: /api Claude Code · home-server/ })).toBeVisible();
  // Any workspace and agent can be picked, including one never used.
  await page.getByRole("combobox", { name: "Workspace and agent" }).click();
  await expect(page.getByRole("option")).toHaveCount(3);
  await page.getByRole("option", { name: /^site Codex · This machine/ }).click();
  await page.waitForURL("**/agents/new?workspaceId=codex-site&provider=codex");
  await expect(page.getByRole("combobox", { name: "Workspace and agent" })).toContainText("site");

  // Every session is listed once, filed by what it needs.
  const needsYou = section(page, "Needs you");
  await expect(needsYou.getByRole("link")).toHaveCount(2);
  await expect(needsYou.getByRole("link").nth(0)).toContainText("Upgrade the parser");
  await expect(needsYou.getByRole("link").nth(0)).toContainText("Allow Bash · npm ci");
  await expect(needsYou.getByRole("link").nth(1)).toContainText("Fix the flaky test");
  await expect(needsYou.getByRole("link").nth(1)).toContainText("Rate limit reached");
  await expect(section(page, "Working").getByRole("link")).toHaveCount(1);
  await expect(section(page, "Working").getByRole("link")).toHaveAccessibleName(
    /^Working: Write the docs \d+m app · This machine$/,
  );
  const ready = section(page, "Ready to review");
  await expect(ready.getByRole("link")).toHaveCount(1);
  await expect(ready.getByRole("link")).toContainText("Added cursor pagination to /items.");
  const recentSessions = section(page, "Recent");
  await expect(recentSessions.getByRole("link")).toHaveAccessibleName(/^Old refactor \d+h api · home-server$/);
  const sectionOrder = await page
    .getByRole("complementary")
    .getByRole("region")
    .evaluateAll((regions) => regions.map((region) => region.getAttribute("aria-label")));
  expect(sectionOrder).toEqual(["Needs you", "Ready to review", "Working", "Recent"]);

  // Marking a finished session read files it under Recent; unread brings it back.
  await ready.getByRole("link").hover();
  await ready.getByRole("button", { name: "Mark Add pagination as read" }).click();
  await expect(ready).toHaveCount(0);
  await expect(recentSessions.getByRole("link")).toHaveCount(2);
  expect(reads).toEqual([{ sessionId: "ready", read: true }]);
  await recentSessions.getByRole("link", { name: /^Old refactor/ }).hover();
  await recentSessions.getByRole("button", { name: "Mark Old refactor as unread" }).click();
  await expect(section(page, "Ready to review").getByRole("link")).toContainText("Old refactor");
  expect(reads.at(-1)).toEqual({ sessionId: "seen", read: false });

  // The workspace grouping shows each session's state in its folder.
  await page.getByRole("button", { name: "Agent list options", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "Workspace" }).click();
  await expect(needsYou).toHaveCount(0);
  await page.getByRole("button", { name: "Expand api" }).click();
  const tree = page.getByRole("list", { name: "Agent workspaces", exact: true });
  await expect(tree.getByRole("link", { name: /^Finished: Old refactor / })).toBeVisible();
  await expect(tree.getByRole("link", { name: /^Add pagination / })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("list", { name: "Agent workspaces", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Agent list options", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "Status" }).click();

  // Opening a session with an unseen result marks it read.
  await needsYou.getByRole("link", { name: /Fix the flaky test/ }).click();
  await page.waitForURL("**/agents/failed");
  await expect.poll(() => reads.at(-1)).toEqual({ sessionId: "failed", read: true });
  await expect(section(page, "Needs you").getByRole("link")).toHaveCount(1);

  // Settings keep the current mode, and each mode returns to where it was left.
  await page.goto("/settings/general");
  await expect(sidebarView(page).getByRole("button", { name: "Agents" })).toHaveAttribute("aria-pressed", "true");
  await sidebarView(page).getByRole("button", { name: "Chat" }).click();
  await page.waitForURL((url) => url.pathname === "/");
  await expect(sidebarView(page).getByRole("button", { name: "Agents, 1 needs you" })).toBeVisible();
  await sidebarView(page).getByRole("button", { name: "Agents, 1 needs you" }).click();
  await page.waitForURL("**/agents/failed");
});

test("the Agents home explains how to start when no folder is connected", async ({
  page,
}) => {
  await page.context().route("**/api/agent-connections", (route) =>
    route.fulfill({ json: { connections: [] } }),
  );
  await page.goto(await setupUrl());
  await page.locator("#name").fill("Empty Agents Admin");
  await page.locator("#email").fill("empty-agents@overtchat-test.local");
  await page.locator("#password").fill("test-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/");

  await sidebarView(page).getByRole("button", { name: "Agents" }).click();
  await page.waitForURL((url) => url.pathname === "/agents");
  await expect(page.getByRole("heading", { name: "Start an agent in a folder" })).toBeVisible();
  await page.getByRole("main").getByRole("link", { name: "Add workspace" }).click();
  await page.waitForURL("**/settings/connections?add=1");
});

test("history searches every session by title, message, workspace and agent", async ({
  page,
}) => {
  await setupAgentAttention(page);
  await sidebarView(page).getByRole("button", { name: /^Agents/ }).click();
  await page.waitForURL("**/agents/new?**");
  await page.getByRole("link", { name: "History", exact: true }).click();
  await page.waitForURL((url) => url.pathname === "/agents/history");

  const results = page.getByRole("main").getByRole("link");
  await expect(page.getByRole("status").filter({ hasText: /sessions?$/ })).toHaveText("5 sessions");
  await expect(results.first()).toContainText("Upgrade the parser");
  await expect(page.getByRole("main").getByRole("region", { name: "Today" })).toBeVisible();

  await page.getByRole("searchbox", { name: "Search sessions" }).fill("cursor pagination");
  await expect(results).toHaveCount(1);
  await expect(results).toContainText("Add pagination");
  await expect(results).toContainText("Claude Code · api · home-server");
  await page.waitForURL((url) => url.searchParams.get("q") === "cursor pagination");

  await page.getByRole("searchbox", { name: "Search sessions" }).fill("");
  await page.getByRole("combobox", { name: "Workspace" }).click();
  await page.getByRole("option", { name: "app · This machine" }).click();
  await expect(results).toHaveCount(3);
  await page.getByRole("combobox", { name: "Agent" }).click();
  await page.getByRole("option", { name: "Claude Code" }).click();
  await expect(page.getByText("No sessions match.")).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(results).toHaveCount(5);

  // Filters live in the address, so a reload or a shared link keeps them.
  await page.goto("/agents/history?provider=claude&sort=created");
  await expect(results).toHaveCount(2);
  await expect(page.getByRole("combobox", { name: "Sort by" })).toHaveText(/Created/);
  await results.filter({ hasText: "Old refactor" }).click();
  await page.waitForURL("**/agents/seen");
});
