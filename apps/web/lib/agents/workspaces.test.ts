import { describe, expect, it } from "vitest";
import type { AgentConnectionListItem } from "@overtchat/agent-bridge";
import {
  agentConnectionMatchesTarget,
  groupAgentWorkspaces,
} from "./workspaces";

function connection(
  id: string,
  provider: AgentConnectionListItem["provider"],
  options: {
    path?: string;
    transport?: "local" | "ssh";
    sshAlias?: string;
    modifiedAt?: number;
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
        name: "overtchat",
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
});
