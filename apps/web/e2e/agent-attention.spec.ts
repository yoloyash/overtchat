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
  // Another machine opens with the folder and agent last used on it.
  const machine = page.getByRole("combobox", { name: "Machine" });
  await expect(machine).toContainText("This machine");
  await machine.click();
  await expect(page.getByRole("option")).toHaveCount(2);
  await page.getByRole("option", { name: "home-server" }).click();
  await page.waitForURL("**/agents/new?workspaceId=claude-api&provider=claude");
  await expect(page.getByRole("heading", { name: "New Claude Code session" })).toBeVisible();
  // The folder list holds only that machine's folders; the agent stays.
  const workspace = page.getByRole("combobox", { name: "Workspace" });
  await expect(workspace).toContainText("api");
  await workspace.click();
  await expect(page.getByRole("option")).toHaveCount(2);
  await page.getByRole("option", { name: "site" }).click();
  await page.waitForURL("**/agents/new?workspaceId=claude-site&provider=claude");
  // Back on this machine, the agent list holds only the agents that have the folder.
  await machine.click();
  await page.getByRole("option", { name: "This machine" }).click();
  await page.waitForURL("**/agents/new?workspaceId=codex-app&provider=codex");
  await workspace.click();
  await page.getByRole("option", { name: "site" }).click();
  await page.waitForURL("**/agents/new?workspaceId=codex-site&provider=codex");
  const agent = page.getByRole("combobox", { name: "Agent" });
  await expect(agent).toContainText("Codex");
  await agent.click();
  await expect(page.getByRole("option")).toHaveCount(2);
  await page.getByRole("option", { name: "Oh My Pi" }).click();
  await page.waitForURL("**/agents/new?workspaceId=omp-site&provider=omp");
  await expect(page.getByRole("heading", { name: "New Oh My Pi session" })).toBeVisible();

  // Every session is listed once, filed by what it needs.
  const needsInput = section(page, "Needs input");
  await expect(needsInput.getByRole("link")).toHaveCount(1);
  await expect(needsInput.getByRole("link")).toHaveAccessibleName(
    /^Needs approval: Upgrade the parser \d+m Allow Bash · npm ci$/,
  );
  const failed = section(page, "Failed");
  await expect(failed.getByRole("link")).toHaveAccessibleName(
    /^Failed: Fix the flaky test \d+m app · This machine$/,
  );
  await expect(section(page, "Working").getByRole("link")).toHaveCount(1);
  await expect(section(page, "Working").getByRole("link")).toHaveAccessibleName(
    /^Working: Write the docs \d+m app · This machine$/,
  );
  const ready = section(page, "Ready to review");
  await expect(ready.getByRole("link")).toHaveAccessibleName(
    /^Finished: Add pagination \d+m api · home-server$/,
  );
  const done = section(page, "Done");
  await expect(done.getByRole("link")).toHaveAccessibleName(/^Old refactor \d+h api · home-server$/);
  const sectionOrder = await page
    .getByRole("complementary")
    .getByRole("region")
    .evaluateAll((regions) => regions.map((region) => region.getAttribute("aria-label")));
  expect(sectionOrder).toEqual(["Needs input", "Failed", "Ready to review", "Working", "Done"]);

  // A group folds from its header and stays folded.
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByRole("button", { name: "Done", exact: true })).toHaveAttribute("aria-expanded", "false");
  await expect(done.getByRole("link")).toHaveCount(0);
  await page.reload();
  await expect(done.getByRole("link")).toHaveCount(0);
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(done.getByRole("link")).toHaveCount(1);

  // Marking a finished session read files it under Done; unread brings it back.
  await ready.getByRole("link").hover();
  await ready.getByRole("button", { name: "Mark Add pagination as read" }).click();
  await expect(ready).toHaveCount(0);
  await expect(done.getByRole("link")).toHaveCount(2);
  expect(reads).toEqual([{ sessionId: "ready", read: true }]);
  await done.getByRole("link", { name: /^Old refactor/ }).hover();
  await done.getByRole("button", { name: "Mark Old refactor as unread" }).click();
  await expect(section(page, "Ready to review").getByRole("link")).toHaveAccessibleName(/^Finished: Old refactor /);
  expect(reads.at(-1)).toEqual({ sessionId: "seen", read: false });

  // The workspace grouping shows each session's state in its folder.
  await page.getByRole("button", { name: "Agent list options", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "Workspace" }).click();
  await expect(needsInput).toHaveCount(0);
  await expect(page.getByRole("status", { name: "Finished in api" })).toBeVisible();
  await page.getByRole("button", { name: "Expand api" }).click();
  const tree = page.getByRole("list", { name: "Agent workspaces", exact: true });
  await expect(tree.getByRole("link", { name: /^Finished: Old refactor \d+h Claude Code$/ })).toBeVisible();
  await expect(tree.getByRole("link", { name: /^Add pagination / })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("list", { name: "Agent workspaces", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Agent list options", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "Status" }).click();

  // Every finished session can be marked read at once.
  await page.getByRole("button", { name: "Agent list options", exact: true }).click();
  await page.getByRole("menuitem", { name: "Mark all as read" }).click();
  await expect(section(page, "Ready to review")).toHaveCount(0);
  expect(reads.at(-1)).toEqual({ sessionId: "seen", read: true });
  await page.getByRole("button", { name: "Agent list options", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "Mark all as read" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  // Opening a session with an unseen result marks it read.
  await failed.getByRole("link", { name: /Fix the flaky test/ }).click();
  await page.waitForURL("**/agents/failed");
  await expect.poll(() => reads.at(-1)).toEqual({ sessionId: "failed", read: true });
  await expect(section(page, "Failed")).toHaveCount(0);

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

test("history searches every session and filters by machine, folder and agent", async ({
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
  // Filters narrow in order: the machine, a folder on it, then an agent with sessions there.
  await page.getByRole("combobox", { name: "Machine" }).click();
  await page.getByRole("option", { name: "This machine" }).click();
  await expect(results).toHaveCount(3);
  await page.getByRole("combobox", { name: "Workspace" }).click();
  await expect(page.getByRole("option")).toHaveText(["All workspaces", "app"]);
  await page.getByRole("option", { name: "app" }).click();
  await expect(results).toHaveCount(3);
  await page.waitForURL(
    (url) =>
      url.searchParams.get("host") === "local-host" &&
      url.searchParams.get("workspace") === "app",
  );
  // Another machine drops the folder it does not have.
  await page.getByRole("combobox", { name: "Machine" }).click();
  await page.getByRole("option", { name: "home-server" }).click();
  await expect(results).toHaveCount(2);
  await expect(page.getByRole("combobox", { name: "Workspace" })).toContainText("All workspaces");
  await page.waitForURL(
    (url) => url.searchParams.get("host") === "ssh-host" && !url.searchParams.has("workspace"),
  );
  await page.getByRole("combobox", { name: "Agent" }).click();
  await expect(page.getByRole("option")).toHaveText(["All agents", "Claude Code"]);
  await page.getByRole("option", { name: "Claude Code" }).click();
  await expect(results).toHaveCount(2);
  await page.getByRole("searchbox", { name: "Search sessions" }).fill("npm ci");
  await expect(page.getByText("No sessions match.")).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(results).toHaveCount(5);
  await page.waitForURL((url) => [...url.searchParams.keys()].length === 0);

  // Filters live in the address, so a reload or a shared link keeps them.
  await page.goto("/agents/history?provider=claude&sort=created");
  await expect(results).toHaveCount(2);
  await expect(page.getByRole("combobox", { name: "Sort by" })).toHaveText(/Created/);
  await results.filter({ hasText: "Old refactor" }).click();
  await page.waitForURL("**/agents/seen");
});
