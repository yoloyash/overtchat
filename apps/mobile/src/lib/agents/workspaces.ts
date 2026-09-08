import type {
  AgentConnectionListItem,
  AgentProviderId,
  AgentSessionListItem,
  AgentWorkspaceListItem,
} from "@overtchat/agent-bridge";

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
export function sessionTitle(session: AgentSessionListItem) {
  return session.name || session.firstMessage || "Untitled chat";
}
