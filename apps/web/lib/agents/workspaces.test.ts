import { describe, expect, it } from "vitest";
import type { AgentConnectionListItem } from "@overtchat/agent-bridge";
import {
  agentConnectionMatchesTarget,
  groupAgentWorkspaces,
  nestAgentWorkspaceGroups,
  projectAgentWorkspaceProviders,
} from "./workspaces";

function connection(
  id: string,
  provider: AgentConnectionListItem["provider"],
  options: {
    path?: string;
    transport?: "local" | "ssh";
    sshAlias?: string;
    modifiedAt?: number;
    name?: string;
    worktreeParentPath?: string;
  } = {},
): AgentConnectionListItem {
  const transport = options.transport ?? "local";
  return {
    id,
    provider,
    executable: provider,
    detectedVersion: "1.2.3",
    lastValidatedAt: 1,
    host: {
      id: `host-${id}`,
      connectorId: "connector",
      name: transport === "local" ? "This server" : options.sshAlias!,
      transport,
      sshAlias: transport === "ssh" ? options.sshAlias! : null,
    },
    workspaces: [
      {
        id: `workspace-${id}`,
        path: options.path ?? "/srv/overtchat",
        name: options.name ?? "overtchat",
        worktreeParentPath: options.worktreeParentPath ?? null,
        sessions: [
          {
            id: `session-${id}`,
            providerSessionId: `provider-session-${id}`,
            name: `${provider} work`,
            firstMessage: null,
            messageCount: 1,
            createdAt: options.modifiedAt ?? 1,
            modifiedAt: options.modifiedAt ?? 1,
            runtimeStatus: "idle",
          },
        ],
      },
    ],
  };
}

describe("agent workspace projection", () => {
  it("combines provider-specific records for the same host and path", () => {
    const groups = groupAgentWorkspaces([
      connection("codex", "codex", { modifiedAt: 10 }),
      connection("omp", "omp", { modifiedAt: 20 }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]!.targets.map((target) => target.connection.provider)).toEqual([
      "codex",
      "omp",
    ]);
    expect(groups[0]!.sessions.map(({ session }) => session.id)).toEqual([
      "session-omp",
      "session-codex",
    ]);
  });

  it("keeps identical paths on different SSH hosts separate", () => {
    const groups = groupAgentWorkspaces([
      connection("one", "codex", {
        transport: "ssh",
        sshAlias: "dev-one",
      }),
      connection("two", "codex", {
        transport: "ssh",
        sshAlias: "dev-two",
      }),
    ]);

    expect(groups).toHaveLength(2);
  });

  it("matches reusable connections by exact host target and provider", () => {
    const existing = connection("existing", "codex", {
      transport: "ssh",
      sshAlias: "devbox",
    });

    expect(
      agentConnectionMatchesTarget(
        existing,
        { connectorId: "connector", transport: "ssh", sshAlias: "devbox" },
        "codex",
      ),
    ).toBe(true);
    expect(
      agentConnectionMatchesTarget(
        existing,
        { connectorId: "connector", transport: "ssh", sshAlias: "other" },
        "codex",
      ),
    ).toBe(false);
    expect(
      agentConnectionMatchesTarget(
        existing,
        { connectorId: "connector", transport: "ssh", sshAlias: "devbox" },
        "omp",
      ),
    ).toBe(false);
  });

  it("nests worktrees under the workspace they were created from on the same host", () => {
    const groups = groupAgentWorkspaces([
      connection("repo", "codex"),
      connection("beta", "codex", {
        path: "/wt/beta",
        name: "beta",
        worktreeParentPath: "/srv/overtchat",
      }),
      // Another agent's record for the same worktree folder.
      connection("beta-omp", "omp", { path: "/wt/beta", name: "beta" }),
      connection("alpha", "codex", {
        path: "/wt/alpha",
        name: "alpha",
        worktreeParentPath: "/srv/overtchat",
      }),
      connection("orphan", "codex", {
        path: "/wt/orphan",
        name: "orphan",
        worktreeParentPath: "/srv/removed",
      }),
      connection("remote", "codex", {
        transport: "ssh",
        sshAlias: "devbox",
        path: "/wt/remote",
        name: "remote",
        worktreeParentPath: "/srv/overtchat",
      }),
    ]);
    const { roots, worktrees } = nestAgentWorkspaceGroups(groups);

    expect(roots.map((group) => group.name)).toEqual(["overtchat", "orphan", "remote"]);
    expect(worktrees.get(roots[0]!.key)?.map((group) => group.name)).toEqual([
      "alpha",
      "beta",
    ]);
    expect(worktrees.get(roots[0]!.key)?.[1]?.targets).toHaveLength(2);
  });

  it("projects a newly detected provider onto an existing workspace", () => {
    const group = groupAgentWorkspaces([
      connection("pi", "pi"),
    ])[0]!;

    const targets = projectAgentWorkspaceProviders(group, {
      target: { connectorId: "connector", transport: "local" },
      providers: [
        {
          provider: "pi",
          status: "ready",
          executable: "pi",
          version: "1",
          shellMode: "interactive",
        },
        { provider: "omp", status: "unavailable" },
        { provider: "codex", status: "unavailable" },
        {
          provider: "opencode",
          status: "ready",
          executable: "opencode",
          version: "2",
          shellMode: "interactive",
        },
      ],
      refreshedAt: 1,
    });

    expect(targets).toEqual([
      { provider: "pi", workspace: group.targets[0]!.workspace },
      { provider: "opencode", workspace: group.targets[0]!.workspace },
    ]);
  });
});
