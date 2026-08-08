import "server-only";
import type { AgentConnectionListItem } from "@/lib/agents/types";
import { agentRuntimeRegistry } from "@/lib/agents/runtime/registry";

export function withAgentRuntimeStatuses(
  connections: AgentConnectionListItem[],
  userId: string,
): AgentConnectionListItem[] {
  return connections.map((connection) => ({
    ...connection,
    workspaces: connection.workspaces.map((workspace) => ({
      ...workspace,
      sessions: workspace.sessions.map((session) => ({
        ...session,
        runtimeStatus: agentRuntimeRegistry.runtimeStatusForSession(
          session.id,
          userId,
        ),
      })),
    })),
  }));
}
