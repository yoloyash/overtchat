import "server-only";
import {
  applyAgentSessionDirectoryEntry,
  type AgentConnectionListItem,
  type AgentSessionListItem,
} from "@overtchat/agent-bridge";
import { hostConnectorBroker } from "./broker";

export function withConnectorSessionState(
  session: AgentSessionListItem,
): AgentSessionListItem {
  return applyAgentSessionDirectoryEntry(
    session,
    hostConnectorBroker.sessionDirectoryEntry(session.id),
  );
}

export function withConnectorSessionDirectory(
  connections: AgentConnectionListItem[],
): AgentConnectionListItem[] {
  return connections.map((connection) => ({
    ...connection,
    workspaces: connection.workspaces.map((workspace) => ({
      ...workspace,
      sessions: workspace.sessions.map(withConnectorSessionState),
    })),
  }));
}
