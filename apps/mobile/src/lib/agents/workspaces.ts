import type {
  AgentConnectionListItem,
  AgentDiscoveryTarget,
  AgentProviderId,
  AgentProviderSnapshot,
  AgentSessionListItem,
  AgentWorkspaceListItem,
} from "@overtchat/agent-bridge";
import {
  agentWorkspaceAgents,
  type AgentWorkspaceAgent,
} from "@overtchat/shared/agent-creation";

export type WorkspaceSession = {
  provider: AgentProviderId;
  workspaceId: string;
  session: AgentSessionListItem;
};
export type WorkspaceGroup = {
  key: string;
  name: string;
  path: string;
  host: AgentConnectionListItem["host"];
  targets: { provider: AgentProviderId; workspace: AgentWorkspaceListItem }[];
  sessions: WorkspaceSession[];
};
export const WORKSPACE_CHAT_PREVIEW = 5;

export function recentAgentChats(groups: WorkspaceGroup[], limit = 5) {
  return groups
    .flatMap((group) => group.sessions.map((item) => ({ item, group })))
    .sort(
      (a, b) =>
        (b.item.session.modifiedAt ?? b.item.session.createdAt ?? 0) -
        (a.item.session.modifiedAt ?? a.item.session.createdAt ?? 0),
    )
    .slice(0, limit);
}

// A directory on the same connector/SSH target is one workspace, even when
// multiple providers have chats there. Match the web client's workspace identity.
export function groupWorkspaces(
  connections: AgentConnectionListItem[],
): WorkspaceGroup[] {
  const groups = new Map<string, WorkspaceGroup>();
  for (const connection of connections) {
    for (const workspace of connection.workspaces) {
      const key = JSON.stringify([
        connection.host.connectorId,
        connection.host.transport,
        connection.host.transport === "ssh" ? connection.host.sshAlias : "",
        workspace.path,
      ]);
      let group = groups.get(key);
      if (!group) {
        group = {
          key,
          name: workspace.name,
          path: workspace.path,
          host: connection.host,
          targets: [],
          sessions: [],
        };
        groups.set(key, group);
      }
      group.targets.push({ provider: connection.provider, workspace });
      group.sessions.push(
        ...workspace.sessions.map((session) => ({
          provider: connection.provider,
          workspaceId: workspace.id,
          session,
        })),
      );
    }
  }
  for (const group of groups.values())
    group.sessions.sort(
      (a, b) =>
        (b.session.modifiedAt ?? b.session.createdAt ?? 0) -
        (a.session.modifiedAt ?? a.session.createdAt ?? 0),
    );
  return [...groups.values()];
}
/** The machine the folder is on, as the connector reaches it. */
export function workspaceTarget(group: WorkspaceGroup): AgentDiscoveryTarget {
  return group.host.transport === "local"
    ? { connectorId: group.host.connectorId, transport: "local" }
    : {
        connectorId: group.host.connectorId,
        transport: "ssh",
        sshAlias: group.host.sshAlias!,
      };
}

/**
 * The agents a new chat in the folder can use: those with a record of it,
 * then the rest the machine has. An agent without a record starts from the
 * folder's first record; the server files the chat under the agent's own.
 */
export function workspaceAgents(
  group: WorkspaceGroup,
  snapshot: AgentProviderSnapshot | undefined,
): AgentWorkspaceAgent[] {
  return agentWorkspaceAgents(
    group.targets.map(({ provider, workspace }) => ({
      provider,
      workspaceId: workspace.id,
    })),
    snapshot,
  ).filter((agent) => agent.detected);
}

export function workspaceMatches(group: WorkspaceGroup, search: string) {
  return `${group.name} ${group.path} ${group.host.name} ${group.targets.map((t) => t.provider).join(" ")}`
    .toLowerCase()
    .includes(search.trim().toLowerCase());
}
export function matchingSessions(group: WorkspaceGroup, search: string) {
  if (workspaceMatches(group, search)) return group.sessions;
  const query = search.trim().toLowerCase();
  return group.sessions.filter(({ session }) =>
    `${session.name ?? ""} ${session.firstMessage ?? ""}`
      .toLowerCase()
      .includes(query),
  );
}
/** The folder and list entry for a session id, when the list knows it. */
export function findAgentSession(groups: WorkspaceGroup[], id: string) {
  for (const group of groups) {
    const item = group.sessions.find(({ session }) => session.id === id);
    if (item) return { group, item };
  }
  return null;
}
export function sessionTitle(session: AgentSessionListItem) {
  return session.name || session.firstMessage || "Untitled chat";
}
