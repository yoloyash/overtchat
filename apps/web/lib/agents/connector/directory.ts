import "server-only";
import type { AgentConnectionListItem } from "@overtchat/agent-bridge";
import { hostConnectorBroker } from "./broker";

export function withConnectorSessionDirectory(
  connections: AgentConnectionListItem[],
): AgentConnectionListItem[] {
  return connections.map((connection) => ({
    ...connection,
    workspaces: connection.workspaces.map((workspace) => ({
      ...workspace,
      sessions: workspace.sessions.map((session) => ({
        ...session,
        runtimeStatus: hostConnectorBroker.runtimeStatusForSession(session.id),
      })),
    })),
  }));
}
