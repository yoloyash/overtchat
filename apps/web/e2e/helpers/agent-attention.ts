import type { Page } from "@playwright/test";
import type {
  AgentConnectionListItem,
  AgentSessionDirectoryEntry,
  AgentSessionListItem,
} from "@overtchat/agent-bridge";
import { setupUrl } from "./database";

/** Agents in every attention state, for specs that script the session list. */
const now = Date.now();

function session(
  id: string,
  name: string,
  overrides: Partial<AgentSessionListItem> = {},
): AgentSessionListItem {
  return {
    id,
    providerSessionId: `native-${id}`,
    name,
    firstMessage: null,
    messageCount: 2,
    createdAt: now - 3_600_000,
    modifiedAt: now - 3_600_000,
    runtimeStatus: "idle",
    ...overrides,
  };
}

export function agentAttentionFixture(): AgentConnectionListItem[] {
  return [
    {
      id: "codex",
      provider: "codex",
      executable: "codex",
      detectedVersion: "1.0",
      lastValidatedAt: null,
      host: {
        id: "local-host",
        connectorId: "connector",
        name: "This machine",
        transport: "local",
        sshAlias: null,
      },
      workspaces: [
        {
          id: "codex-app",
          name: "app",
          path: "/srv/app",
          sessions: [
            session("approval", "Upgrade the parser", {
              runtimeStatus: "running",
              turnStartedAt: now - 120_000,
              attention: {
                kind: "approval",
                id: "request",
                requestedAt: now - 60_000,
                title: "Allow Bash",
                detail: "npm ci",
              },
            }),
            session("failed", "Fix the flaky test", {
              lastTurn: {
                outcome: "failed",
                startedAt: now - 600_000,
                endedAt: now - 500_000,
                error: "Rate limit reached",
              },
            }),
            session("working", "Write the docs", {
              runtimeStatus: "running",
              turnStartedAt: now - 75_000,
            }),
          ],
        },
        { id: "codex-site", name: "site", path: "/srv/site", sessions: [] },
      ],
    },
    {
      id: "claude",
      provider: "claude",
      executable: "claude",
      detectedVersion: "1.0",
      lastValidatedAt: null,
      host: {
        id: "ssh-host",
        connectorId: "connector",
        name: "home-server",
        transport: "ssh",
        sshAlias: "home-server",
      },
      workspaces: [
        // The same folder as codex-site, reachable with another agent.
        { id: "claude-site", name: "site", path: "/srv/site", sessions: [] },
        {
          id: "claude-api",
          name: "api",
          path: "/srv/api",
          sessions: [
            session("ready", "Add pagination", {
              lastTurn: {
                outcome: "completed",
                startedAt: now - 300_000,
                endedAt: now - 240_000,
                preview: "Added cursor pagination to /items.",
              },
            }),
            session("seen", "Old refactor", {
              lastTurn: {
                outcome: "completed",
                startedAt: now - 7_200_000,
                endedAt: now - 7_000_000,
              },
              readTurnEndedAt: now - 7_000_000,
            }),
          ],
        },
      ],
    },
  ];
}

function directory(
  connections: AgentConnectionListItem[],
): AgentSessionDirectoryEntry[] {
  return connections.flatMap((connection) =>
    connection.workspaces.flatMap((workspace) =>
      workspace.sessions.map((item) => ({
        sessionId: item.id,
        runtimeStatus: item.runtimeStatus,
        turnStartedAt: item.turnStartedAt ?? null,
        attention: item.attention ?? null,
        lastTurn: item.lastTurn ?? null,
      })),
    ),
  );
}

export async function setupAgentAttention(
  page: Page,
  connections = agentAttentionFixture(),
) {
  const reads: Array<{ sessionId: string; read: boolean }> = [];
  await page.context().route("**/api/agent-connections", (route) =>
    route.fulfill({ json: { connections } }),
  );
  await page.context().route("**/api/agent-connections/events*", (route) =>
    route.fulfill({
      contentType: "text/event-stream",
      body: `event: snapshot\ndata: ${JSON.stringify({ sessions: directory(connections) })}\n\n`,
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
  await page
    .context()
    .route("**/api/agent-workspaces/*/catalog?*", (route) =>
      route.fulfill({ json: { provider: "codex", models: [], modes: [] } }),
    );
  await page.context().route("**/api/agent-sessions/*/read", (route) => {
    const sessionId = new URL(route.request().url()).pathname.split("/").at(-2)!;
    const { read } = route.request().postDataJSON() as { read: boolean };
    reads.push({ sessionId, read });
    for (const item of connections.flatMap((connection) =>
      connection.workspaces.flatMap((workspace) => workspace.sessions),
    )) {
      if (item.id === sessionId && item.lastTurn) {
        item.readTurnEndedAt = read ? item.lastTurn.endedAt : item.lastTurn.endedAt - 1;
      }
    }
    return route.fulfill({ status: 204 });
  });
  await page.goto(await setupUrl());
  await page.locator("#name").fill("Attention Admin");
  await page.locator("#email").fill("attention-admin@overtchat-test.local");
  await page.locator("#password").fill("test-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/");
  return { reads };
}

/** Starts the agents sidebar grouped by workspace unless the test regroups it. */
export async function groupAgentsByWorkspace(page: Page) {
  await page.addInitScript((key) => {
    if (localStorage.getItem(key) === null) {
      localStorage.setItem(key, JSON.stringify("workspace"));
    }
  }, "overtchat:agent-sidebar-grouping");
}
