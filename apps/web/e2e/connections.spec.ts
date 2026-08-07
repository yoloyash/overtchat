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
  await page.getByRole("button", { name: "Connect this machine" }).click();
  const command = await page.getByLabel("Host Connector install command").textContent();
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
    await page.getByRole("button", { name: "Add connection" }).click();
    const location = page.getByLabel("Connection location");
    await location.getByText("SSH", { exact: true }).click();
    await expect(
      page.getByRole("button", { name: /docease-linode.*104\.237\.153\.169/ }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: /test-server.*10\.0\.0\.91:2222/ })
      .click();
    await expect(
      page.getByRole("button", { name: "Connect Pi", exact: true }),
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
    await location.getByText("This machine", { exact: true }).click();
    await expect(page.getByLabel("Connection location")).toContainText(
      "This machine",
    );
    await expect(
      page.getByRole("button", { name: "Connect Pi", exact: true }),
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
      .getByRole("button", { name: "Connect Pi", exact: true })
      .click();
    await expect(page.getByText("Pi connected")).toBeVisible({
      timeout: 150_000,
    });
    await expect(page.getByText("This machine").first()).toBeVisible();
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
      .getByRole("button", { name: "This machine Pi", exact: true })
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

  await test.step("select and execute a built-in slash command", async () => {
    const composer = page.getByPlaceholder(
      "Message Pi or type / for commands",
    );
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
  await page.getByRole("button", { name: "Add connection" }).click();
  await expect(
    page.getByRole("button", {
      name: "Connect Oh My Pi",
      exact: true,
    }),
  ).toBeVisible({ timeout: 30_000 });
  await page.screenshot({
    path: testInfo.outputPath("omp-detected-installation.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", {
      name: "Connect Oh My Pi",
      exact: true,
    })
    .click();
  await expect(page.getByText("Oh My Pi connected")).toBeVisible({
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
  await dialog.getByRole("button", { name: "Select" }).click();
  await dialog.getByRole("button", { name: "Attach" }).click();
  await expect(page.getByText("Workspace attached")).toBeVisible({
    timeout: 90_000,
  });

  await page
    .getByRole("button", { name: "This machine Oh My Pi", exact: true })
    .click();
  await page
    .getByRole("button", { name: workspaceName, exact: true })
    .click();
  await page
    .getByRole("button", { name: "New session", exact: true })
    .click();
  await page.waitForURL("**/agents/**", { timeout: 150_000 });
  await expect(page.getByText("New Oh My Pi session")).toBeVisible({
    timeout: 150_000,
  });

  const composer = page.getByPlaceholder(
    "Message Oh My Pi or type / for commands",
  );
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
  await page.getByRole("button", { name: "Add connection" }).click();
  await page
    .getByLabel("Connection location")
    .getByText("SSH", { exact: true })
    .click();

  const sshHost = page
    .getByRole("button")
    .filter({ hasText: sshAlias })
    .first();
  await expect(sshHost).toBeVisible({ timeout: 30_000 });
  await sshHost.click();
  await expect(
    page.getByRole("button", {
      name: "Connect Oh My Pi",
      exact: true,
    }),
  ).toBeVisible({ timeout: 30_000 });
  await page
    .getByRole("button", {
      name: "Connect Oh My Pi",
      exact: true,
    })
    .click();
  await expect(page.getByText("Oh My Pi connected")).toBeVisible({
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
  await dialog.locator("#agent-workspace-path").fill(remoteWorkspace);
  await dialog.getByRole("button", { name: "Attach" }).click();
  await expect(page.getByText("Workspace attached")).toBeVisible({
    timeout: 90_000,
  });
  await expect(
    page.getByTitle(remoteWorkspace, { exact: true }),
  ).toBeVisible();

  await page
    .getByRole("button", {
      name: `${sshAlias} Oh My Pi`,
      exact: true,
    })
    .click();
  await page
    .getByRole("button", {
      name: path.basename(remoteWorkspace),
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "New session", exact: true })
    .click();
  await page.waitForURL("**/agents/**", { timeout: 150_000 });
  await expect(page.getByText("New Oh My Pi session")).toBeVisible({
    timeout: 150_000,
  });

  const composer = page.getByPlaceholder(
    "Message Oh My Pi or type / for commands",
  );
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
