import type {
  AgentConnectionListItem,
  AgentProviderSnapshot,
} from "@overtchat/agent-bridge";
import { describe, expect, it } from "vitest";
import { groupWorkspaces, workspaceAgents, workspaceTarget } from "./workspaces";

function connection(
  id: string,
  provider: AgentConnectionListItem["provider"],
  host: AgentConnectionListItem["host"],
): AgentConnectionListItem {
  return {
    id,
    provider,
    executable: provider,
    detectedVersion: "1",
    lastValidatedAt: null,
    host,
    workspaces: [{ id: `${id}-site`, name: "site", path: "/srv/site", sessions: [] }],
  };
}

const macbook: AgentConnectionListItem["host"] = {
  id: "macbook-codex",
  connectorId: "connector",
  name: "macbook",
  transport: "ssh",
  sshAlias: "macbook",
};

/** What the macbook's last detection found: Claude Code too, but no Hermes. */
const snapshot: AgentProviderSnapshot = {
  target: { connectorId: "connector", transport: "ssh", sshAlias: "macbook" },
  refreshedAt: 1,
  providers: (["claude", "codex", "hermes", "omp", "opencode", "pi"] as const).map(
    (provider) =>
      provider === "hermes"
        ? { provider, status: "unavailable" }
        : { provider, status: "ready", executable: provider, version: "1", shellMode: "login" },
  ),
};

const group = groupWorkspaces([
  connection("codex", "codex", macbook),
  connection("omp", "omp", { ...macbook, id: "macbook-omp" }),
])[0]!;

describe("workspaceTarget", () => {
  it("names the machine as the connector reaches it", () => {
    expect(workspaceTarget(group)).toEqual({
      connectorId: "connector",
      transport: "ssh",
      sshAlias: "macbook",
    });
  });
});

describe("workspaceAgents", () => {
  it("lists the folder's agents, then the rest the machine has", () => {
    expect(workspaceAgents(group, snapshot)).toEqual([
      { provider: "codex", workspaceId: "codex-site", detected: true },
      { provider: "omp", workspaceId: "omp-site", detected: true },
      // Agents without a record of the folder start from its first record.
      { provider: "claude", workspaceId: "codex-site", detected: true },
      { provider: "opencode", workspaceId: "codex-site", detected: true },
      { provider: "pi", workspaceId: "codex-site", detected: true },
    ]);
  });

  it("knows only the folder's agents until the machine answers", () => {
    expect(workspaceAgents(group, undefined).map((agent) => agent.provider)).toEqual([
      "codex",
      "omp",
    ]);
  });
});
