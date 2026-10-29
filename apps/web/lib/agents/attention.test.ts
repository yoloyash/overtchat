import { describe, expect, it } from "vitest";
import type {
  AgentConnectionListItem,
  AgentSessionListItem,
} from "@overtchat/agent-bridge";
import {
  agentAttentionCounts,
  agentAttentionSections,
  agentSessionHasUnseenTurn,
  agentSessionState,
  formatAgentSessionAge,
  formatAgentWorkingTime,
  mostUrgentAgentSessionState,
} from "./attention";
import {
  agentSessionHosts,
  agentSessionProviders,
  agentSessionWorkspaces,
  searchAgentSessions,
} from "./search";
import { recentAgentSetups } from "./setups";
import { agentSessionIdForPath, sidebarModeForPath } from "./sidebarMode";
import { groupAgentWorkspaces } from "./workspaces";

function session(
  id: string,
  overrides: Partial<AgentSessionListItem> = {},
): AgentSessionListItem {
  return {
    id,
    providerSessionId: `provider-${id}`,
    name: id,
    firstMessage: null,
    messageCount: 1,
    createdAt: 1,
    modifiedAt: 1,
    runtimeStatus: "idle",
    ...overrides,
  };
}

const approval = {
  kind: "approval",
  id: "request",
  requestedAt: 50,
  title: "Allow Bash",
  detail: "npm ci",
} as const;
const question = { ...approval, kind: "question", title: "Route" } as const;
const completed = { outcome: "completed", startedAt: 10, endedAt: 40 } as const;
const failed = { ...completed, outcome: "failed", error: "Boom" } as const;
const stopped = { ...completed, outcome: "stopped" } as const;

describe("agent session state", () => {
  it.each([
    ["no turn yet", {}, "idle"],
    ["running", { runtimeStatus: "running" }, "working"],
    ["an approval while running", { runtimeStatus: "running", attention: approval }, "approval"],
    ["a question", { attention: question }, "question"],
    ["an unseen failure", { lastTurn: failed }, "failed"],
    ["a seen failure", { lastTurn: failed, readTurnEndedAt: 40 }, "idle"],
    ["an unseen failure while a new turn runs", { runtimeStatus: "running", lastTurn: failed }, "failed"],
    ["an unseen completion", { lastTurn: completed }, "unread"],
    ["a completion seen earlier", { lastTurn: completed, readTurnEndedAt: 39 }, "unread"],
    ["a seen completion", { lastTurn: completed, readTurnEndedAt: 40 }, "idle"],
    ["an unseen completion while a new turn runs", { runtimeStatus: "running", lastTurn: completed }, "working"],
    ["a stop", { lastTurn: stopped }, "idle"],
    ["an exited runtime", { runtimeStatus: "exited", lastTurn: completed, readTurnEndedAt: 40 }, "idle"],
  ] as const)("reports %s", (_name, overrides, state) => {
    expect(agentSessionState(session("s", overrides))).toBe(state);
  });

  it("treats only finished, unseen turns as unseen", () => {
    expect(agentSessionHasUnseenTurn(session("s"))).toBe(false);
    expect(agentSessionHasUnseenTurn(session("s", { lastTurn: completed, readTurnEndedAt: null }))).toBe(true);
    expect(agentSessionHasUnseenTurn(session("s", { lastTurn: stopped }))).toBe(false);
  });

  it("picks the most urgent state among sessions", () => {
    expect(mostUrgentAgentSessionState([])).toBe("idle");
    expect(
      mostUrgentAgentSessionState([
        session("a", { lastTurn: completed }),
        session("b", { runtimeStatus: "running" }),
        session("c", { attention: question }),
      ]),
    ).toBe("question");
    expect(
      mostUrgentAgentSessionState([
        session("a", { lastTurn: completed }),
        session("b", { runtimeStatus: "running" }),
      ]),
    ).toBe("working");
  });

  it.each([
    [-5_000, "0s"],
    [45_400, "45s"],
    [12 * 60_000 + 5_000, "12m"],
    [60 * 60_000, "1h"],
    [65 * 60_000, "1h 5m"],
  ])("formats %d ms of work as %s", (elapsed, label) => {
    expect(formatAgentWorkingTime(elapsed)).toBe(label);
  });

  it.each([
    [-5_000, "now"],
    [30_000, "now"],
    [5 * 60_000, "5m"],
    [3 * 3_600_000, "3h"],
    [2 * 86_400_000, "2d"],
    [15 * 86_400_000, "2w"],
  ])("formats an age of %d ms as %s", (elapsed, label) => {
    const now = Date.UTC(2026, 9, 27, 12);
    expect(formatAgentSessionAge(now - elapsed, now)).toBe(label);
  });

  it("formats older ages as a date", () => {
    const now = new Date(2026, 9, 27, 12).getTime();
    const age = formatAgentSessionAge(new Date(2026, 7, 3, 12).getTime(), now);
    expect(age).toMatch(/Aug|8/);
    expect(age).not.toMatch(/2026/);
    expect(formatAgentSessionAge(new Date(2025, 7, 3).getTime(), now)).toMatch(/2025/);
  });
});

function connection(
  provider: "codex" | "claude",
  workspaces: { id: string; name: string; sessions: AgentSessionListItem[] }[],
  host: Partial<AgentConnectionListItem["host"]> = {},
): AgentConnectionListItem {
  return {
    id: provider,
    provider,
    executable: provider,
    detectedVersion: null,
    lastValidatedAt: null,
    host: {
      id: "host",
      connectorId: "connector",
      name: "This machine",
      transport: "local",
      sshAlias: null,
      ...host,
    },
    workspaces: workspaces.map((workspace) => ({
      ...workspace,
      path: `/work/${workspace.name}`,
    })),
  };
}

describe("agent attention sections", () => {
  const connections = [
    connection("codex", [
      {
        id: "codex-app",
        name: "app",
        sessions: [
          session("approval", { runtimeStatus: "running", attention: approval }),
          session("failed", { lastTurn: { ...failed, endedAt: 60 } }),
          session("working-old", { runtimeStatus: "running", turnStartedAt: 20 }),
          session("idle", { lastTurn: completed, readTurnEndedAt: 40 }),
        ],
      },
    ]),
    connection("claude", [
      {
        id: "claude-app",
        name: "app",
        sessions: [
          session("working-new", { runtimeStatus: "running", turnStartedAt: 30 }),
          session("ready-old", { lastTurn: completed }),
          session("ready-new", { lastTurn: { ...completed, endedAt: 70 } }),
          session("stopped", { lastTurn: stopped, modifiedAt: 45 }),
        ],
      },
    ]),
  ];

  it("files sessions by what they need, newest first", () => {
    const sections = agentAttentionSections(groupAgentWorkspaces(connections));
    const ids = (list: typeof sections.done) =>
      list.map((entry) => [entry.item.session.id, entry.state, entry.since]);
    expect(Object.keys(sections)).toEqual([
      "needsInput",
      "failed",
      "ready",
      "working",
      "done",
    ]);
    expect(ids(sections.needsInput)).toEqual([["approval", "approval", 50]]);
    expect(ids(sections.failed)).toEqual([["failed", "failed", 60]]);
    expect(ids(sections.working)).toEqual([
      ["working-new", "working", 30],
      ["working-old", "working", 20],
    ]);
    expect(ids(sections.ready)).toEqual([
      ["ready-new", "unread", 70],
      ["ready-old", "unread", 40],
    ]);
    expect(ids(sections.done)).toEqual([
      ["stopped", "idle", 45],
      ["idle", "idle", 40],
    ]);
    expect(sections.ready[0]!.group.name).toBe("app");
  });

  it("lists one agent's sessions when filtered", () => {
    const sections = agentAttentionSections(groupAgentWorkspaces(connections), "claude");
    expect(
      Object.values(sections).flat().map((entry) => entry.item.session.id).sort(),
    ).toEqual(["ready-new", "ready-old", "stopped", "working-new"]);
  });

  it("counts sessions that need the owner and unseen results", () => {
    expect(agentAttentionCounts(connections)).toEqual({ needsYou: 2, unread: 2 });
    expect(agentAttentionCounts([])).toEqual({ needsYou: 0, unread: 0 });
  });
});

describe("recent agent setups", () => {
  it("orders setups by their latest activity, then list order", () => {
    const setups = recentAgentSetups([
      connection("codex", [
        { id: "codex-empty", name: "empty", sessions: [] },
        { id: "codex-app", name: "app", sessions: [session("a", { modifiedAt: 10 })] },
      ]),
      connection(
        "claude",
        [
          { id: "claude-api", name: "api", sessions: [session("b", { modifiedAt: 5, lastTurn: { ...completed, endedAt: 90 } })] },
          { id: "claude-empty", name: "other", sessions: [] },
        ],
        { transport: "ssh", sshAlias: "home-server", name: "home-server" },
      ),
    ]);
    expect(
      setups.map(({ workspaceId, provider, hostLabel, activityAt }) => [workspaceId, provider, hostLabel, activityAt]),
    ).toEqual([
      ["claude-api", "claude", "home-server", 90],
      ["codex-app", "codex", "This machine", 10],
      ["codex-empty", "codex", "This machine", 0],
      ["claude-empty", "claude", "home-server", 0],
    ]);
    expect(recentAgentSetups([])).toEqual([]);
  });
});

describe("sidebar mode", () => {
  it.each([
    ["/", "agents", "chat"],
    ["/chat/1", "agents", "chat"],
    ["/projects/1", "agents", "chat"],
    ["/library", "agents", "chat"],
    ["/activity/me", "agents", "chat"],
    ["/agents", "chat", "agents"],
    ["/agents/new", "chat", "agents"],
    ["/agents/123", "chat", "agents"],
    ["/agentsx", "agents", "chat"],
    ["/settings", "agents", "agents"],
    ["/settings/models", "chat", "chat"],
  ] as const)("shows %s from %s mode in %s mode", (path, current, mode) => {
    expect(sidebarModeForPath(path, current)).toBe(mode);
  });

  it.each([
    ["/agents/123", "123"],
    ["/agents/a%20b", "a b"],
    ["/agents/new", null],
    ["/agents/history", null],
    ["/agents", null],
    ["/agents/123/files", null],
    ["/chat/123", null],
  ] as const)("%s shows session %s", (path, id) => {
    expect(agentSessionIdForPath(path)).toBe(id);
  });
});

describe("agent session search", () => {
  const groups = groupAgentWorkspaces([
    connection("codex", [
      {
        id: "codex-app",
        name: "app",
        sessions: [
          session("pagination", {
            name: "Add cursor pagination",
            createdAt: 30,
            modifiedAt: 30,
          }),
          session("docs", {
            name: "Write the docs",
            firstMessage: "Document the Réglages page",
            createdAt: 10,
            modifiedAt: 60,
          }),
        ],
      },
      { id: "codex-empty", name: "empty", sessions: [] },
    ]),
    connection(
      "claude",
      [
        {
          id: "claude-api",
          name: "api",
          sessions: [
            session("flaky", {
              name: "Fix the flaky test",
              createdAt: 20,
              modifiedAt: 40,
              lastTurn: { ...completed, endedAt: 50, preview: "Retried the socket handshake" },
            }),
          ],
        },
      ],
      { id: "remote", transport: "ssh", sshAlias: "home-server", name: "home-server" },
    ),
  ]);
  const search = (overrides: Partial<Parameters<typeof searchAgentSessions>[1]>) =>
    searchAgentSessions(groups, {
      query: "",
      host: null,
      workspace: null,
      provider: null,
      sort: "activity",
      ...overrides,
    }).map((entry) => entry.item.session.id);

  it("lists every session by latest activity, or by creation", () => {
    expect(search({})).toEqual(["docs", "flaky", "pagination"]);
    expect(search({ sort: "created" })).toEqual(["pagination", "flaky", "docs"]);
  });

  it("matches every word against titles, messages, replies and setup", () => {
    expect(search({ query: "pagination" })).toEqual(["pagination"]);
    expect(search({ query: "reglages" })).toEqual(["docs"]);
    expect(search({ query: "SOCKET handshake" })).toEqual(["flaky"]);
    expect(search({ query: "home-server" })).toEqual(["flaky"]);
    expect(search({ query: "claude flaky" })).toEqual(["flaky"]);
    expect(search({ query: "claude docs" })).toEqual([]);
  });

  it("filters by machine, folder and agent", () => {
    expect(search({ host: "remote" })).toEqual(["flaky"]);
    expect(search({ workspace: "api" })).toEqual(["flaky"]);
    expect(search({ host: "host", workspace: "api" })).toEqual([]);
    expect(search({ provider: "codex" })).toEqual(["docs", "pagination"]);
  });

  it("offers only the machines, folders and agents that have sessions", () => {
    expect(agentSessionHosts(groups)).toEqual([
      { id: "host", label: "This machine" },
      { id: "remote", label: "home-server" },
    ]);
    expect(agentSessionWorkspaces(groups, null)).toEqual(["api", "app"]);
    expect(agentSessionWorkspaces(groups, "remote")).toEqual(["api"]);
    expect(agentSessionProviders(groups, null, null)).toEqual(["claude", "codex"]);
    expect(agentSessionProviders(groups, "host", null)).toEqual(["codex"]);
    expect(agentSessionProviders(groups, null, "api")).toEqual(["claude"]);
  });
});
