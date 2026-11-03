import { describe, expect, it, vi } from "vitest";
import type {
  AgentConnectionListItem,
  AgentProviderSnapshot,
  AgentSessionListItem,
} from "@overtchat/agent-bridge";

// The mode hook reads the route; these tests only use the pure helpers.
vi.mock("expo-router", () => ({ usePathname: () => "/chat" }));
import { agentDrawerEntries, agentSessionRowMeta } from "./attention";
import {
  agentSessionHosts,
  agentSessionProviders,
  agentSessionWorkspaces,
  searchAgentSessions,
} from "./search";
import {
  agentSetupAgentsForWorkspace,
  agentSetupForWorkspace,
  agentSetupHosts,
  agentSetupWorkspaces,
  recentAgentSetups,
} from "./setups";
import {
  rememberSidebarMode,
  resetSidebarModeMemory,
  sidebarModeForPath,
  sidebarModeHref,
} from "./sidebarMode";
import { agentHostLabel, groupWorkspaces } from "./workspaces";

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
      id: `${provider}-host`,
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

const approval = {
  kind: "approval",
  id: "request",
  requestedAt: 50,
  title: "Allow Bash",
  detail: "npm ci",
} as const;
const completed = { outcome: "completed", startedAt: 10, endedAt: 40 } as const;
const failed = { ...completed, outcome: "failed", error: "Boom" } as const;

const connections = [
  connection("codex", [
    {
      id: "codex-app",
      name: "app",
      sessions: [
        session("approval", { runtimeStatus: "running", attention: approval }),
        session("failed", { lastTurn: { ...failed, endedAt: 60 } }),
        session("working", { runtimeStatus: "running", turnStartedAt: 20 }),
        session("ready", { lastTurn: { ...completed, endedAt: 70 } }),
        ...Array.from({ length: 9 }, (_, i) =>
          session(`done-${i}`, { modifiedAt: 100 - i, lastTurn: completed, readTurnEndedAt: 40 }),
        ),
      ],
    },
    { id: "codex-empty", name: "empty", sessions: [] },
  ]),
  connection(
    "claude",
    [
      {
        id: "claude-app",
        name: "app",
        sessions: [session("claude-done", { modifiedAt: 200, lastTurn: completed, readTurnEndedAt: 40 })],
      },
    ],
    { transport: "ssh", sshAlias: "home-server", name: "Home server" },
  ),
];
const groups = groupWorkspaces(connections);

describe("agent drawer entries", () => {
  it("files sessions by status, shortens Done to seven, and keeps the open session listed", () => {
    const entries = agentDrawerEntries(groups, {
      grouping: "status",
      collapsed: [],
      showAllDone: false,
      activeSessionId: "done-8",
    });
    expect(
      entries.map((entry) =>
        entry.kind === "group"
          ? `# ${entry.label}`
          : entry.kind === "session"
            ? entry.entry.item.session.id
            : entry.kind,
      ),
    ).toEqual([
      "# Needs input",
      "approval",
      "# Failed",
      "failed",
      "# Ready to review",
      "ready",
      "# Working",
      "working",
      "# Done",
      "claude-done",
      ...[0, 1, 2, 3, 4, 5].map((i) => `done-${i}`),
      "done-8",
      "more",
    ]);
    const more = entries.at(-1)!;
    expect(more).toMatchObject({ kind: "more", hidden: 2, expanded: false });
    expect(
      agentDrawerEntries(groups, {
        grouping: "status",
        collapsed: ["done", "working"],
        showAllDone: false,
        activeSessionId: null,
      }).map((entry) => (entry.kind === "group" ? `${entry.label}${entry.collapsed ? " (folded)" : ""}` : entry.kind)),
    ).toEqual([
      "Needs input",
      "session",
      "Failed",
      "session",
      "Ready to review",
      "session",
      "Working (folded)",
      "Done (folded)",
    ]);
    expect(
      agentDrawerEntries(groups, {
        grouping: "status",
        collapsed: [],
        showAllDone: true,
        activeSessionId: null,
      }).filter((entry) => entry.kind === "session"),
    ).toHaveLength(14);
  });

  it("groups by workspace with the most urgent state on a folded folder", () => {
    const entries = agentDrawerEntries(groups, {
      grouping: "workspace",
      collapsed: [groups[0]!.key, groups[2]!.key],
      showAllDone: false,
      activeSessionId: null,
    });
    expect(
      entries.map((entry) =>
        entry.kind === "workspace"
          ? [entry.group.name, agentHostLabel(entry.group.host), entry.state, entry.collapsed]
          : entry.kind === "empty"
            ? entry.text
            : entry.kind,
      ),
    ).toEqual([
      ["app", "This machine", "approval", true],
      ["empty", "This machine", "idle", false],
      "No sessions yet.",
      ["app", "home-server", "idle", true],
    ]);
    // The open session's folder stays open.
    const open = agentDrawerEntries(groups, {
      grouping: "workspace",
      collapsed: [groups[2]!.key],
      showAllDone: false,
      activeSessionId: "claude-done",
    });
    const rows = open.flatMap((entry) => (entry.kind === "session" ? [entry.entry] : []));
    expect(rows.map((entry) => entry.item.session.id)).toContain("claude-done");
    // Under its folder a row names its agent; a waiting one still shows its request.
    expect(agentSessionRowMeta(rows[0]!, "workspace")).toBe("Allow Bash · npm ci");
    expect(agentSessionRowMeta(rows[1]!, "workspace")).toBe("Codex");
  });

  it("says what a waiting session asks, else where it runs", () => {
    const entries = agentDrawerEntries(groups, {
      grouping: "status",
      collapsed: [],
      showAllDone: false,
      activeSessionId: null,
    }).filter((entry) => entry.kind === "session");
    expect(agentSessionRowMeta(entries[0]!.entry, "all")).toBe("Allow Bash · npm ci");
    expect(agentSessionRowMeta(entries[1]!.entry, "all")).toBe("app · This machine");
    expect(agentSessionRowMeta(entries[1]!.entry, "workspace")).toBe("Codex");
  });

  it("lists nothing to see without sessions or workspaces", () => {
    expect(
      agentDrawerEntries([], { grouping: "status", collapsed: [], showAllDone: false, activeSessionId: null }),
    ).toEqual([{ kind: "empty", key: "empty", text: "No sessions yet." }]);
    expect(
      agentDrawerEntries([], { grouping: "workspace", collapsed: [], showAllDone: false, activeSessionId: null }),
    ).toEqual([{ kind: "empty", key: "empty", text: "No workspaces yet." }]);
  });
});

describe("recent agent setups", () => {
  it("orders setups by their latest activity, then list order, and lists machines, folders and agents", () => {
    const setups = recentAgentSetups(connections);
    expect(setups.map(({ workspaceId, provider, hostLabel, activityAt }) => [workspaceId, provider, hostLabel, activityAt])).toEqual([
      ["claude-app", "claude", "home-server", 200],
      ["codex-app", "codex", "This machine", 100],
      ["codex-empty", "codex", "This machine", 0],
    ]);
    expect(agentSetupHosts(setups).map((host) => host.hostLabel)).toEqual(["home-server", "This machine"]);
    const local = setups[1]!.hostKey;
    expect(agentSetupWorkspaces(setups, local).map((setup) => setup.workspaceName)).toEqual(["app", "empty"]);
    // Agents the machine has but never used in the folder follow, from its detection.
    const snapshot = {
      target: setups[1]!.target,
      providers: [
        { provider: "codex", status: "ready" },
        { provider: "claude", status: "ready" },
        { provider: "pi", status: "missing" },
      ],
    } as unknown as AgentProviderSnapshot;
    expect(
      agentSetupAgentsForWorkspace(setups, local, "/work/app", snapshot).map((agent) => [agent.provider, agent.detected]),
    ).toEqual([["codex", true], ["claude", true], ["pi", false]]);
    expect(agentSetupForWorkspace(setups, local, "/work/empty", "claude", snapshot)).toMatchObject({
      provider: "claude",
      workspaceId: "codex-empty",
    });
    expect(agentSetupForWorkspace(setups, local, "/work/empty", "claude", undefined)).toMatchObject({
      provider: "codex",
    });
  });
});

describe("agent session search", () => {
  it("narrows by machine, folder and agent and matches every word", () => {
    expect(agentSessionHosts(groups)).toEqual(["This machine", "home-server"]);
    expect(agentSessionWorkspaces(groups, "home-server")).toEqual(["app"]);
    expect(agentSessionProviders(groups, null, "app")).toEqual(["claude", "codex"]);
    expect(agentSessionProviders(groups, "home-server", null)).toEqual(["claude"]);
    const all = { query: "", host: null, workspace: null, provider: null, sort: "activity" as const };
    expect(searchAgentSessions(groups, all)).toHaveLength(14);
    expect(searchAgentSessions(groups, all)[0]!.item.session.id).toBe("claude-done");
    expect(
      searchAgentSessions(groups, { ...all, query: "bash npm" }).map((entry) => entry.item.session.id),
    ).toEqual(["approval"]);
    expect(
      searchAgentSessions(groups, { ...all, host: "home-server" }).map((entry) => entry.item.session.id),
    ).toEqual(["claude-done"]);
    expect(searchAgentSessions(groups, { ...all, provider: "claude", host: "This machine" })).toEqual([]);
    expect(
      searchAgentSessions(groups, { ...all, query: "boom" }).map((entry) => entry.state),
    ).toEqual(["failed"]);
  });
});

describe("drawer mode", () => {
  it.each([
    ["/chat", "agents", "chat"],
    ["/projects/1", "agents", "chat"],
    ["/search", "agents", "chat"],
    ["/agents", "chat", "agents"],
    ["/agents/history", "chat", "agents"],
    ["/agent/123", "chat", "agents"],
    ["/agentsx", "agents", "chat"],
    ["/settings", "agents", "agents"],
    ["/settings/models", "chat", "chat"],
    ["/personalization", "agents", "agents"],
  ] as const)("shows %s from %s mode in %s mode", (path, current, mode) => {
    expect(sidebarModeForPath(path, current)).toBe(mode);
  });

  it("returns each mode to the screen it was left on, else its home", () => {
    resetSidebarModeMemory();
    expect(sidebarModeHref("chat")).toBe("/chat");
    expect(sidebarModeHref("agents")).toBe("/agents");
    rememberSidebarMode("agents", "/agent/123");
    rememberSidebarMode("agents", null);
    expect(sidebarModeHref("agents")).toBe("/agent/123");
    rememberSidebarMode("chat", "/projects/9");
    expect(sidebarModeHref("chat")).toBe("/projects/9");
    resetSidebarModeMemory();
    expect(sidebarModeHref("agents")).toBe("/agents");
  });
});
