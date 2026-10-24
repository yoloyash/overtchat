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
  /** Key of the group this OvertChat worktree was created from, when it is one. */
  parentKey: string | null;
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
      const targetKey = agentTargetKey(agentConnectionTarget(connection));
      const key = JSON.stringify([targetKey, workspace.path]);
      const existing = groups.get(key);
      const target = { connection, workspace };
      const parentKey = workspace.worktreeParentPath
        ? JSON.stringify([targetKey, workspace.worktreeParentPath])
        : null;
      if (existing) {
        existing.parentKey ??= parentKey;
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
        parentKey,
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

/**
 * Splits groups into top-level groups and the worktrees nested under each,
 * keeping the order of `groups` at the top level and sorting worktrees by name.
 * A worktree whose workspace was removed is shown at the top level.
 */
export function nestAgentWorkspaceGroups(groups: AgentWorkspaceGroup[]): {
  roots: AgentWorkspaceGroup[];
  worktrees: Map<string, AgentWorkspaceGroup[]>;
} {
  const keys = new Set(groups.map((group) => group.key));
  const roots: AgentWorkspaceGroup[] = [];
  const worktrees = new Map<string, AgentWorkspaceGroup[]>();
  for (const group of groups) {
    if (group.parentKey === null || !keys.has(group.parentKey)) {
      roots.push(group);
      continue;
    }
    worktrees.set(group.parentKey, [
      ...(worktrees.get(group.parentKey) ?? []),
      group,
    ]);
  }
  for (const children of worktrees.values()) {
    children.sort((left, right) => left.name.localeCompare(right.name));
  }
  return { roots, worktrees };
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
