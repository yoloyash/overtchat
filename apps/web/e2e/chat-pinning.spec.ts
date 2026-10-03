import { expect, test, type Locator } from "@playwright/test";
import { openE2eDatabase, resetE2eDatabase } from "./helpers/database";

test.beforeEach(resetE2eDatabase);

test("pins persist, include older chats, and keep their project across sidebar actions", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/signup");
  await page.locator("#name").fill("Pin Test Admin");
  await page.locator("#email").fill("pin-admin@overtchat-test.local");
  await page.locator("#password").fill("test-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/");

  const db = openE2eDatabase();
  const oldTimestamp = Date.now() - 40 * 86_400_000;
  try {
    const owner = db.prepare("SELECT id FROM user LIMIT 1").get() as { id: string };
    db.prepare("INSERT INTO projects (id, user_id, name, instructions) VALUES ('pin-project', ?, 'Pin Project', 'Keep project instructions')")
      .run(owner.id);
    const insert = db.prepare("INSERT INTO chats (id, user_id, title, kind, pinned, updated_at, project_id) VALUES (?, ?, ?, ?, ?, ?, ?)");
    insert.run("old-pin", owner.id, "Old pinned chat", "text", 1, oldTimestamp, null);
    insert.run("project-chat", owner.id, "Project conversation", "voice", 0, Date.now(), "pin-project");
    insert.run("recent-chat", owner.id, "Weekend Ideas", "text", 0, Date.now() + 1, null);
    for (let i = 0; i < 110; i++) {
      insert.run(`filler-${i}`, owner.id, `Recent filler ${i}`, "text", 0, Date.now() - 1000 - i, null);
    }
  } finally {
    db.close();
  }
  await page.reload();

  const sidebar = page.locator("[data-desktop-sidebar]");
  const pins = sidebar.getByRole("region", { name: "Pinned chats" });
  await expect(pins.getByRole("link", { name: "Old pinned chat", exact: true })).toBeVisible();
  await expect(sidebar.getByRole("link", { name: "Old pinned chat", exact: true })).toHaveCount(1);
  const row = (root: Locator, name: string) => root.getByRole("link", { name, exact: true }).locator("..");

  // The inline control is keyboard reachable and activates without navigating.
  const weekend = row(sidebar, "Weekend Ideas");
  await weekend.getByRole("link").focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(weekend.getByRole("button", { name: "Pin chat", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(pins.getByRole("link", { name: "Weekend Ideas", exact: true })).toBeVisible();
  await expect(pins.getByRole("link", { name: "Weekend Ideas", exact: true })).toBeFocused();
  await expect(sidebar.getByRole("link", { name: "Weekend Ideas", exact: true })).toHaveCount(1);
  await expect(pins.getByRole("link")).toHaveText(["Weekend Ideas", "Old pinned chat"]);

  // Project pinning preserves the project, including its move-menu selection.
  await sidebar.getByRole("button", { name: "Expand", exact: true }).click();
  const projectRow = row(sidebar, "Project conversation");
  await projectRow.hover();
  await projectRow.getByRole("button", { name: "Chat actions" }).click();
  await page.getByRole("menuitem", { name: "Pin", exact: true }).click();
  await expect(pins.getByRole("link", { name: "Project conversation", exact: true })).toBeVisible();
  await expect(sidebar.getByRole("link", { name: "Project conversation", exact: true })).toHaveCount(2);
  await page.reload();
  await expect(pins.getByRole("link", { name: "Weekend Ideas", exact: true })).toBeVisible();
  await expect(pins.getByRole("link", { name: "Project conversation", exact: true })).toBeVisible();
  const pinnedProject = row(pins, "Project conversation");
  await page.screenshot({ path: "test-results/chat-pinning-desktop.png" });
  await pinnedProject.hover();
  await pinnedProject.getByRole("button", { name: "Chat actions" }).click();
  await page.getByRole("menuitem", { name: /^Move to/ }).hover();
  await expect(page.getByRole("menuitem", { name: "Pin Project", exact: true })).toBeDisabled();
  await page.getByRole("menuitem", { name: "No project", exact: true }).click();
  await expect(pins.getByRole("link", { name: "Project conversation", exact: true })).toBeVisible();
  await expect(sidebar.getByRole("link", { name: "Project conversation", exact: true })).toHaveCount(1);

  // A failed write leaves the pin in place and exposes a retryable error.
  await page.route("**/api/chats/recent-chat", async (route) => {
    if (route.request().method() === "PATCH") await route.fulfill({ status: 500 });
    else await route.continue();
  });
  await row(pins, "Weekend Ideas").getByRole("button", { name: "Unpin chat", exact: true }).click();
  await expect(page.getByRole("region", { name: "Notifications" }).getByText("Failed to unpin chat", { exact: true })).toBeVisible();
  await expect(pins.getByRole("link", { name: "Weekend Ideas", exact: true })).toBeVisible();
  await page.unroute("**/api/chats/recent-chat");

  // The same controls work in the browser's touch drawer.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Open sidebar" }).click();
  const drawer = page.getByRole("dialog", { name: "Navigation" });
  const mobilePins = drawer.getByRole("region", { name: "Pinned chats" });
  const mobileWeekend = row(mobilePins, "Weekend Ideas");
  await mobileWeekend.getByRole("button", { name: "Chat actions" }).click();
  await drawer.getByRole("menuitem", { name: "Unpin", exact: true }).click();
  await expect(mobilePins.getByRole("link", { name: "Weekend Ideas", exact: true })).toHaveCount(0);
  await expect(drawer.getByRole("link", { name: "Weekend Ideas", exact: true })).toBeVisible();
  await page.screenshot({ path: "test-results/chat-pinning-mobile.png" });

  // Unpinning an old chat does not manufacture activity to keep it in recents.
  await row(mobilePins, "Old pinned chat").getByRole("button", { name: "Unpin chat", exact: true }).click();
  await expect(drawer.getByRole("link", { name: "Old pinned chat", exact: true })).toHaveCount(0);

  const projectPin = row(mobilePins, "Project conversation");
  await projectPin.getByRole("button", { name: "Chat actions" }).click();
  await drawer.getByRole("menuitem", { name: "Delete", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete", exact: true }).click();
  await expect(mobilePins).toHaveCount(0);
  const verificationDb = openE2eDatabase();
  try {
    expect(verificationDb.prepare("SELECT updated_at, pinned FROM chats WHERE id = 'old-pin'").get())
      .toEqual({ updated_at: oldTimestamp, pinned: 0 });
    expect(verificationDb.prepare("SELECT id FROM chats WHERE id = 'project-chat'").get()).toBeUndefined();
  } finally {
    verificationDb.close();
  }
});
