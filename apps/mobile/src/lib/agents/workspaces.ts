import type {
  AgentConnectionListItem,
  AgentDiscoveryTarget,
  AgentProviderId,
  AgentProviderSnapshot,
  AgentSessionListItem,
  AgentWorkspaceListItem,
} from "@overtchat/agent-bridge";
import { agentSessionDisplayTitle } from "@overtchat/shared/agent-attention";
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

/** How a machine is named everywhere: its SSH alias, else its name. */
export function agentHostLabel(
  host: Pick<AgentConnectionListItem["host"], "name" | "sshAlias">,
): string {
  return host.sshAlias || host.name || "This server";
}

/**
 * The machine a connection reaches, as a key. Every agent on a machine has
 * its own host row, so the row id would make each agent its own machine.
 */
export function agentTargetKey(target: AgentDiscoveryTarget): string {
  return JSON.stringify([
    target.connectorId,
    target.transport,
    target.transport === "ssh" ? target.sshAlias : "",
  ]);
}

export function agentConnectionTarget(
  connection: Pick<AgentConnectionListItem, "host">,
): AgentDiscoveryTarget {
  return connection.host.transport === "local"
    ? { connectorId: connection.host.connectorId, transport: "local" }
    : {
        connectorId: connection.host.connectorId,
        transport: "ssh",
        sshAlias: connection.host.sshAlias!,
      };
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
        agentTargetKey(agentConnectionTarget(connection)),
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
  return agentConnectionTarget(group);
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

/** The sessions in a folder whose title or first message contains the search. */
export function matchingSessions(group: WorkspaceGroup, search: string) {
  const query = search.trim().toLowerCase();
  if (!query) return group.sessions;
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
  return agentSessionDisplayTitle(session) || "New session";
}
/**
 * Where a new session in a folder starts: with the agent used there most
 * recently, else the first agent with a record of the folder.
 */
export function workspaceNewSessionParams(group: WorkspaceGroup): {
  workspace: string;
  provider: AgentProviderId;
} {
  const recent = group.sessions[0];
  return {
    workspace: recent?.workspaceId ?? group.targets[0]!.workspace.id,
    provider: recent?.provider ?? group.targets[0]!.provider,
  };
}
