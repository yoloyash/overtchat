import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";
import {
  openE2eDatabase,
  resetE2eDatabase,
} from "./helpers/database";

const workspacePath = path.resolve(process.cwd(), "../..");
const workspaceName = path.basename(workspacePath);
const execFileAsync = promisify(execFile);
const connectorProcesses = new Set<ChildProcess>();

test.beforeEach(resetE2eDatabase);
test.afterEach(async () => {
  await Promise.all(
    [...connectorProcesses].map(
      (child) =>
        new Promise<void>((resolve) => {
          if (child.exitCode !== null || child.signalCode !== null) {
            resolve();
            return;
          }
          child.once("exit", () => resolve());
          child.kill("SIGTERM");
          setTimeout(() => {
            if (child.exitCode === null && child.signalCode === null) {
              child.kill("SIGKILL");
            }
          }, 2_000).unref();
        }),
    ),
  );
  connectorProcesses.clear();
});

async function startHostConnector(
  page: import("@playwright/test").Page,
  testInfo: import("@playwright/test").TestInfo,
): Promise<void> {
  await page.goto("/settings/connections");
  await expect(
    page.getByText(
      "Run coding agents in project folders on this server or over SSH.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.getByTitle("Pi", { exact: true })).toBeVisible();
  await expect(page.getByTitle("Oh My Pi", { exact: true })).toBeVisible();
  await expect(
    page.getByTitle("Claude Code · Coming soon", { exact: true }),
  ).toBeVisible();
  await expect(page.getByTitle("Codex", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Agent host" }),
  ).toBeVisible();
  await expect(page.getByText("Not set up", { exact: true })).toBeVisible();
  await expect(
    page.getByText(
      "Not installed on this server. Run: overtchat setup",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Set up" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Agent workspaces" }),
  ).toHaveCount(0);

  // Managed setup is the only user-facing installation path. Provision an
  // unmanaged connector through the authenticated API solely as an E2E fixture
  // so the connector transport and agent flows below remain covered.
  const { pairCode } = await page.evaluate(async () => {
    const response = await fetch("/api/host-connectors", { method: "POST" });
    if (!response.ok) {
      throw new Error(`Could not create connector fixture: ${response.status}`);
    }
    return (await response.json()) as { pairCode: string };
  });

  const server = new URL(page.url()).origin;
  const configPath = testInfo.outputPath("host-connector.json");
  const environment = {
    ...process.env,
    OVERTCHAT_CONNECTOR_CONFIG: configPath,
  };
  await execFileAsync(
    "npm",
    [
      "run",
      "dev",
      "-w",
      "apps/connector",
      "--",
      "pair",
      "--server",
      server,
      "--pair-code",
      pairCode,
      "--name",
      "Playwright host",
    ],
    { cwd: workspacePath, env: environment },
  );
  const child = spawn(
    "npm",
    ["run", "dev", "-w", "apps/connector", "--", "run"],
    {
      cwd: workspacePath,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  connectorProcesses.add(child);

  let connectorOutput = "";
  child.stdout?.on("data", (chunk) => {
    connectorOutput += chunk.toString();
  });
  child.stderr?.on("data", (chunk) => {
    connectorOutput += chunk.toString();
  });
  await expect
    .poll(
      async () => {
        if (child.exitCode !== null) {
          throw new Error(
            `Host Connector exited with ${child.exitCode}: ${connectorOutput}`,
          );
        }
        return page.evaluate(async () => {
          const response = await fetch("/api/host-connectors");
          if (!response.ok) return false;
          const data = (await response.json()) as {
            connectors: Array<{ online: boolean }>;
          };
          return data.connectors[0]?.online ?? false;
        });
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  await page.reload();
  await expect(page.getByText("Playwright host · Online")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Agent workspaces" })).toBeVisible();
  await expect(
    page.getByText("No agent workspaces added", { exact: true }),
  ).toBeVisible();
}

function seedSidebarSessions(count: number) {
  const db = openE2eDatabase();
  try {
    const workspace = db
      .prepare("SELECT id FROM agent_workspaces LIMIT 1")
      .get() as { id: string } | undefined;
    if (!workspace) throw new Error("Expected an attached agent workspace.");
    const insert = db.prepare(`
      INSERT INTO agent_sessions (
        id, workspace_id, provider_session_id, provider_session_path,
        name, first_message, message_count, provider_created_at,
        provider_modified_at, last_synced_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, NULL, 0, ?, ?, ?, ?, ?)
    `);
    const now = Date.now();
    db.transaction(() => {
      for (let index = 0; index < count; index += 1) {
        const timestamp = now - (index + 1) * 60_000;
        insert.run(
          randomUUID(),
          workspace.id,
          `sidebar-provider-${index}`,
          `/tmp/overtchat-sidebar-${index}.jsonl`,
          `Sidebar fixture ${index + 1}`,
          timestamp,
          timestamp,
          timestamp,
          timestamp,
          timestamp,
        );
      }
    })();
  } finally {
    db.close();
  }
}

function seedMixedProviderWorkspace() {
  const db = openE2eDatabase();
  try {
    const connector = db
      .prepare("SELECT id, user_id AS userId FROM host_connectors LIMIT 1")
      .get() as { id: string; userId: string } | undefined;
    if (!connector) throw new Error("Expected a paired Host Connector.");
    const host = { id: randomUUID() };
    db.prepare(`
      INSERT INTO agent_hosts (
        id, user_id, connector_id, name, transport, ssh_alias
      ) VALUES (?, ?, ?, 'This server', 'local', NULL)
    `).run(host.id, connector.userId, connector.id);
    const now = Date.now();
    const entries = [
      {
        provider: "codex",
        executable: "codex",
        sessionName: "Codex sidebar chat",
      },
      {
        provider: "omp",
        executable: "omp",
        sessionName: "OMP sidebar chat",
      },
    ];
    const workspaceIds: Record<string, string> = {};
    db.transaction(() => {
      for (const entry of entries) {
        const connectionId = randomUUID();
        const workspaceId = randomUUID();
        workspaceIds[entry.provider] = workspaceId;
        db.prepare(`
          INSERT INTO agent_connections (
            id, host_id, provider, executable, shell_mode,
            detected_version, last_validated_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, 'login', 'test', ?, ?, ?)
        `).run(
          connectionId,
          host.id,
          entry.provider,
          entry.executable,
          now,
          now,
          now,
        );
        db.prepare(`
          INSERT INTO agent_workspaces (
            id, connection_id, path, name, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?)
        `).run(workspaceId, connectionId, workspacePath, workspaceName, now, now);
        db.prepare(`
          INSERT INTO agent_sessions (
            id, workspace_id, provider_session_id, provider_session_path,
            name, first_message, message_count, provider_created_at,
            provider_modified_at, last_synced_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, NULL, 1, ?, ?, ?, ?, ?)
        `).run(
          randomUUID(),
          workspaceId,
          `${entry.provider}-native`,
          `/tmp/${entry.provider}-native.jsonl`,
          entry.sessionName,
          now,
          now,
          now,
          now,
          now,
        );
      }
    })();
    return workspaceIds;
  } finally {
    db.close();
  }
}

async function enterWorkspacePath(
  dialog: import("@playwright/test").Locator,
  workspace: string,
): Promise<void> {
  await dialog.getByRole("button", { name: "Enter path" }).click();
  await dialog.getByLabel("Directory path").fill(workspace);
}

test("explains agent access before setup", async ({ page }, testInfo) => {
  await page.goto("/signup");
  await page.locator("#name").fill("Connections E2E Admin");
  await page
    .locator("#email")
    .fill("connections-admin@overtchat-test.local");
  await page.locator("#password").fill("test-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/", { timeout: 15_000 });

  await expect(
    page.getByText("Agent workspaces", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Add workspace" }),
  ).toHaveCount(0);
  await page.goto("/settings/connections");
  await expect(
    page.getByText(
      "Run coding agents in project folders on this server or over SSH.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.getByTitle("Pi", { exact: true })).toBeVisible();
  await expect(page.getByTitle("Oh My Pi", { exact: true })).toBeVisible();
  await expect(
    page.getByTitle("Claude Code · Coming soon", { exact: true }),
  ).toBeVisible();
  await expect(page.getByTitle("Codex", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Agent host" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /Agents Beta/ }),
  ).toBeVisible();
  await expect(page.getByText("Not set up", { exact: true })).toBeVisible();
  await expect(
    page.getByText(
      "Not installed on this server. Run: overtchat setup",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Set up" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Agent workspaces" }),
  ).toHaveCount(0);

  await page.screenshot({
    path: testInfo.outputPath("agent-access-uninstalled-desktop.png"),
    fullPage: true,
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: testInfo.outputPath("agent-access-uninstalled-mobile.png"),
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

test("shows the no-re-pair upgrade command for an older connector", async ({
  page,
}) => {
  const upgradeCommand =
    "curl --proto '=https' --tlsv1.2 -fsSL https://overtchat.com/install/connector/0.3.4 | sh -s -- --upgrade";
  await page.route("**/api/host-connectors", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        connectors: [
          {
            id: "older-connector",
            name: "Home server",
            version: "0.2.0",
            lastSeenAt: Date.now(),
            online: true,
            upgrade: { version: "0.3.4", command: upgradeCommand },
          },
        ],
      }),
    });
  });
  await page.goto("/signup");
  await page.locator("#name").fill("Connector Upgrade Admin");
  await page.locator("#email").fill("connector-upgrade@overtchat-test.local");
  await page.locator("#password").fill("test-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/", { timeout: 15_000 });

  await page.goto("/settings/connections");

  await expect(
    page.getByText("Host Connector 0.3.4 is available", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Host Connector upgrade command")).toHaveText(
    upgradeCommand,
  );
  await expect(
    page.getByRole("button", { name: "Copy connector upgrade command" }),
  ).toBeVisible();
  await expect(
    page.getByText(/without changing the existing pairing or settings/u),
  ).toBeVisible();
});

test("shows the consolidated Add workspace flow after setup", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await page.goto("/signup");
  await page.locator("#name").fill("Agent Setup E2E Admin");
  await page
    .locator("#email")
    .fill("agent-setup-admin@overtchat-test.local");
  await page.locator("#password").fill("test-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/", { timeout: 15_000 });

  await startHostConnector(page, testInfo);
  await expect(page.getByText("Local agents and SSH")).toBeVisible();
  await page.getByRole("button", { name: "Add workspace" }).click();

  const dialog = page.getByRole("dialog", { name: "Add workspace" });
  await expect(dialog).toBeVisible();
  const location = dialog.getByLabel("Workspace machine");
  await expect(location).toContainText("This server");
  await expect(location).toContainText("SSH host");
  await expect(dialog.getByText("2. Project folder", { exact: true })).toBeVisible();
  await expect(dialog.getByText("3. Agent", { exact: true })).toHaveCount(0);
  await expect(dialog.getByTitle(os.homedir(), { exact: true })).toBeVisible();
  await expect(dialog.getByText("Agents are automatic", { exact: true })).toBeVisible();
  const configureManually = dialog.getByRole("button", {
    name: "Configure manually",
  });
  await expect(configureManually).toBeEnabled();
  await configureManually.click();
  await expect(
    dialog.getByRole("button", { name: "Use automatic detection", exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Add workspace", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("add-agent-dialog-desktop.png"),
    fullPage: true,
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: testInfo.outputPath("add-agent-dialog-mobile.png"),
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

test("groups providers by directory, filters chats, refreshes globally, and reveals launch options progressively", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  await page.goto("/signup");
  await page.locator("#name").fill("Workspace UX E2E Admin");
  await page
    .locator("#email")
    .fill("workspace-ux-admin@overtchat-test.local");
  await page.locator("#password").fill("test-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/", { timeout: 15_000 });

  await startHostConnector(page, testInfo);
  const workspaceIds = seedMixedProviderWorkspace();
  await page.route("**/api/agent-connections/discover", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        installations: [
          { provider: "codex", executable: "codex", version: "test" },
          { provider: "omp", executable: "omp", version: "test" },
        ],
      }),
    });
  });
  await page.route(
    /\/api\/agent-workspaces\/[^/]+\/catalog$/u,
    async (route) => {
      const id = new URL(route.request().url()).pathname.split("/").at(-2);
      const provider = id === workspaceIds.codex ? "codex" : "omp";
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          provider,
          models: [
            {
              provider,
              id: `${provider}-model`,
              label: `${provider} model`,
              isDefault: true,
              api: provider,
              baseUrl: "",
              reasoning: true,
              input: ["text"],
              contextWindow: null,
              maxTokens: null,
              thinkingOptions: [
                { id: "high", label: "High", isDefault: true },
              ],
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            },
          ],
          modes: [
            {
              id: "full",
              label: "Full access",
              description: "Full workspace access",
            },
          ],
          defaultModeId: "full",
        }),
      });
    },
  );
  await page.route(/\/api\/agent-workspaces\/[^/]+$/u, async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ sessions: [] }),
      });
      return;
    }
    await route.continue();
  });

  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Agent workspace options" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Add workspace" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: `Expand ${workspaceName}` })
    .click();
  await expect(page.getByRole("link", { name: "Codex sidebar chat" })).toBeVisible();
  await expect(page.getByRole("link", { name: "OMP sidebar chat" })).toBeVisible();

  await page.getByRole("button", { name: "Agent workspace options" }).click();
  await expect(
    page.getByRole("menuitemradio", { name: "All agents" }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("workspace-options-menu.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("menuitemradio", { name: "Codex" }).click();
  await expect(page.getByRole("link", { name: "Codex sidebar chat" })).toBeVisible();
  await expect(page.getByRole("link", { name: "OMP sidebar chat" })).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: "Agent workspace options, filtered by Codex",
    }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "Agent workspace options, filtered by Codex",
    })
    .click();
  await page.getByRole("menuitemradio", { name: "All agents" }).click();
  await page.screenshot({
    path: testInfo.outputPath("workspace-leading-provider-logos.png"),
    fullPage: true,
    animations: "disabled",
  });

  await page.getByRole("button", { name: "Agent workspace options" }).click();
  await page.getByRole("menuitem", { name: "Refresh all chats" }).click();
  await expect(page.getByText("Chats refreshed", { exact: true })).toBeVisible();

  await page
    .getByRole("button", { name: `New session in ${workspaceName}` })
    .click();
  const dialog = page.getByRole("dialog", {
    name: `New session in ${workspaceName}`,
  });
  await expect(dialog.getByText("Choose an agent", { exact: true })).toBeVisible();
  await expect(dialog.getByLabel("Model")).toHaveCount(0);
  await expect(dialog.getByText(workspaceIds.codex, { exact: true })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Select Codex" }).click();
  await expect(dialog.getByLabel("Model")).toBeVisible();
  await expect(dialog.getByLabel("Reasoning")).toBeVisible();
  await expect(dialog.getByLabel("Permissions")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Start session" })).toBeEnabled();

  await page.screenshot({
    path: testInfo.outputPath("workspace-progressive-launch.png"),
    fullPage: true,
  });
});

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

  await test.step("add the local Pi workspace", async () => {
    await startHostConnector(page, testInfo);
    await page.route("**/api/agent-connections/ssh-hosts*", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          hosts: [
            {
              alias: "docease-linode",
              hostname: "104.237.153.169",
              port: 22,
              username: "root",
            },
            {
              alias: "test-server",
              hostname: "10.0.0.91",
              port: 2222,
              username: "developer",
            },
          ],
        }),
      });
    });
    await page.route(
      "**/api/agent-connections/discover",
      async (route) => {
        const target = route.request().postDataJSON() as {
          transport?: string;
        };
        if (target.transport !== "ssh") {
          await route.continue();
          return;
        }
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            installations: [
              {
                provider: "pi",
                executable: "/usr/local/bin/pi",
                version: "0.42.3",
              },
            ],
          }),
        });
      },
    );
    await page.route(
      "**/api/agent-connections/directories",
      async (route) => {
        const body = route.request().postDataJSON() as {
          target?: { transport?: string };
        };
        if (body.target?.transport !== "ssh") {
          await route.continue();
          return;
        }
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            directory: {
              path: os.homedir(),
              parent: path.dirname(os.homedir()),
              directories: [],
            },
          }),
        });
      },
    );
    await expect(
      page.getByRole("heading", { name: /Agents Beta/ }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Add workspace" }).click();
    const dialog = page.getByRole("dialog", { name: "Add workspace" });
    const location = dialog.getByLabel("Workspace machine");
    await location.getByText("SSH host", { exact: true }).click();
    await expect(
      page.getByRole("button", { name: /docease-linode.*104\.237\.153\.169/ }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: /test-server.*10\.0\.0\.91:2222/ })
      .click();
    await expect(dialog.getByText("ssh test-server", { exact: true })).toBeVisible();
    await expect(dialog.getByText("Pi", { exact: true })).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("pi-ssh-picker.png"),
      fullPage: true,
    });
    await dialog.getByRole("button", { name: "Change host" }).click();
    await dialog.getByRole("button", { name: "Add manually" }).click();
    await expect(dialog.getByLabel("SSH alias")).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "SSH config" }),
    ).toBeVisible();
    await location.getByText("This server", { exact: true }).click();
    await expect(dialog.getByLabel("Workspace machine")).toContainText(
      "This server",
    );
    await enterWorkspacePath(dialog, workspacePath);
    await expect(dialog.getByText("Pi", { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: testInfo.outputPath("pi-connection-dialog-mobile.png"),
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    ).toBe(true);
    await page.setViewportSize({ width: 1280, height: 720 });
    await dialog
      .getByRole("button", { name: "Add workspace", exact: true })
      .click();
    await expect(page.getByText("Agent workspace added")).toBeVisible({
      timeout: 150_000,
    });
    await expect(page.getByTitle(workspacePath)).toBeVisible();
  });

  await test.step("open a native Pi session from the sidebar hierarchy", async () => {
    await page
      .getByRole("button", { name: `Expand ${workspaceName}`, exact: true })
      .click();
    await page
      .getByRole("button", {
        name: `New session in ${workspaceName}`,
        exact: true,
      })
      .click();
    const sessionDialog = page.getByRole("dialog", {
      name: `New session in ${workspaceName}`,
    });
    await sessionDialog.getByRole("button", { name: "Select Pi" }).click();
    await expect(sessionDialog.getByLabel("Model")).toBeVisible({
      timeout: 30_000,
    });
    await sessionDialog.getByRole("button", { name: "Start session" }).click();
    await page.waitForURL("**/agents/**", { timeout: 150_000 });
    await expect(page.getByText("New Pi session")).toBeVisible({
      timeout: 150_000,
    });
    await expect(
      page.getByTestId("agent-composer").getByRole("combobox"),
    ).toBeVisible();
    await expect(page.getByLabel("Session usage")).toBeVisible();
    await expect(page.getByLabel("Session actions")).toBeVisible();
  });

  await test.step("select and execute a built-in slash command", async () => {
    const composer = page.getByTestId("agent-composer").getByRole("combobox");
    await composer.fill("/na");
    const nameCommand = page.getByRole("option", {
      name: /\/name.*Set the session name.*Built-in/,
    });
    await expect(nameCommand).toBeVisible();
    await composer.press("Enter");
    await expect(composer).toHaveValue("/name ");
    await composer.fill("/name Slash Command Session");
    await composer.press("Enter");
    await expect(page).toHaveTitle("Slash Command Session · Pi", {
      timeout: 30_000,
    });
    await expect(page.getByText("Session renamed")).toBeVisible();
    await composer.fill("/autocompact off");
    await composer.press("Enter");
    await expect(page.getByText("Auto-compaction disabled")).toBeVisible();

    const previousUrl = page.url();
    await composer.fill("/new");
    await composer.press("Enter");
    await page.waitForURL(
      (url) =>
        url.pathname.startsWith("/agents/") && url.href !== previousUrl,
      { timeout: 30_000 },
    );
    await expect(page.getByText("New Pi session")).toBeVisible();
  });

  await test.step("limit and expand workspace sessions in the sidebar", async () => {
    seedSidebarSessions(12);
    await page.reload();
    const showMore = page.getByRole("button", {
      name: /Show \d+ more/,
    });
    await expect(showMore).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Sidebar fixture 12" }),
    ).not.toBeVisible();
    await showMore.click();
    await expect(
      page.getByRole("link", { name: "Sidebar fixture 12" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Show less" }).click();
    await expect(
      page.getByRole("link", { name: "Sidebar fixture 12" }),
    ).not.toBeVisible();
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
      page.getByTestId("agent-composer").getByRole("combobox"),
    ).toBeVisible();
    await page.getByLabel("Open sidebar").click();
    await expect(
      page
        .getByText("Agent workspaces", { exact: true })
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

test("connect local Oh My Pi and use its native commands", async ({
  page,
}, testInfo) => {
  test.skip(
    process.env.RUN_OMP_E2E !== "1",
    "Set RUN_OMP_E2E=1 on a machine with Oh My Pi installed.",
  );

  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });

  await page.goto("/signup");
  await page.locator("#name").fill("OMP E2E Admin");
  await page.locator("#email").fill("omp-admin@overtchat-test.local");
  await page.locator("#password").fill("test-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/", { timeout: 15_000 });

  await startHostConnector(page, testInfo);
  await page.getByRole("button", { name: "Add workspace" }).click();
  const dialog = page.getByRole("dialog", { name: "Add workspace" });
  await enterWorkspacePath(dialog, workspacePath);
  await expect(dialog.getByText("Oh My Pi", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await page.screenshot({
    path: testInfo.outputPath("omp-detected-installation.png"),
    fullPage: true,
  });
  await dialog
    .getByRole("button", { name: "Add workspace", exact: true })
    .click();
  await expect(page.getByText("Agent workspace added")).toBeVisible({
    timeout: 150_000,
  });

  await page
    .getByRole("button", { name: `Expand ${workspaceName}`, exact: true })
    .click();
  await page
    .getByRole("button", {
      name: `New session in ${workspaceName}`,
      exact: true,
    })
    .click();
  const sessionDialog = page.getByRole("dialog", {
    name: `New session in ${workspaceName}`,
  });
  await sessionDialog
    .getByRole("button", { name: "Select Oh My Pi" })
    .click();
  await expect(sessionDialog.getByLabel("Model")).toBeVisible({
    timeout: 30_000,
  });
  await sessionDialog.getByRole("button", { name: "Start session" }).click();
  await page.waitForURL("**/agents/**", { timeout: 150_000 });
  await expect(page.getByText("New Oh My Pi session")).toBeVisible({
    timeout: 150_000,
  });

  const composer = page.getByTestId("agent-composer").getByRole("combobox");
  await composer.fill("/model");
  await composer.press("Enter");
  await expect(page.getByText(/Current model:/)).toBeVisible({
    timeout: 30_000,
  });

  const previousUrl = page.url();
  await composer.fill("/new");
  await composer.press("Enter");
  await page.waitForURL(
    (url) =>
      url.pathname.startsWith("/agents/") && url.href !== previousUrl,
    { timeout: 30_000 },
  );
  await expect(page.getByText("New Oh My Pi session")).toBeVisible();
  expect(browserErrors).toEqual([]);
});

test("connect local Codex and resume a native thread", async ({
  page,
}, testInfo) => {
  test.setTimeout(360_000);
  test.skip(
    process.env.RUN_CODEX_E2E !== "1",
    "Set RUN_CODEX_E2E=1 on a machine with Codex installed and signed in.",
  );

  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });

  await page.goto("/signup");
  await page.locator("#name").fill("Codex E2E Admin");
  await page
    .locator("#email")
    .fill("codex-admin@overtchat-test.local");
  await page.locator("#password").fill("test-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/", { timeout: 15_000 });

  await startHostConnector(page, testInfo);
  await page.getByRole("button", { name: "Add workspace" }).click();
  const dialog = page.getByRole("dialog", { name: "Add workspace" });
  await enterWorkspacePath(dialog, workspacePath);
  await expect(dialog.getByText("Codex", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await dialog
    .getByRole("button", { name: "Add workspace", exact: true })
    .click();
  await expect(page.getByText("Agent workspace added")).toBeVisible({
    timeout: 150_000,
  });

  await page
    .getByRole("button", { name: `Expand ${workspaceName}`, exact: true })
    .click();
  await page
    .getByRole("button", {
      name: `New session in ${workspaceName}`,
      exact: true,
    })
    .click();
  const sessionDialog = page.getByRole("dialog", {
    name: `New session in ${workspaceName}`,
  });
  await sessionDialog.getByRole("button", { name: "Select Codex" }).click();
  await expect(sessionDialog.getByLabel("Model")).toBeVisible({
    timeout: 30_000,
  });
  await sessionDialog.getByRole("button", { name: "Start session" }).click();
  await page.waitForURL("**/agents/**", { timeout: 150_000 });
  await expect(page.getByText("New Codex session")).toBeVisible({
    timeout: 150_000,
  });

  const composer = page.getByTestId("agent-composer").getByRole("combobox");
  await composer.fill("/usage");
  await composer.press("Enter");
  const usageDialog = page.getByRole("dialog", { name: "Codex usage" });
  await expect(usageDialog).toBeVisible({ timeout: 30_000 });
  await usageDialog.getByRole("button", { name: "Done" }).click();

  const prompt =
    "Respond with exactly OVERTCHAT_CODEX_E2E_OK and nothing else.";
  await composer.fill(prompt);
  await composer.press("Enter");
  await expect(
    page.getByText("OVERTCHAT_CODEX_E2E_OK", { exact: true }),
  ).toBeVisible({ timeout: 150_000 });
  await expect(composer).toBeEnabled({ timeout: 30_000 });
  await expect(composer).toHaveValue("");
  await expect(
    page.locator("main").getByText(prompt, { exact: true }),
  ).toBeVisible();

  await page.reload();
  await expect(
    page.locator("main").getByText(prompt, { exact: true }),
  ).toBeVisible({ timeout: 60_000 });
  await expect(
    page.getByText("OVERTCHAT_CODEX_E2E_OK", { exact: true }),
  ).toBeVisible({ timeout: 60_000 });

  const sourceUrl = page.url();
  await page
    .getByRole("button", { name: "Fork from this response" })
    .click();
  await page.waitForURL(
    (url) =>
      url.pathname.startsWith("/agents/") && url.href !== sourceUrl,
    { timeout: 30_000 },
  );
  await expect(
    page.locator("main").getByText(prompt, { exact: true }),
  ).toBeVisible({ timeout: 60_000 });
  await expect(
    page.getByText("OVERTCHAT_CODEX_E2E_OK", { exact: true }),
  ).toBeVisible({ timeout: 60_000 });
  await page.screenshot({
    path: testInfo.outputPath("codex-forked-session-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("button", { name: "Edit from this message" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Fork from this response" }),
  ).toBeVisible();
  const editBounds = await page
    .getByRole("button", { name: "Edit from this message" })
    .boundingBox();
  expect(editBounds).not.toBeNull();
  expect(editBounds!.x).toBeGreaterThanOrEqual(0);
  expect(editBounds!.x + editBounds!.width).toBeLessThanOrEqual(390);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("codex-forked-session-mobile.png"),
    fullPage: true,
  });

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(sourceUrl);
  await page
    .getByRole("button", { name: "Edit from this message" })
    .click();
  await expect(composer).toHaveValue(prompt, { timeout: 30_000 });
  await expect(page).toHaveURL(sourceUrl);
  await expect(composer).toBeFocused();
  await expect
    .poll(() =>
      composer.evaluate((element) => {
        const textarea = element as HTMLTextAreaElement;
        return [textarea.selectionStart, textarea.selectionEnd];
      }),
    )
    .toEqual([prompt.length, prompt.length]);
  await expect(
    page.getByRole("region", { name: "Read-only Codex session" }),
  ).toHaveCount(0);
  await expect(
    page.getByTestId("agent-message-list").getByText(prompt, { exact: true }),
  ).toHaveCount(0);
  await expect(
    page
      .getByTestId("agent-message-list")
      .getByText("OVERTCHAT_CODEX_E2E_OK", { exact: true }),
  ).toHaveCount(0);
  await composer.press("Enter");
  await expect(
    page.getByText("OVERTCHAT_CODEX_E2E_OK", { exact: true }),
  ).toBeVisible({ timeout: 150_000 });
  await expect(composer).toBeEnabled({ timeout: 30_000 });
  expect(browserErrors).toEqual([]);
});

test("connect to Oh My Pi through an existing SSH alias", async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  test.skip(
    process.env.RUN_OMP_SSH_E2E !== "1",
    "Set RUN_OMP_SSH_E2E=1 on a machine with a working OMP SSH alias.",
  );

  const sshAlias = process.env.OMP_SSH_ALIAS ?? "macbook";
  const remoteWorkspace =
    process.env.OMP_SSH_WORKSPACE ?? "/Users/yash";
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });

  await page.goto("/signup");
  await page.locator("#name").fill("OMP SSH E2E Admin");
  await page
    .locator("#email")
    .fill("omp-ssh-admin@overtchat-test.local");
  await page.locator("#password").fill("test-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/", { timeout: 15_000 });

  await startHostConnector(page, testInfo);
  await page.getByRole("button", { name: "Add workspace" }).click();
  const dialog = page.getByRole("dialog", { name: "Add workspace" });
  await dialog
    .getByLabel("Workspace machine")
    .getByText("SSH host", { exact: true })
    .click();

  const sshHost = dialog
    .getByRole("button")
    .filter({ hasText: sshAlias })
    .first();
  await expect(sshHost).toBeVisible({ timeout: 30_000 });
  await sshHost.click();
  await enterWorkspacePath(dialog, remoteWorkspace);
  await expect(dialog.getByText("Oh My Pi", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await dialog
    .getByRole("button", { name: "Add workspace", exact: true })
    .click();
  await expect(page.getByText("Agent workspace added")).toBeVisible({
    timeout: 150_000,
  });
  await expect(
    page.getByTitle(remoteWorkspace, { exact: true }),
  ).toBeVisible();

  const remoteWorkspaceName = path.basename(remoteWorkspace);
  await page
    .getByRole("button", {
      name: `Expand ${remoteWorkspaceName}`,
      exact: true,
    })
    .click();
  await page
    .getByRole("button", {
      name: `New session in ${remoteWorkspaceName}`,
      exact: true,
    })
    .click();
  const sessionDialog = page.getByRole("dialog", {
    name: `New session in ${remoteWorkspaceName}`,
  });
  await sessionDialog
    .getByRole("button", { name: "Select Oh My Pi" })
    .click();
  await expect(sessionDialog.getByLabel("Model")).toBeVisible({
    timeout: 30_000,
  });
  await sessionDialog.getByRole("button", { name: "Start session" }).click();
  await page.waitForURL("**/agents/**", { timeout: 150_000 });
  await expect(page.getByText("New Oh My Pi session")).toBeVisible({
    timeout: 150_000,
  });

  const composer = page.getByTestId("agent-composer").getByRole("combobox");
  await composer.fill("/model");
  await composer.press("Enter");
  await expect(page.getByText(/Current model:/)).toBeVisible({
    timeout: 30_000,
  });

  const previousUrl = page.url();
  await composer.fill("/new");
  await composer.press("Enter");
  await page.waitForURL(
    (url) =>
      url.pathname.startsWith("/agents/") && url.href !== previousUrl,
    { timeout: 30_000 },
  );
  await expect(page.getByText("New Oh My Pi session")).toBeVisible();
  expect(browserErrors).toEqual([]);
});
