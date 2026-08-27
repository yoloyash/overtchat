import type {
  AgentConnectionListItem,
  AgentDiscoveryTarget,
  AgentProviderId,
  AgentProviderSnapshot,
  AgentSessionListItem,
  AgentWorkspaceListItem,
} from "@overtchat/agent-bridge";

export type AgentWorkspaceTarget = {
  connection: AgentConnectionListItem;
  workspace: AgentWorkspaceListItem;
};

export type AgentWorkspaceSession = {
  provider: AgentProviderId;
  workspaceId: string;
  session: AgentSessionListItem;
};

export type AgentWorkspaceGroup = {
  key: string;
  name: string;
  path: string;
  host: AgentConnectionListItem["host"];
  targets: AgentWorkspaceTarget[];
  sessions: AgentWorkspaceSession[];
};

export type AgentWorkspaceProviderTarget = {
  provider: AgentProviderId;
  workspace: AgentWorkspaceListItem;
};

export function agentTargetKey(target: AgentDiscoveryTarget): string {
  return JSON.stringify([
    target.connectorId,
    target.transport,
    target.transport === "ssh" ? target.sshAlias : "",
  ]);
}

export function agentConnectionTarget(
  connection: AgentConnectionListItem,
): AgentDiscoveryTarget {
  return connection.host.transport === "local"
    ? {
        connectorId: connection.host.connectorId,
        transport: "local",
      }
    : {
        connectorId: connection.host.connectorId,
        transport: "ssh",
        sshAlias: connection.host.sshAlias!,
      };
}

export function agentConnectionMatchesTarget(
  connection: AgentConnectionListItem,
  target: {
    connectorId: string;
    transport: "local" | "ssh";
    sshAlias?: string;
  },
  provider: AgentProviderId,
): boolean {
  return (
    connection.provider === provider &&
    connection.host.connectorId === target.connectorId &&
    connection.host.transport === target.transport &&
    (target.transport === "local" ||
      connection.host.sshAlias === target.sshAlias)
  );
}

export function groupAgentWorkspaces(
  connections: AgentConnectionListItem[],
): AgentWorkspaceGroup[] {
  const groups = new Map<string, AgentWorkspaceGroup>();

  for (const connection of connections) {
    for (const workspace of connection.workspaces) {
      const key = JSON.stringify([
        agentTargetKey(agentConnectionTarget(connection)),
        workspace.path,
      ]);
      const existing = groups.get(key);
      const target = { connection, workspace };
      if (existing) {
        existing.targets.push(target);
        existing.sessions.push(
          ...workspace.sessions.map((session) => ({
            provider: connection.provider,
            workspaceId: workspace.id,
            session,
          })),
        );
        continue;
      }

      groups.set(key, {
        key,
        name: workspace.name,
        path: workspace.path,
        host: connection.host,
        targets: [target],
        sessions: workspace.sessions.map((session) => ({
          provider: connection.provider,
          workspaceId: workspace.id,
          session,
        })),
      });
    }
  }

  return [...groups.values()].map((group) => ({
    ...group,
    targets: [...group.targets].sort((left, right) =>
      left.connection.provider.localeCompare(right.connection.provider),
    ),
    sessions: [...group.sessions].sort((left, right) => {
      const leftTime =
        left.session.modifiedAt ?? left.session.createdAt ?? 0;
      const rightTime =
        right.session.modifiedAt ?? right.session.createdAt ?? 0;
      return rightTime - leftTime;
    }),
  }));
}

export function projectAgentWorkspaceProviders(
  group: AgentWorkspaceGroup,
  snapshot: AgentProviderSnapshot | undefined,
): AgentWorkspaceProviderTarget[] {
  const representativeWorkspace = group.targets[0]!.workspace;
  const providers = new Set<AgentProviderId>(
    snapshot?.providers.flatMap((entry) =>
      entry.status === "ready" ? [entry.provider] : [],
    ) ?? [],
  );
  for (const { connection } of group.targets) providers.add(connection.provider);
  return [...providers].map((provider) => ({
    provider,
    workspace:
      group.targets.find(
        ({ connection }) => connection.provider === provider,
      )?.workspace ?? representativeWorkspace,
  }));
}
