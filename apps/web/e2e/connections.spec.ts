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
      "Use OvertChat as a web interface for coding agents.",
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
    page.getByRole("heading", { name: "Agent access" }),
  ).toBeVisible();
  await expect(page.getByText("Not set up", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Agents" }),
  ).toHaveCount(0);

  await page.getByRole("button", { name: "Set up" }).click();
  await expect(
    page.getByText("Install Host Connector", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Run this command in a terminal on the computer running OvertChat.",
      { exact: true },
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "About Host Connector" }).click();
  await expect(
    page.getByText(
      /Lets OvertChat use agent binaries and SSH hosts available on this server/,
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "View installer source" }),
  ).toHaveAttribute(
    "href",
    "https://github.com/yoloyash/overtchat/blob/main/scripts/install-connector.sh",
  );
  await page.keyboard.press("Escape");
  const command = await page.getByLabel("Host Connector install command").textContent();
  expect(command).toContain("https://overtchat.com/install/connector/0.2.0");
  expect(command).toContain("--server 'http://127.0.0.1:4718'");
  const pairCode = /--pair-code '([^']+)'/u.exec(command ?? "")?.[1];
  if (!pairCode) throw new Error("The Host Connector pairing code was missing.");

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
  await expect(page.getByRole("heading", { name: "Agents" })).toBeVisible();
  await expect(page.getByText("No agents added", { exact: true })).toBeVisible();
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

test("explains agent access before setup", async ({ page }, testInfo) => {
  await page.goto("/signup");
  await page.locator("#name").fill("Connections E2E Admin");
  await page
    .locator("#email")
    .fill("connections-admin@overtchat-test.local");
  await page.locator("#password").fill("test-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/", { timeout: 15_000 });

  const connectionsSection = page.getByText("Connections", { exact: true });
  await expect(connectionsSection).toBeVisible();
  await expect(
    connectionsSection.locator("..").getByText("Beta", { exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Add agent" }).click();
  await page.waitForURL("**/settings/connections?add=1");
  await expect(
    page.getByText(
      "Use OvertChat as a web interface for coding agents.",
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
    page.getByRole("heading", { name: "Agent access" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /Connections Beta/ }),
  ).toBeVisible();
  await expect(page.getByText("Not set up", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Agents" }),
  ).toHaveCount(0);

  await page.getByRole("button", { name: "Set up" }).click();
  await expect(
    page.getByText("Install Host Connector", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Run this command in a terminal on the computer running OvertChat.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByText("Waiting for connection…", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "About Host Connector" }).click();
  await expect(
    page.getByText(
      /Lets OvertChat use agent binaries and SSH hosts available on this server/,
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "View installer source" }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("agent-access-setup-desktop.png"),
    fullPage: true,
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: testInfo.outputPath("agent-access-setup-mobile.png"),
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

test("shows the Add agent flow after setup", async ({ page }, testInfo) => {
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
  await page.getByRole("button", { name: "Add agent" }).click();

  const dialog = page.getByRole("dialog", { name: "Add agent" });
  await expect(dialog).toBeVisible();
  const location = dialog.getByLabel("Connection location");
  await expect(location).toContainText("This server");
  await expect(location).toContainText("SSH host");
  await dialog.getByRole("button", { name: "Use custom executable" }).click();
  await expect(
    dialog.getByRole("button", { name: "Back", exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Add", exact: true }),
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
    await expect(
      page.getByRole("heading", { name: "Connections" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Add agent" }).click();
    const location = page.getByLabel("Connection location");
    await location.getByText("SSH host", { exact: true }).click();
    await expect(
      page.getByRole("button", { name: /docease-linode.*104\.237\.153\.169/ }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: /test-server.*10\.0\.0\.91:2222/ })
      .click();
    await expect(
      page.getByRole("button", { name: "Add Pi", exact: true }),
    ).toBeVisible();
    await expect(page.getByTitle("/usr/local/bin/pi")).toBeVisible();
    await expect(page.getByTitle("ssh test-server")).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("pi-ssh-picker.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: "SSH hosts" }).click();
    await page.getByRole("button", { name: "Add manually" }).click();
    await expect(page.getByLabel("SSH alias")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "SSH config" }),
    ).toBeVisible();
    await location.getByText("This server", { exact: true }).click();
    await expect(page.getByLabel("Connection location")).toContainText(
      "This server",
    );
    await expect(
      page.getByRole("button", { name: "Add Pi", exact: true }),
    ).toBeVisible({ timeout: 30_000 });
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
    await page.getByRole("button", { name: "Use custom executable" }).click();
    const customForm = page
      .locator("form")
      .filter({ has: page.getByLabel("Executable command or path") });
    await expect(
      customForm.getByLabel("Executable command or path"),
    ).toHaveValue("pi");
    await customForm.getByRole("button", { name: "Cancel" }).click();
    await page
      .getByRole("button", { name: "Add Pi", exact: true })
      .click();
    await expect(page.getByText("Pi added")).toBeVisible({
      timeout: 150_000,
    });
    await expect(page.getByText("This server").first()).toBeVisible();
  });

  await test.step("browse and attach the worktree directory", async () => {
    await page.getByRole("button", { name: "Add workspace" }).click();
    const dialog = page.getByRole("dialog", { name: "Add workspace" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTitle(os.homedir(), { exact: true })).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("workspace-dialog-desktop.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: testInfo.outputPath("workspace-dialog-mobile.png"),
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
    await dialog.getByRole("button", { name: "Enter path" }).click();
    await expect(dialog.getByLabel("Directory path")).toHaveValue(os.homedir());
    await dialog.getByRole("button", { name: "Browse folders" }).click();
    await expect(dialog.getByTitle(os.homedir(), { exact: true })).toBeVisible();
    const relativeWorkspacePath = path.relative(os.homedir(), workspacePath);
    expect(relativeWorkspacePath.startsWith("..")).toBe(false);
    for (const segment of relativeWorkspacePath.split(path.sep)) {
      await dialog
        .getByRole("button", { name: segment, exact: true })
        .click();
    }
    await expect(dialog.getByTitle(workspacePath, { exact: true })).toBeVisible();
    await dialog
      .getByRole("button", { name: "Add workspace", exact: true })
      .click();
    await expect(page.getByText("Workspace attached")).toBeVisible({
      timeout: 90_000,
    });
    await expect(
      page.getByTitle(workspacePath),
    ).toBeVisible();
  });

  await test.step("open a native Pi session from the sidebar hierarchy", async () => {
    await page
      .getByRole("button", { name: "Expand This server", exact: true })
      .click();
    await page
      .getByRole("button", { name: `Expand ${workspaceName}`, exact: true })
      .click();
    await page
      .getByRole("button", {
        name: `New session in ${workspaceName}`,
        exact: true,
      })
      .click();
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
  await page.getByRole("button", { name: "Add agent" }).click();
  await expect(
    page.getByRole("button", {
      name: "Add Oh My Pi",
      exact: true,
    }),
  ).toBeVisible({ timeout: 30_000 });
  await page.screenshot({
    path: testInfo.outputPath("omp-detected-installation.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", {
      name: "Add Oh My Pi",
      exact: true,
    })
    .click();
  await expect(page.getByText("Oh My Pi added")).toBeVisible({
    timeout: 150_000,
  });

  await page.getByRole("button", { name: "Add workspace" }).click();
  const dialog = page.getByRole("dialog", { name: "Add workspace" });
  const relativeWorkspacePath = path.relative(os.homedir(), workspacePath);
  expect(relativeWorkspacePath.startsWith("..")).toBe(false);
  for (const segment of relativeWorkspacePath.split(path.sep)) {
    await dialog
      .getByRole("button", { name: segment, exact: true })
      .click();
  }
  await dialog
    .getByRole("button", { name: "Add workspace", exact: true })
    .click();
  await expect(page.getByText("Workspace attached")).toBeVisible({
    timeout: 90_000,
  });

  await page
    .getByRole("button", { name: "Expand This server", exact: true })
    .click();
  await page
    .getByRole("button", { name: `Expand ${workspaceName}`, exact: true })
    .click();
  await page
    .getByRole("button", {
      name: `New session in ${workspaceName}`,
      exact: true,
    })
    .click();
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
  test.setTimeout(240_000);
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
  await page.getByRole("button", { name: "Add agent" }).click();
  await expect(
    page.getByRole("button", { name: "Add Codex", exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  await page
    .getByRole("button", { name: "Add Codex", exact: true })
    .click();
  await expect(page.getByText("Codex added")).toBeVisible({
    timeout: 150_000,
  });

  await page.getByRole("button", { name: "Add workspace" }).click();
  const dialog = page.getByRole("dialog", { name: "Add workspace" });
  await dialog.getByRole("button", { name: "Enter path" }).click();
  await dialog.getByLabel("Directory path").fill(workspacePath);
  await dialog
    .getByRole("button", { name: "Add workspace", exact: true })
    .click();
  await expect(page.getByText("Workspace attached")).toBeVisible({
    timeout: 90_000,
  });

  await page
    .getByRole("button", { name: "Expand This server", exact: true })
    .click();
  await page
    .getByRole("button", { name: `Expand ${workspaceName}`, exact: true })
    .click();
  await page
    .getByRole("button", {
      name: `New session in ${workspaceName}`,
      exact: true,
    })
    .click();
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
    .getByRole("button", { name: "Edit from this message" })
    .click();
  await page.waitForURL(
    (url) =>
      url.pathname.startsWith("/agents/") && url.href !== sourceUrl,
    { timeout: 30_000 },
  );
  await expect(composer).toHaveValue(prompt, { timeout: 30_000 });
  await expect(composer).toBeFocused();
  await expect
    .poll(() =>
      composer.evaluate((element) => {
        const textarea = element as HTMLTextAreaElement;
        return [textarea.selectionStart, textarea.selectionEnd];
      }),
    )
    .toEqual([prompt.length, prompt.length]);

  await page.goto(sourceUrl);
  await expect(
    page.locator("main").getByText(prompt, { exact: true }),
  ).toBeVisible({ timeout: 60_000 });
  await expect(
    page.getByText("OVERTCHAT_CODEX_E2E_OK", { exact: true }),
  ).toBeVisible({ timeout: 60_000 });

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
  await page.getByRole("button", { name: "Add agent" }).click();
  await page
    .getByLabel("Connection location")
    .getByText("SSH host", { exact: true })
    .click();

  const sshHost = page
    .getByRole("button")
    .filter({ hasText: sshAlias })
    .first();
  await expect(sshHost).toBeVisible({ timeout: 30_000 });
  await sshHost.click();
  await expect(
    page.getByRole("button", {
      name: "Add Oh My Pi",
      exact: true,
    }),
  ).toBeVisible({ timeout: 30_000 });
  await page
    .getByRole("button", {
      name: "Add Oh My Pi",
      exact: true,
    })
    .click();
  await expect(page.getByText("Oh My Pi added")).toBeVisible({
    timeout: 150_000,
  });

  await page.getByRole("button", { name: "Add workspace" }).click();
  const dialog = page.getByRole("dialog", { name: "Add workspace" });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByTitle(remoteWorkspace, { exact: true }),
  ).toBeVisible({
    timeout: 30_000,
  });
  await dialog.getByRole("button", { name: "Enter path" }).click();
  await dialog.getByLabel("Directory path").fill(remoteWorkspace);
  await dialog
    .getByRole("button", { name: "Add workspace", exact: true })
    .click();
  await expect(page.getByText("Workspace attached")).toBeVisible({
    timeout: 90_000,
  });
  await expect(
    page.getByTitle(remoteWorkspace, { exact: true }),
  ).toBeVisible();

  await page
    .getByRole("button", {
      name: `Expand ${sshAlias}`,
      exact: true,
    })
    .click();
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
