import { expect, test } from "@playwright/test";
import type { AgentConnectionListItem } from "@/lib/agents/types";
import {
  openE2eDatabase,
  resetE2eDatabase,
} from "./helpers/database";

const SESSION_ID = "runtime-session";

test.beforeEach(resetE2eDatabase);

function seedAgentSession() {
  const db = openE2eDatabase();
  try {
    const admin = db
      .prepare("SELECT id FROM user LIMIT 1")
      .get() as { id: string } | undefined;
    if (!admin) throw new Error("Expected the administrator to exist.");

    db.prepare(`
      INSERT INTO host_connectors (id, user_id, name, token_hash)
      VALUES ('connector', ?, 'Runtime test connector', 'test-token-hash')
    `).run(admin.id);
    db.prepare(`
      INSERT INTO agent_hosts (
        id, user_id, connector_id, name, transport, ssh_alias
      ) VALUES ('host', ?, 'connector', 'This machine', 'local', NULL)
    `).run(admin.id);
    db.prepare(`
      INSERT INTO agent_connections (
        id, host_id, provider, executable, detected_version
      ) VALUES ('connection', 'host', 'pi', 'pi', 'test')
    `).run();
    db.prepare(`
      INSERT INTO agent_workspaces (id, connection_id, path, name)
      VALUES ('workspace', 'connection', '/tmp/runtime-test', 'Runtime test')
    `).run();
    db.prepare(`
      INSERT INTO agent_sessions (
        id, workspace_id, provider_session_id, provider_session_path,
        name, first_message, message_count
      ) VALUES (?, 'workspace', 'native-session', '/tmp/runtime-test.jsonl',
        'Runtime activity', 'Inspect the runtime', 3)
    `).run(SESSION_ID);
  } finally {
    db.close();
  }
}

function runtimeSnapshot(startedAt: number) {
  return {
    sessionId: SESSION_ID,
    provider: "pi",
    capabilities: { steer: true },
    status: "running",
    activeTurn: { startedAt },
    state: {
      isStreaming: true,
      isCompacting: false,
      sessionName: "Runtime activity",
    },
    messages: [
      {
        role: "user",
        content: "Inspect the runtime",
        timestamp: 1,
      },
      {
        role: "assistant",
        content: [
          {
            type: "thinking",
            thinking: "I should inspect the runtime before responding.",
          },
          {
            type: "text",
            text: "I will inspect the runtime.",
          },
        ],
        timestamp: 2,
      },
      {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "command",
            name: "bash",
            arguments: { command: "printf done" },
          },
        ],
        timestamp: 3,
      },
      {
        role: "toolResult",
        toolCallId: "command",
        toolName: "bash",
        content: [{ type: "text", text: "done" }],
        isError: false,
        timestamp: 4,
      },
      {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "edit",
            name: "apply_patch",
            arguments: {
              path: "apps/web/runtime.ts",
              patch:
                "@@ -1,2 +1,2 @@\n-export const state = 'old';\n+export const state = 'ready';",
            },
          },
        ],
        timestamp: 5,
      },
      {
        role: "toolResult",
        toolCallId: "edit",
        toolName: "apply_patch",
        content: [{ type: "text", text: "Done!" }],
        isError: false,
        timestamp: 6,
      },
      {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "search",
            name: "grep",
            arguments: {
              pattern: "runtimeStatus",
              path: "apps/web",
            },
          },
        ],
        timestamp: 7,
      },
    ],
    models: [],
    thinkingLevels: ["off"],
    commands: [],
    queuedMessages: [],
    stats: {
      sessionFile: "/tmp/runtime-test.jsonl",
      sessionId: "native-session",
      userMessages: 1,
      assistantMessages: 1,
      toolCalls: 3,
      toolResults: 2,
      totalMessages: 3,
      tokens: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0,
      },
      cost: 0,
    },
  };
}

test("shows durable turn activity without changing completed tool status", async ({
  page,
}, testInfo) => {
  await page.goto("/signup");
  await page.locator("#name").fill("Runtime E2E Admin");
  await page.locator("#email").fill("runtime-admin@overtchat-test.local");
  await page.locator("#password").fill("test-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/");
  seedAgentSession();

  const startedAt = Date.now() - 3_000;
  const snapshot: ReturnType<typeof runtimeSnapshot> & {
    pendingInteraction?: Record<string, unknown>;
  } = runtimeSnapshot(startedAt);
  let retryRequested = false;
  let interactionResponse: Record<string, unknown> | null = null;
  await page.route(
    new RegExp(`/api/agent-sessions/${SESSION_ID}$`),
    async (route) => {
      if (route.request().method() === "POST") {
        const command = route.request().postDataJSON() as {
          type?: string;
          message?: string;
          [key: string]: unknown;
        };
        if (command.type === "interaction_response") {
          interactionResponse = command;
          delete snapshot.pendingInteraction;
        }
        if (command.type === "retry_interactive") retryRequested = true;
        if (
          command.type === "abort" ||
          command.type === "steer" ||
          command.type === "queue" ||
          command.type === "remove_queued_message" ||
          command.type === "steer_queued_message"
        ) {
          await new Promise((resolve) => setTimeout(resolve, 750));
        }
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            accepted: true,
            ...(command.type === "queue"
              ? {
                  queuedMessages: [
                    {
                      id: "queued-message",
                      message: command.message,
                      status: "pending",
                    },
                  ],
                }
              : command.type === "remove_queued_message"
                ? { queuedMessages: [] }
                : command.type === "steer_queued_message"
                  ? { queuedMessages: [] }
                : {}),
          }),
        });
        return;
      }
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ snapshot }),
      });
    },
  );
  await page.route("**/api/agent-connections", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as {
      connections: AgentConnectionListItem[];
    };
    for (const connection of body.connections) {
      for (const workspace of connection.workspaces) {
        for (const session of workspace.sessions) {
          if (session.id === SESSION_ID) session.runtimeStatus = "running";
        }
      }
    }
    await route.fulfill({ response, json: body });
  });
  await page.route(
    new RegExp("/api/agent-workspaces/workspace/git-status$"),
    async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          status: {
            isGit: true,
            repositoryRoot: "/tmp/runtime-test",
            branch: "feature/runtime-status",
            upstream: "origin/feature/runtime-status",
            ahead: 2,
            behind: 1,
            dirty: true,
            changedFiles: 2,
            additions: 8,
            deletions: 3,
            lineStatsComplete: true,
          },
        }),
      });
    },
  );
  await page.addInitScript(() => {
    type RuntimeEnvelope = {
      sequence: number;
      type: "runtime_event" | "snapshot";
      data: Record<string, unknown>;
    };
    type RuntimeControls = {
      emit: (envelope: RuntimeEnvelope) => void;
      disconnect: () => void;
      reconnect: () => void;
      connected: () => boolean;
    };

    const sources: FakeEventSource[] = [];
    class FakeEventSource extends EventTarget {
      onopen: ((event: Event) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;

      constructor() {
        super();
        sources.push(this);
        window.setTimeout(() => this.onopen?.(new Event("open")), 0);
      }

      close() {
        const index = sources.indexOf(this);
        if (index >= 0) sources.splice(index, 1);
      }
    }

    const controls: RuntimeControls = {
      emit(envelope) {
        for (const source of sources) {
          source.dispatchEvent(
            new MessageEvent("runtime", {
              data: JSON.stringify(envelope),
            }),
          );
        }
      },
      disconnect() {
        for (const source of sources) source.onerror?.(new Event("error"));
      },
      reconnect() {
        for (const source of sources) source.onopen?.(new Event("open"));
      },
      connected() {
        return sources.length > 0;
      },
    };
    Object.assign(window, {
      EventSource: FakeEventSource,
      __agentRuntimeControls: controls,
    });
  });

  await page.goto(`/agents/${SESSION_ID}`);
  await page.waitForFunction(
    () =>
      (
        window as unknown as {
          __agentRuntimeControls: { connected: () => boolean };
        }
      ).__agentRuntimeControls.connected(),
  );
  await page.evaluate((initialSnapshot) => {
    const controls = (
      window as unknown as {
        __agentRuntimeControls: {
          emit: (envelope: unknown) => void;
        };
      }
    ).__agentRuntimeControls;
    controls.emit({
      sequence: 0,
      type: "snapshot",
      data: initialSnapshot,
    });
  }, snapshot);

  const sessionActivity = page.getByRole("status", {
    name: "Runtime activity is working",
  });
  await expect(sessionActivity).toBeVisible();
  const headerGitStatus = page.getByTestId("agent-workspace-git-status");
  await expect(headerGitStatus).toContainText("feature/runtime-status");
  await expect(headerGitStatus).toContainText("2 files");
  await expect(headerGitStatus).toContainText("+8");
  await expect(headerGitStatus).toContainText("-3");
  const sidebarGitStatus = page.locator(
    '[data-testid="sidebar-workspace-git-status-workspace"]:visible',
  );
  await expect(sidebarGitStatus).toContainText("feature/runtime-status");
  await expect(sidebarGitStatus).toContainText("+8");
  await expect(sidebarGitStatus).toContainText("-3");
  await page.getByRole("button", { name: "Session actions" }).click();
  await expect(
    page.getByRole("menuitem", { name: "Copy workspace path" }),
  ).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "Copy branch name" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "New session in Runtime test" }),
  ).toBeVisible();
  await expect(page.getByText("New session", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Collapse Runtime test" }).click();
  await expect(
    page.getByRole("status", {
      name: "Runtime test has running sessions",
    }),
  ).toBeVisible();
  await expect(sessionActivity).toHaveCount(0);

  await page.getByRole("button", { name: "Expand Runtime test" }).click();
  await expect(sessionActivity).toBeVisible();
  await page.getByRole("button", { name: "Collapse This machine" }).click();
  await expect(
    page.getByRole("status", {
      name: "This machine has running sessions",
    }),
  ).toBeVisible();
  await expect(sessionActivity).toHaveCount(0);

  await page.getByRole("button", { name: "Expand This machine" }).click();
  await expect(sessionActivity).toBeVisible();

  const genericActivity = page.getByTestId("agent-run-activity");
  await expect(genericActivity).toHaveCount(0);
  const thoughts = page.getByRole("button", { name: "Thoughts", exact: true });
  await thoughts.click();
  await expect(
    page.getByText("I should inspect the runtime before responding."),
  ).toBeVisible();
  await expect(page.getByText("Thinking", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Thinking", exact: true }),
  ).toHaveCount(0);
  const liveActivity = page.getByRole("button", {
    name: /Searching.*runtimeStatus/u,
  });
  await expect(liveActivity).toBeVisible();
  await expect(liveActivity).toContainText(/\d+s/u);
  await expect(liveActivity).toContainText("2 completed");
  await page.screenshot({
    path: testInfo.outputPath("runtime-activity-collapsed-desktop.png"),
    fullPage: true,
  });
  await liveActivity.click();
  await expect(
    page.getByRole("button", { name: /Activity.*2 completed/u }),
  ).toBeVisible();
  const completedCommand = page.getByRole("button", {
    name: "Terminal: printf done, completed",
  });
  await expect(completedCommand).toBeVisible();
  await completedCommand.click();
  await expect(page.getByText("$ printf done", { exact: true })).toBeVisible();
  await expect(page.getByText("done", { exact: true })).toBeVisible();
  const completedEdit = page.getByRole("button", {
    name: "Edit: apps/web/runtime.ts, completed",
  });
  await completedEdit.click();
  await expect(page.getByText("Changes", { exact: true })).toBeVisible();
  await expect(
    page.getByText("+export const state = 'ready';", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Output", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Done!", { exact: true })).toHaveCount(0);
  await expect(
    page.getByText("Running command", { exact: true }),
  ).not.toBeVisible();

  const composer = page.getByPlaceholder(
    "Message Pi or type / for commands",
  );
  await composer.fill("Run the tests");
  await page.getByRole("button", { name: "Queue message for Pi" }).click();
  await expect(composer).toHaveValue("Run the tests");
  await expect(composer).toBeDisabled();
  await expect(composer).toHaveValue("");
  await expect(page.getByText("Run the tests", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Edit queued message" }).click();
  await expect(composer).toHaveValue("Run the tests");
  await expect(composer).toBeDisabled();
  await expect(composer).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Edit queued message" }),
  ).toHaveCount(0);
  await composer.fill("");

  await composer.fill("Focus on the failing test");
  await page.getByRole("button", { name: "Steer Pi" }).click();
  await expect(composer).toHaveValue("Focus on the failing test");
  await expect(composer).toBeDisabled();
  await expect(composer).toHaveValue("");

  await composer.fill("Then summarize");
  await page.getByRole("button", { name: "Queue message for Pi" }).click();
  await expect(
    page.getByText("Then summarize", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Steer with queued message" })
    .click();
  await expect(
    page.getByText("Then summarize", { exact: true }),
  ).toHaveCount(0);

  await page.getByRole("button", { name: "Stop Pi" }).click();
  await expect(genericActivity).toContainText("Stopping");
  await expect(page.getByRole("button", { name: "Stopping Pi" })).toBeVisible();
  await expect(genericActivity).toHaveCount(0, { timeout: 2_000 });
  await expect(page.getByRole("button", { name: "Stop Pi" })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("runtime-activity-desktop.png"),
    fullPage: true,
  });

  await page.evaluate(() => {
    const controls = (
      window as unknown as {
        __agentRuntimeControls: {
          emit: (envelope: unknown) => void;
        };
      }
    ).__agentRuntimeControls;
    controls.emit({
      sequence: 1,
      type: "runtime_event",
      data: { type: "compaction_start", reason: "auto" },
    });
  });
  await expect(genericActivity).toContainText("Compacting");

  await page.evaluate(() => {
    const controls = (
      window as unknown as {
        __agentRuntimeControls: {
          emit: (envelope: unknown) => void;
          disconnect: () => void;
        };
      }
    ).__agentRuntimeControls;
    controls.emit({
      sequence: 2,
      type: "runtime_event",
      data: { type: "compaction_end", reason: "auto" },
    });
    controls.disconnect();
  });
  await expect(genericActivity).toContainText("Reconnecting");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(genericActivity).toBeVisible();
  await expect(headerGitStatus).not.toBeVisible();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("runtime-activity-mobile-main.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Open sidebar" }).click();
  await expect(sessionActivity).toBeVisible();
  await expect(sidebarGitStatus).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("runtime-activity-mobile.png"),
    fullPage: true,
  });

  await page.evaluate(() => {
    const controls = (
      window as unknown as {
        __agentRuntimeControls: {
          reconnect: () => void;
          emit: (envelope: unknown) => void;
        };
      }
    ).__agentRuntimeControls;
    controls.reconnect();
    controls.emit({
      sequence: 3,
      type: "runtime_event",
      data: { type: "overtchat_status", status: "idle", startedAt: null },
    });
  });
  await expect(genericActivity).not.toBeVisible();

  await page.setViewportSize({ width: 1280, height: 720 });
  snapshot.pendingInteraction = {
    type: "interaction_request",
    id: "mcp-form",
    method: "form",
    title: "GitHub needs your input",
    message: "Configure the GitHub tool",
    fields: [
      {
        id: "token",
        type: "text",
        label: "Token",
        description: "Personal access token",
        required: true,
        secret: true,
        options: [],
      },
      {
        id: "environment",
        type: "select",
        label: "Environment",
        required: true,
        secret: false,
        options: [
          { value: "production", label: "Production" },
          { value: "staging", label: "Staging" },
        ],
      },
      {
        id: "scopes",
        type: "multiselect",
        label: "Scopes",
        required: false,
        secret: false,
        options: [
          { value: "repo", label: "Repo" },
          { value: "issues", label: "Issues" },
        ],
      },
      {
        id: "private",
        type: "boolean",
        label: "Private repository",
        required: false,
        secret: false,
        options: [],
        defaultValue: false,
      },
    ],
  };
  await page.reload();
  await expect(
    page.getByRole("dialog", { name: "GitHub needs your input" }),
  ).toBeVisible();
  await expect(page.getByLabel("Token")).toHaveAttribute("type", "password");
  await page.getByLabel("Token").fill("secret");
  await page.getByLabel("Environment").selectOption("staging");
  await page.getByRole("checkbox", { name: "Repo", exact: true }).check();
  await page
    .getByRole("switch", { name: "Private repository (optional)", exact: true })
    .click();
  await page.getByRole("button", { name: "Submit" }).click();
  await expect.poll(() => interactionResponse).toMatchObject({
    type: "interaction_response",
    id: "mcp-form",
    values: {
      token: "secret",
      environment: "staging",
      scopes: ["repo"],
      private: true,
    },
  });

  interactionResponse = null;
  snapshot.pendingInteraction = {
    type: "interaction_request",
    id: "mcp-url",
    method: "external",
    title: "Continue with GitHub?",
    message: "Authorize the GitHub tool",
    url: "https://github.com/login/oauth/authorize",
  };
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Open authorization page" }),
  ).toHaveAttribute("href", "https://github.com/login/oauth/authorize");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect.poll(() => interactionResponse).toMatchObject({
    type: "interaction_response",
    id: "mcp-url",
    confirmed: true,
  });

  await page.evaluate((initialSnapshot) => {
    const controls = (
      window as unknown as {
        __agentRuntimeControls: {
          emit: (envelope: unknown) => void;
        };
      }
    ).__agentRuntimeControls;
    controls.emit({
      sequence: 6,
      type: "snapshot",
      data: {
        ...initialSnapshot,
        status: "idle",
        activeTurn: null,
        state: {
          ...initialSnapshot.state,
          isStreaming: false,
        },
        readOnly: {
          reason:
            "Another Codex process currently owns this session. You can view it here and retry when it becomes available.",
          retryable: true,
        },
      },
    });
  }, snapshot);
  await expect(
    page.getByRole("region", { name: "Read-only Pi session" }),
  ).toBeVisible();
  await expect(
    page.getByPlaceholder("Message Pi or type / for commands"),
  ).toBeDisabled();
  await page.getByLabel("Session actions").click();
  await expect(
    page.getByRole("menuitem", { name: "Copy workspace path" }),
  ).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "Rename session" }),
  ).toHaveAttribute("aria-disabled", "true");
  await expect(
    page.getByRole("menuitem", { name: "Compact context" }),
  ).toHaveAttribute("aria-disabled", "true");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Retry" }).click();
  await expect.poll(() => retryRequested).toBe(true);
});
