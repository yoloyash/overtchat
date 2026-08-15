import { expect, test } from "@playwright/test";
import type {
  AgentConnectionListItem,
  AgentRuntimeSnapshot,
} from "@overtchat/agent-bridge";
import {
  openE2eDatabase,
  resetE2eDatabase,
} from "./helpers/database";

const SESSION_ID = "runtime-session";
const IMAGE_UPLOAD_ID = "11111111-1111-4111-8111-111111111111";
const TEST_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

const imageModel: AgentRuntimeSnapshot["models"][number] = {
  id: "gpt-5.6",
  name: "GPT-5.6",
  provider: "codex",
  api: "codex-app-server",
  baseUrl: "",
  reasoning: true,
  input: ["text", "image"],
  contextWindow: 100_000,
  maxTokens: 10_000,
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
  },
};

const textModel: AgentRuntimeSnapshot["models"][number] = {
  ...imageModel,
  id: "gpt-5.6-mini",
  name: "GPT-5.6 Mini",
  input: ["text"],
};

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
      ) VALUES ('connection', 'host', 'codex', 'codex', '0.147.0')
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

function runtimeSnapshot(startedAt: number): AgentRuntimeSnapshot {
  return {
    sessionId: SESSION_ID,
    provider: "codex",
    capabilities: {
      steer: true,
      usage: true,
      editSentMessages: true,
      forkMessages: true,
    },
    status: "running",
    activeTurn: { startedAt },
    state: {
      isStreaming: true,
      isCompacting: false,
      sessionName: "Runtime activity",
      model: imageModel,
      thinkingLevel: "high",
      collaborationMode: "default",
      collaborationModes: ["default", "plan"],
      fastModeEnabled: false,
      fastModeAvailable: true,
      accessMode: "inherit",
      accessModes: ["inherit", "default", "auto-review", "full-access"],
      goalsSupported: true,
      goal: {
        objective: "Finish Codex parity",
        status: "active",
        tokenBudget: 20_000,
        tokensUsed: 4_200,
        timeUsedSeconds: 180,
        createdAt: 1,
        updatedAt: 2,
      },
    },
    messages: [
      {
        id: "turn-1:user:0",
        role: "user",
        content: "Inspect the runtime",
        timestamp: 1,
      },
      {
        id: "commentary",
        role: "assistant",
        content: [
          {
            id: "commentary",
            type: "text",
            phase: "commentary",
            text: "I'm auditing the release state before merging anything.",
          },
        ],
        timestamp: 2,
        overtchatTurnId: "turn-1",
        overtchatTurnBoundaryId: "turn-1:assistant",
      },
      {
        id: "reasoning",
        role: "assistant",
        content: [
          {
            id: "reasoning",
            type: "thinking",
            thinking: "I should inspect the runtime before responding.",
          },
        ],
        timestamp: 2.1,
        overtchatTurnId: "turn-1",
        overtchatTurnBoundaryId: "turn-1:assistant",
      },
      {
        id: "answer",
        role: "assistant",
        content: [
          {
            id: "answer",
            type: "text",
            text: "I will inspect the runtime.",
          },
        ],
        timestamp: 2.2,
        overtchatTurnId: "turn-1",
        overtchatTurnBoundaryId: "turn-1:assistant",
      },
      {
        id: "turn-1:footer",
        role: "turnFooter",
        messageId: "turn-1:assistant",
        content:
          "I'm auditing the release state before merging anything.\n\nI will inspect the runtime.",
        durationMs: 246_000,
        timestamp: 2.3,
      },
      {
        role: "assistant",
        content: [
          {
            type: "plan",
            id: "plan",
            text: "- [x] Audit the runtime\n- [ ] Finish parity",
            explanation: "Two focused steps.",
            steps: [
              { step: "Audit the runtime", status: "completed" },
              { step: "Finish parity", status: "inProgress" },
            ],
          },
        ],
        timestamp: 2.5,
      },
      {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "command",
            name: "bash",
            arguments: { command: "printf done" },
            terminalInputs: ["y\n"],
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
            type: "subagent",
            id: "collab",
            action: "spawnAgent",
            prompt: "Inspect the runtime tests",
            status: "completed",
            receivers: [
              {
                threadId: "child-thread",
                status: "completed",
                message: "Tests are green",
              },
            ],
            events: ["Checked the runtime suite.", "$ npm test\n476 passed"],
          },
        ],
        timestamp: 6.5,
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
    models: [imageModel, textModel],
    thinkingLevels: ["low", "high"],
    commands: [
      {
        name: "plan",
        description: "Enable Plan mode",
        source: "builtin",
      },
      {
        name: "fast",
        description: "Enable Fast mode",
        source: "builtin",
      },
    ],
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
      contextUsage: {
        tokens: 42_000,
        contextWindow: 100_000,
        percent: 42,
      },
    },
  };
}

test("requires inspection before retrying an uncertain queued message", async ({
  page,
}) => {
  await page.goto("/signup");
  await page.locator("#name").fill("Uncertain Queue E2E Admin");
  await page
    .locator("#email")
    .fill("uncertain-queue-admin@overtchat-test.local");
  await page.locator("#password").fill("test-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/");
  seedAgentSession();

  const snapshot = runtimeSnapshot(Date.now() - 3_000);
  snapshot.queuedMessages = [
    {
      id: "uncertain-message",
      message: "Check whether this was delivered",
      status: "uncertain",
    },
  ];
  const submittedCommands: Array<Record<string, unknown>> = [];
  await page.route(
    new RegExp(`/api/agent-sessions/${SESSION_ID}(?:\\?.*)?$`),
    async (route) => {
      if (route.request().method() === "POST") {
        submittedCommands.push(
          route.request().postDataJSON() as Record<string, unknown>,
        );
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({ accepted: true, queuedMessages: [] }),
        });
        return;
      }
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ snapshot }),
      });
    },
  );
  await page.addInitScript(() => {
    class FakeEventSource extends EventTarget {
      onopen: ((event: Event) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;

      constructor() {
        super();
        window.setTimeout(() => this.onopen?.(new Event("open")), 0);
      }

      close() {}
    }
    Object.assign(window, { EventSource: FakeEventSource });
  });

  await page.goto(`/agents/${SESSION_ID}`);
  const composer = page.getByTestId("agent-composer").getByRole("combobox");
  const uncertainQueueItem = page
    .locator('section[aria-label="Pending messages"] article')
    .filter({ hasText: "Check whether this was delivered" });
  await expect(uncertainQueueItem).toContainText(
    "Delivery unknown — inspect the session before resending",
  );
  await expect(
    uncertainQueueItem.getByRole("button", { name: "Edit queued message" }),
  ).toBeVisible();
  await expect(
    uncertainQueueItem.getByRole("button", { name: "Delete queued message" }),
  ).toBeVisible();
  await expect(
    uncertainQueueItem.getByRole("button", {
      name: "Steer with queued message",
    }),
  ).toHaveCount(0);

  await uncertainQueueItem
    .getByRole("button", { name: "Edit queued message" })
    .click();
  await expect.poll(() => submittedCommands.at(-1)).toMatchObject({
    type: "remove_queued_message",
    id: "uncertain-message",
  });
  await expect(composer).toHaveValue("Check whether this was delivered");
  await expect(uncertainQueueItem).toHaveCount(0);
});

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
  let runtimeAvailable = true;
  const submittedCommands: Array<Record<string, unknown>> = [];
  await page.exposeFunction(
    "__setAgentRuntimeAvailable",
    (available: boolean) => {
      runtimeAvailable = available;
    },
  );
  await page.route("**/api/uploads", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        url: `/api/uploads/${IMAGE_UPLOAD_ID}`,
        mediaType: "image/png",
        filename: "clipboard.png",
        category: "image",
        size: TEST_PNG.byteLength,
        pageCount: null,
        truncated: false,
      }),
    });
  });
  await page.route(`**/api/uploads/${IMAGE_UPLOAD_ID}`, async (route) => {
    await route.fulfill({
      contentType: "image/png",
      body: TEST_PNG,
    });
  });
  await page.route(
    new RegExp(`/api/agent-sessions/${SESSION_ID}(?:\\?.*)?$`),
    async (route) => {
      if (route.request().method() === "POST") {
        const command = route.request().postDataJSON() as {
          type?: string;
          message?: string;
          [key: string]: unknown;
        };
        submittedCommands.push(command);
        if (command.type === "interaction_response") {
          interactionResponse = command;
          delete snapshot.pendingInteraction;
        }
        if (command.type === "retry_interactive") retryRequested = true;
        if (command.type === "set_collaboration_mode") {
          snapshot.state.collaborationMode = command.mode;
        }
        if (
          command.type === "prompt" &&
          command.message?.trim() === "/plan"
        ) {
          snapshot.state.collaborationMode =
            snapshot.state.collaborationMode === "plan" ? "default" : "plan";
        }
        if (command.type === "set_model") {
          snapshot.state.model = snapshot.models.find(
            (model) =>
              model.provider === command.provider &&
              model.id === command.modelId,
          );
        }
        if (command.type === "set_thinking_level") {
          snapshot.state.thinkingLevel = command.level;
        }
        if (command.type === "set_fast_mode") {
          snapshot.state.fastModeEnabled = command.enabled;
        }
        if (command.type === "set_access_mode") {
          snapshot.state.accessMode = command.mode;
        }
        if (command.type === "update_goal") {
          if (command.action === "clear") {
            snapshot.state.goal = null;
          } else {
            const current =
              snapshot.state.goal &&
              typeof snapshot.state.goal === "object"
                ? snapshot.state.goal
                : {};
            snapshot.state.goal = {
              ...current,
              ...(command.action === "set" &&
              typeof command.objective === "string"
                ? { objective: command.objective }
                : {}),
              status:
                command.action === "pause" ? "paused" : "active",
            };
          }
        }
        if (
          command.type === "abort" ||
          command.type === "queue" ||
          command.type === "remove_queued_message" ||
          command.type === "steer_queued_message"
        ) {
          await new Promise((resolve) => setTimeout(resolve, 750));
        }
        const queueResult =
          command.type === "queue"
            ? {
                queuedMessages: [
                  {
                    id: "queued-message",
                    message: command.message,
                    ...(Array.isArray(command.images)
                      ? { images: command.images }
                      : {}),
                    status: "pending",
                  },
                ],
              }
            : command.type === "remove_queued_message" ||
                command.type === "steer_queued_message"
              ? { queuedMessages: [] }
              : {};
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            accepted: true,
            ...(command.type === "edit_message"
              ? {
                  sessionId: SESSION_ID,
                  draft: "Inspect the runtime",
                }
              : {}),
            ...(command.type === "show_usage"
              ? { usage: { planType: "plus", windows: [] } }
              : {}),
            ...queueResult,
          }),
        });
        return;
      }
      if (!runtimeAvailable) {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "Runtime test connector unavailable" }),
        });
        return;
      }
      const after = new URL(route.request().url()).searchParams.get("after");
      const separator = after?.lastIndexOf(":") ?? -1;
      const sequence = Number(after?.slice(separator + 1));
      const cursor =
        after &&
        separator > 0 &&
        Number.isSafeInteger(sequence) &&
        sequence >= 0
          ? { epoch: after.slice(0, separator), sequence }
          : null;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          snapshot,
          ...(cursor
            ? { sync: { reset: true, cursor, snapshot } }
            : {}),
        }),
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
      epoch: string;
      sequence: number;
      type: "runtime_event" | "snapshot";
      data: Record<string, unknown>;
    };
    type RuntimeControls = {
      emit: (envelope: RuntimeEnvelope) => void;
      disconnect: () => Promise<void>;
      reconnect: () => Promise<void>;
      connected: () => boolean;
    };
    const setRuntimeAvailable = (
      window as unknown as {
        __setAgentRuntimeAvailable: (available: boolean) => Promise<void>;
      }
    ).__setAgentRuntimeAvailable;

    const sources: FakeEventSource[] = [];
    let online = true;
    class FakeEventSource extends EventTarget {
      onopen: ((event: Event) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;

      constructor() {
        super();
        sources.push(this);
        window.setTimeout(() => {
          if (online && sources.includes(this)) {
            this.onopen?.(new Event("open"));
          }
        }, 0);
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
      async disconnect() {
        online = false;
        await setRuntimeAvailable(false);
        for (const source of [...sources]) {
          source.onerror?.(new Event("error"));
        }
      },
      async reconnect() {
        await setRuntimeAvailable(true);
        online = true;
        for (const source of [...sources]) {
          source.onopen?.(new Event("open"));
        }
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
      epoch: "runtime-test",
      sequence: 1,
      type: "snapshot",
      data: initialSnapshot,
    });
  }, snapshot);

  const sessionActivity = page.getByRole("status", {
    name: "Runtime activity is working",
  });
  await expect(sessionActivity).toBeVisible();
  const agentHeader = page.getByTestId("agent-session-header");
  const agentComposer = page.getByTestId("agent-composer");
  await expect(
    agentHeader.getByTestId("agent-model-effort-trigger"),
  ).toHaveCount(0);
  await expect(
    agentComposer.getByRole("button", {
      name: "Model and effort: GPT-5.6, High",
    }),
  ).toBeEnabled();
  await expect(agentComposer.getByRole("button", { name: "Plan mode" })).toHaveCount(0);
  await expect(
    agentComposer.getByRole("button", { name: "Fast", exact: true }),
  ).toHaveCount(0);
  const permissionsControl = agentComposer.getByRole("button", {
    name: "Permissions: Codex default",
  });
  await expect(permissionsControl).toBeEnabled();
  await permissionsControl.click();
  await page
    .getByRole("menu", { name: "Permissions" })
    .getByRole("menuitem", { name: /Default permissions/u })
    .click();
  await expect.poll(() => submittedCommands.at(-1)).toMatchObject({
    type: "set_access_mode",
    mode: "default",
  });
  const defaultPermissionsControl = agentComposer.getByRole("button", {
    name: "Permissions: Default permissions",
  });
  await defaultPermissionsControl.click();
  await page
    .getByRole("menu", { name: "Permissions" })
    .getByRole("menuitem", { name: /Full access/u })
    .click();
  const fullAccessDialog = page.getByRole("alertdialog", {
    name: "Enable Full access?",
  });
  await fullAccessDialog
    .getByRole("button", { name: "Enable Full access" })
    .click();
  await expect.poll(() => submittedCommands.at(-1)).toMatchObject({
    type: "set_access_mode",
    mode: "full-access",
  });
  await expect(
    agentComposer.getByRole("button", {
      name: /Usage: 42% context used/u,
    }),
  ).toBeVisible();
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
  await expect(
    page.locator('[data-activity-sequence="single"]'),
  ).toHaveCount(1);
  await expect(
    page.locator('[data-activity-sequence="first"]'),
  ).toHaveCount(1);
  await expect(
    page.locator('[data-activity-sequence="middle"]'),
  ).toHaveCount(1);
  await expect(
    page.locator('[data-activity-sequence="last"]'),
  ).toHaveCount(1);
  await expect(
    page.getByText("I'm auditing the release state before merging anything."),
  ).toBeVisible();
  const completedTurn = page.getByTestId("agent-turn-footer");
  await expect(completedTurn).toContainText("Worked for 4m 6s");
  await expect(
    completedTurn.getByRole("button", { name: "Copy response" }),
  ).toBeVisible();
  const thinking = page.getByRole("button", { name: "Thoughts" });
  await thinking.click();
  await expect(
    page.getByText("I should inspect the runtime before responding."),
  ).toBeVisible();
  await expect(
    page.getByText("I will inspect the runtime.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("agent-plan-card")).toContainText(
    "Finish parity",
  );
  await expect(page.getByTestId("agent-goal-bar")).toContainText(
    "Finish Codex parity",
  );
  const toolSummaries = page.locator('[data-agent-tool-summary="true"]');
  await expect(toolSummaries).toHaveCount(2);
  const completedCommandSummary = page.getByRole("button", {
    name: "Ran 1 command, completed",
  });
  await expect(completedCommandSummary).toBeVisible();
  const liveActivity = page.getByRole("button", {
    name: "Edited 1 file and searched 1 time, running",
  });
  await expect(liveActivity).toBeVisible();
  const completedCommand = page.getByRole("button", {
    name: "Terminal: printf done, completed",
  });
  const completedEdit = page.getByRole("button", {
    name: "Edit: apps/web/runtime.ts, completed",
  });
  await expect(completedCommand).not.toBeVisible();
  await expect(completedEdit).not.toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("runtime-activity-collapsed-desktop.png"),
    fullPage: true,
  });
  await completedCommandSummary.click();
  await expect(completedCommand).toBeVisible();
  await completedCommand.click();
  await expect(page.getByText("$ printf done", { exact: true })).toBeVisible();
  await expect(page.getByText("done", { exact: true })).toBeVisible();
  await expect(page.getByText("› y", { exact: true })).toBeVisible();
  await liveActivity.click();
  await expect(completedEdit).toBeVisible();
  await completedEdit.click();
  await expect(page.getByText("Changes", { exact: true }).first()).toBeVisible();
  await expect(
    page.getByText("+export const state = 'ready';", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Output", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Done!", { exact: true })).toHaveCount(0);
  await expect(
    page.getByText("Running command", { exact: true }),
  ).not.toBeVisible();
  const subagentActivity = page.getByTestId("agent-subagent-activity");
  await expect(subagentActivity).toContainText("Started subagent");
  await subagentActivity.getByRole("button").click();
  await expect(subagentActivity).toContainText("Checked the runtime suite.");
  await expect(
    page.getByText("Turn changes", { exact: true }),
  ).toHaveCount(0);

  const composer = agentComposer.getByRole("combobox");
  await expect(composer).toHaveAttribute(
    "placeholder",
    "Message Codex or type / for commands",
  );
  await expect(
    page.getByLabel("Active turn message actions"),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Attach images" })).toBeVisible();
  await composer.fill("/usage");
  await composer.press("Enter");
  await expect(page.getByRole("dialog", { name: "Codex usage" })).toBeVisible();
  await expect.poll(() => submittedCommands.at(-1)).toMatchObject({
    type: "show_usage",
  });
  await page.getByRole("button", { name: "Done" }).click();
  await expect(composer).toBeEnabled();
  await composer.evaluate(async (element) => {
    const canvas = document.createElement("canvas");
    canvas.width = 96;
    canvas.height = 72;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is unavailable.");
    context.fillStyle = "#2563eb";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#f8fafc";
    context.fillRect(18, 18, 60, 36);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (value) =>
          value ? resolve(value) : reject(new Error("PNG encoding failed.")),
        "image/png",
      );
    });
    const transfer = new DataTransfer();
    transfer.items.add(
      new File([blob], "clipboard.png", { type: "image/png" }),
    );
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: transfer,
      }),
    );
  });
  await expect(page.getByAltText("clipboard.png")).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("runtime-image-paste-desktop.png"),
    fullPage: true,
  });
  await composer.fill("Run the tests");
  await page.getByRole("button", { name: "Queue message for Codex" }).click();
  await expect(composer).toHaveValue("Run the tests");
  await expect(composer).toBeDisabled();
  await expect(composer).toHaveValue("");
  await expect(page.getByText("Run the tests", { exact: true })).toBeVisible();
  await expect.poll(() => submittedCommands.at(-1)).toMatchObject({
    type: "queue",
    message: "Run the tests",
    images: [
      {
        uploadId: IMAGE_UPLOAD_ID,
        filename: "clipboard.png",
        mediaType: "image/png",
      },
    ],
  });
  await page.screenshot({
    path: testInfo.outputPath("runtime-queued-message-desktop.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Edit queued message" }).click();
  await expect(composer).toHaveValue("Run the tests");
  await expect(composer).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Edit queued message" }),
  ).toHaveCount(0);
  await expect(page.getByAltText("clipboard.png")).toBeVisible();
  await page
    .getByRole("button", { name: "Remove clipboard.png" })
    .click();
  await composer.fill("");

  await composer.fill("Focus on the failing test");
  await composer.press("Enter");
  await expect(composer).toHaveValue("Focus on the failing test");
  await expect(composer).toBeDisabled();
  await expect(composer).toHaveValue("");
  await expect(
    page.getByText("Focus on the failing test", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Steer with queued message" })
    .click();
  await expect.poll(() => submittedCommands.at(-1)).toMatchObject({
    type: "steer_queued_message",
  });
  await expect(
    page.getByText("Focus on the failing test", { exact: true }),
  ).toHaveCount(0);

  await expect(composer).toHaveAttribute(
    "placeholder",
    "Message Codex or type / for commands",
  );
  await composer.fill("Delete this follow-up");
  await composer.press("Enter");
  await expect(
    page.getByText("Delete this follow-up", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Delete queued message" }).click();
  await expect(
    page.getByText("Delete this follow-up", { exact: true }),
  ).toHaveCount(0);

  await expect(
    page.getByRole("button", { name: "Interrupt Codex and send message" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Steer Codex" }),
  ).toHaveCount(0);

  await composer.fill("Queue with the alternate shortcut");
  await composer.press("Control+Enter");
  await expect.poll(() => submittedCommands.at(-1)).toMatchObject({
    type: "queue",
    message: "Queue with the alternate shortcut",
  });
  await page.getByRole("button", { name: "Delete queued message" }).click();
  await expect(composer).toBeEnabled();

  await composer.fill("Submit this only once");
  const commandCountBeforeDoubleSubmit = submittedCommands.length;
  await composer.evaluate((element) => {
    for (let index = 0; index < 2; index += 1) {
      element.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      );
    }
  });
  await expect.poll(() => submittedCommands.length).toBe(
    commandCountBeforeDoubleSubmit + 1,
  );
  await expect.poll(() => submittedCommands.at(-1)).toMatchObject({
    type: "queue",
    message: "Submit this only once",
  });
  await expect(composer).toBeEnabled();
  expect(submittedCommands).toHaveLength(commandCountBeforeDoubleSubmit + 1);

  await page.getByRole("button", { name: "Stop Codex" }).click();
  await expect(genericActivity).toContainText("Stopping");
  await expect(
    page.getByRole("button", { name: "Stopping Codex" }),
  ).toBeVisible();
  await expect(genericActivity).toHaveCount(0, { timeout: 2_000 });
  await expect(page.getByRole("button", { name: "Stop Codex" })).toBeVisible();
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
      epoch: "runtime-test",
      sequence: 2,
      type: "runtime_event",
      data: { type: "compaction_start", reason: "auto" },
    });
  });
  await expect(genericActivity).toContainText("Compacting");

  await page.evaluate(async () => {
    const controls = (
      window as unknown as {
        __agentRuntimeControls: {
          emit: (envelope: unknown) => void;
          disconnect: () => Promise<void>;
        };
      }
    ).__agentRuntimeControls;
    controls.emit({
      epoch: "runtime-test",
      sequence: 3,
      type: "runtime_event",
      data: { type: "compaction_end", reason: "auto" },
    });
    await controls.disconnect();
  });
  await expect(genericActivity).toContainText("Reconnecting");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(genericActivity).toBeVisible();
  await expect(headerGitStatus).not.toBeVisible();
  await expect(
    agentComposer.getByTestId("agent-model-effort-trigger"),
  ).toBeVisible();
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
  await page.getByRole("button", { name: "Collapse sidebar" }).click();

  await page.evaluate(async () => {
    const controls = (
      window as unknown as {
        __agentRuntimeControls: {
          reconnect: () => Promise<void>;
        };
      }
    ).__agentRuntimeControls;
    await controls.reconnect();
  });
  await page.waitForFunction(
    () =>
      (
        window as unknown as {
          __agentRuntimeControls: { connected: () => boolean };
        }
      ).__agentRuntimeControls.connected(),
  );
  await page.evaluate(() => {
    const controls = (
      window as unknown as {
        __agentRuntimeControls: {
          emit: (envelope: unknown) => void;
        };
      }
    ).__agentRuntimeControls;
    controls.emit({
      epoch: "runtime-test",
      sequence: 4,
      type: "runtime_event",
      data: { type: "overtchat_status", status: "idle", startedAt: null },
    });
  });
  await expect(genericActivity).not.toBeVisible();

  snapshot.status = "idle";
  snapshot.activeTurn = null;
  snapshot.state.isStreaming = false;
  const sessionUrl = page.url();
  await page
    .getByRole("button", { name: "Edit from this message" })
    .click();
  await expect.poll(() => submittedCommands.at(-1)).toMatchObject({
    type: "edit_message",
    messageId: "turn-1:user:0",
  });
  await expect(composer).toHaveValue("Inspect the runtime");
  await expect(page).toHaveURL(sessionUrl);
  await expect(composer).toBeFocused();
  await composer.fill("");
  const modelEffortControl = agentComposer.getByRole("button", {
    name: "Model and effort: GPT-5.6, High",
  });
  await expect(modelEffortControl).toBeEnabled();
  await modelEffortControl.click();
  await expect(
    page.getByRole("button", { name: "Scroll to bottom" }),
  ).toHaveCount(0);
  const modelEffortMenu = page.getByRole("menu", {
    name: "Model and effort",
  });
  await expect(
    modelEffortMenu.getByRole("menuitem", { name: /Model.*GPT-5\.6/u }),
  ).toBeVisible();
  await modelEffortMenu
    .getByRole("menuitem", { name: /Effort.*High/u })
    .click();
  await expect(
    modelEffortMenu.getByRole("menuitem", {
      name: "Back to model and effort",
    }),
  ).toBeVisible();
  await expect(
    modelEffortMenu.getByRole("menuitem", { name: "Low" }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("runtime-model-effort-mobile.png"),
    fullPage: true,
  });
  await modelEffortMenu.getByRole("menuitem", { name: "Low" }).click();
  await expect.poll(() => submittedCommands.at(-1)).toMatchObject({
    type: "set_thinking_level",
    level: "low",
  });

  await composer.fill("/plan");
  await expect(
    page
      .getByRole("listbox", { name: "Codex commands" })
      .getByRole("option", { name: /\/plan/u }),
  ).toBeVisible();
  await page.keyboard.press("Enter");
  await expect.poll(() => submittedCommands.at(-1)).toMatchObject({
    type: "set_collaboration_mode",
    mode: "plan",
  });
  await page.evaluate((model) => {
    const controls = (
      window as unknown as {
        __agentRuntimeControls: {
          emit: (envelope: unknown) => void;
        };
      }
    ).__agentRuntimeControls;
    controls.emit({
      epoch: "runtime-test",
      sequence: 5,
      type: "runtime_event",
      data: {
        type: "config_update",
        model,
        thinkingLevel: "low",
        collaborationMode: "plan",
        collaborationModes: ["default", "plan"],
        fastModeEnabled: false,
        fastModeAvailable: true,
        accessMode: "default",
        accessModes: ["inherit", "default", "auto-review", "full-access"],
      },
    });
  }, imageModel);
  const planModeControl = agentComposer.getByRole("button", {
    name: "Plan mode",
  });
  await expect(planModeControl).toBeVisible();
  await planModeControl.click();
  await page
    .getByRole("menu", { name: "Plan mode" })
    .getByRole("menuitem", { name: "Exit plan mode" })
    .click();
  await expect.poll(() => submittedCommands.at(-1)).toMatchObject({
    type: "set_collaboration_mode",
    mode: "default",
  });
  await expect(planModeControl).toHaveCount(0);

  await page.setViewportSize({ width: 1280, height: 720 });
  await agentComposer
    .getByRole("button", {
      name: "Model and effort: GPT-5.6, Low",
    })
    .click();
  await page
    .getByRole("menu", { name: "Model and effort" })
    .getByRole("menuitem", { name: /Model.*GPT-5\.6/u })
    .click();
  await expect(
    page
      .getByRole("menu", { name: "Model and effort" })
      .getByRole("menuitem", { name: "Back to model and effort" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("menu", { name: "Model and effort" })
      .getByRole("menuitem", { name: /GPT-5.6 Mini/u }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("runtime-model-effort-desktop.png"),
    fullPage: true,
  });
  await page
    .getByRole("menu", { name: "Model and effort" })
    .getByRole("menuitem", { name: /GPT-5.6 Mini/u })
    .click();
  await expect.poll(() => submittedCommands.at(-1)).toMatchObject({
    type: "set_model",
    provider: "codex",
    modelId: "gpt-5.6-mini",
  });
  await expect(
    agentComposer.getByRole("button", { name: "Fast", exact: true }),
  ).toHaveCount(0);
  await composer.fill("/fast");
  await expect(
    page
      .getByRole("listbox", { name: "Codex commands" })
      .getByRole("option", { name: /Enable Fast mode/u }),
  ).toBeVisible();
  await page.keyboard.press("Enter");
  await expect.poll(() => submittedCommands.at(-1)).toMatchObject({
    type: "set_fast_mode",
    enabled: true,
  });
  const fastModeControl = agentComposer.getByRole("button", {
    name: "Fast",
    exact: true,
  });
  await expect(fastModeControl).toBeVisible();
  await fastModeControl.click();
  await expect.poll(() => submittedCommands.at(-1)).toMatchObject({
    type: "set_fast_mode",
    enabled: false,
  });
  await expect(fastModeControl).toHaveCount(0);
  await page.getByRole("button", { name: "Pause goal" }).click();
  await expect(page.getByRole("button", { name: "Resume goal" })).toBeVisible();
  await page.getByRole("button", { name: "Resume goal" }).click();
  await expect(page.getByRole("button", { name: "Pause goal" })).toBeVisible();
  await page.getByRole("button", { name: "Implement plan" }).click();
  await expect.poll(() => submittedCommands.at(-1)).toMatchObject({
    type: "implement_plan",
    plan: expect.stringContaining("Finish parity"),
  });
  await page.getByRole("button", { name: "Clear goal" }).click();
  await expect(page.getByTestId("agent-goal-bar")).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath("runtime-codex-parity-desktop.png"),
    fullPage: true,
  });
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
      epoch: "runtime-test",
      sequence: 7,
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
    page.getByRole("region", { name: "Read-only Codex session" }),
  ).toBeVisible();
  await expect(
    page.getByPlaceholder("Message Codex or type / for commands"),
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
