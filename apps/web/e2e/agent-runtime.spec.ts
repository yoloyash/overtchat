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
      toolCalls: 1,
      toolResults: 1,
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
  const snapshot = runtimeSnapshot(startedAt);
  await page.route(
    new RegExp(`/api/agent-sessions/${SESSION_ID}$`),
    async (route) => {
      if (route.request().method() === "POST") {
        const command = route.request().postDataJSON() as {
          type?: string;
        };
        if (command.type === "abort") {
          await new Promise((resolve) => setTimeout(resolve, 750));
        }
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({}),
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
  await page.addInitScript(() => {
    type RuntimeEnvelope = {
      sequence: number;
      type: "pi_event" | "snapshot";
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

  const activity = page.getByTestId("agent-run-activity");
  await expect(activity).toContainText("Working");
  await expect(activity).toContainText(/\d+s/);
  const thoughts = page.getByRole("button", { name: "Thoughts", exact: true });
  await thoughts.click();
  await expect(
    page.getByText("I should inspect the runtime before responding."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Thinking", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText("Ran command", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Running command", { exact: true }),
  ).not.toBeVisible();
  await page.getByRole("button", { name: "Stop Pi" }).click();
  await expect(activity).toContainText("Stopping");
  await expect(page.getByRole("button", { name: "Stopping Pi" })).toBeVisible();
  await expect(activity).toContainText("Working", { timeout: 2_000 });
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
      type: "pi_event",
      data: { type: "compaction_start", reason: "auto" },
    });
  });
  await expect(activity).toContainText("Compacting");

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
      type: "pi_event",
      data: { type: "compaction_end", reason: "auto" },
    });
    controls.disconnect();
  });
  await expect(activity).toContainText("Reconnecting");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(activity).toBeVisible();
  await page.getByRole("button", { name: "Open sidebar" }).click();
  await expect(sessionActivity).toBeVisible();
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
      type: "pi_event",
      data: { type: "overtchat_status", status: "idle", startedAt: null },
    });
  });
  await expect(activity).not.toBeVisible();
});
