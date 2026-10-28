import { describe, expect, it } from "vitest";
import {
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
    hostId: `host-${hostLabel}`,
    hostLabel,
    transport: hostLabel === "macbook" ? "local" : "ssh",
    activityAt: 0,
  };
}

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
      { hostId: "host-macbook", hostLabel: "macbook", transport: "local" },
      { hostId: "host-home-server", hostLabel: "home-server", transport: "ssh" },
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

describe("agentSetupForWorkspace", () => {
  it("keeps the chosen agent when the folder has it", () => {
    expect(agentSetupForWorkspace(setups, "host-macbook", "/srv/app", "codex")).toBe(
      setups[4],
    );
  });

  it("falls back to the folder's most recently used agent", () => {
    expect(agentSetupForWorkspace(setups, "host-macbook", "/srv/site", "codex")).toBe(
      setups[5],
    );
    expect(
      agentSetupForWorkspace(setups, "host-home-server", "/srv/site", "codex"),
    ).toBeUndefined();
  });
});
