import { expect, test, type Page } from "@playwright/test";
import type { AgentConnectionListItem } from "@overtchat/agent-bridge";
import { resetE2eDatabase } from "./helpers/database";

const workspaceNames = ["Alpha", "Beta", "Gamma"];

function connections(names = workspaceNames): AgentConnectionListItem[] {
  return ["codex", "pi"].map((provider) => ({
    id: provider,
    provider: provider as "codex" | "pi",
    executable: provider,
    detectedVersion: "1.0",
    lastValidatedAt: null,
    host: {
      id: "host",
      connectorId: "connector",
      name: "Local",
      transport: "local",
      sshAlias: null,
    },
    workspaces: names.map((name) => ({
      id: `${provider}-${name}`,
      name,
      path: `/srv/${name}`,
      sessions: [],
    })),
  }));
}

async function setup(
  page: Page,
  running = false,
  fixture?: AgentConnectionListItem[],
) {
  let names = [...workspaceNames];
  await page.context().route("**/api/agent-connections", (route) => {
    const items = fixture ?? connections(names);
    if (running) {
      items[0].workspaces[0].sessions.push({
        id: "running-session",
        providerSessionId: "native-session",
        name: "Working",
        firstMessage: null,
        messageCount: 1,
        createdAt: 1,
        modifiedAt: 1,
        runtimeStatus: "running",
      });
    }
    return route.fulfill({ json: { connections: items } });
  });
  await page.context().route("**/api/agent-connections/events", (route) =>
    route.fulfill({
      contentType: "text/event-stream",
      body: 'event: snapshot\ndata: {"sessions":[]}\n\n',
    }),
  );
  await page.context().route("**/api/agent-connections/discover?*", (route) =>
    route.fulfill({
      json: {
        snapshot: {
          target: { connectorId: "connector", transport: "local" },
          providers: [],
          refreshedAt: 1,
        },
      },
    }),
  );
  await page
    .context()
    .route("**/api/agent-workspaces/*/git-status", (route) =>
      route.fulfill({ json: { status: { isGit: false } } }),
    );
  await page.goto("/signup");
  await page.locator("#name").fill("Workspace Admin");
  await page.locator("#email").fill("workspace-admin@overtchat-test.local");
  await page.locator("#password").fill("test-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/");
  return (next: string[]) => {
    names = next;
  };
}

function list(page: Page) {
  return page.getByRole("list", { name: "Agent workspaces", exact: true });
}

async function expectOrder(page: Page, names: string[]) {
  await expect
    .poll(() =>
      list(page)
        .getByRole("button", { name: /^(Expand|Collapse) / })
        .evaluateAll((buttons) =>
          buttons.map((button) =>
            button
              .getAttribute("aria-label")
              ?.replace(/^(Expand|Collapse) /, ""),
          ),
        ),
    )
    .toEqual(names);
}

async function organize(page: Page) {
  if (await page.getByRole("button", { name: "Done", exact: true }).isVisible())
    return;
  await page.getByRole("button", { name: /^Agent workspace options/ }).click();
  await page.getByRole("menuitem", { name: "Organize workspaces" }).click();
  await expect(
    page.getByRole("button", { name: "Done", exact: true }),
  ).toBeVisible();
}

async function drag(
  page: Page,
  from: string,
  to: string,
  duringDrag?: () => Promise<void>,
) {
  await organize(page);
  const source = list(page).getByRole("button", {
    name: `Reorder ${from}`,
    exact: true,
  });
  const target = list(page).getByRole("button", {
    name: `Reorder ${to}`,
    exact: true,
  });
  const start = (await source.boundingBox())!;
  const end = (await target.boundingBox())!;
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await expect(source).toHaveAttribute("aria-pressed", "true");
  await duringDrag?.();
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, {
    steps: 15,
  });
  await page.mouse.up();
}

test.beforeEach(resetE2eDatabase);

function sidebarDesignFixture(): AgentConnectionListItem[] {
  const items = connections(["overtchat"]);
  for (const item of items) item.host.name = "macbook";
  items[0].workspaces[0].sessions = Array.from({ length: 7 }, (_, index) => ({
    id: `local-${index + 1}`,
    providerSessionId: `native-${index + 1}`,
    name: [
      "Improve workspace navigation",
      "Review connector reconnects",
      "Fix mobile composer",
      "Investigate deployment failure",
      "Add keyboard shortcuts",
      "Update search indexing",
      "Run the release checks",
    ][index],
    firstMessage: null,
    messageCount: 10,
    createdAt: 100,
    modifiedAt: 1000 - index,
    runtimeStatus: index === 6 ? "running" : "idle",
  }));
  items[1].workspaces[0].sessions = [
    {
      ...items[0].workspaces[0].sessions[0],
      id: "pi-session",
      name: "Review the sidebar design",
      modifiedAt: null,
      createdAt: 200,
    },
  ];
  items.push({
    ...items[0],
    id: "remote",
    host: {
      ...items[0].host,
      id: "remote-host",
      transport: "ssh",
      name: "Home server",
      sshAlias: "home-server-2",
    },
    workspaces: [
      {
        ...items[0].workspaces[0],
        id: "remote-workspace",
        sessions: [
          {
            ...items[0].workspaces[0].sessions[0],
            id: "remote-session",
            name: "Update the deployment configuration",
            modifiedAt: 1100,
          },
        ],
      },
      {
        id: "long-workspace",
        name: "a-workspace-with-a-very-long-descriptive-name",
        path: "/srv/long-workspace",
        sessions: [],
      },
    ],
  });
  return items;
}

for (const mobile of [false, true]) {
  test(`compact workspace rows expose activity, recent chats, and persistent expansion${mobile ? " on mobile" : ""}`, async ({
    page,
  }, testInfo) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    await setup(page, false, sidebarDesignFixture());
    await page
      .context()
      .route("**/api/agent-workspaces/*/git-status", (route) =>
        route.fulfill({
          json: {
            status: {
              isGit: true,
              branch: "feature/sidebar-with-a-long-branch-name",
              dirty: true,
              changedFiles: 3,
              additions: 8,
              deletions: 2,
              lineStatsComplete: true,
            },
          },
        }),
      );
    await page
      .context()
      .route("**/api/agent-sessions/*", (route) =>
        route.fulfill({
          status: 503,
          json: { error: "Preview session is offline" },
        }),
      );
    await page.reload();
    if (mobile)
      await page.getByRole("button", { name: "Open sidebar" }).click();

    const recent = page.getByRole("list", { name: "Recent agent chats" });
    await expect(recent.getByRole("link")).toHaveCount(5);
    expect(
      await recent
        .getByRole("link")
        .evaluateAll((links) => links.map((link) => link.getAttribute("href"))),
    ).toEqual([
      "/agents/remote-session",
      "/agents/local-1",
      "/agents/local-2",
      "/agents/local-3",
      "/agents/local-4",
    ]);
    await expect(recent).toContainText("overtchat · home-server-2");
    await expect(recent).toContainText("overtchat · macbook");

    const expand = list(page)
      .getByRole("button", { name: "Expand overtchat", exact: true })
      .first();
    await expect(expand).toContainText("macbook");
    await expect(
      expand.getByRole("status", { name: "1 running chat in overtchat" }),
    ).toBeVisible();
    await expect(
      expand.getByLabel("3 changed files", { exact: true }),
    ).toBeVisible();
    expect((await expand.boundingBox())!.height).toBe(mobile ? 44 : 40);
    await expand.click();
    const local = list(page).locator(":scope > li").first();
    await expect(local.getByRole("link")).toHaveCount(6);
    await expect(
      local.locator('a[href="/agents/local-7"]'),
    ).toBeVisible();
    await local.getByRole("button", { name: "Show 2 more" }).click();
    await expect(local.getByRole("link")).toHaveCount(8);
    await local.getByRole("button", { name: "Show less" }).click();
    await expect(local.getByRole("link")).toHaveCount(6);

    // Long names and metadata must fit the sidebar, including on touch screens.
    expect(
      await list(page).evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    await (
      mobile
        ? page.getByRole("dialog", { name: "Navigation" })
        : page.locator("[data-desktop-sidebar-panel]")
    ).screenshot({
      path: testInfo.outputPath(
        `workspace-design-${mobile ? "mobile" : "desktop"}.png`,
      ),
    });
    await page.reload();
    if (mobile)
      await page.getByRole("button", { name: "Open sidebar" }).click();
    await expect(
      local.getByRole("button", { name: "Collapse overtchat" }),
    ).toHaveAttribute("aria-expanded", "true");
    await expect(local.getByRole("link")).toHaveCount(6);

    await page.getByRole("button", { name: "Recent chats", exact: true }).click();
    await expect(recent).toBeHidden();
    await page.reload();
    if (mobile)
      await page.getByRole("button", { name: "Open sidebar" }).click();
    await expect(recent).toBeHidden();
    await page.getByRole("button", { name: "Recent chats", exact: true }).click();

    await page
      .getByRole("button", { name: "Agent workspace options", exact: true })
      .click();
    const filter = page.getByRole("menuitem", { name: "Filter chats" });
    if (mobile) await filter.click();
    else await filter.hover();
    await page.getByRole("menuitemradio", { name: "Pi", exact: true }).click();
    await expect(recent.getByRole("link")).toHaveCount(1);
    await expect(recent).toContainText("Review the sidebar design");
    await expect(local.getByRole("status")).toHaveCount(0);

    await local.getByRole("button", { name: "Collapse overtchat" }).click();
    await recent.getByRole("link").click();
    await page.waitForURL("**/agents/pi-session");
    if (mobile) {
      await expect(
        page.getByRole("dialog", { name: "Navigation" }),
      ).toBeHidden();
      await page.getByRole("button", { name: "Open sidebar" }).click();
    }
    await expect(
      local.getByRole("button", { name: "Collapse overtchat" }),
    ).toHaveAttribute("aria-expanded", "true");
    await expect(
      local.getByRole("link", {
        name: "Review the sidebar design",
        exact: true,
      }),
    ).toHaveAttribute("aria-current", "page");

    // A saved collapse must not hide a chat reached outside the Recent list,
    // including a selected chat older than the five-row preview.
    await local.getByRole("button", { name: "Collapse overtchat" }).click();
    await page.goto("/agents/local-6");
    if (mobile)
      await page.getByRole("button", { name: "Open sidebar" }).click();
    await expect(
      local.getByRole("button", { name: "Collapse overtchat" }),
    ).toHaveAttribute("aria-expanded", "true");
    await expect(local.locator('a[href="/agents/local-6"]')).toHaveAttribute(
      "aria-current",
      "page",
    );
    await local.getByRole("button", { name: "Collapse overtchat" }).click();
    await page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/agent-connections",
    );
    await expect(
      local.getByRole("button", { name: "Expand overtchat" }),
    ).toHaveAttribute("aria-expanded", "false");
    await page.reload();
    if (mobile)
      await page.getByRole("button", { name: "Open sidebar" }).click();
    await expect(local.locator('a[href="/agents/local-6"]')).toBeVisible();
  });
}

test("mouse and keyboard reorder grouped workspaces, persist locally, and preserve expansion", async ({
  page,
}) => {
  const setNames = await setup(page);
  await expectOrder(page, workspaceNames);
  await list(page)
    .getByRole("button", { name: "Expand Gamma", exact: true })
    .click();
  await drag(page, "Gamma", "Alpha");
  await expectOrder(page, ["Gamma", "Alpha", "Beta"]);
  await expect(
    list(page).getByRole("button", { name: "Collapse Gamma" }),
  ).toBeVisible();
  await expect(list(page).getByText("No agent chats")).toHaveCount(1);
  await list(page).screenshot({
    path: test.info().outputPath("workspace-order.png"),
  });
  await page.reload();
  await expectOrder(page, ["Gamma", "Alpha", "Beta"]);

  await organize(page);
  const handle = list(page).getByRole("button", { name: "Reorder Gamma" });
  await handle.focus();
  await page.keyboard.press("Space");
  await expect(handle).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("ArrowDown");
  await expectOrder(page, ["Alpha", "Gamma", "Beta"]);
  await page.keyboard.press("Escape");
  await expectOrder(page, ["Gamma", "Alpha", "Beta"]);
  await expect(handle).toHaveAttribute("aria-pressed", "false");
  await expect(
    list(page)
      .getByRole("listitem")
      .filter({
        has: page.getByRole("button", { name: "Reorder Gamma", exact: true }),
      }),
  ).toHaveAttribute("data-dropping", "false");
  await handle.focus();
  await page.keyboard.press("Space");
  await expect(handle).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("ArrowDown");
  await expectOrder(page, ["Alpha", "Gamma", "Beta"]);
  await page.keyboard.press("Space");
  await expect(handle).toHaveAttribute("aria-pressed", "false");
  await expectOrder(page, ["Alpha", "Gamma", "Beta"]);
  setNames(["Delta", "Alpha", "Gamma"]);
  await page.reload();
  await expectOrder(page, ["Alpha", "Gamma", "Delta"]);
});

test("touch long-press reorders inside the mobile drawer", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
  });
  const page = await context.newPage();
  try {
    await setup(page);
    await page.getByRole("button", { name: "Open sidebar" }).click();
    await expectOrder(page, workspaceNames);
    await organize(page);
    const handle = list(page).getByRole("button", { name: "Reorder Gamma" });
    await handle.click({ trial: true }); // Wait for the drawer's opening animation.
    const start = (await list(page)
      .getByRole("button", { name: "Reorder Gamma" })
      .boundingBox())!;
    const end = (await list(page)
      .getByRole("button", { name: "Reorder Alpha" })
      .boundingBox())!;
    const client = await context.newCDPSession(page);
    const point = {
      x: start.x + start.width / 2,
      y: start.y + start.height / 2,
    };
    await client.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [point],
    });
    await expect(handle).toHaveAttribute("aria-pressed", "true");
    for (let step = 1; step <= 12; step++) {
      await client.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [
          {
            x: point.x,
            y: point.y + ((end.y + end.height / 2 - point.y) * step) / 12,
          },
        ],
      });
    }
    await client.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await expectOrder(page, ["Gamma", "Alpha", "Beta"]);
    await expect(
      page.getByRole("dialog", { name: "Navigation" }),
    ).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: "Open sidebar" }).click();
    await expectOrder(page, ["Gamma", "Alpha", "Beta"]);
  } finally {
    await context.close();
  }
});

test("invalid saved data and unavailable storage do not break the sidebar", async ({
  page,
}) => {
  await setup(page);
  await drag(page, "Gamma", "Alpha");
  await expectOrder(page, ["Gamma", "Alpha", "Beta"]);
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find((key) =>
      key.startsWith("overtchat_agent_workspace_order:"),
    )!;
    localStorage.setItem(key, JSON.stringify({ invalid: true }));
  });
  await page.reload();
  await expectOrder(page, workspaceNames);
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find((key) =>
      key.startsWith("overtchat_agent_workspace_order:"),
    )!;
    localStorage.setItem(key, "{broken json");
  });
  await page.reload();
  await expectOrder(page, workspaceNames);
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException("Full", "QuotaExceededError");
    };
  });
  await drag(page, "Gamma", "Alpha");
  await expectOrder(page, ["Gamma", "Alpha", "Beta"]);
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => {
      throw new DOMException("Blocked", "SecurityError");
    };
    Storage.prototype.setItem = () => {
      throw new DOMException("Blocked", "SecurityError");
    };
  });
  await page.reload();
  await expectOrder(page, workspaceNames);
  await drag(page, "Gamma", "Alpha");
  await expectOrder(page, ["Gamma", "Alpha", "Beta"]);
});

test("saved order updates another open tab", async ({ page, context }) => {
  await setup(page);
  const second = await context.newPage();
  await second.goto("/");
  await expectOrder(second, workspaceNames);
  await drag(page, "Gamma", "Alpha");
  await expectOrder(second, ["Gamma", "Alpha", "Beta"]);
  await second.close();
});

test("a connection refetch during dragging preserves the move and appends new workspaces", async ({
  page,
}) => {
  const setNames = await setup(page, true);
  await expectOrder(page, workspaceNames);
  await drag(page, "Gamma", "Alpha", async () => {
    setNames(["Delta", ...workspaceNames]);
    const refetch = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/agent-connections",
    );
    // Running sessions cause the real connection query to poll every two seconds.
    await refetch;
    await expectOrder(page, workspaceNames);
  });
  await expectOrder(page, ["Gamma", "Alpha", "Beta", "Delta"]);
});

test("Organize controls stay on the right and Done restores the normal sidebar", async ({
  page,
}) => {
  await setup(page);
  const expand = list(page).getByRole("button", {
    name: "Expand Alpha",
    exact: true,
  });
  await expect(expand).toBeVisible();
  await expect(
    list(page).getByRole("button", { name: /^Reorder / }),
  ).toHaveCount(0);
  await expect(
    list(page).getByRole("button", { name: /^Remove / }),
  ).toHaveCount(0);
  const before = (await expand.boundingBox())!;
  await organize(page);
  await expect(
    list(page).getByRole("button", { name: /^New session in/ }),
  ).toHaveCount(0);
  const editing = (await expand.boundingBox())!;
  expect(editing.x).toBe(before.x);
  const grip = (await list(page)
    .getByRole("button", { name: "Reorder Alpha" })
    .boundingBox())!;
  expect(grip.x).toBeGreaterThan(editing.x + editing.width);
  await expand.click();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(
    list(page).getByRole("button", { name: /^Reorder / }),
  ).toHaveCount(0);
  await expect(
    list(page).getByRole("button", { name: /^Remove / }),
  ).toHaveCount(0);
  await expect(
    list(page).getByRole("button", { name: "New session in Alpha" }),
  ).toBeVisible();
  await expect(
    list(page).getByRole("button", { name: "Collapse Alpha" }),
  ).toBeVisible();
});

test("Filter chats submenu retains the provider selection", async ({
  page,
}) => {
  await setup(page);
  await list(page)
    .getByRole("button", { name: "Expand Alpha", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Agent workspace options", exact: true })
    .click();
  await expect(
    page.getByRole("menuitemradio", { name: "Codex", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("menuitem", { name: "Filter chats" }).hover();
  await page.getByRole("menuitemradio", { name: "Codex", exact: true }).click();
  await expect(list(page).getByText("No Codex chats")).toBeVisible();
  const options = page.getByRole("button", {
    name: "Agent workspace options, filtered by Codex",
    exact: true,
  });
  await options.click();
  await page.getByRole("menuitem", { name: "Filter chats" }).hover();
  await expect(
    page.getByRole("menuitemradio", { name: "Codex", exact: true }),
  ).toHaveAttribute("aria-checked", "true");
  await page
    .getByRole("menuitemradio", { name: "All agents", exact: true })
    .click();
  await expect(list(page).getByText("No agent chats")).toBeVisible();
});

for (const mobile of [false, true]) {
  test(`removing a grouped workspace confirms and removes every provider record${mobile ? " on mobile" : ""}`, async ({
    page,
  }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    await setup(page);
    const deleted: string[] = [];
    await page.context().route("**/api/agent-connections", (route) =>
      route.fulfill({
        json: {
          connections: connections().map((connection) => ({
            ...connection,
            workspaces: connection.workspaces.filter(
              (workspace) =>
                !deleted.includes(`/api/agent-workspaces/${workspace.id}`),
            ),
          })),
        },
      }),
    );
    await page.context().route("**/api/agent-workspaces/*", (route) => {
      if (route.request().method() !== "DELETE") return route.fallback();
      deleted.push(new URL(route.request().url()).pathname);
      return route.fulfill({ status: 204 });
    });
    if (mobile)
      await page.getByRole("button", { name: "Open sidebar" }).click();
    await organize(page);
    await list(page)
      .getByRole("button", { name: "Remove Beta", exact: true })
      .click();
    const dialog = page.getByRole("alertdialog", { name: "Remove workspace?" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(
      "Files and native agent sessions remain on the host.",
    );
    expect(deleted).toEqual([]);
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    expect(deleted).toEqual([]);
    await list(page)
      .getByRole("button", { name: "Remove Beta", exact: true })
      .click();
    await dialog.getByRole("button", { name: "Remove", exact: true }).click();
    await expect(dialog).toBeHidden();
    expect(deleted.sort()).toEqual([
      "/api/agent-workspaces/codex-Beta",
      "/api/agent-workspaces/pi-Beta",
    ]);
    await expectOrder(page, ["Alpha", "Gamma"]);
    if (mobile)
      await expect(
        page.getByRole("dialog", { name: "Navigation" }),
      ).toBeVisible();
  });
}

test("removing the last workspace retries a partial failure using only workspace DELETEs", async ({
  page,
}) => {
  const setNames = await setup(page);
  setNames(["Gamma"]);
  await page.reload();
  const deleted: string[] = [];
  let fail = true;
  await page.context().route("**/api/agent-connections", (route) =>
    route.fulfill({
      json: {
        connections: connections(["Gamma"]).filter(
          (connection) => !deleted.includes(`${connection.provider}-Gamma`),
        ),
      },
    }),
  );
  await page.context().route("**/api/agent-connections/*", (route) => {
    if (route.request().method() !== "DELETE") return route.fallback();
    throw new Error("Workspace removal must not delete an entire connection");
  });
  await page.context().route("**/api/agent-workspaces/*", (route) => {
    if (route.request().method() !== "DELETE") return route.fallback();
    const id = new URL(route.request().url()).pathname.split("/").pop()!;
    if (id === "pi-Gamma" && fail)
      return route.fulfill({ status: 500, json: { error: "Removal failed" } });
    if (deleted.includes(id)) return route.fulfill({ status: 404 });
    deleted.push(id);
    return route.fulfill({ status: 204 });
  });
  await organize(page);
  await expect(
    list(page).getByRole("button", { name: "Reorder Gamma" }),
  ).toBeDisabled();
  await list(page)
    .getByRole("button", { name: "Remove Gamma", exact: true })
    .click();
  const dialog = page.getByRole("alertdialog", { name: "Remove workspace?" });
  await dialog.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Removal failed");
  expect(deleted).toEqual(["codex-Gamma"]);
  fail = false;
  await dialog.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(deleted).toEqual(["codex-Gamma", "pi-Gamma"]);
  await expect(list(page)).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Add workspace", exact: true }))
    .toHaveAttribute("href", "/settings/connections?add=1");
});

test("a workspace added while confirmation is open survives removal", async ({
  page,
}) => {
  const setNames = await setup(page, true);
  setNames(["Gamma"]);
  await page.reload();
  await expectOrder(page, ["Gamma"]);
  await organize(page);
  await list(page)
    .getByRole("button", { name: "Remove Gamma", exact: true })
    .click();
  const refetch = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/agent-connections",
  );
  setNames(["Gamma", "Delta"]);
  await refetch;
  await expect(page.locator('ul[aria-label="Agent workspaces"]')).toContainText(
    "Delta",
  );
  const deleted: string[] = [];
  await page.context().route("**/api/agent-connections", (route) =>
    route.fulfill({
      json: {
        connections: connections(["Gamma", "Delta"]).map((connection) => ({
          ...connection,
          workspaces: connection.workspaces.filter(
            (workspace) => !deleted.includes(workspace.id),
          ),
        })),
      },
    }),
  );
  await page.context().route("**/api/agent-connections/*", (route) => {
    if (route.request().method() !== "DELETE") return route.fallback();
    throw new Error("Workspace removal must not delete an entire connection");
  });
  await page.context().route("**/api/agent-workspaces/*", (route) => {
    if (route.request().method() !== "DELETE") return route.fallback();
    deleted.push(new URL(route.request().url()).pathname.split("/").pop()!);
    return route.fulfill({ status: 204 });
  });
  const dialog = page.getByRole("alertdialog", { name: "Remove workspace?" });
  await dialog.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(deleted).toEqual(["codex-Gamma", "pi-Gamma"]);
  await expectOrder(page, ["Delta"]);
});

for (const mobile of [false, true]) {
  test(`keyboard focus follows Organize and Done${mobile ? " in the mobile drawer" : ""}`, async ({
    page,
  }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    await setup(page);
    if (mobile)
      await page.getByRole("button", { name: "Open sidebar" }).click();
    const options = page.getByRole("button", {
      name: "Agent workspace options",
      exact: true,
    });
    await options.focus();
    await page.keyboard.press("Enter");
    await page.getByRole("menuitem", { name: "Organize workspaces" }).focus();
    await page.keyboard.press("Enter");
    const done = page.getByRole("button", { name: "Done", exact: true });
    await expect(done).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(options).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("menuitem", { name: "Organize workspaces" }),
    ).toBeVisible();
    const addWorkspace = page.getByRole("menuitem", {
      name: "Add workspace…",
      exact: true,
    });
    await expect(page.getByRole("menuitem").first()).toHaveText("Add workspace…");
    await expect(addWorkspace).toHaveAttribute("href", "/settings/connections?add=1");
    await addWorkspace.focus();
    await page.keyboard.press("Enter");
    await page.waitForURL("**/settings/connections?add=1");
    if (mobile)
      await expect(page.getByRole("dialog", { name: "Navigation" })).toBeHidden();
  });
}
