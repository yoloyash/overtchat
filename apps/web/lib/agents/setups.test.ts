import { describe, expect, it } from "vitest";
import {
  agentSetupWorkspaceNames,
  agentSetupsByHost,
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
    hostLabel,
    transport: "local",
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

describe("agentSetupWorkspaceNames", () => {
  it("lists each workspace name once, most recently used first", () => {
    expect(agentSetupWorkspaceNames(setups)).toEqual(["app", "api", "site"]);
  });
});

describe("agentSetupsByHost", () => {
  it("groups one workspace's setups by host in last-used order", () => {
    expect(agentSetupsByHost(setups, "app")).toEqual([
      {
        hostLabel: "macbook",
        setups: [setups[0], setups[2], setups[4]],
      },
      { hostLabel: "home-server", setups: [setups[3]] },
    ]);
  });

  it("is empty for a name no setup has", () => {
    expect(agentSetupsByHost(setups, "docs")).toEqual([]);
  });
});
