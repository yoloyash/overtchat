import type { AgentProviderSnapshot } from "@overtchat/agent-bridge";
import { describe, expect, it } from "vitest";
import {
  agentSetupAgentsForWorkspace,
  agentSetupForWorkspace,
  agentSetupHosts,
  agentSetupWorkspaces,
  agentSetupsForWorkspace,
  type AgentSetup,
} from "./setups";

function setup(
  workspaceId: string,
  workspaceName: string,
  provider: AgentSetup["provider"],
  hostLabel: string,
): AgentSetup {
  return {
    workspaceId,
    provider,
    workspaceName,
    workspacePath: `/srv/${workspaceName}`,
    hostKey: `host-${hostLabel}`,
    hostLabel,
    transport: hostLabel === "macbook" ? "local" : "ssh",
    target:
      hostLabel === "macbook"
        ? { connectorId: "connector", transport: "local" }
        : { connectorId: "connector", transport: "ssh", sshAlias: hostLabel },
    activityAt: 0,
  };
}

/** What the macbook's last detection found: Claude Code too, but no Hermes. */
const macbookSnapshot: AgentProviderSnapshot = {
  target: { connectorId: "connector", transport: "local" },
  refreshedAt: 1,
  providers: (["claude", "codex", "hermes", "omp", "opencode", "pi"] as const).map(
    (provider) =>
      provider === "hermes" || provider === "opencode"
        ? { provider, status: "unavailable" }
        : { provider, status: "ready", executable: provider, version: "1", shellMode: "login" },
  ),
};

// Already in most-recently-used order, as recentAgentSetups returns them.
const setups = [
  setup("omp-app-mac", "app", "omp", "macbook"),
  setup("claude-api-home", "api", "claude", "home-server"),
  setup("claude-app-mac", "app", "claude", "macbook"),
  setup("codex-app-home", "app", "codex", "home-server"),
  setup("codex-app-mac", "app", "codex", "macbook"),
  setup("pi-site-mac", "site", "pi", "macbook"),
];

describe("agentSetupHosts", () => {
  it("lists each machine once, most recently used first", () => {
    expect(agentSetupHosts(setups)).toEqual([
      { hostKey: "host-macbook", hostLabel: "macbook", transport: "local" },
      { hostKey: "host-home-server", hostLabel: "home-server", transport: "ssh" },
    ]);
  });
});

describe("agentSetupWorkspaces", () => {
  it("lists each folder on the machine once, by its most recently used agent", () => {
    expect(agentSetupWorkspaces(setups, "host-macbook")).toEqual([
      setups[0],
      setups[5],
    ]);
    expect(agentSetupWorkspaces(setups, "host-home-server")).toEqual([
      setups[1],
      setups[3],
    ]);
    expect(agentSetupWorkspaces(setups, "host-gaming-pc")).toEqual([]);
  });
});

describe("agentSetupsForWorkspace", () => {
  it("lists the agents that have the folder on that machine, in last-used order", () => {
    expect(agentSetupsForWorkspace(setups, "host-macbook", "/srv/app")).toEqual([
      setups[0],
      setups[2],
      setups[4],
    ]);
    expect(agentSetupsForWorkspace(setups, "host-home-server", "/srv/site")).toEqual([]);
  });
});

describe("agentSetupAgentsForWorkspace", () => {
  it("lists the folder's agents first, then the rest the machine has", () => {
    expect(
      agentSetupAgentsForWorkspace(setups, "host-macbook", "/srv/site", macbookSnapshot),
    ).toEqual([
      { provider: "pi", workspaceId: "pi-site-mac", detected: true },
      // Agents the folder lacks start from its most recently used record.
      { provider: "claude", workspaceId: "pi-site-mac", detected: true },
      { provider: "codex", workspaceId: "pi-site-mac", detected: true },
      { provider: "omp", workspaceId: "pi-site-mac", detected: true },
      { provider: "hermes", workspaceId: "pi-site-mac", detected: false },
      { provider: "opencode", workspaceId: "pi-site-mac", detected: false },
    ]);
  });

  it("keeps an agent the folder has even when detection no longer finds it", () => {
    const snapshot: AgentProviderSnapshot = {
      ...macbookSnapshot,
      providers: macbookSnapshot.providers.map((entry) =>
        entry.provider === "pi" ? { provider: "pi", status: "unavailable" } : entry,
      ),
    };
    expect(
      agentSetupAgentsForWorkspace(setups, "host-macbook", "/srv/site", snapshot)[0],
    ).toEqual({ provider: "pi", workspaceId: "pi-site-mac", detected: true });
  });

  it("knows only the folder's agents before detection, and none for a folder it lacks", () => {
    expect(
      agentSetupAgentsForWorkspace(setups, "host-macbook", "/srv/site", undefined),
    ).toEqual([{ provider: "pi", workspaceId: "pi-site-mac", detected: true }]);
    expect(
      agentSetupAgentsForWorkspace(setups, "host-home-server", "/srv/site", macbookSnapshot),
    ).toEqual([]);
  });
});

describe("agentSetupForWorkspace", () => {
  it("keeps the chosen agent when the folder has it", () => {
    expect(
      agentSetupForWorkspace(setups, "host-macbook", "/srv/app", "codex", undefined),
    ).toEqual({ provider: "codex", workspaceId: "codex-app-mac", detected: true });
  });

  it("keeps the chosen agent when the machine has it", () => {
    expect(
      agentSetupForWorkspace(setups, "host-macbook", "/srv/site", "codex", macbookSnapshot),
    ).toEqual({ provider: "codex", workspaceId: "pi-site-mac", detected: true });
  });

  it("falls back to the folder's most recently used agent", () => {
    expect(
      agentSetupForWorkspace(setups, "host-macbook", "/srv/site", "codex", undefined),
    ).toEqual({ provider: "pi", workspaceId: "pi-site-mac", detected: true });
    expect(
      agentSetupForWorkspace(setups, "host-macbook", "/srv/site", "hermes", macbookSnapshot),
    ).toEqual({ provider: "pi", workspaceId: "pi-site-mac", detected: true });
    expect(
      agentSetupForWorkspace(setups, "host-home-server", "/srv/site", "codex", undefined),
    ).toBeUndefined();
  });
});
